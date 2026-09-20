import type { DeliveryFileRow, Env, PendingUploadRow } from "../types";
import { DELIVERY_SOURCES, HttpError } from "../types";
import { requireSession } from "../lib/auth";
import {
  cleanupExpired, deleteDeliveryCompletely,
} from "../lib/cleanup";
import {
  createDeliveryFromUploads, getAdminDelivery, getDelivery, getDeliveryDailySeries, getDeliveryFile, getDeliveryFiles,
  getOverview, getPageAnalytics, getTimeseries, getTopDeliveries, listDeliveriesForAdmin, nowSec, parseJson, updateDeliveryFields,
} from "../lib/db";
import { newDeliveryId, newFileId, newUploadId, displayFileName, r2KeyFor, sanitizeFilename } from "../lib/ids";
import { deleteObject, headObject, readHead } from "../lib/r2";
import { fetchRedditMetadata } from "../lib/reddit";
import {
  HARD_CAP_BYTES, claimUpload, commitUpload, getPendingUpload, getStorageState, markUncertain,
  reconcileStorage, releaseFile, releaseReservation, releaseStoredPending, reserveUpload, setStorageLimit,
  storageSummary, summarize,
} from "../lib/storage";
import {
  MAX_EXPIRY_SECONDS, MAX_NAME_LENGTH, MAX_NOTES_LENGTH, clampString, cleanRedditSource, cleanSourceMeta,
  extensionOf, isAllowedExtension, isBattleExtension, isValidDeliveryId, magicMatches, mimeForExtension, parseExpiry,
} from "../lib/validate";
import { error, json, readJson, requireJson, segments, wrap } from "./util";

export function handleAdmin(request: Request, path: string, env: Env): Promise<Response> {
  return wrap(async () => {
    await requireSession(request, env); // EVERY admin route is authenticated, no exceptions
    const seg = segments(path); // e.g. ['deliveries', 'BZ-XXXX', 'duplicate']
    switch (seg[0]) {
      case "uploads": return routeUploads(request, seg, env);
      case "deliveries": return routeDeliveries(request, seg, env);
      case "cleanup": return request.method === "POST" ? runCleanup(env) : error("Method not allowed", 405);
      case "storage": return routeStorage(request, seg, env);
      case "analytics": return routeAnalytics(request, seg, env);
      case "reddit-metadata": return redditMetadata(request, env);
      default: return error("Not found", 404);
    }
  });
}

const maxUploadBytes = (env: Env) => Math.max(1, Number(env.MAX_UPLOAD_BYTES || 94371840));
const maxFiles = (env: Env) => Math.max(1, Number(env.MAX_FILES_PER_DELIVERY || 20));

// =============================================================================
// UPLOADS — reserve -> PUT bytes -> (finalise with POST /deliveries)
// =============================================================================
async function routeUploads(request: Request, seg: string[], env: Env): Promise<Response> {
  const uploadId = seg[1];
  if (!uploadId) {
    if (request.method === "POST") return reserve(request, env);
    return error("Method not allowed", 405);
  }
  if (!/^[a-z0-9]{16}$/.test(uploadId)) return error("Not found", 404);
  if (request.method === "PUT") return putUpload(request, uploadId, env);
  if (request.method === "DELETE") return abortUpload(uploadId, env);
  return error("Method not allowed", 405);
}

