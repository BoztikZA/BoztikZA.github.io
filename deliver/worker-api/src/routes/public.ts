// Public (unauthenticated) routes. They only ever expose ACTIVE deliveries, never
// internal columns (source_meta, analytics counters, R2 keys), and never an R2
// URL: files are streamed by this Worker behind short-lived HMAC-signed URLs.
import type { Env } from "../types";
import { HttpError } from "../types";
import { optionalSession } from "../lib/auth";
import { getDelivery, getDeliveryFile, getDeliveryFiles, iso, nowSec, parseJson, recordDownload, recordPageView, recordShare, recordView } from "../lib/db";
import { timingSafeEqual } from "../lib/ids";
import { signFileAccess, verifyFileAccess } from "../lib/sign";
import {
  extensionOf, isPreviewExtension, isValidDeliveryId, isValidFileId, isValidShareMethod, mimeForExtension,
} from "../lib/validate";
import {
  assertSameSiteOrigin, checkPublicRate, corsHeaders, error, json, readJson, requireJson, segments, wrap,
} from "./util";

const PREVIEW_TTL = 300;
const DOWNLOAD_TTL = 120;

export function handlePublic(request: Request, path: string, env: Env): Promise<Response> {
  return wrap(async () => {
    const seg = segments(path);
    switch (seg[0]) {
      case "health":
        return json({ status: "ok", service: "boztik-deliver-api", time: new Date().toISOString() });
      case "delivery":
        return routeDelivery(request, seg, env);
      case "blob":
        checkPublicRate(request, env, "blob", 4);
        return serveBlob(request, seg, env);
      case "photoshop-battles-image":
        checkPublicRate(request, env, "blob", 4);
        return servePhotoshopBattlesImage(request, seg[1] ?? "", env);
      case "pageview":
        return pageView(request, env);
      default:
        return error("Not found", 404);
    }
  });
}

const isActive = (row: { expires_at: number; files_removed_at: number | null }) =>
  row.expires_at > nowSec() && row.files_removed_at === null;

async function routeDelivery(request: Request, seg: string[], env: Env): Promise<Response> {
  checkPublicRate(request, env);
  const id = seg[1];
  if (!isValidDeliveryId(id)) return error("Not found", 404);
  const action = seg[2];

  if (!action) {
    if (request.method !== "GET") return error("Method not allowed", 405);
    return publicDelivery(id, env);
  }
  if (action === "view" && seg.length === 3) {
    if (request.method !== "POST") return error("Method not allowed", 405);
    return trackView(request, id, env);
  }
  if (action === "share" && seg.length === 3) {
    if (request.method !== "POST") return error("Method not allowed", 405);
    return trackShare(request, id, env);
  }
  if (action === "files" && seg.length === 5 && seg[4] === "access") {
    if (request.method !== "POST") return error("Method not allowed", 405);
    return fileAccess(request, id, seg[3] ?? "", env);
  }
  return error("Not found", 404);
}

/** Does NOT count a view (the page records that explicitly via POST /view, so
 *  admin previews and prefetches never inflate the numbers). */
async function publicDelivery(id: string, env: Env): Promise<Response> {
  const row = await getDelivery(env, id);
  if (!row) return error("Not found", 404, { code: "not_found" });

  if (!isActive(row)) {
    // Expired / cleaned: reveal only what the branded "expired" page needs.
    return json({
      ok: true,
      delivery: {
        id: row.id,
        expired: true,
        expires_at: iso(row.expires_at),
        support_enabled: row.support_enabled === 1,
        is_photoshop_battles: row.is_photoshop_battles === 1,
        delivery_files: [],
      },
    });
  }

  const files = await getDeliveryFiles(env, id);
  return json({
    ok: true,
    delivery: {
      id: row.id,
      expired: false,
      project_name: row.project_name,
      client_name: row.client_name,
      notes: row.notes,
      created_at: iso(row.created_at),
      expires_at: iso(row.expires_at),
      support_enabled: row.support_enabled === 1,
      is_photoshop_battles: row.is_photoshop_battles === 1,
      reddit_source: parseJson<Record<string, unknown>>(row.reddit_source),
      file_size: files.reduce((s, f) => s + f.file_size, 0),
      delivery_files: files.map((f) => ({
        id: f.id,
        file_path: f.id, // opaque id — the client never learns a storage path
        delivery_id: row.id,
        file_name: f.file_name,
        file_size: f.file_size,
        mime: f.content_type ?? "application/octet-stream",
        content_type: f.content_type ?? "application/octet-stream",
      })),
    },
  });
}

