// =========================================================
// BOZTIK DELIVER — cleanup-expired-deliveries
// Supabase Edge Function
//
// Deletes only stored files for deliveries whose expires_at has passed,
// retaining delivery records and their analytics. GitHub Pages is static and can't run this on a
// schedule itself, so this function is deployed to Supabase and
// invoked on a cron schedule (see supabase/CLEANUP_SETUP.md).
//
// Deploy:
//   supabase functions deploy cleanup-expired-deliveries
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

  // Process each delivery independently so one delivery's Storage
  // error (bad path, transient network blip, etc.) can't block the
  // rest of the batch from being cleaned up. A delivery is only ever
  // marked storage_deleted_at after its own Storage removal has
  // actually succeeded — analytics (view_count, download_count,
  // delivery_analytics) are never touched here, and a failed
  // delivery is simply left for the next run to retry.
  const cleaned = [];
  const failed = [];
  let filesRemoved = 0;

  for (const delivery of expired) {
    const files = delivery.delivery_files?.length
      ? delivery.delivery_files
      : delivery.file_path
        ? [{ file_path: delivery.file_path }]
        : [];
    const paths = files.map((file) => file.file_path).filter(Boolean);

    if (paths.length) {
      const { error: storageError } = await supabase.storage.from("deliveries").remove(paths);
      if (storageError) {
        console.error(`Storage cleanup error for ${delivery.id}:`, storageError.message);
        failed.push({ id: delivery.id, error: storageError.message });
        continue;
      }
      filesRemoved += paths.length;
    }

    // Nothing to remove (already gone / never had a path) counts as
    // successfully cleaned, per the idempotent-cleanup requirement.
    const { error: dbError } = await supabase
      .from("deliveries")
      .update({ storage_deleted_at: new Date().toISOString() })
      .eq("id", delivery.id);

    if (dbError) {
      console.error(`Failed to mark ${delivery.id} as cleaned:`, dbError.message);
      failed.push({ id: delivery.id, error: dbError.message });
      continue;
    }

    cleaned.push(delivery.id);
  }

  return new Response(
    JSON.stringify({
      cleaned: cleaned.length,
      failed: failed.length,
      filesRemoved,
      ids: cleaned,
      failures: failed
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});