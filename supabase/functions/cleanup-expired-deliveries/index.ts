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

  const paths = expired.flatMap((delivery) => {
    const files = delivery.delivery_files?.length
      ? delivery.delivery_files
      : [{ file_path: delivery.file_path }];
    return files.map((file) => file.file_path).filter(Boolean);
  });
  const ids = expired.map((d) => d.id);

  if (paths.length) {
    const { error: storageError } = await supabase.storage.from("deliveries").remove(paths);
    if (storageError) {
      console.error("Storage cleanup error:", storageError.message);
      return new Response(JSON.stringify({ error: storageError.message }), { status: 500 });
    }
  }

  const { error: dbError } = await supabase
    .from("deliveries")
    .update({ storage_deleted_at: new Date().toISOString() })
    .in("id", ids);
  if (dbError) {
    return new Response(JSON.stringify({ error: dbError.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ cleaned: ids.length, filesRemoved: paths.length, ids }),
    { headers: { "Content-Type": "application/json" } }
  );
});