async function trackView(request: Request, id: string, env: Env): Promise<Response> {
  assertSameSiteOrigin(request, env);
  let preview = false;
  try { preview = (await readJson(request, 1024)).preview === true; } catch { /* no body is fine */ }
  // preview=1 only suppresses counting when it comes with a VALID admin session.
  if (preview && (await optionalSession(request, env))) return json({ ok: true, counted: false, reason: "admin_preview" });
  return json({ ok: true, counted: await recordView(env, id) });
}

/** Records a share/copy action fired from the delivery page. Never throws — sharing
 *  must never be blocked or slowed by analytics. Unknown methods are ignored, and
 *  only ACTIVE deliveries count (recordShare enforces that). */
async function trackShare(request: Request, id: string, env: Env): Promise<Response> {
  assertSameSiteOrigin(request, env);
  let method = "";
  try { const b = await readJson(request, 1024); method = typeof b.method === "string" ? b.method : ""; } catch { /* no body -> nothing to record */ }
  if (!isValidShareMethod(method)) return json({ ok: true, counted: false });
  return json({ ok: true, counted: await recordShare(env, id, method) });
}

async function fileAccess(request: Request, deliveryId: string, fileId: string, env: Env): Promise<Response> {
  assertSameSiteOrigin(request, env);
  requireJson(request);
  if (!isValidFileId(fileId)) return error("Not found", 404);
  const body = await readJson(request, 1024);
  const intent = body.intent === "preview" ? "preview" : body.intent === "download" ? "download" : null;
  if (!intent) throw new HttpError(400, "invalid_intent", "intent must be 'preview' or 'download'.");

  const row = await getDelivery(env, deliveryId);
  if (!row) return error("Not found", 404);
  if (!isActive(row)) throw new HttpError(410, "expired", "This delivery has expired.");
  const file = await getDeliveryFile(env, deliveryId, fileId);
  if (!file) return error("Not found", 404);
  if (intent === "preview" && !isPreviewExtension(extensionOf(file.file_name))) {
    throw new HttpError(415, "not_previewable", "This file type cannot be previewed.");
  }

  const ttl = intent === "preview" ? PREVIEW_TTL : DOWNLOAD_TTL;
  const { exp, sig } = await signFileAccess(env, intent === "preview" ? "p" : "d", deliveryId, fileId, ttl);
  const base = new URL(request.url).origin;
  return json({
    ok: true,
    url: `${base}/api/public/blob/${deliveryId}/${fileId}?m=${intent === "preview" ? "p" : "d"}&e=${exp}&s=${sig}`,
    expires_in: ttl,
  });
}

// -----------------------------------------------------------------------------
// File bytes
// -----------------------------------------------------------------------------
function parseRange(header: string | null, size: number): { offset: number; length: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") { // suffix range
    const n = Number(m[2]);
    if (n <= 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || start >= size || end < start) return "invalid";
  return { offset: start, length: end - start + 1 };
}

function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\;]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const FILE_SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
};