/** Step 1. Validate + atomically reserve capacity. Rejects BEFORE any byte moves. */
async function reserve(request: Request, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);

  if (!isValidDeliveryId(b.delivery_id)) throw new HttpError(422, "invalid_delivery_id", "A valid delivery id is required.");
  const deliveryId = b.delivery_id;
  const rawName = typeof b.file_name === "string" ? b.file_name : "";
  const fileSize = typeof b.file_size === "number" ? b.file_size : NaN;
  const isBattle = b.is_photoshop_battles === true;

  const ext = extensionOf(rawName);
  if (!isAllowedExtension(ext)) throw new HttpError(415, "file_type_not_allowed", "This file type is not allowed.");
  if (isBattle && !isBattleExtension(ext)) throw new HttpError(415, "battles_image_only", "PhotoshopBattles deliveries accept JPG or PNG images only.");
  if (!Number.isInteger(fileSize) || fileSize <= 0) throw new HttpError(422, "invalid_size", "File size must be a positive whole number of bytes.");
  if (fileSize > maxUploadBytes(env)) {
    throw new HttpError(413, "file_too_large", `File exceeds the ${Math.floor(maxUploadBytes(env) / 1048576)} MB per-file limit.`, { max_bytes: maxUploadBytes(env) });
  }
  if (await getDelivery(env, deliveryId)) throw new HttpError(409, "delivery_exists", "This delivery already exists; files can only be added while creating it.");

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM pending_uploads WHERE delivery_id = ?").bind(deliveryId).first<{ n: number }>();
  const limitFiles = isBattle ? 1 : maxFiles(env);
  if ((count?.n ?? 0) >= limitFiles) {
    throw new HttpError(422, "too_many_files", isBattle ? "PhotoshopBattles deliveries support a single image only." : `A delivery can contain at most ${limitFiles} files.`);
  }

  const fileId = newFileId();
  const uploadId = newUploadId();
  const safeName = sanitizeFilename(rawName);
  const contentType = mimeForExtension(ext);
  await reserveUpload(env, {
    uploadId, deliveryId, fileId, r2Key: r2KeyFor(deliveryId, fileId, safeName),
    fileName: displayFileName(rawName), fileSize, contentType,
  });

  const s = await storageSummary(env);
  return json({ ok: true, upload_id: uploadId, file_id: fileId, file_size: fileSize, max_bytes: maxUploadBytes(env), storage: s }, 201);
}

/** Step 2. Stream the request body straight into R2 (never buffered in memory). */
async function putUpload(request: Request, uploadId: string, env: Env): Promise<Response> {
  const pending = await getPendingUpload(env, uploadId);
  if (!pending) throw new HttpError(404, "upload_not_found", "Upload not found (it may have expired). Start the upload again.");
  if (pending.state !== "reserved") throw new HttpError(409, "upload_not_pending", "This upload was already started or completed.");

  const declared = Number(request.headers.get("Content-Length"));
  if (!request.headers.has("Content-Length") || !Number.isInteger(declared)) {
    throw new HttpError(411, "length_required", "Content-Length is required.");
  }
  if (declared !== pending.file_size) {
    throw new HttpError(422, "size_mismatch", "Body size does not match the size that was reserved.", { reserved: pending.file_size, received: declared });
  }
  if (!request.body) throw new HttpError(400, "empty_body", "Missing file body.");
  if (!(await claimUpload(env, uploadId))) throw new HttpError(409, "upload_not_pending", "This upload was already started or completed.");

  let committed = false;
  try {
    // FixedLengthStream makes the stored size EXACTLY the reserved size: a body
    // that is shorter or longer than declared makes the write fail and R2 stores nothing.
    const fixed = new FixedLengthStream(pending.file_size);
    const pipe = request.body.pipeTo(fixed.writable);
    const put = env.BUCKET.put(pending.r2_key, fixed.readable, { httpMetadata: { contentType: pending.content_type ?? "application/octet-stream" } });
    await Promise.all([pipe, put]);

    const head = await headObject(env, pending.r2_key);
    if (!head || head.size !== pending.file_size) throw new HttpError(502, "upload_verify_failed", "The stored file did not verify. Nothing was saved.");

    const ext = extensionOf(pending.file_name) ?? "";
    const first = await readHead(env, pending.r2_key, 1024);
    if (!first || !magicMatches(ext, first)) {
      throw new HttpError(422, "content_mismatch", "The file's contents do not match its type. Nothing was saved.");
    }

    if (!(await commitUpload(env, uploadId, pending.file_size))) {
      throw new HttpError(409, "upload_cancelled", "This upload was cancelled while it was in progress.");
    }
    committed = true;
    return json({ ok: true, upload_id: uploadId, file_id: pending.file_id, file_name: pending.file_name, file_size: pending.file_size }, 201);
  } catch (e) {
    if (!committed) await rollbackUpload(env, pending);
    if (e instanceof HttpError) throw e;
    console.error("upload failed", e);
    throw new HttpError(502, "upload_failed", "The upload did not complete. Nothing was saved; please try again.");
  }
}

/** Remove whatever a failed upload left behind and give the reserved bytes back. */
async function rollbackUpload(env: Env, p: PendingUploadRow): Promise<void> {
  try {
    await deleteObject(env, p.r2_key);
  } catch (e) {
    // Could not confirm the object is gone: keep the row (the sweeper retries)
    // and flag the ledger so uploads pause until R2 is verified.
    console.error("rollback: R2 delete failed", p.r2_key, e);
    await markUncertain(env, "upload_cleanup_failed");
    return;
  }
  try {
    await releaseReservation(env, p.upload_id, p.file_size);
  } catch (e) {
    console.error("rollback: release failed", e);
    await markUncertain(env, "release_failed");
  }
}

