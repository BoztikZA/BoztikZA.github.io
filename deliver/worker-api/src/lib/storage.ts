// =============================================================================
// Storage accounting — the 3 GB hard cap.
//
//   total_bytes     bytes of objects that exist in R2 (uploaded + committed)
//   reserved_bytes  bytes promised to in-flight uploads (not yet in R2)
//
// An upload is admitted only when, in ONE atomic SQL statement:
//        total_bytes + reserved_bytes + incoming  <=  limit
// so two concurrent uploads can never both squeeze past the cap, and a request
// that would exceed it is rejected BEFORE any byte is written to R2.
//
// The ledger is self-healing: reconcileStorage() recomputes total_bytes from the
// real R2 listing (the ground truth) and re-derives reserved_bytes from the
// pending rows. Anything the code is unsure about sets needs_reconcile=1, and
// while that flag (or a lock) is set NEW UPLOADS ARE REFUSED — fail closed.
// =============================================================================
import type { Env, PendingUploadRow, StorageStateRow } from "../types";
import { HttpError } from "../types";
import { sumR2Bytes } from "./r2";

/** Compiled-in ceiling. Configuration can only LOWER the cap, never raise it. */
export const HARD_CAP_BYTES = 3 * 1024 * 1024 * 1024;

const nowSec = () => Math.floor(Date.now() / 1000);

export function effectiveLimit(env: Env, state?: Pick<StorageStateRow, "limit_bytes"> | null): number {
  const candidates = [HARD_CAP_BYTES];
  const fromEnv = Number(env.STORAGE_LIMIT_BYTES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) candidates.push(Math.floor(fromEnv));
  if (state && Number.isFinite(state.limit_bytes) && state.limit_bytes > 0) candidates.push(Math.floor(state.limit_bytes));
  return Math.min(...candidates);
}

export async function getStorageState(env: Env): Promise<StorageStateRow> {
  // New ledgers start "needs reconcile" so the first upload verifies against R2.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO storage_state (id, limit_bytes, total_bytes, reserved_bytes, mutation_seq, needs_reconcile, status)
     VALUES (1, ?, 0, 0, 0, 1, 'ok')`,
  ).bind(effectiveLimit(env)).run();
  const row = await env.DB.prepare("SELECT * FROM storage_state WHERE id = 1").first<StorageStateRow>();
  if (!row) throw new HttpError(503, "storage_unverified", "Storage accounting is unavailable.");
  return row;
}

export type StorageLevel = "ok" | "notice" | "warning" | "critical" | "full";

/** Warning thresholds: 70 % notice, 85 % warning, 95 % critical, 100 % full (locked). */
export function levelFor(percent: number): StorageLevel {
  if (percent >= 100) return "full";
  if (percent >= 95) return "critical";
  if (percent >= 85) return "warning";
  if (percent >= 70) return "notice";
  return "ok";
}

export interface StorageSummary {
  limit_bytes: number;
  used_bytes: number;
  reserved_bytes: number;
  remaining_bytes: number;
  used_percent: number;
  level: StorageLevel;
  upload_locked: boolean;
  status: string;
  lock_reason: string | null;
  accounting_uncertain: boolean;
  last_reconciled_at: string | null;
}

export function summarize(env: Env, s: StorageStateRow): StorageSummary {
  const limit = effectiveLimit(env, s);
  const used = Math.max(0, s.total_bytes);
  const reserved = Math.max(0, s.reserved_bytes);
  // The gauge counts in-flight reservations too: that is exactly what the admit guard counts.
  const percent = limit > 0 ? ((used + reserved) / limit) * 100 : 100;
  return {
    limit_bytes: limit,
    used_bytes: used,
    reserved_bytes: reserved,
    remaining_bytes: Math.max(0, limit - used - reserved),
    used_percent: Math.round(percent * 10) / 10,
    level: levelFor(percent),
    upload_locked: s.status === "locked" || used + reserved >= limit,
    status: s.status,
    lock_reason: s.lock_reason,
    accounting_uncertain: s.needs_reconcile === 1,
    last_reconciled_at: s.last_reconciled_at ? new Date(s.last_reconciled_at * 1000).toISOString() : null,
  };
}

export async function storageSummary(env: Env): Promise<StorageSummary> {
  return summarize(env, await getStorageState(env));
}

// -----------------------------------------------------------------------------
// Reservation
// -----------------------------------------------------------------------------
export interface ReserveInput {
  uploadId: string;
  deliveryId: string;
  fileId: string;
  r2Key: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}

/** Atomically admit an upload or throw. Nothing is written to R2 here. */
export async function reserveUpload(env: Env, p: ReserveInput): Promise<void> {
  if (!Number.isInteger(p.fileSize) || p.fileSize <= 0) {
    throw new HttpError(422, "invalid_size", "File size must be a positive integer.");
  }

  let state = await getStorageState(env);
  if (state.needs_reconcile === 1 || state.status === "locked") {
    const r = await reconcileStorage(env); // throws 503 when R2 cannot be verified
    state = r.state;
    if (state.needs_reconcile === 1) {
      throw new HttpError(503, "storage_unverified", "Storage usage could not be verified right now. Uploads are paused; try again in a moment.");
    }
  }
  if (state.status === "locked") {
    throw new HttpError(423, "storage_locked", "Uploads are locked because storage is at or over its limit.", { lock_reason: state.lock_reason });
  }

  const limit = effectiveLimit(env, state);
  const now = nowSec();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pending_uploads
         (upload_id, delivery_id, file_id, r2_key, file_name, file_size, content_type, created_at, confirmed_at, state, stored_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, 'reserved', NULL
       WHERE EXISTS (
         SELECT 1 FROM storage_state
          WHERE id = 1 AND status = 'ok' AND needs_reconcile = 0
            AND total_bytes + reserved_bytes + ?6 <= ?9)`,
    ).bind(p.uploadId, p.deliveryId, p.fileId, p.r2Key, p.fileName, p.fileSize, p.contentType, now, limit),
    env.DB.prepare(
      `UPDATE storage_state
          SET reserved_bytes = reserved_bytes + ?1, mutation_seq = mutation_seq + 1, last_mutation_at = ?2
        WHERE id = 1 AND changes() > 0`,
    ).bind(p.fileSize, now),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 1) return;

  // Rejected by the atomic guard. Explain precisely (numbers only, no internals).
  const s = summarize(env, await getStorageState(env));
  throw new HttpError(
    507,
    "storage_full",
    s.upload_locked && s.remaining_bytes === 0
      ? "Storage limit reached. Delete old or expired deliveries before uploading."
      : "This upload would exceed the storage limit.",
    {
      limit_bytes: s.limit_bytes,
      used_bytes: s.used_bytes,
      reserved_bytes: s.reserved_bytes,
      remaining_bytes: s.remaining_bytes,
      incoming_bytes: p.fileSize,
    },
  );
}