async function serveBlob(request: Request, seg: string[], env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return error("Method not allowed", 405);
  const deliveryId = seg[1];
  const fileId = seg[2];
  if (!isValidDeliveryId(deliveryId) || !isValidFileId(fileId) || seg.length !== 3) return error("Not found", 404);

  const q = new URL(request.url).searchParams;
  const mode = q.get("m") ?? "";
  if (!(await verifyFileAccess(env, mode, deliveryId, fileId, q.get("e") ?? "", q.get("s") ?? ""))) {
    return error("This link is invalid or has expired.", 403, { code: "bad_signature" });
  }

  // Authorization is re-checked at read time, so expiry beats a still-valid signature.
  const row = await getDelivery(env, deliveryId);
  if (!row || !isActive(row)) return error("This delivery has expired.", 410, { code: "expired" });
  const file = await getDeliveryFile(env, deliveryId, fileId);
  if (!file) return error("Not found", 404);

  const ext = extensionOf(file.file_name);
  const inline = mode === "p" && isPreviewExtension(ext);
  const range = parseRange(request.headers.get("Range"), file.file_size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...FILE_SECURITY, "Content-Range": `bytes */${file.file_size}` } });

  const obj = await env.BUCKET.get(file.r2_key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!obj) return error("The file is no longer available.", 410, { code: "missing" });

  const headers: Record<string, string> = {
    ...corsHeaders(request, env, "public"),
    ...FILE_SECURITY,
    "Content-Type": mimeForExtension(ext),
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.file_name),
    "Accept-Ranges": "bytes",
    "Content-Length": String(range ? range.length : file.file_size),
  };
  if (range) headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${file.file_size}`;

  // Count a download only when a full download actually starts (not HEAD, not a resumed range).
  if (mode === "d" && request.method === "GET" && (!range || range.offset === 0)) {
    try { await recordDownload(env, deliveryId); } catch (e) { console.error("recordDownload failed", e); }
  }
  if (request.method === "HEAD") { await obj.body?.cancel(); return new Response(null, { status: range ? 206 : 200, headers }); }
  return new Response(obj.body, { status: range ? 206 : 200, headers });
}

/** Stable direct image URL for Reddit: /photoshop-battles-image/<id>--<token>.<jpg|png> */
async function servePhotoshopBattlesImage(request: Request, name: string, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return error("Method not allowed", 405);
  const m = /^(BZ-[A-Z0-9]{6,12})--([a-f0-9]{32})\.(jpg|jpeg|png)$/i.exec(decodeURIComponent(name).slice(0, 120));
  if (!m) return error("Invalid PhotoshopBattles image URL.", 400);
  const [, id, token, rawExt] = m as unknown as [string, string, string, string];

  const row = await getDelivery(env, id);
  const meta = row ? parseJson<{ type?: string; direct_token?: string }>(row.source_meta) : null;
  // One uniform 404 for "no such delivery", "not a battle" and "wrong token".
  if (!row || row.is_photoshop_battles !== 1 || meta?.type !== "photoshop_battles" || typeof meta.direct_token !== "string"
      || !timingSafeEqual(meta.direct_token, token)) {
    return error("Image not found.", 404);
  }
  if (!isActive(row)) return error("This image has expired.", 410, { code: "expired" });

  const file = (await getDeliveryFiles(env, id))[0];
  const fileExt = extensionOf(file?.file_name ?? "");
  const norm = (e: string | null) => (e === "jpeg" ? "jpg" : e);
  if (!file || (fileExt !== "jpg" && fileExt !== "jpeg" && fileExt !== "png") || norm(fileExt) !== norm(rawExt.toLowerCase())) {
    return error("Image not found.", 404);
  }
  const obj = await env.BUCKET.get(file.r2_key);
  if (!obj) return error("Image not found.", 404);

  if (request.method === "GET") {
    try { await recordView(env, id); } catch (e) { console.error("battle view failed", e); }
  }
  const headers = {
    ...corsHeaders(request, env, "public"),
    ...FILE_SECURITY,
    "Content-Type": mimeForExtension(fileExt),
    "Content-Disposition": contentDisposition("inline", file.file_name),
    "Content-Length": String(file.file_size),
  };
  if (request.method === "HEAD") { await obj.body?.cancel(); return new Response(null, { status: 200, headers }); }
  return new Response(obj.body, { status: 200, headers });
}

// -----------------------------------------------------------------------------
async function pageView(request: Request, env: Env): Promise<Response> {
  checkPublicRate(request, env, "pageview");
  if (request.method !== "POST") return error("Method not allowed", 405);
  assertSameSiteOrigin(request, env);
  if (env.PAGE_ANALYTICS_ALLOWED !== "1") return json({ ok: true, counted: false });
  const b = await readJson(request, 512);
  const page = typeof b.page === "string" ? b.page : "";
  return json({ ok: true, counted: await recordPageView(env, page) });
}