async function abortUpload(uploadId: string, env: Env): Promise<Response> {
  const p = await getPendingUpload(env, uploadId);
  if (!p) return json({ ok: true, status: "already_gone" });
  try {
    await deleteObject(env, p.r2_key);
  } catch {
    throw new HttpError(502, "r2_delete_failed", "Could not remove the uploaded file. It will be retried automatically.");
  }
  if (p.state === "stored") await releaseStoredPending(env, uploadId, p.file_size);
  else await releaseReservation(env, uploadId, p.file_size);
  return json({ ok: true, status: "aborted", released_bytes: p.file_size });
}

// =============================================================================
// DELIVERIES
// =============================================================================
async function routeDeliveries(request: Request, seg: string[], env: Env): Promise<Response> {
  const id = seg[1];
  if (!id) {
    if (request.method === "GET") return listDeliveries(request, env);
    if (request.method === "POST") return createDelivery(request, env);
    return error("Method not allowed", 405);
  }
  if (!isValidDeliveryId(id)) throw new HttpError(400, "invalid_delivery_id", "Invalid delivery id.");
  const action = seg[2];

  if (!action) {
    if (request.method === "GET") return deliveryDetail(id, env);
    if (request.method === "PATCH") return patchDelivery(request, id, env);
    if (request.method === "DELETE") return deleteDelivery(id, env);
    return error("Method not allowed", 405);
  }
  if (request.method === "GET" && action === "analytics") {
    if (!(await getDelivery(env, id))) throw new HttpError(404, "not_found", "Delivery not found.");
    return json({ ok: true, series: await getDeliveryDailySeries(env, id, 30) });
  }
  if (request.method === "POST" && action === "duplicate") return duplicateDelivery(id, env);
  if (request.method === "POST" && action === "expire") return expireNow(id, env);
  if (request.method === "POST" && action === "remove-file") return removeFile(request, id, env);
  return error("Not found", 404);
}

async function listDeliveries(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const num = (k: string, d: number) => { const n = Number(q.get(k)); return Number.isFinite(n) && q.get(k) !== null ? n : d; };
  const result = await listDeliveriesForAdmin(env, {
    search: q.get("q") ?? undefined,
    source: q.get("source") ?? undefined,
    status: q.get("status") ?? undefined,
    sort: q.get("sort") ?? "created",
    order: q.get("order") ?? "desc",
    limit: num("limit", 100),
    offset: num("offset", 0),
  });
  return json({ ok: true, items: result.items, total: result.total });
}

async function deliveryDetail(id: string, env: Env, status = 200): Promise<Response> {
  const d = await getAdminDelivery(env, id);
  if (!d) throw new HttpError(404, "not_found", "Delivery not found.");
  return json({ ok: true, delivery: d }, status);
}

