import type { Env } from "../types";
import { AccessAuthError } from "../types";
import * as db from "../lib/db";
import { presignPutUrl, objectExists, deleteObject } from "../lib/r2";
import { newDeliveryId, newDuplicateDeliveryId, newFileId, newUploadId, r2KeyFor } from "../lib/ids";
import { requireAccessIdentity } from "../lib/access";

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

/** Every admin route is wrapped in this. If Access verification fails for
 *  any reason, the request is rejected here regardless of whether the
 *  Access edge layer should already have blocked it — see Phase 2 §6. */
export async function withAdmin(
  request: Request,
  env: Env,
  handler: (email: string) => Promise<Response>,
): Promise<Response> {
  try {
    const email = await requireAccessIdentity(request, env);
    return await handler(email);
  } catch (err) {
    if (err instanceof AccessAuthError) {
      return json({ error: "unauthorized", detail: err.message }, { status: 401 });
    }
    throw err;
  }
}

export async function listDeliveriesHandler(env: Env): Promise<Response> {
  const rows = await db.listDeliveriesForDashboard(env);
  return json(rows);
}

interface InitUploadBody {
  deliveryId?: string;
  files: Array<{ fileName: string; fileSize: number }>;
}

export async function initUploadHandler(env: Env, request: Request): Promise<Response> {
  let body: InitUploadBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const maxFiles = Number(env.MAX_FILES_PER_DELIVERY);
  const maxBytes = Number(env.MAX_UPLOAD_BYTES);

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return json({ error: "no_files" }, { status: 400 });
  }
  if (body.files.length > maxFiles) {
    return json({ error: "too_many_files", max: maxFiles }, { status: 400 });
  }
  for (const f of body.files) {
    if (typeof f.fileSize === "number" && f.fileSize > maxBytes) {
      return json({ error: "file_too_large", fileName: f.fileName, max: maxBytes }, { status: 400 });
    }
  }

  // deliver-v2/js/dashboard.js pre-generates an id client-side (via
  // shared.js's deliveryId(), exactly as it does against the current
  // Supabase backend) and uses that same value afterward — accepting it
  // here rather than always generating our own is what keeps that code
  // path working unmodified. A caller that omits it still gets a fresh
  // server-generated id, so this endpoint works either way.
  const deliveryId = body.deliveryId && /^BZ-[A-Z0-9]{6,12}$/.test(body.deliveryId)
    ? body.deliveryId
    : newDeliveryId();

  const uploads = body.files.map((f) => {
    const fileId = newFileId();
    const uploadId = newUploadId();
    const r2Key = r2KeyFor(deliveryId, fileId, f.fileName);
    return { uploadId, fileId, r2Key, fileName: f.fileName, fileSize: f.fileSize ?? null };
  });

  await db.insertPendingUploads(
    env,
    uploads.map((u) => ({
      uploadId: u.uploadId,
      deliveryId,
      r2Key: u.r2Key,
      fileName: u.fileName,
      fileSize: u.fileSize,
    })),
  );

  const withUrls = await Promise.all(
    uploads.map(async (u) => ({
      uploadId: u.uploadId,
      fileId: u.fileId,
      fileName: u.fileName,
      putUrl: await presignPutUrl(env, u.r2Key),
    })),
  );

  return json({
    deliveryId,
    uploads: withUrls,
    expiresInSeconds: Number(env.UPLOAD_URL_TTL_SECONDS),
  });
}

interface FinalizeUploadBody {
  deliveryId: string;
  uploadIds: string[];
  projectName?: string | null;
  clientName?: string | null;
  notes?: string | null;
  expiresAt: number;
  supportEnabled?: boolean;
  isPhotoshopBattles?: boolean;
  source?: string | null;
  sourceMeta?: Record<string, unknown> | null;
  redditSource?: Record<string, unknown> | null;
}

export async function finalizeUploadHandler(env: Env, request: Request): Promise<Response> {
  let body: FinalizeUploadBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.deliveryId || !Array.isArray(body.uploadIds) || body.uploadIds.length === 0) {
    return json({ error: "missing_fields" }, { status: 400 });
  }

  const pending = await db.getPendingUploads(env, body.uploadIds);
  if (pending.length !== body.uploadIds.length) {
    return json({ error: "unknown_upload_id" }, { status: 400 });
  }
  if (pending.some((p) => p.delivery_id !== body.deliveryId)) {
    return json({ error: "upload_delivery_mismatch" }, { status: 400 });
  }

  // Verify every file actually landed in R2 — never trust the browser's
  // report alone. This is what keeps an interrupted upload from ever
  // becoming a permanent, files-missing delivery record.
  const checks = await Promise.all(pending.map((p) => objectExists(env, p.r2_key)));
  const missing = pending.filter((_, i) => !checks[i]);
  if (missing.length > 0) {
    return json(
      {
        error: "files_not_confirmed",
        missing: missing.map((m) => ({ uploadId: m.upload_id, fileName: m.file_name })),
      },
      { status: 409 },
    );
  }

  let sourceMetaJson: string | null = null;
  const isPhotoshopBattles = Boolean(body.isPhotoshopBattles);
  if (body.sourceMeta) {
    const meta = { ...body.sourceMeta } as Record<string, unknown>;
    if (isPhotoshopBattles && !meta.direct_token) {
      meta.direct_token = crypto.randomUUID().replace(/-/g, "");
    }
    sourceMetaJson = JSON.stringify(meta);
  } else if (isPhotoshopBattles) {
    sourceMetaJson = JSON.stringify({ direct_token: crypto.randomUUID().replace(/-/g, "") });
  }

  await db.createDeliveryWithFiles(env, {
    id: body.deliveryId,
    projectName: body.projectName ?? null,
    clientName: body.clientName ?? null,
    notes: body.notes ?? null,
    expiresAt: body.expiresAt,
    supportEnabled: body.supportEnabled ?? true,
    isPhotoshopBattles,
    source: body.source ?? null,
    sourceMeta: sourceMetaJson,
    redditSource: body.redditSource ? JSON.stringify(body.redditSource) : null,
    files: pending.map((p) => ({
      id: newFileId(),
      fileName: p.file_name,
      fileSize: p.file_size,
      r2Key: p.r2_key,
    })),
    confirmedUploadIds: pending.map((p) => p.upload_id),
  });

  return json({ ok: true, deliveryId: body.deliveryId });
}

