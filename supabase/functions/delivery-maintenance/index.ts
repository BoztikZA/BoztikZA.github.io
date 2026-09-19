// Authoritative, fail-closed administration for Deliver storage lifecycle.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ORIGINS = new Set(["https://boztikza.github.io", "https://boztik.com", "https://www.boztik.com"]);
const BUCKET = "deliveries";
const cors = (request: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(request.headers.get("Origin") || "") ? request.headers.get("Origin")! : "https://www.boztik.com",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin"
});
const reply = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(request), "Content-Type": "application/json" } });

function configuredAdmins() {
  return new Set((Deno.env.get("DELIVERY_ADMIN_USER_IDS") || "").split(",").map(id => id.trim()).filter(Boolean));
}

async function requireAdmin(request: Request, url: string, anonKey: string) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(url, anonKey);
  const { data: { user }, error } = await client.auth.getUser(token);
  const admins = configuredAdmins();
  if (error || !user || !admins.size || !admins.has(user.id)) return null;
  return user;
}

async function storagePaths(admin: ReturnType<typeof createClient>, deliveryId: string) {
  const { data: delivery, error } = await admin.from("deliveries").select("id,file_path").eq("id", deliveryId).maybeSingle();
  if (error) throw new Error(`Delivery lookup failed: ${error.message}`);
  if (!delivery) return null;
  const { data: files, error: filesError } = await admin.from("delivery_files").select("file_path").eq("delivery_id", deliveryId);
  if (filesError) throw new Error(`File metadata lookup failed: ${filesError.message}`);
  return [...new Set([delivery.file_path, ...(files || []).map(file => file.file_path)].filter(Boolean))];
}

async function deleteOne(admin: ReturnType<typeof createClient>, deliveryId: string) {
  const paths = await storagePaths(admin, deliveryId);
  if (paths === null) return { status: "already_deleted", delivery_id: deliveryId, paths: [] };
  if (paths.length) {
    const { error } = await admin.storage.from(BUCKET).remove(paths);
    if (error && !/not found|not exist|no such object|missing/i.test(error.message || "")) {
      return { status: "failed", delivery_id: deliveryId, paths, message: `Storage deletion failed: ${error.message}` };
    }
    const { data: present, error: verifyError } = await admin.rpc("delivery_storage_paths_present", { p_paths: paths });
    if (verifyError) return { status: "failed", delivery_id: deliveryId, paths, message: `Storage verification failed: ${verifyError.message}` };
    if (present?.length) return { status: "partial_failure", delivery_id: deliveryId, paths, remaining_paths: present, message: "Storage file(s) could not be verified as deleted. No metadata was removed." };
  }
  const { error: filesError } = await admin.from("delivery_files").delete().eq("delivery_id", deliveryId);
  if (filesError) return { status: "partial_failure", delivery_id: deliveryId, paths, message: `Storage was removed but file metadata could not be removed: ${filesError.message}` };
  const { error: deliveryError } = await admin.from("deliveries").delete().eq("id", deliveryId);
  if (deliveryError) return { status: "partial_failure", delivery_id: deliveryId, paths, message: `Storage was removed but delivery metadata could not be removed: ${deliveryError.message}` };
  return { status: "success", delivery_id: deliveryId, paths, analytics_retained: true };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== "POST") return reply(request, { error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(request, { error: "server_misconfigured" }, 500);
  if (!await requireAdmin(request, url, anon)) return reply(request, { error: "unauthorized", message: "A permitted administrator session is required." }, 403);
  const admin = createClient(url, service);
  let input: { action?: string; delivery_id?: string; confirm?: boolean; limit?: number };
  try { input = await request.json(); } catch { return reply(request, { error: "invalid_request" }, 400); }
  if (input.action === "usage") {
    const { data, error } = await admin.rpc("storage_usage_summary");
    if (error || !data) return reply(request, { error: "usage_unavailable", message: error?.message || "Could not read storage usage." }, 502);
    return reply(request, {
      usage: data,
      // Compatibility shape keeps the existing panel small while exposing the
      // explicit quota fields above for callers that need them.
      storage: { totals: { bytes: Number(data.used_bytes || 0), objects: Number(data.object_count || 0) }, buckets: { deliveries: { bytes: Number(data.used_bytes || 0), objects: Number(data.object_count || 0) }, }, generated_at: data.generated_at },
      egress: { available: false }
    });
  }
  if (input.action === "delete") {
    if (!input.delivery_id) return reply(request, { error: "invalid_request" }, 400);
    const result = await deleteOne(admin, input.delivery_id);
    return reply(request, result, result.status === "success" || result.status === "already_deleted" ? 200 : 409);
  }
  if (input.action === "cleanup_preview" || input.action === "cleanup_execute") {
    const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 50);
    const { data, error } = await admin.from("deliveries").select("id,project_name,client_name,expires_at,file_path,delivery_files(file_path)").lt("expires_at", new Date().toISOString()).order("expires_at").limit(limit);
    if (error) return reply(request, { error: "lookup_failed", message: error.message }, 500);
    const report = (data || []).map(d => ({ delivery_id: d.id, project_name: d.project_name, client_name: d.client_name, expires_at: d.expires_at, paths: [...new Set([d.file_path, ...(d.delivery_files || []).map((f: { file_path: string }) => f.file_path)].filter(Boolean))] }));
    const { data: orphanReport, error: orphanError } = await admin.rpc("delivery_orphan_storage_preview");
    if (orphanError) return reply(request, { error: "preview_unavailable", message: orphanError.message }, 502);
    if (input.action === "cleanup_preview") return reply(request, { status: "preview", deliveries: report, count: report.length, capped_at: limit, ...orphanReport });
    if (!input.confirm) return reply(request, { error: "confirmation_required", deliveries: report }, 400);
    const results = [];
    for (const item of report) results.push(await deleteOne(admin, item.delivery_id));
    return reply(request, { status: results.some(r => r.status === "failed" || r.status === "partial_failure") ? "partial_failure" : "success", results, orphan_storage_not_deleted: orphanReport?.orphan_storage_count || 0 });
  }
  return reply(request, { error: "invalid_action" }, 400);
});