/** Step 3. Turn stored uploads into a delivery (atomically). */
async function createDelivery(request: Request, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);

  const id = isValidDeliveryId(b.id) ? b.id : newDeliveryId();
  const sm = cleanSourceMeta(b.source_meta);
  let source = typeof b.source === "string" && (DELIVERY_SOURCES as readonly string[]).includes(b.source) ? b.source : "private";
  if (sm.isBattle) source = "reddit";
  const rs = cleanRedditSource(b.reddit_source, b.reddit_url);

  const now = nowSec();
  let expiresAt: number;
  if (b.expires_at !== undefined && b.expires_at !== null) {
    const parsed = parseExpiry(b.expires_at);
    if (parsed === null) throw new HttpError(422, "invalid_expiry", "The expiry date/time is invalid.");
    expiresAt = parsed;
  } else {
    const hours = Number(b.expires_in_hours ?? env.DEFAULT_EXPIRY_HOURS ?? 24);
    expiresAt = now + Math.min(720, Math.max(1, Number.isFinite(hours) ? hours : 24)) * 3600;
  }
  if (expiresAt < now + 60) throw new HttpError(422, "invalid_expiry", "The expiry must be in the future.");
  if (expiresAt > now + MAX_EXPIRY_SECONDS) throw new HttpError(422, "invalid_expiry", "The expiry can be at most 30 days from now.");

  const uploadIds = Array.isArray(b.upload_ids) ? b.upload_ids.filter((u): u is string => typeof u === "string" && /^[a-z0-9]{16}$/.test(u)) : [];
  if (uploadIds.length === 0 || uploadIds.length !== (b.upload_ids as unknown[]).length) {
    throw new HttpError(422, "no_files", "At least one completed upload is required.");
  }
  if (new Set(uploadIds).size !== uploadIds.length) throw new HttpError(422, "duplicate_uploads", "The same upload was listed twice.");
  if (uploadIds.length > maxFiles(env)) throw new HttpError(422, "too_many_files", `A delivery can contain at most ${maxFiles(env)} files.`);

  const rows = (
    await env.DB.prepare(`SELECT * FROM pending_uploads WHERE upload_id IN (${uploadIds.map(() => "?").join(",")})`)
      .bind(...uploadIds).all<PendingUploadRow>()
  ).results;
  const byId = new Map(rows.map((r) => [r.upload_id, r]));
  for (const uid of uploadIds) {
    const p = byId.get(uid);
    if (!p) throw new HttpError(404, "upload_not_found", "An upload was not found or was already used. Upload the files again.");
    if (p.delivery_id !== id) throw new HttpError(409, "upload_wrong_delivery", "An upload belongs to a different delivery.");
    if (p.state !== "stored") throw new HttpError(409, "upload_unfinished", "An upload has not finished yet.");
  }

  // PhotoshopBattles is IMAGE ONLY and a single file — enforced here, server side.
  if (sm.isBattle) {
    const ok = rows.length === 1 && rows.every((r) => isBattleExtension(extensionOf(r.file_name)));
    if (!ok) throw new HttpError(422, "battles_image_only", "PhotoshopBattles deliveries accept a single JPG or PNG image only.");
  }

  await createDeliveryFromUploads(env, {
    id,
    projectName: clampString(b.project_name, MAX_NAME_LENGTH),
    clientName: clampString(b.client_name, MAX_NAME_LENGTH),
    notes: clampString(b.notes, MAX_NOTES_LENGTH),
    expiresAt,
    supportEnabled: b.support_enabled !== false,
    isBattle: sm.isBattle,
    source,
    sourceMeta: sm.json,
    redditUrl: rs?.url ?? null,
    redditSource: rs?.json ?? null,
    uploadIds,
  });
  return deliveryDetail(id, env, 201);
}

async function patchDelivery(request: Request, id: string, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);
  const row = await getDelivery(env, id);
  if (!row) throw new HttpError(404, "not_found", "Delivery not found.");

  const f: Record<string, string | number | null> = {};
  if ("project_name" in b) f.project_name = clampString(b.project_name, MAX_NAME_LENGTH);
  if ("client_name" in b) f.client_name = clampString(b.client_name, MAX_NAME_LENGTH);
  if ("notes" in b) f.notes = clampString(b.notes, MAX_NOTES_LENGTH);
  if ("support_enabled" in b) f.support_enabled = b.support_enabled === false ? 0 : 1;

  if ("expires_at" in b) {
    const parsed = parseExpiry(b.expires_at);
    const now = nowSec();
    if (parsed === null) throw new HttpError(422, "invalid_expiry", "The expiry date/time is invalid.");
    if (parsed < now + 60) throw new HttpError(422, "invalid_expiry", "Choose an expiry in the future. To end a delivery now, use Expire or Delete.");
    if (parsed > now + MAX_EXPIRY_SECONDS) throw new HttpError(422, "invalid_expiry", "The expiry can be at most 30 days from now.");
    if (row.files_removed_at !== null) throw new HttpError(409, "files_removed", "This delivery's files were already removed, so it cannot be extended. Create a new delivery.");
    f.expires_at = parsed;
  }

  if ("source" in b && typeof b.source === "string" && (DELIVERY_SOURCES as readonly string[]).includes(b.source)) f.source = b.source;

  if ("source_meta" in b) {
    const existing = parseJson<{ direct_token?: string }>(row.source_meta);
    const sm = cleanSourceMeta(b.source_meta, existing?.direct_token ?? null); // the shared direct URL never changes
    if (sm.isBattle && row.is_photoshop_battles !== 1) {
      const files = await getDeliveryFiles(env, id);
      if (files.length !== 1 || !isBattleExtension(extensionOf(files[0]!.file_name))) {
        throw new HttpError(422, "battles_image_only", "Only a delivery with a single JPG/PNG image can be a PhotoshopBattles delivery.");
      }
    }
    f.source_meta = sm.json;
    f.is_photoshop_battles = sm.isBattle ? 1 : 0;
    if (sm.isBattle) f.source = "reddit";
  }

  if ("reddit_source" in b || "reddit_url" in b) {
    const rs = cleanRedditSource(b.reddit_source, b.reddit_url); // null clears it
    f.reddit_source = rs?.json ?? null;
    f.reddit_url = rs?.url ?? null;
  }

  if (Object.keys(f).length === 0) throw new HttpError(422, "no_changes", "No editable fields were supplied.");
  await updateDeliveryFields(env, id, f);
  return deliveryDetail(id, env);
}