export async function getPendingUpload(env: Env, uploadId: string): Promise<PendingUploadRow | null> {
  return (await env.DB.prepare("SELECT * FROM pending_uploads WHERE upload_id = ?").bind(uploadId).first<PendingUploadRow>()) ?? null;
}

/** reserved -> uploading. Only one caller can claim an upload. */
export async function claimUpload(env: Env, uploadId: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE pending_uploads SET state = 'uploading' WHERE upload_id = ? AND state = 'reserved'")
    .bind(uploadId).run();
  return (r.meta.changes ?? 0) === 1;
}

/** uploading -> stored, and move the bytes from reserved to total — atomically. */
export async function commitUpload(env: Env, uploadId: string, size: number): Promise<boolean> {
  const now = nowSec();
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE pending_uploads SET state = 'stored', stored_at = ?2 WHERE upload_id = ?1 AND state = 'uploading'").bind(uploadId, now),
    env.DB.prepare(
      `UPDATE storage_state
          SET reserved_bytes = MAX(0, reserved_bytes - ?1), total_bytes = total_bytes + ?1,
              mutation_seq = mutation_seq + 1, last_mutation_at = ?2
        WHERE id = 1 AND changes() > 0`,
    ).bind(size, now),
  ]);
  return (res[0]?.meta.changes ?? 0) === 1;
}

/** Give back the reservation of an upload that never reached R2 (or whose object was removed). */
export async function releaseReservation(env: Env, uploadId: string, size: number): Promise<void> {
  const now = nowSec();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pending_uploads WHERE upload_id = ?1 AND state IN ('reserved','uploading')").bind(uploadId),
    env.DB.prepare(
      `UPDATE storage_state
          SET reserved_bytes = MAX(0, reserved_bytes - ?1), mutation_seq = mutation_seq + 1, last_mutation_at = ?2
        WHERE id = 1 AND changes() > 0`,
    ).bind(size, now),
  ]);
}

