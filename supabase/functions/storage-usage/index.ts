// Boztik Deliver: returns authoritative Supabase storage usage for the
// Command Centre "Storage & usage" panel.
//
// Storage size is measured byte-exact from the storage.objects catalog via
// the SECURITY DEFINER RPC public.storage_usage_summary() (see the
// 20260918000000_storage_usage_monitor migration). The Management API does
// not expose per-project egress bytes, so egress is reported as "not
// available" rather than a misleading zero.
//
// Security: only a signed-in dashboard user (any valid auth session) may read
// usage; the RPC itself is restricted to service_role, so this function is the
// single gateway. Never expose the service-role key client-side.
//
// Deploy with: supabase functions deploy storage-usage --project-ref <ref>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["https://boztikza.github.io", "https://boztik.com"];

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin ?? "") ? origin! : "https://boztik.com",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

const json = (body: unknown, request: Request, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" }
  });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, request, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    return json({ error: "server_misconfigured" }, request, 500);
  }

  // Verify the caller holds a valid sign-in session. Usage is admin-only.
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json({ error: "unauthorized", message: "A valid sign-in session is required." }, request, 401);

  const verifyClient = createClient(url, anonKey);
  const { data: { user } = {}, error: authError } = await verifyClient.auth.getUser(token);
  if (authError || !user) {
    return json({ error: "unauthorized", message: "Your sign-in session is invalid or expired." }, request, 401);
  }

  const supabase = createClient(url, serviceRoleKey);
  const { data, error: rpcError } = await supabase.rpc("storage_usage_summary");
  if (rpcError) {
    console.error("[storage-usage] rpc failed:", rpcError);
    return json({ error: "usage_unavailable", message: "Could not read storage usage right now." }, request, 502);
  }

  return json({
    storage: data || null,
    egress: {
      available: false,
      note: "Per-project egress (GB) is not exposed by the Supabase API. See the Supabase dashboard usage page for egress."
    }
  }, request);
});