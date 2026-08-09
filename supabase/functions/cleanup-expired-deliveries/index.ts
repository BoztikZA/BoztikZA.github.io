// Boztik Deliver — deliver-file Edge Function
//
// Runs server-side only. Uses the service-role key (from environment,
// never sent to or stored in the browser) to validate a delivery/file
// request and mint a short-lived signed Storage URL. Replaces direct
// anon-role createSignedUrl() calls from the browser.
//
// Deploy: supabase functions deploy deliver-file
// Required secrets (see deployment notes below):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase
//   ALLOWED_ORIGIN — e.g. https://boztikza.github.io

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://boztikza.github.io";
const STORAGE_BUCKET = "deliveries";
const PREVIEW_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { deliveryId?: string; filePath?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_request", message: "Request body must be JSON." }, 400);
  }

  const { deliveryId, filePath, mode } = body;
  if (!deliveryId || typeof deliveryId !== "string") return json({ error: "invalid_delivery_id" }, 400);
  if (!filePath || typeof filePath !== "string") return json({ error: "invalid_file_path" }, 400);
  if (mode !== "preview" && mode !== "download") return json({ error: "invalid_mode", message: "mode must be 'preview' or 'download'." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_misconfigured" }, 500);

  // Service-role client — bypasses RLS deliberately, since THIS function
  // is now the trust boundary instead of anon-role Storage policies.
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: delivery, error: deliveryError } = await supabase
    .from("deliveries")
    .select("id, expires_at, file_path")
    .eq("id", deliveryId)
    .maybeSingle();

  if (deliveryError) return json({ error: "lookup_failed", message: deliveryError.message }, 500);
  if (!delivery) return json({ error: "delivery_not_found" }, 404);
  if (new Date(delivery.expires_at).getTime() <= Date.now()) return json({ error: "delivery_expired" }, 410);

  // Verify the requested file actually belongs to this delivery — checks
  // both the multi-file table and the legacy single-file column, so one
  // delivery's ID can never be used to sign a path from another delivery.
  let belongsToDelivery = delivery.file_path === filePath;
  if (!belongsToDelivery) {
    const { data: fileRow, error: fileError } = await supabase
      .from("delivery_files")
      .select("file_path")
      .eq("delivery_id", deliveryId)
      .eq("file_path", filePath)
      .maybeSingle();
    if (fileError) return json({ error: "lookup_failed", message: fileError.message }, 500);
    belongsToDelivery = !!fileRow;
  }
  if (!belongsToDelivery) return json({ error: "file_not_in_delivery" }, 403);

  const ttl = mode === "preview" ? PREVIEW_TTL_SECONDS : DOWNLOAD_TTL_SECONDS;
  const signOptions = mode === "download" ? { download: filePath.split("/").pop() } : undefined;

  const { data: signed, error: signError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(filePath, ttl, signOptions);

  if (signError || !signed) return json({ error: "signing_failed", message: signError?.message ?? "Unknown signing error" }, 502);

  return json({ signedUrl: signed.signedUrl, expiresIn: ttl });
});