/** After the R2 object of a stored-but-unfinalised upload was deleted. */
export async function releaseStoredPending(env: Env, uploadId: string, size: number): Promise<void> {
  const now = nowSec();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pending_uploads WHERE upload_id = ?1 AND state = 'stored'").bind(uploadId),
    env.DB.prepare(
      `UPDATE storage_state
          SET total_bytes = MAX(0, total_bytes - ?1), mutation_seq = mutation_seq + 1, last_mutation_at = ?2
        WHERE id = 1 AND changes() > 0`,
    ).bind(size, now),
  ]);
}

/** After the R2 object of a finalised delivery file was deleted: drop the row and release its bytes. */
export async function releaseFile(env: Env, fileId: string, size: number): Promise<void> {
  const now = nowSec();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM delivery_files WHERE id = ?1").bind(fileId),
    env.DB.prepare(
      `UPDATE storage_state
          SET total_bytes = MAX(0, total_bytes - ?1), mutation_seq = mutation_seq + 1, last_mutation_at = ?2
        WHERE id = 1 AND changes() > 0`,
    ).bind(size, now),
  ]);
}

/** Flag the ledger as uncertain: uploads stay refused until reconcile verifies R2. */
export async function markUncertain(env: Env, reason: string): Promise<void> {
  try {
    await env.DB.prepare("UPDATE storage_state SET needs_reconcile = 1, lock_reason = COALESCE(lock_reason, ?1), last_mutation_at = ?2 WHERE id = 1")
      .bind(reason, nowSec()).run();
  } catch (e) {
    console.error("markUncertain failed", e);
  }
}

export async function setStorageLimit(env: Env, limitBytes: number): Promise<void> {
  const capped = Math.min(HARD_CAP_BYTES, Math.floor(limitBytes));
  await env.DB.prepare("UPDATE storage_state SET limit_bytes = ?1, mutation_seq = mutation_seq + 1 WHERE id = 1").bind(capped).run();
}

// -----------------------------------------------------------------------------
// Reconciliation — R2 is the ground truth.
// -----------------------------------------------------------------------------
export interface ReconcileResult {
  state: StorageStateRow;
  actualBytes: number;
  objectCount: number;
  previousTotal: number;
  driftBytes: number;
  /** true when concurrent activity meant the ledger was (safely) left untouched */
  deferred: boolean;
}

export async function reconcileStorage(env: Env): Promise<ReconcileResult> {
  const before = await getStorageState(env);

  let actual: { bytes: number; objects: number };
  try {
    actual = await sumR2Bytes(env);
  } catch (e) {
    console.error("reconcile: R2 listing failed", e);
    await markUncertain(env, "r2_unreachable");
    throw new HttpError(503, "storage_unverified", "Storage usage could not be verified (R2 unreachable). Uploads are paused.");
  }

  const inflight = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN state = 'reserved' THEN file_size END), 0) AS reserved,
            COALESCE(SUM(CASE WHEN state = 'uploading' THEN 1 END), 0) AS uploading
       FROM pending_uploads`,
  ).first<{ reserved: number; uploading: number }>();

  // Bytes may be landing in R2 right now: don't judge the ledger against a moving target.
  if ((inflight?.uploading ?? 0) > 0) {
    return { state: before, actualBytes: actual.bytes, objectCount: actual.objects, previousTotal: before.total_bytes, driftBytes: before.total_bytes - actual.bytes, deferred: true };
  }

  const limit = effectiveLimit(env, before);
  const over = actual.bytes > limit;
  const res = await env.DB.prepare(
    `UPDATE storage_state
        SET total_bytes = ?1, reserved_bytes = ?2, needs_reconcile = 0,
            status = ?3, lock_reason = ?4, last_reconciled_at = ?5
      WHERE id = 1 AND mutation_seq = ?6`,
  ).bind(actual.bytes, inflight?.reserved ?? 0, over ? "locked" : "ok", over ? "over_limit" : null, nowSec(), before.mutation_seq).run();

  const after = await getStorageState(env);
  const deferred = (res.meta.changes ?? 0) === 0; // ledger moved while we listed R2
  return {
    state: after,
    actualBytes: actual.bytes,
    objectCount: actual.objects,
    previousTotal: before.total_bytes,
    driftBytes: before.total_bytes - actual.bytes,
    deferred,
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