async function expireNow(id: string, env: Env): Promise<Response> {
  const ts = nowSec();
  await env.DB.prepare("UPDATE deliveries SET expires_at = ?1 WHERE id = ?2 AND expires_at > ?1").bind(ts, id).run();
  return deliveryDetail(id, env);
}

async function removeFile(request: Request, id: string, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);
  const fileId = typeof b.file_id === "string" ? b.file_id : "";
  const file: DeliveryFileRow | null = fileId ? await getDeliveryFile(env, id, fileId) : null;
  if (!file) throw new HttpError(404, "not_found", "File not found.");
  try { await deleteObject(env, file.r2_key); } catch { throw new HttpError(502, "r2_delete_failed", "The file could not be removed from storage. Nothing was changed."); }
  await releaseFile(env, file.id, file.file_size);
  return deliveryDetail(id, env);
}

/** R2 objects first, then D1 — see lib/cleanup.ts. */
async function deleteDelivery(id: string, env: Env): Promise<Response> {
  const outcome = await deleteDeliveryCompletely(env, id);
  return json({ ok: true, ...outcome, storage: await storageSummary(env) });
}

/** Copy a delivery (new id, new direct token, fresh counters). Every byte is
 *  reserved against the 3 GB cap BEFORE it is copied, exactly like an upload. */
async function duplicateDelivery(id: string, env: Env): Promise<Response> {
  const src = await getDelivery(env, id);
  if (!src) throw new HttpError(404, "not_found", "Delivery not found.");
  if (src.files_removed_at !== null || src.expires_at <= nowSec()) throw new HttpError(409, "expired", "An expired delivery cannot be duplicated.");
  const files = await getDeliveryFiles(env, id);
  if (files.length === 0) throw new HttpError(409, "no_files", "This delivery has no files to duplicate.");

  const newId = newDeliveryId();
  const made: PendingUploadRow[] = [];
  try {
    for (const f of files) {
      const uploadId = newUploadId();
      const fileId = newFileId();
      const key = r2KeyFor(newId, fileId, sanitizeFilename(f.file_name));
      await reserveUpload(env, { uploadId, deliveryId: newId, fileId, r2Key: key, fileName: f.file_name, fileSize: f.file_size, contentType: f.content_type ?? "application/octet-stream" });
      const p = await getPendingUpload(env, uploadId);
      if (!p) throw new HttpError(500, "internal_error", "Reservation vanished.");
      made.push(p);
      if (!(await claimUpload(env, uploadId))) throw new HttpError(409, "upload_not_pending", "Could not start the copy.");

      const obj = await env.BUCKET.get(f.r2_key);
      if (!obj) throw new HttpError(409, "source_missing", "A source file is missing from storage, so it cannot be duplicated.");
      await env.BUCKET.put(key, obj.body, { httpMetadata: { contentType: f.content_type ?? "application/octet-stream" } });
      const head = await headObject(env, key);
      if (!head || head.size !== f.file_size) throw new HttpError(502, "copy_verify_failed", "The copied file did not verify. Nothing was saved.");
      if (!(await commitUpload(env, uploadId, f.file_size))) throw new HttpError(409, "upload_cancelled", "The copy was cancelled.");
      p.state = "stored";
    }

    const meta = parseJson<{ redditUrl?: string }>(src.source_meta);
    const sm = src.is_photoshop_battles === 1
      ? cleanSourceMeta({ type: "photoshop_battles", ...(meta?.redditUrl ? { redditUrl: meta.redditUrl } : {}) }) // brand-new direct token
      : { json: null, isBattle: false };
    await createDeliveryFromUploads(env, {
      id: newId,
      projectName: `${src.project_name ?? "Untitled delivery"} (copy)`.slice(0, MAX_NAME_LENGTH),
      clientName: src.client_name,
      notes: src.notes,
      expiresAt: nowSec() + Math.max(1, Number(env.DEFAULT_EXPIRY_HOURS || 24)) * 3600,
      supportEnabled: src.support_enabled === 1,
      isBattle: sm.isBattle,
      source: src.source,
      sourceMeta: sm.json,
      redditUrl: src.reddit_url,
      redditSource: src.reddit_source,
      uploadIds: made.map((m) => m.upload_id),
    });
  } catch (e) {
    for (const p of made) await rollbackDuplicatePart(env, p);
    throw e;
  }
  return deliveryDetail(newId, env, 201);
}

