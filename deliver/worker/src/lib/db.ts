import type {
  DeliveryFileRow,
  DeliveryRow,
  Env,
  PendingUploadRow,
} from "../types";

const nowSec = () => Math.floor(Date.now() / 1000);
const currentMonth = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM'

export async function getDelivery(env: Env, id: string): Promise<DeliveryRow | null> {
  const row = await env.DB.prepare("SELECT * FROM deliveries WHERE id = ?")
    .bind(id)
    .first<DeliveryRow>();
  return row ?? null;
}

export async function getDeliveryFiles(env: Env, deliveryId: string): Promise<DeliveryFileRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM delivery_files WHERE delivery_id = ? ORDER BY rowid ASC",
  )
    .bind(deliveryId)
    .all<DeliveryFileRow>();
  return results;
}

export async function getDeliveryFile(
  env: Env,
  deliveryId: string,
  fileId: string,
): Promise<DeliveryFileRow | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM delivery_files WHERE id = ? AND delivery_id = ?",
  )
    .bind(fileId, deliveryId)
    .first<DeliveryFileRow>();
  return row ?? null;
}

export async function listDeliveries(
  env: Env,
  limit: number,
  offset: number,
): Promise<{ rows: DeliveryRow[]; total: number }> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM deliveries ORDER BY created_at DESC LIMIT ? OFFSET ?",
  )
    .bind(limit, offset)
    .all<DeliveryRow>();
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM deliveries").first<{
    n: number;
  }>();
  return { rows: results, total: countRow?.n ?? 0 };
}

/** Same rows as listDeliveries, but shaped exactly like the original
 *  api.js's listDeliveries() — each delivery flattened with its files and
 *  current-month analytics attached — because deliver-v2/js/dashboard.js
 *  is reused verbatim and reads `delivery.delivery_files`,
 *  `delivery.monthly_views`, `delivery.monthly_downloads`,
 *  `delivery.lifetime_views`, and `delivery.lifetime_downloads` directly. */
