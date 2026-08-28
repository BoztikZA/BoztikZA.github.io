// Boztik Deliver: securely issues short-lived URLs for files belonging to an
// active delivery. Deploy with: supabase functions deploy deliver-file
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let input: { deliveryId?: string; filePath?: string; fileName?: string; mode?: "preview" | "download" };
  try { input = await request.json(); } catch { return json({ error: "invalid_request" }, request, 400); }
  if (!input.deliveryId || !input.filePath || !["preview", "download"].includes(input.mode ?? "")) {
    return json({ error: "invalid_request", message: "A delivery, file and valid mode are required." }, request, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return json({ error: "server_misconfigured" }, request, 500);
  const supabase = createClient(url, serviceRoleKey);

  const { data: delivery, error: deliveryError } = await supabase
    .from("deliveries").select("id, expires_at, file_path").eq("id", input.deliveryId).maybeSingle();
  if (deliveryError) return json({ error: "lookup_failed" }, request, 500);
  if (!delivery) return json({ error: "delivery_not_found" }, request, 404);
  if (new Date(delivery.expires_at).getTime() <= Date.now()) return json({ error: "delivery_expired" }, request, 410);

  let belongsToDelivery = delivery.file_path === input.filePath;
  if (!belongsToDelivery) {
    const { data: file } = await supabase.from("delivery_files")
      .select("file_path").eq("delivery_id", input.deliveryId).eq("file_path", input.filePath).maybeSingle();
    belongsToDelivery = Boolean(file);
  }
  if (!belongsToDelivery) return json({ error: "file_not_in_delivery" }, request, 403);

  const ttl = input.mode === "preview" ? 300 : 60;
  const download = input.mode === "download" ? { download: input.fileName || input.filePath.split("/").pop() } : undefined;
  const { data, error } = await supabase.storage.from("deliveries").createSignedUrl(input.filePath, ttl, download);
  if (error || !data?.signedUrl) return json({ error: "signing_failed" }, request, 502);
  return json({ signedUrl: data.signedUrl, expiresIn: ttl }, request);
});