async function rollbackDuplicatePart(env: Env, p: PendingUploadRow): Promise<void> {
  try { await deleteObject(env, p.r2_key); } catch (e) { console.error("duplicate rollback: R2 delete failed", e); await markUncertain(env, "duplicate_cleanup_failed"); return; }
  try {
    if (p.state === "stored") await releaseStoredPending(env, p.upload_id, p.file_size);
    else await releaseReservation(env, p.upload_id, p.file_size);
  } catch (e) { console.error("duplicate rollback: release failed", e); await markUncertain(env, "release_failed"); }
}

// =============================================================================
// MAINTENANCE / STORAGE / ANALYTICS / REDDIT
// =============================================================================
/** Manual "Clean Expired Deliveries". Same routine as the cron. */
async function runCleanup(env: Env): Promise<Response> {
  const report = await cleanupExpired(env, 50);
  return json({ ok: true, ...report, storage: await storageSummary(env) });
}

async function routeStorage(request: Request, seg: string[], env: Env): Promise<Response> {
  const action = seg[1];
  if (!action && request.method === "GET") {
    const state = await getStorageState(env);
    const files = await env.DB.prepare("SELECT COUNT(*) AS n FROM delivery_files").first<{ n: number }>();
    return json({ ok: true, storage: { ...summarize(env, state), hard_cap_bytes: HARD_CAP_BYTES, file_count: files?.n ?? 0 } });
  }
  if (action === "reconcile" && request.method === "POST") {
    const r = await reconcileStorage(env); // 503 storage_unverified if R2 cannot be read
    return json({
      ok: true,
      reconcile: { actual_bytes: r.actualBytes, object_count: r.objectCount, previous_total_bytes: r.previousTotal, drift_bytes: r.driftBytes, deferred: r.deferred },
      storage: summarize(env, r.state),
    });
  }
  if (action === "limit" && request.method === "PATCH") {
    requireJson(request);
    const b = await readJson(request);
    const limit = typeof b.limit_bytes === "number" ? b.limit_bytes : NaN;
    if (!Number.isFinite(limit) || limit < 1024 * 1024) throw new HttpError(422, "invalid_limit", "limit_bytes must be at least 1 MB.");
    if (limit > HARD_CAP_BYTES) throw new HttpError(422, "limit_above_hard_cap", "The 3 GB storage cap cannot be raised.");
    await setStorageLimit(env, limit);
    return json({ ok: true, storage: await storageSummary(env) });
  }
  return error("Not found", 404);
}

async function routeAnalytics(request: Request, seg: string[], env: Env): Promise<Response> {
  if (request.method !== "GET") return error("Method not allowed", 405);
  const section = seg[1];
  if (!section || section === "overview") {
    const [overview, storage] = await Promise.all([getOverview(env), storageSummary(env)]);
    return json({ ok: true, storage, ...overview });
  }
  if (section === "timeseries") {
    const r = new URL(request.url).searchParams.get("range");
    const range = r === "24h" || r === "30d" || r === "all" ? r : "7d";
    return json({ ok: true, range, series: await getTimeseries(env, range) });
  }
  if (section === "top") return json({ ok: true, top: await getTopDeliveries(env, 8) });
  if (section === "pages") return json({ ok: true, pages: await getPageAnalytics(env, 30) });
  return error("Not found", 404);
}

async function redditMetadata(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return error("Method not allowed", 405);
  requireJson(request);
  const b = await readJson(request, 8 * 1024);
  const url = typeof b.url === "string" ? b.url : "";
  if (!url.trim()) throw new HttpError(400, "invalid_url", "Please paste a Reddit URL.");
  void env;
  return json({ ok: true, ...(await fetchRedditMetadata(url)) });
}