export async function listDeliveriesForDashboard(env: Env): Promise<Record<string, unknown>[]> {
  const { results: deliveries } = await env.DB.prepare(
    "SELECT * FROM deliveries ORDER BY created_at DESC LIMIT 100",
  ).all<DeliveryRow>();
  if (deliveries.length === 0) return [];

  const ids = deliveries.map((d) => d.id);
  const placeholders = ids.map(() => "?").join(",");

  const { results: files } = await env.DB.prepare(
    `SELECT * FROM delivery_files WHERE delivery_id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<DeliveryFileRow>();
  const filesByDelivery: Record<string, DeliveryFileRow[]> = {};
  for (const f of files) {
    (filesByDelivery[f.delivery_id] ??= []).push(f);
  }

  const month = currentMonth();
  const { results: analytics } = await env.DB.prepare(
    `SELECT * FROM delivery_analytics WHERE delivery_id IN (${placeholders}) AND month = ?`,
  )
    .bind(...ids, month)
    .all<{ delivery_id: string; views: number; downloads: number }>();
  const analyticsByDelivery: Record<string, { views: number; downloads: number }> = {};
  for (const a of analytics) {
    analyticsByDelivery[a.delivery_id] = { views: a.views, downloads: a.downloads };
  }

  return deliveries.map((d) => {
    const monthly = analyticsByDelivery[d.id] ?? { views: 0, downloads: 0 };
    return {
      ...d,
      support_enabled: Boolean(d.support_enabled),
      is_photoshop_battles: Boolean(d.is_photoshop_battles),
      reddit_source: d.reddit_source ? JSON.parse(d.reddit_source) : null,
      source_meta: d.source_meta ? JSON.parse(d.source_meta) : null,
      delivery_files: filesByDelivery[d.id] ?? [],
      monthly_views: monthly.views,
      monthly_downloads: monthly.downloads,
      lifetime_views: d.view_count,
      lifetime_downloads: d.download_count,
    };
  });
}

export interface NewDeliveryInput {
  id: string;
  projectName: string | null;
  clientName: string | null;
  notes: string | null;
  expiresAt: number;
  supportEnabled: boolean;
  isPhotoshopBattles: boolean;
  source: string | null;
  sourceMeta: string | null;
  redditSource: string | null;
  files: Array<{ id: string; fileName: string; fileSize: number | null; r2Key: string }>;
  confirmedUploadIds: string[];
}

/** Atomically creates a delivery + its files and marks the corresponding
 *  pending_uploads confirmed. Nothing here is called unless every file has
 *  already been verified present in R2 (see routes/admin.ts finalize
 *  handler) — this function assumes that check already happened. */
export async function createDeliveryWithFiles(env: Env, input: NewDeliveryInput): Promise<void> {
  const created = nowSec();
  const statements = [
    env.DB.prepare(
      `INSERT INTO deliveries
         (id, project_name, client_name, notes, created_at, expires_at,
          support_enabled, is_photoshop_battles, source, source_meta,
          reddit_source, view_count, download_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    ).bind(
      input.id,
      input.projectName,
      input.clientName,
      input.notes,
      created,
      input.expiresAt,
      input.supportEnabled ? 1 : 0,
      input.isPhotoshopBattles ? 1 : 0,
      input.source,
      input.sourceMeta,
      input.redditSource,
    ),
    ...input.files.map((f) =>
      env.DB.prepare(
        `INSERT INTO delivery_files (id, delivery_id, file_name, file_size, r2_key)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(f.id, input.id, f.fileName, f.fileSize, f.r2Key),
    ),
    ...input.confirmedUploadIds.map((uploadId) =>
      env.DB.prepare("UPDATE pending_uploads SET confirmed_at = ? WHERE upload_id = ?").bind(
        nowSec(),
        uploadId,
      ),
    ),
  ];
  await env.DB.batch(statements);
}

export async function insertPendingUploads(
  env: Env,
  rows: Array<{ uploadId: string; deliveryId: string; r2Key: string; fileName: string; fileSize: number | null }>,
): Promise<void> {
  const created = nowSec();
  const statements = rows.map((r) =>
    env.DB.prepare(
      `INSERT INTO pending_uploads (upload_id, delivery_id, r2_key, file_name, file_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(r.uploadId, r.deliveryId, r.r2Key, r.fileName, r.fileSize, created),
  );
  await env.DB.batch(statements);
}

export async function getPendingUploads(
  env: Env,
  uploadIds: string[],
): Promise<PendingUploadRow[]> {
  if (uploadIds.length === 0) return [];
  const placeholders = uploadIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM pending_uploads WHERE upload_id IN (${placeholders})`,
  )
    .bind(...uploadIds)
    .all<PendingUploadRow>();
  return results;
}

export async function findAbandonedPendingUploads(
  env: Env,
  olderThanTs: number,
): Promise<PendingUploadRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM pending_uploads WHERE confirmed_at IS NULL AND created_at < ?",
  )
    .bind(olderThanTs)
    .all<PendingUploadRow>();
  return results;
}

export async function deletePendingUpload(env: Env, uploadId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM pending_uploads WHERE upload_id = ?").bind(uploadId).run();
}

/** Gated exactly like the current record_delivery_view/download Postgres
 *  functions: the WHERE clause is the entire enforcement mechanism, since
 *  D1 has no RLS to fall back on. A delivery past expiry silently does not
 *  accrue further analytics — not an error, just a no-op. */
export async function recordView(env: Env, id: string): Promise<void> {
  const ts = nowSec();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE deliveries SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ? AND expires_at > ?",
    ).bind(ts, id, ts),
    env.DB.prepare(
      `INSERT INTO delivery_analytics (delivery_id, month, views, downloads)
       VALUES (?, ?, 1, 0)
       ON CONFLICT (delivery_id, month) DO UPDATE SET views = views + 1`,
    ).bind(id, currentMonth()),
  ]);
}

export async function recordDownload(env: Env, id: string): Promise<void> {
  const ts = nowSec();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE deliveries SET download_count = download_count + 1, last_downloaded_at = ? WHERE id = ? AND expires_at > ?",
    ).bind(ts, id, ts),
    env.DB.prepare(
      `INSERT INTO delivery_analytics (delivery_id, month, views, downloads)
       VALUES (?, ?, 0, 1)
       ON CONFLICT (delivery_id, month) DO UPDATE SET downloads = downloads + 1`,
    ).bind(id, currentMonth()),
  ]);
}

export async function markFileRemoved(env: Env, fileId: string): Promise<void> {
  await env.DB.prepare("UPDATE delivery_files SET removed_at = ? WHERE id = ?")
    .bind(nowSec(), fileId)
    .run();
}

/** Sets files_removed_at once every file on a delivery has been handled.
 *  Never touches view_count, download_count, last_viewed_at,
 *  last_downloaded_at, or delivery_analytics — those are updated by
 *  recordView/recordDownload only, nowhere else in this codebase. */
export async function markDeliveryFilesRemoved(env: Env, id: string): Promise<void> {
  await env.DB.prepare("UPDATE deliveries SET files_removed_at = ? WHERE id = ?")
    .bind(nowSec(), id)
    .run();
}

/** Manual-delete only: pulls expiry to now (if it isn't already in the
 *  past) so the public read path immediately stops serving a delivery
 *  whose files are gone. Analytics columns are untouched by this
 *  statement — it names only `expires_at`. */
export async function pullExpiryToNow(env: Env, id: string): Promise<void> {
  const ts = nowSec();
  await env.DB.prepare(
    "UPDATE deliveries SET expires_at = MIN(expires_at, ?) WHERE id = ?",
  )
    .bind(ts, id)
    .run();
}

export async function updateDeliveryMetadata(
  env: Env,
  id: string,
  fields: Partial<
    Pick<
      DeliveryRow,
      "project_name" | "client_name" | "notes" | "expires_at" | "reddit_source" | "source" | "source_meta"
    >
  >,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  values.push(id);
  await env.DB.prepare(`UPDATE deliveries SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

/** Deliveries that are past expiry and still have at least one file whose
 *  physical object hasn't been removed yet — the cron's worklist. */
export async function findDeliveriesNeedingExpiryCleanup(env: Env): Promise<string[]> {
  const ts = nowSec();
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT d.id FROM deliveries d
     JOIN delivery_files f ON f.delivery_id = d.id
     WHERE d.expires_at <= ? AND f.removed_at IS NULL`,
  )
    .bind(ts)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}
