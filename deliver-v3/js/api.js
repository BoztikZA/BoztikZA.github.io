// Boztik Deliver API client (Cloudflare Worker + D1 + R2).
//
// The browser talks ONLY to the Worker. It never receives an R2 credential, an
// R2 URL, or a storage path: files move through the Worker, and downloads use
// short-lived signed Worker URLs. The exported function names/shapes are the same
// ones dashboard.js and client.js already use, so the UI code is unchanged.
import { config } from "./config.js";
import { authHeaders, clearLocalSession } from "./auth.js";
import { StorageLimitError, evaluateStorageGuard, readStorageUsage } from "./storage-guard.js";

export const DELIVERY_SOURCES = Object.freeze(["reddit", "private", "paid", "free", "returning", "other"]);

export class ApiError extends Error {
  constructor(message, { status = 0, code = "", details = {} } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, { body, auth = true, headers = {}, signal } = {}) {
  const init = { method, signal, headers: { ...(auth ? authHeaders() : {}), ...headers } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, init);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError("Could not reach the Boztik Deliver server. Check your connection and try again.", { code: "network" });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && auth) clearLocalSession(); // session expired / revoked -> dashboard shows sign-in
    throw toError(response.status, data);
  }
  return data ?? {};
}

function toError(status, data) {
  const code = data?.code || "";
  const message = data?.error || `Request failed (HTTP ${status}).`;
  if (code === "storage_full") {
    const d = data;
    return new StorageLimitError(d.remaining_bytes > 0 ? "insufficient" : "full", {
      usedBytes: d.used_bytes, incomingBytes: d.incoming_bytes, remainingBytes: d.remaining_bytes, limitBytes: d.limit_bytes
    });
  }
  if (code === "storage_locked") return new StorageLimitError("full", {});
  if (code === "storage_unverified") return new StorageLimitError("unverified", {});
  return new ApiError(message, { status, code, details: data || {} });
}

/* ------------------------------------------------------------------ shapes */
function normalizeDelivery(d) {
  return {
    ...d,
    file_size: d.total_file_size ?? 0,
    storage_deleted_at: d.files_removed_at || null,
    delivery_files: (d.files || []).map(f => ({
      id: f.id, delivery_id: d.id, file_path: f.id, file_name: f.file_name,
      file_size: f.file_size, file_type: f.content_type, created_at: d.created_at
    })),
    lifetime_views: Number(d.view_count || 0),
    lifetime_downloads: Number(d.download_count || 0),
    monthly_views: Number(d.monthly_views || 0),
    monthly_downloads: Number(d.monthly_downloads || 0)
  };
}

/* ---------------------------------------------------------------- deliveries */
export async function listDeliveries(params = {}) {
  const q = new URLSearchParams({ limit: "200", ...params });
  const { items } = await request("GET", `/api/admin/deliveries?${q}`);
  return items.map(normalizeDelivery);
}

/** Fresh, authoritative usage straight from the Worker (fail-closed if unreadable). */
export async function fetchStorageUsage() {
  const { storage } = await request("GET", "/api/admin/storage");
  // used_bytes counts in-flight reservations too — exactly what the Worker's guard counts.
  const used = storage.used_bytes + storage.reserved_bytes;
  return {
    storage,
    usage: { used_bytes: used, object_count: storage.file_count ?? 0, generated_at: storage.last_reconciled_at }
  };
}

/** Instant friendly pre-check. The Worker re-checks atomically; this only saves a round trip. */
export async function assertStorageCapacity(incomingBytes) {
  let usage = null;
  let cause = null;
  try { usage = readStorageUsage(await fetchStorageUsage()); } catch (error) { cause = error; console.error("[Boztik Deliver] Storage check failed:", error); }
  if (!usage) throw new StorageLimitError("unverified", { cause });
  const verdict = evaluateStorageGuard({ usedBytes: usage.usedBytes, incomingBytes });
  if (!verdict.allowed) throw new StorageLimitError(verdict.reason, verdict);
  return { ...usage, ...verdict };
}

