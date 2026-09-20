// Deletion, expiry and housekeeping. One rule runs through everything here:
//
//     R2 FIRST. D1 rows are only removed for objects R2 confirmed deleted.
//
// If R2 refuses to delete something, the corresponding D1 rows are left in
// place (so nothing is orphaned and nothing lies about what still exists), the
// failure is reported, and the operation can simply be retried — every step is
// idempotent (deleting a missing R2 key is a no-op; deleting a missing row too).
import type { DeliveryFileRow, Env, PendingUploadRow } from "../types";
import { HttpError } from "../types";
import { R2_PREFIX } from "./ids";
import { deleteObject, listAllObjects } from "./r2";
import {
  reconcileStorage,
  releaseFile,
  releaseReservation,
  releaseStoredPending,
} from "./storage";

const nowSec = () => Math.floor(Date.now() / 1000);

export interface RemovalResult {
  removed_files: number;
  removed_bytes: number;
  failed: string[]; // display names of objects R2 could not delete
}

/** Delete every R2 object that belongs to a delivery and release its bytes.
 *  Identifies objects from D1 file rows, D1 pending uploads AND a live R2
 *  listing of the delivery's prefix (so strays are caught too). */
export async function removeDeliveryObjects(env: Env, deliveryId: string): Promise<RemovalResult> {
  const files = (await env.DB.prepare("SELECT * FROM delivery_files WHERE delivery_id = ?").bind(deliveryId).all<DeliveryFileRow>()).results;
  const pending = (await env.DB.prepare("SELECT * FROM pending_uploads WHERE delivery_id = ?").bind(deliveryId).all<PendingUploadRow>()).results;

  const result: RemovalResult = { removed_files: 0, removed_bytes: 0, failed: [] };
  const known = new Set<string>();

  for (const f of files) {
    known.add(f.r2_key);
    try {
      await deleteObject(env, f.r2_key);
    } catch (e) {
      console.error("R2 delete failed", f.r2_key, e);
      result.failed.push(f.file_name);
      continue;
    }
    await releaseFile(env, f.id, f.file_size);
    result.removed_files += 1;
    result.removed_bytes += f.file_size;
  }

  for (const p of pending) {
    known.add(p.r2_key);
    try {
      await deleteObject(env, p.r2_key);
    } catch (e) {
      console.error("R2 delete failed (pending)", p.r2_key, e);
      result.failed.push(p.file_name);
      continue;
    }
    if (p.state === "stored") await releaseStoredPending(env, p.upload_id, p.file_size);
    else await releaseReservation(env, p.upload_id, p.file_size);
  }

  // Strays under this delivery's prefix that no row knows about.
  const stray = (await listAllObjects(env, `${R2_PREFIX}${deliveryId}/`)).filter((o) => !known.has(o.key));
  for (const o of stray) {
    try {
      await deleteObject(env, o.key);
    } catch (e) {
      console.error("R2 delete failed (stray)", o.key, e);
      result.failed.push(o.key.split("/").pop() ?? "object");
    }
  }
  return result;
}

export interface DeleteOutcome {
  status: "deleted" | "already_deleted";
  removed_files: number;
  removed_bytes: number;
}

/** Manual delete: R2 objects first, then every D1 record of the delivery.
 *  Aggregate analytics tables (keyed by id, no FK) are intentionally kept so
 *  historical totals and charts survive. */
export async function deleteDeliveryCompletely(env: Env, deliveryId: string): Promise<DeleteOutcome> {
  const exists = await env.DB.prepare("SELECT 1 AS x FROM deliveries WHERE id = ?").bind(deliveryId).first();
  const removal = await removeDeliveryObjects(env, deliveryId);

  if (removal.failed.length > 0) {
    throw new HttpError(
      502,
      "r2_delete_failed",
      `Deletion was NOT completed: ${removal.failed.length} stored file(s) could not be removed. Nothing was marked as deleted; try again.`,
      { failed_files: removal.failed.slice(0, 20), removed_files: removal.removed_files },
    );
  }

  if (!exists && removal.removed_files === 0) {
    return { status: "already_deleted", removed_files: 0, removed_bytes: 0 };
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM delivery_files WHERE delivery_id = ?").bind(deliveryId),
    env.DB.prepare("DELETE FROM pending_uploads WHERE delivery_id = ?").bind(deliveryId),
    env.DB.prepare("DELETE FROM deliveries WHERE id = ?").bind(deliveryId),
  ]);
  return { status: "deleted", removed_files: removal.removed_files, removed_bytes: removal.removed_bytes };
}

export interface ExpiryReport {
  cleaned: number;
  failed: number;
  removed_files: number;
  removed_bytes: number;
  remaining: number;
}

/** Expiry: R2 objects + file rows are removed and storage released. The small
 *  delivery row stays as a tombstone (files_removed_at set) so the public link
 *  keeps showing the branded "expired" page and history/analytics remain. */