export async function updateDeliveryHandler(
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  const delivery = await db.getDelivery(env, id);
  if (!delivery) return json({ error: "not_found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const fields: Record<string, unknown> = {};
  if (typeof body.projectName === "string") fields.project_name = body.projectName;
  if (typeof body.clientName === "string") fields.client_name = body.clientName;
  if (typeof body.notes === "string") fields.notes = body.notes;
  if (typeof body.expiresAt === "number") fields.expires_at = body.expiresAt;
  if (typeof body.source === "string" || body.source === null) fields.source = body.source;
  if ("sourceMeta" in body) {
    fields.source_meta = body.sourceMeta ? JSON.stringify(body.sourceMeta) : null;
  }
  if ("redditSource" in body) {
    fields.reddit_source = body.redditSource ? JSON.stringify(body.redditSource) : null;
  }

  await db.updateDeliveryMetadata(env, id, fields);
  return json({ ok: true });
}

export async function duplicateDeliveryHandler(env: Env, id: string): Promise<Response> {
  const delivery = await db.getDelivery(env, id);
  if (!delivery) return json({ error: "not_found" }, { status: 404 });
  const files = await db.getDeliveryFiles(env, id);
  const liveFiles = files.filter((f) => f.removed_at === null);
  if (liveFiles.length === 0) {
    return json({ error: "no_files_to_duplicate" }, { status: 409 });
  }

  const newId = newDuplicateDeliveryId();
  const newFiles: Array<{ id: string; fileName: string; fileSize: number | null; r2Key: string }> = [];

  for (const f of liveFiles) {
    const obj = await env.BUCKET.get(f.r2_key);
    if (!obj) continue; // shouldn't happen given removed_at check, but skip safely
    const newFileIdValue = newFileId();
    const newKey = r2KeyForCopy(newId, newFileIdValue, f.file_name);
    await env.BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
    newFiles.push({ id: newFileIdValue, fileName: f.file_name, fileSize: f.file_size, r2Key: newKey });
  }

  const oneDaySec = 24 * 60 * 60;
  await db.createDeliveryWithFiles(env, {
    id: newId,
    projectName: delivery.project_name,
    clientName: delivery.client_name,
    notes: delivery.notes,
    expiresAt: Math.floor(Date.now() / 1000) + oneDaySec,
    supportEnabled: Boolean(delivery.support_enabled),
    isPhotoshopBattles: Boolean(delivery.is_photoshop_battles),
    source: delivery.source,
    sourceMeta: null, // fresh delivery: never inherits the original's direct_token
    redditSource: delivery.reddit_source,
    files: newFiles,
    confirmedUploadIds: [],
  });

  return json({ ok: true, deliveryId: newId });
}

function r2KeyForCopy(deliveryId: string, fileId: string, fileName: string): string {
  return `deliveries/${deliveryId}/${fileId}-${fileName.replace(/[^\w.\- ]/g, "").replace(/\s+/g, "-")}`;
}

/** Manual deletion — the direct analogue of the fix already made to the
 *  Supabase version of this function. Deletes physical objects, marks
 *  them removed, and pulls expires_at to now so the public read path
 *  stops serving it — but never touches view_count, download_count,
 *  last_viewed_at, last_downloaded_at, or delivery_analytics. Idempotent:
 *  safe to call again on an already-cleaned delivery. */
export async function deleteFilesHandler(env: Env, id: string): Promise<Response> {
  const delivery = await db.getDelivery(env, id);
  if (!delivery) return json({ error: "not_found" }, { status: 404 });

  const files = await db.getDeliveryFiles(env, id);
  const remaining = files.filter((f) => f.removed_at === null);

  for (const f of remaining) {
    await deleteObject(env, f.r2_key);
    await db.markFileRemoved(env, f.id);
  }

  await db.markDeliveryFilesRemoved(env, id);
  await db.pullExpiryToNow(env, id);

  return json({ ok: true, filesRemoved: remaining.length });
}