const totalBytes = items => (items || []).reduce((t, i) => t + Math.max(0, Number(i?.size ?? i?.file_size) || 0), 0);

/** PUT with real byte-level progress (fetch cannot report upload progress). */
function putFile(uploadId, file, onBytes) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${config.apiBaseUrl}/api/admin/uploads/${uploadId}`);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onBytes(event.loaded); };
    xhr.onerror = () => reject(new ApiError("The upload was interrupted. Nothing was saved.", { code: "network" }));
    xhr.onabort = () => reject(new ApiError("The upload was cancelled.", { code: "aborted" }));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401) clearLocalSession();
      reject(toError(xhr.status, data));
    };
    xhr.send(file);
  });
}

/**
 * reserve (server-side 3 GB guard, BEFORE any byte moves) -> stream bytes to R2 ->
 * finalise the delivery atomically. Any failure aborts every upload made so far so
 * nothing is left behind in R2 or counted against the cap.
 */
export async function createDelivery(metadata, files, onProgress) {
  if (!metadata?.id || !files?.length) throw new Error("A delivery ID and at least one file are required.");
  const isBattle = metadata.source_meta?.type === "photoshop_battles";
  await assertStorageCapacity(totalBytes(files));

  const total = totalBytes(files) || 1;
  const uploadIds = [];
  let done = 0;
  try {
    for (const file of files) {
      const reserved = await request("POST", "/api/admin/uploads", {
        body: { delivery_id: metadata.id, file_name: file.name, file_size: file.size, is_photoshop_battles: isBattle }
      });
      uploadIds.push(reserved.upload_id);
      await putFile(reserved.upload_id, file, loaded => onProgress?.((done + loaded) / total));
      done += file.size;
      onProgress?.(done / total);
    }
    const { delivery } = await request("POST", "/api/admin/deliveries", {
      body: {
        id: metadata.id, project_name: metadata.project_name, client_name: metadata.client_name, notes: metadata.notes,
        expires_at: metadata.expires_at, source: metadata.source, source_meta: metadata.source_meta,
        reddit_source: metadata.reddit_source ?? null, support_enabled: metadata.support_enabled, upload_ids: uploadIds
      }
    });
    return normalizeDelivery(delivery);
  } catch (error) {
    await Promise.allSettled(uploadIds.map(id => request("DELETE", `/api/admin/uploads/${id}`)));
    throw error;
  }
}

export async function updateDelivery(deliveryId, updates = {}) {
  if (!deliveryId) throw new Error("A delivery ID is required.");
  const allowed = ["project_name", "client_name", "notes", "expires_at", "source", "source_meta", "reddit_source"];
  const payload = Object.fromEntries(Object.entries(updates).filter(([key]) => allowed.includes(key)));
  if (!Object.keys(payload).length) throw new Error("No editable fields were supplied.");
  if (payload.expires_at) {
    const at = new Date(payload.expires_at);
    if (Number.isNaN(at.getTime())) throw new Error("The expiry date/time is invalid.");
    payload.expires_at = at.toISOString();
  }
  const { delivery } = await request("PATCH", `/api/admin/deliveries/${encodeURIComponent(deliveryId)}`, { body: payload });
  return normalizeDelivery(delivery);
}

/** R2 objects are removed first; D1 records only after R2 confirms. Throws if R2 deletion failed. */
export async function deleteDelivery(delivery) {
  if (!delivery?.id) throw new Error("A delivery ID is required.");
  const result = await request("DELETE", `/api/admin/deliveries/${encodeURIComponent(delivery.id)}`);
  if (result.status !== "deleted" && result.status !== "already_deleted") throw new Error("Deletion was not confirmed by the server.");
  return { ...result, status: "success", message: "Delivery deleted." };
}

/** Server-side copy; every byte is reserved against the 3 GB cap first. Returns the new id. */
export async function duplicateDelivery(delivery) {
  const { delivery: copy } = await request("POST", `/api/admin/deliveries/${encodeURIComponent(delivery.id)}/duplicate`);
  return copy.id;
}

export const cleanExpiredDeliveries = () => request("POST", "/api/admin/cleanup");
export const reconcileStorage = () => request("POST", "/api/admin/storage/reconcile");
export const fetchDeliveryAnalytics = id => request("GET", `/api/admin/deliveries/${encodeURIComponent(id)}/analytics`);

/* ---------------------------------------------------------- Command Centre */
export const fetchOverview = () => request("GET", "/api/admin/analytics/overview");
export const fetchTimeseries = range => request("GET", `/api/admin/analytics/timeseries?range=${encodeURIComponent(range)}`);
export const fetchTopDeliveries = () => request("GET", "/api/admin/analytics/top");
/** Per-page view counts (last 30 days) recorded by the site's first-party page-view counter. */
export const fetchPageAnalytics = () => request("GET", "/api/admin/analytics/pages");

/** Unauthenticated reachability probe of the Worker. Never throws; reports latency for the health chip. */
export async function pingHealth() {
  const started = performance.now();
  try {
    const response = await fetch(`${config.apiBaseUrl}/api/health`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    return { ok: response.ok && data?.status === "ok", ms: Math.round(performance.now() - started), status: response.status };
  } catch {
    return { ok: false, ms: null, status: 0 };
  }
}

/* ----------------------------------------------------------------- public */
/** null => not found (shown as the "expired" state). Expired deliveries come back with expired:true and no files. */
export async function getPublicDelivery(id) {
  let response;
  try { response = await fetch(`${config.apiBaseUrl}/api/public/delivery/${encodeURIComponent(id)}`); }
  catch { throw new ApiError("Could not reach the Boztik Deliver server.", { code: "network" }); }
  if (response.status === 404) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.delivery) throw new ApiError(data?.error || `Could not load this delivery (HTTP ${response.status}).`, { status: response.status });
  return data.delivery;
}

/** The Worker decides whether to count it: preview=true only skips counting for a valid admin session. */
export async function recordView(id, { preview = false } = {}) {
  try {
    const headers = { "Content-Type": "application/json", ...(preview ? authHeaders() : {}) };
    const response = await fetch(`${config.apiBaseUrl}/api/public/delivery/${encodeURIComponent(id)}/view`, {
      method: "POST", headers, body: JSON.stringify({ preview })
    });
    return response.ok;
  } catch (error) { console.error("[Boztik Deliver] recordView failed:", error); return false; }
}

/** Downloads are counted server-side when the file actually starts streaming, so this is a no-op. */
export const recordDownload = async () => true;

async function signedUrl(file, intent) {
  const response = await fetch(`${config.apiBaseUrl}/api/public/delivery/${encodeURIComponent(file.delivery_id)}/files/${encodeURIComponent(file.id)}/access`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent })
  }).catch(() => { throw new ApiError("Could not reach the Boztik Deliver server.", { code: "network" }); });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.url) throw new ApiError(response.status === 410 ? "This delivery has expired." : data?.error || "Could not prepare this file.", { status: response.status });
  return data.url;
}
export const signedDownload = file => signedUrl(file, "download");
export const signedPreview = file => signedUrl(file, "preview");

/* ----------------------------------------------------------------- reddit */
export async function fetchRedditMetadata(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await request("POST", "/api/admin/reddit-metadata", { body: { url: (url || "").trim() }, signal: controller.signal });
    if (!r?.title) throw new Error("Could not read this Reddit thread's title.");
    return { title: r.title, subreddit: r.subreddit || null, author: r.author || null,
      canonicalUrl: r.canonicalUrl || r.redditUrl || url, redditUrl: r.redditUrl || url };
  } finally { clearTimeout(timeout); }
}