export async function cleanupExpired(env: Env, maxDeliveries = 25): Promise<ExpiryReport> {
  const now = nowSec();
  const due = (
    await env.DB.prepare(
      "SELECT id FROM deliveries WHERE expires_at <= ? AND files_removed_at IS NULL ORDER BY expires_at ASC LIMIT ?",
    ).bind(now, maxDeliveries).all<{ id: string }>()
  ).results;

  const report: ExpiryReport = { cleaned: 0, failed: 0, removed_files: 0, removed_bytes: 0, remaining: 0 };
  for (const { id } of due) {
    // Re-check: an admin may have extended the expiry since the worklist was built.
    const still = await env.DB.prepare("SELECT 1 AS x FROM deliveries WHERE id = ? AND expires_at <= ? AND files_removed_at IS NULL")
      .bind(id, nowSec()).first();
    if (!still) continue;

    const removal = await removeDeliveryObjects(env, id);
    report.removed_files += removal.removed_files;
    report.removed_bytes += removal.removed_bytes;
    if (removal.failed.length > 0) {
      report.failed += 1; // rows stay; the next run retries
      continue;
    }
    await env.DB.prepare("UPDATE deliveries SET files_removed_at = ? WHERE id = ? AND files_removed_at IS NULL").bind(nowSec(), id).run();
    report.cleaned += 1;
  }
  const rest = await env.DB.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE expires_at <= ? AND files_removed_at IS NULL")
    .bind(nowSec()).first<{ n: number }>();
  report.remaining = rest?.n ?? 0;
  return report;
}

/** Uploads that reserved space or landed bytes but were never finalised into a delivery. */
export async function sweepAbandonedUploads(env: Env, max = 50): Promise<{ released: number; failed: number }> {
  const now = nowSec();
  const graceHours = Math.max(1, Number(env.ABANDONED_UPLOAD_GRACE_HOURS || 6));
  const unstoredCutoff = now - 2 * 3600;
  const storedCutoff = now - graceHours * 3600;
  const rows = (
    await env.DB.prepare(
      `SELECT * FROM pending_uploads
        WHERE (state IN ('reserved','uploading') AND created_at <= ?1)
           OR (state = 'stored' AND COALESCE(stored_at, created_at) <= ?2)
        LIMIT ?3`,
    ).bind(unstoredCutoff, storedCutoff, max).all<PendingUploadRow>()
  ).results;

  let released = 0;
  let failed = 0;
  for (const p of rows) {
    try {
      await deleteObject(env, p.r2_key);
    } catch (e) {
      console.error("abandoned upload: R2 delete failed", p.r2_key, e);
      failed += 1;
      continue;
    }
    if (p.state === "stored") await releaseStoredPending(env, p.upload_id, p.file_size);
    else await releaseReservation(env, p.upload_id, p.file_size);
    released += 1;
  }
  return { released, failed };
}

/** R2 objects under deliveries/ that no D1 row references and that are older than 1 h. */
export async function sweepOrphans(env: Env, max = 50): Promise<{ deleted: number; failed: number }> {
  const objects = await listAllObjects(env); // throws if R2 unreachable -> caller logs, sweep skipped
  const keys = (
    await env.DB.prepare("SELECT r2_key FROM delivery_files UNION SELECT r2_key FROM pending_uploads").all<{ r2_key: string }>()
  ).results;
  const known = new Set(keys.map((k) => k.r2_key));
  const cutoffMs = Date.now() - 3600_000;

  let deleted = 0;
  let failed = 0;
  for (const o of objects) {
    if (deleted + failed >= max) break;
    if (!o.key.startsWith(R2_PREFIX) || known.has(o.key) || o.uploaded > cutoffMs) continue;
    try {
      await deleteObject(env, o.key);
      deleted += 1;
    } catch (e) {
      console.error("orphan delete failed", o.key, e);
      failed += 1;
    }
  }
  return { deleted, failed };
}

export async function housekeeping(env: Env): Promise<void> {
  const now = nowSec();
  const cutoffHour = new Date(Date.now() - 8 * 86400_000).toISOString().slice(0, 13);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ? OR revoked = 1").bind(now),
    env.DB.prepare("DELETE FROM auth_throttle WHERE window_start < ?").bind(now - 86400),
    env.DB.prepare("DELETE FROM site_hourly_metrics WHERE hour < ?").bind(cutoffHour),
  ]);
}

export interface CronReport {
  expiry: ExpiryReport | null;
  abandoned: { released: number; failed: number } | null;
  orphans: { deleted: number; failed: number } | null;
  reconcile: { drift_bytes: number; deferred: boolean } | null;
  errors: string[];
}

/** The whole scheduled job. Each step is isolated so one failure cannot starve the others. */
export async function runMaintenance(env: Env): Promise<CronReport> {
  const report: CronReport = { expiry: null, abandoned: null, orphans: null, reconcile: null, errors: [] };
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); } catch (e) {
      console.error(`maintenance step failed: ${name}`, e);
      report.errors.push(name);
      return null;
    }
  };
  report.expiry = await step("expiry", () => cleanupExpired(env, 25));
  report.abandoned = await step("abandoned", () => sweepAbandonedUploads(env));
  report.orphans = await step("orphans", () => sweepOrphans(env));
  const rec = await step("reconcile", () => reconcileStorage(env));
  if (rec) {
    report.reconcile = { drift_bytes: rec.driftBytes, deferred: rec.deferred };
    if (rec.driftBytes !== 0 && !rec.deferred) console.warn(`storage drift corrected: ledger differed from R2 by ${rec.driftBytes} bytes`);
  }
  await step("housekeeping", () => housekeeping(env));
  return report;
}
