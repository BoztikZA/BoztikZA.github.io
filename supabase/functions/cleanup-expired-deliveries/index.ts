// Retired: cleanup is now an explicit, reviewable administrator operation in
// delivery-maintenance. This endpoint deliberately cannot delete anything.
Deno.serve(() => new Response(JSON.stringify({
  error: "manual_cleanup_required",
  message: "Expired-delivery cleanup is disabled here. Use delivery-maintenance cleanup_preview, review the report, then call cleanup_execute with confirm=true."
}), { status: 410, headers: { "Content-Type": "application/json" } }));
