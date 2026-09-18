// =========================================================
// BOZTIK DELIVER — cleanup-expired-deliveries
// Supabase Edge Function
//
// Deletes only stored files for deliveries whose expires_at has passed,
// retaining delivery records and their analytics. GitHub Pages is static and can't run this on a
// schedule itself, so this function is deployed to Supabase and invoked on a
// cron schedule every 30 minutes (see supabase/CLEANUP_SETUP.md and
// supabase/cron/jobs.sql).
//
// Deploy:
//   supabase functions deploy cleanup-expired-deliveries
//   supabase secrets set CLEANUP_SECRET=...            (shared secret the cron job sends)
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... (auto-available
//     as SUPABASE_SERVICE_ROLE_KEY in the function runtime already)
// =========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  // Optional shared-secret check so this endpoint can't be triggered
  // by randoms — set CLEANUP_SECRET as a function secret and pass it
  // as a header from your cron trigger.
  const expectedSecret = Deno.env.get("CLEANUP_SECRET");
  if (expectedSecret) {
    const provided = req.headers.get("x-cleanup-secret");
    if (provided !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: expired, error: fetchError } = await supabase
    .from("deliveries")
    .select("id, file_path, delivery_files(file_path)")
    .lt("expires_at", new Date().toISOString())
    .is("storage_deleted_at", null);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  if (!expired || expired.length === 0) {
    return new Response(JSON.stringify({ deleted: 0, message: "Nothing to clean up." }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Process deliveries independently. A transient error on one object must
  // not prevent unrelated expired files from being reclaimed, and a row is
  // marked only after its own Storage removal succeeds.
  const cleaned = [];
  const failed = [];
  let filesRemoved = 0;

  for (const delivery of expired) {
    const files = delivery.delivery_files?.length
      ? delivery.delivery_files
      : delivery.file_path ? [{ file_path: delivery.file_path }] : [];
    // Deduplicate so a legacy single-file delivery whose path also exists in
    // delivery_files is not asked to be removed twice.
    const paths = [...new Set(files.map((file) => file.file_path).filter(Boolean))];

    if (paths.length) {
      const { error: storageError } = await supabase.storage.from("deliveries").remove(paths);
      // An object that reports as already-gone is success — there is nothing
      // left to delete. This happens when an earlier run (or a manual delete,
      // or an interrupted run where Storage removal succeeded but the
      // storage_deleted_at marker did not persist) already removed the file.
      // Treating "not found" as success keeps cleanup idempotent and lets the
      // DB marker below settle the row instead of entering a permanent retry.
      const alreadyGone = storageError &&
        /not found|not exist|no such object|missing|doesn'?t exist/i.test(`${storageError.message}`);
      if (storageError && !alreadyGone) {
        console.error(`Storage cleanup error for ${delivery.id}:`, storageError.message);
        failed.push({ id: delivery.id, error: storageError.message });
        continue;
      }
      filesRemoved += paths.length;
    }

    const { error: dbError } = await supabase.from("deliveries")
      .update({ storage_deleted_at: new Date().toISOString() }).eq("id", delivery.id);
    if (dbError) {
      console.error(`Failed to mark ${delivery.id} as cleaned:`, dbError.message);
      failed.push({ id: delivery.id, error: dbError.message });
      continue;
    }
    cleaned.push(delivery.id);
  }

  console.log(`[cleanup-expired-deliveries] expired=${expired.length} cleaned=${cleaned.length} failed=${failed.length} filesRemoved=${filesRemoved}`);
  if (failed.length) {
    console.error(`[cleanup-expired-deliveries] failed delivery files:`, failed.map((f) => `${f.id}: ${f.error}`).join(" | "));
  }

  return new Response(
    JSON.stringify({ cleaned: cleaned.length, failed: failed.length, filesRemoved, ids: cleaned, failures: failed }),
    { headers: { "Content-Type": "application/json" } }
  );
});
