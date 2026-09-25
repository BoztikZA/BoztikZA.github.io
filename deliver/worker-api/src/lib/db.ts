import type { DeliveryFileRow, DeliveryRow, Env } from "../types";
import { HttpError } from "../types";

export const nowSec = () => Math.floor(Date.now() / 1000);
export const iso = (s: number): string => new Date(s * 1000).toISOString();
export const isoOrNull = (s: number | null): string | null => (s === null || s === undefined ? null : iso(s));

/** Analytics buckets follow the owner's local calendar (default SAST, UTC+2). */
export function utcOffsetSeconds(env: Env): number {
  const raw = Number(env.ANALYTICS_UTC_OFFSET_MINUTES ?? 120);
  return (Number.isFinite(raw) ? Math.max(-720, Math.min(840, raw)) : 120) * 60;
}
export const localDay = (env: Env, ts = nowSec()): string => new Date((ts + utcOffsetSeconds(env)) * 1000).toISOString().slice(0, 10);
export const localHour = (env: Env, ts = nowSec()): string => new Date((ts + utcOffsetSeconds(env)) * 1000).toISOString().slice(0, 13);
export const localMonth = (env: Env, ts = nowSec()): string => localDay(env, ts).slice(0, 7);
export const localDayStartTs = (env: Env, ts = nowSec()): number => {
  const off = utcOffsetSeconds(env);
  return Math.floor((ts + off) / 86400) * 86400 - off;
};

export function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------
export async function getDelivery(env: Env, id: string): Promise<DeliveryRow | null> {
  return (await env.DB.prepare("SELECT * FROM deliveries WHERE id = ?").bind(id).first<DeliveryRow>()) ?? null;
}

export async function getDeliveryFiles(env: Env, deliveryId: string): Promise<DeliveryFileRow[]> {
  return (await env.DB.prepare("SELECT * FROM delivery_files WHERE delivery_id = ? ORDER BY rowid ASC").bind(deliveryId).all<DeliveryFileRow>()).results;
}

export async function getDeliveryFile(env: Env, deliveryId: string, fileId: string): Promise<DeliveryFileRow | null> {
  return (await env.DB.prepare("SELECT * FROM delivery_files WHERE id = ? AND delivery_id = ?").bind(fileId, deliveryId).first<DeliveryFileRow>()) ?? null;
}

export interface AdminDelivery {
  id: string;
  project_name: string | null;
  client_name: string | null;
  notes: string | null;
  source: string;
  source_meta: Record<string, unknown> | null;
  reddit_source: Record<string, unknown> | null;
  reddit_url: string | null;
  support_enabled: boolean;
  is_photoshop_battles: boolean;
  created_at: string;
  expires_at: string;
  expired: boolean;
  status: "active" | "expired";
  files_removed_at: string | null;
  view_count: number;
  download_count: number;
  monthly_views: number;
  monthly_downloads: number;
  last_viewed_at: string | null;
  last_downloaded_at: string | null;
  file_count: number;
  total_file_size: number;
  files: Array<{ id: string; file_name: string; file_size: number; content_type: string | null }>;
}

export function toAdminDelivery(d: DeliveryRow, files: DeliveryFileRow[], monthly?: { views: number; downloads: number }): AdminDelivery {
  const expired = d.expires_at <= nowSec();
  return {
    id: d.id,
    project_name: d.project_name,
    client_name: d.client_name,
    notes: d.notes,
    source: d.source,
    source_meta: parseJson(d.source_meta),
    reddit_source: parseJson(d.reddit_source),
    reddit_url: d.reddit_url,
    support_enabled: d.support_enabled === 1,
    is_photoshop_battles: d.is_photoshop_battles === 1,
    created_at: iso(d.created_at),
    expires_at: iso(d.expires_at),
    expired,
    status: expired ? "expired" : "active",
    files_removed_at: isoOrNull(d.files_removed_at),
    view_count: d.view_count,
    download_count: d.download_count,
    monthly_views: monthly?.views ?? 0,
    monthly_downloads: monthly?.downloads ?? 0,
    last_viewed_at: isoOrNull(d.last_viewed_at),
    last_downloaded_at: isoOrNull(d.last_downloaded_at),
    file_count: files.length,
    total_file_size: files.reduce((s, f) => s + f.file_size, 0),
    files: files.map((f) => ({ id: f.id, file_name: f.file_name, file_size: f.file_size, content_type: f.content_type })),
  };
}

export async function getAdminDelivery(env: Env, id: string): Promise<AdminDelivery | null> {
  const row = await getDelivery(env, id);
  if (!row) return null;
  const [files, monthly] = await Promise.all([
    getDeliveryFiles(env, id),
    env.DB.prepare("SELECT views, downloads FROM delivery_analytics WHERE delivery_id = ? AND month = ?").bind(id, localMonth(env)).first<{ views: number; downloads: number }>(),
  ]);
  return toAdminDelivery(row, files, monthly ?? undefined);
}

export interface DeliveryFilter {
  search?: string;
  source?: string;
  status?: string; // active | expiring | expired | all
  sort?: string;   // created | views | downloads | expires
  order?: string;  // asc | desc
  limit: number;
  offset: number;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
export const EXPIRING_SOON_SECONDS = 72 * 3600; // matches the Command Centre's "Expiring soon" card

export async function listDeliveriesForAdmin(env: Env, f: DeliveryFilter): Promise<{ items: AdminDelivery[]; total: number }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  const now = nowSec();

  if (f.search && f.search.trim()) {
    const like = `%${likeEscape(f.search.trim().slice(0, 100))}%`;
    where.push("(d.id LIKE ? ESCAPE '\\' OR d.project_name LIKE ? ESCAPE '\\' OR d.client_name LIKE ? ESCAPE '\\')");
    binds.push(like, like, like);
  }
  if (f.source && f.source !== "all") {
    if (f.source === "photoshop_battles") where.push("d.is_photoshop_battles = 1");
    else { where.push("d.source = ? AND d.is_photoshop_battles = 0"); binds.push(f.source); }
  }
  if (f.status === "active") { where.push("d.expires_at > ?"); binds.push(now); }
  else if (f.status === "expired") { where.push("d.expires_at <= ?"); binds.push(now); }
  else if (f.status === "expiring") { where.push("d.expires_at > ? AND d.expires_at <= ?"); binds.push(now, now + EXPIRING_SOON_SECONDS); }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderCol =
    f.sort === "views" ? "d.view_count" : f.sort === "downloads" ? "d.download_count" : f.sort === "expires" ? "d.expires_at" : "d.created_at";
  const dir = f.order === "asc" ? "ASC" : "DESC";
  const limit = Math.min(200, Math.max(1, Math.floor(f.limit)));
  const offset = Math.max(0, Math.floor(f.offset));

  const [count, page] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM deliveries d ${whereSql}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(`SELECT d.* FROM deliveries d ${whereSql} ORDER BY ${orderCol} ${dir}, d.id ASC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset).all<DeliveryRow>(),
  ]);
  const rows = page.results;
  if (rows.length === 0) return { items: [], total: count?.n ?? 0 };

  const ph = rows.map(() => "?").join(",");
  const ids = rows.map((r) => r.id);
  const [files, monthly] = await Promise.all([
    env.DB.prepare(`SELECT * FROM delivery_files WHERE delivery_id IN (${ph}) ORDER BY rowid ASC`).bind(...ids).all<DeliveryFileRow>(),
    env.DB.prepare(`SELECT delivery_id, views, downloads FROM delivery_analytics WHERE month = ? AND delivery_id IN (${ph})`)
      .bind(localMonth(env), ...ids).all<{ delivery_id: string; views: number; downloads: number }>(),
  ]);
  const filesBy = new Map<string, DeliveryFileRow[]>();
  for (const file of files.results) {
    const arr = filesBy.get(file.delivery_id);
    if (arr) arr.push(file); else filesBy.set(file.delivery_id, [file]);
  }
  const monthlyBy = new Map(monthly.results.map((m) => [m.delivery_id, m]));
  return {
    items: rows.map((r) => toAdminDelivery(r, filesBy.get(r.id) ?? [], monthlyBy.get(r.id))),
    total: count?.n ?? 0,
  };
}

// -----------------------------------------------------------------------------
// Create / update
// -----------------------------------------------------------------------------
export interface NewDelivery {
  id: string;
  projectName: string | null;
  clientName: string | null;
  notes: string | null;
  expiresAt: number;
  supportEnabled: boolean;
  isBattle: boolean;
  source: string;
  sourceMeta: string | null;
  redditUrl: string | null;
  redditSource: string | null;
  uploadIds: string[];
}

/** Creates the delivery and converts its stored uploads into file rows in ONE
 *  transaction. If any upload is not in the `stored` state for this delivery
 *  (e.g. swept, never finished) nothing is created. */
export async function createDeliveryFromUploads(env: Env, a: NewDelivery): Promise<void> {
  const ph = a.uploadIds.map(() => "?").join(",");
  const created = nowSec();
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO deliveries
         (id, project_name, client_name, notes, created_at, expires_at, files_removed_at, support_enabled,
          is_photoshop_battles, source, source_meta, reddit_url, reddit_source, view_count, download_count,
          last_viewed_at, last_downloaded_at)
       SELECT ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL
       WHERE (SELECT COUNT(*) FROM pending_uploads
               WHERE delivery_id = ? AND state = 'stored' AND upload_id IN (${ph})) = ?`,
    ).bind(
      a.id, a.projectName, a.clientName, a.notes, created, a.expiresAt, a.supportEnabled ? 1 : 0,
      a.isBattle ? 1 : 0, a.source, a.sourceMeta, a.redditUrl, a.redditSource,
      a.id, ...a.uploadIds, a.uploadIds.length,
    ),
  ];
  for (const uid of a.uploadIds) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO delivery_files (id, delivery_id, file_name, file_size, content_type, r2_key, removed_at)
         SELECT file_id, delivery_id, file_name, file_size, content_type, r2_key, NULL
           FROM pending_uploads
          WHERE upload_id = ?1 AND delivery_id = ?2 AND state = 'stored'
            AND EXISTS (SELECT 1 FROM deliveries WHERE id = ?2)`,
      ).bind(uid, a.id),
      env.DB.prepare(
        `DELETE FROM pending_uploads
          WHERE upload_id = ?1 AND delivery_id = ?2 AND state = 'stored'
            AND EXISTS (SELECT 1 FROM delivery_files f WHERE f.delivery_id = ?2 AND f.id = pending_uploads.file_id)`,
      ).bind(uid, a.id),
    );
  }
  let results: D1Result[];
  try {
    results = await env.DB.batch(stmts);
  } catch (e) {
    if (String((e as Error)?.message ?? e).includes("UNIQUE")) {
      throw new HttpError(409, "delivery_exists", "A delivery with this id already exists.");
    }
    throw e;
  }
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "uploads_not_ready", "One or more uploads are missing, unfinished, or were already used. Upload the files again.");
  }
}

const UPDATABLE = new Set([
  "project_name", "client_name", "notes", "expires_at", "reddit_url", "reddit_source",
  "source", "source_meta", "support_enabled", "is_photoshop_battles",
]);

export async function updateDeliveryFields(env: Env, id: string, fields: Record<string, string | number | null>): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  for (const k of keys) if (!UPDATABLE.has(k)) throw new Error(`column not updatable: ${k}`); // never interpolate an unvetted name
  await env.DB.prepare(`UPDATE deliveries SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .bind(...keys.map((k) => fields[k] ?? null), id).run();
}

// -----------------------------------------------------------------------------
// Analytics writes. These are aggregates only (no per-visitor rows, no IPs).
// -----------------------------------------------------------------------------
/** Counts a view for an ACTIVE delivery. Returns false when nothing was counted. */
export async function recordView(env: Env, id: string): Promise<boolean> {
  const ts = nowSec();
  const r = await env.DB.prepare(
    "UPDATE deliveries SET view_count = view_count + 1, last_viewed_at = ?1 WHERE id = ?2 AND expires_at > ?1 AND files_removed_at IS NULL",
  ).bind(ts, id).run();
  if ((r.meta.changes ?? 0) === 0) return false;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO delivery_analytics (delivery_id, month, views, downloads) VALUES (?1, ?2, 1, 0) ON CONFLICT (delivery_id, month) DO UPDATE SET views = views + 1").bind(id, localMonth(env, ts)),
    env.DB.prepare("INSERT INTO delivery_daily_metrics (delivery_id, day, views, downloads) VALUES (?1, ?2, 1, 0) ON CONFLICT (delivery_id, day) DO UPDATE SET views = views + 1").bind(id, localDay(env, ts)),
    env.DB.prepare("INSERT INTO site_hourly_metrics (hour, views, downloads) VALUES (?1, 1, 0) ON CONFLICT (hour) DO UPDATE SET views = views + 1").bind(localHour(env, ts)),
    env.DB.prepare("INSERT INTO page_analytics (day, page, views) VALUES (?1, 'deliver', 1) ON CONFLICT (day, page) DO UPDATE SET views = views + 1").bind(localDay(env, ts)),
  ]);
  return true;
}

export async function recordDownload(env: Env, id: string): Promise<boolean> {
  const ts = nowSec();
  const r = await env.DB.prepare(
    "UPDATE deliveries SET download_count = download_count + 1, last_downloaded_at = ?1 WHERE id = ?2 AND expires_at > ?1 AND files_removed_at IS NULL",
  ).bind(ts, id).run();
  if ((r.meta.changes ?? 0) === 0) return false;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO delivery_analytics (delivery_id, month, views, downloads) VALUES (?1, ?2, 0, 1) ON CONFLICT (delivery_id, month) DO UPDATE SET downloads = downloads + 1").bind(id, localMonth(env, ts)),
    env.DB.prepare("INSERT INTO delivery_daily_metrics (delivery_id, day, views, downloads) VALUES (?1, ?2, 0, 1) ON CONFLICT (delivery_id, day) DO UPDATE SET downloads = downloads + 1").bind(id, localDay(env, ts)),
    env.DB.prepare("INSERT INTO site_hourly_metrics (hour, views, downloads) VALUES (?1, 0, 1) ON CONFLICT (hour) DO UPDATE SET downloads = downloads + 1").bind(localHour(env, ts)),
  ]);
  return true;
}

/** Which methods classify as a completed share/copy vs an externally-opened attempt. */
export const shareKind = (method: string): "completed" | "attempted" | null =>
  method === "native" || method === "copy"
    ? "completed"
    : method === "whatsapp" || method === "facebook" || method === "x" || method === "reddit"
      ? "attempted"
      : null;

/** Records a share/copy action for an ACTIVE delivery. Returns false when nothing was counted. */
export async function recordShare(env: Env, id: string, method: string): Promise<boolean> {
  const kind = shareKind(method);
  if (!kind) return false;
  const ts = nowSec();
  // Only ever count for a live delivery, and derive the page type server-side so a
  // client can't mislabel a battle page as a normal delivery (or vice-versa).
  const row = await env.DB.prepare("SELECT is_photoshop_battles FROM deliveries WHERE id = ?1 AND expires_at > ?2 AND files_removed_at IS NULL")
    .bind(id, ts).first<{ is_photoshop_battles: number | null }>();
  if (!row) return false;
  const pageType = row.is_photoshop_battles === 1 ? "photoshop_battles" : "delivery";
  await env.DB.prepare(
    `INSERT INTO share_metrics (delivery_id, day, page_type, method, kind, count)
       VALUES (?1, ?2, ?3, ?4, ?5, 1)
       ON CONFLICT (delivery_id, day, page_type, method, kind) DO UPDATE SET count = count + 1`,
  ).bind(id, localDay(env, ts), pageType, method, kind).run();
  return true;
}

export const PAGE_KEYS = ["homepage", "portfolio", "tools", "guides", "about", "support", "contact", "services", "deliver"] as const;

export async function recordPageView(env: Env, page: string): Promise<boolean> {
  if (!(PAGE_KEYS as readonly string[]).includes(page)) return false;
  await env.DB.prepare("INSERT INTO page_analytics (day, page, views) VALUES (?1, ?2, 1) ON CONFLICT (day, page) DO UPDATE SET views = views + 1")
    .bind(localDay(env), page).run();
  return true;
}

// -----------------------------------------------------------------------------
// Analytics reads (Command Centre)
// -----------------------------------------------------------------------------
export interface Overview {
  deliveries: { active: number; expiring_soon: number; expired: number; awaiting_cleanup: number; total: number; live_files: number };
  activity: { today: { views: number; downloads: number; new_deliveries: number }; last_7d: { views: number; downloads: number }; month: { views: number; downloads: number }; lifetime: { views: number; downloads: number } };
}

export async function getOverview(env: Env): Promise<Overview> {
  const now = nowSec();
  const day = localDay(env);
  const since7 = localDay(env, now - 6 * 86400);
  const [c, t, w, m, l] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM deliveries WHERE expires_at > ?1) AS active,
         (SELECT COUNT(*) FROM deliveries WHERE expires_at > ?1 AND expires_at <= ?2) AS expiring,
         (SELECT COUNT(*) FROM deliveries WHERE expires_at <= ?1) AS expired,
         (SELECT COUNT(*) FROM deliveries WHERE expires_at <= ?1 AND files_removed_at IS NULL) AS awaiting,
         (SELECT COUNT(*) FROM deliveries) AS total,
         (SELECT COUNT(*) FROM delivery_files) AS files`,
    ).bind(now, now + EXPIRING_SOON_SECONDS).first<Record<string, number>>(),
    env.DB.prepare("SELECT COALESCE(SUM(views),0) AS v, COALESCE(SUM(downloads),0) AS d FROM delivery_daily_metrics WHERE day = ?").bind(day).first<{ v: number; d: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(views),0) AS v, COALESCE(SUM(downloads),0) AS d FROM delivery_daily_metrics WHERE day >= ?").bind(since7).first<{ v: number; d: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(views),0) AS v, COALESCE(SUM(downloads),0) AS d FROM delivery_analytics WHERE month = ?").bind(localMonth(env)).first<{ v: number; d: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(views),0) AS v, COALESCE(SUM(downloads),0) AS d FROM delivery_analytics").first<{ v: number; d: number }>(),
  ]);
  const created = await env.DB.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE created_at >= ?").bind(localDayStartTs(env)).first<{ n: number }>();
  return {
    deliveries: { active: c?.active ?? 0, expiring_soon: c?.expiring ?? 0, expired: c?.expired ?? 0, awaiting_cleanup: c?.awaiting ?? 0, total: c?.total ?? 0, live_files: c?.files ?? 0 },
    activity: {
      today: { views: t?.v ?? 0, downloads: t?.d ?? 0, new_deliveries: created?.n ?? 0 },
      last_7d: { views: w?.v ?? 0, downloads: w?.d ?? 0 },
      month: { views: m?.v ?? 0, downloads: m?.d ?? 0 },
      lifetime: { views: l?.v ?? 0, downloads: l?.d ?? 0 },
    },
  };
}

export interface SeriesPoint { label: string; views: number; downloads: number }

export async function getTimeseries(env: Env, range: "24h" | "7d" | "30d" | "all"): Promise<SeriesPoint[]> {
  const now = nowSec();
  if (range === "24h") {
    const labels: string[] = [];
    for (let h = 23; h >= 0; h--) labels.push(localHour(env, now - h * 3600));
    const rows = (await env.DB.prepare(`SELECT hour, views, downloads FROM site_hourly_metrics WHERE hour >= ?`).bind(labels[0]!).all<{ hour: string; views: number; downloads: number }>()).results;
    const by = new Map(rows.map((r) => [r.hour, r]));
    return labels.map((label) => ({ label, views: by.get(label)?.views ?? 0, downloads: by.get(label)?.downloads ?? 0 }));
  }

  let days: string[] = [];
  if (range === "7d" || range === "30d") {
    const n = range === "7d" ? 7 : 30;
    for (let d = n - 1; d >= 0; d--) days.push(localDay(env, now - d * 86400));
  } else {
    const first = await env.DB.prepare("SELECT MIN(day) AS d FROM delivery_daily_metrics").first<{ d: string | null }>();
    const startTs = first?.d ? Math.floor(new Date(`${first.d}T00:00:00Z`).getTime() / 1000) - utcOffsetSeconds(env) : now;
    const spanDays = Math.min(366, Math.max(1, Math.ceil((now - startTs) / 86400) + 1));
    for (let d = spanDays - 1; d >= 0; d--) days.push(localDay(env, now - d * 86400));
  }
  days = [...new Set(days)];
  const rows = (
    await env.DB.prepare("SELECT day, SUM(views) AS views, SUM(downloads) AS downloads FROM delivery_daily_metrics WHERE day >= ? GROUP BY day")
      .bind(days[0]!).all<{ day: string; views: number; downloads: number }>()
  ).results;
  const by = new Map(rows.map((r) => [r.day, r]));
  return days.map((label) => ({ label, views: by.get(label)?.views ?? 0, downloads: by.get(label)?.downloads ?? 0 }));
}

export interface TopDelivery {
  id: string; project_name: string | null; client_name: string | null; source: string; is_photoshop_battles: boolean;
  views_7d: number; downloads_7d: number; view_count: number; download_count: number;
  expires_at: string; last_activity: string | null; trending: boolean;
}

/** Active deliveries ranked by last-7-day traffic (views + 2 x downloads). */
export async function getTopDeliveries(env: Env, limit = 8): Promise<TopDelivery[]> {
  const now = nowSec();
  const since7 = localDay(env, now - 6 * 86400);
  const since2 = localDay(env, now - 86400);
  const rows = (
    await env.DB.prepare(
      `SELECT d.id, d.project_name, d.client_name, d.source, d.is_photoshop_battles, d.view_count, d.download_count,
              d.expires_at, COALESCE(d.last_viewed_at, d.last_downloaded_at) AS last_activity,
              COALESCE(SUM(CASE WHEN m.day >= ?1 THEN m.views END), 0) AS v7,
              COALESCE(SUM(CASE WHEN m.day >= ?1 THEN m.downloads END), 0) AS d7,
              COALESCE(SUM(CASE WHEN m.day >= ?2 THEN m.views + m.downloads END), 0) AS recent
         FROM deliveries d LEFT JOIN delivery_daily_metrics m ON m.delivery_id = d.id
        WHERE d.expires_at > ?3
        GROUP BY d.id
       HAVING v7 + d7 > 0 OR d.view_count + d.download_count > 0
        ORDER BY (v7 + 2 * d7) DESC, (d.view_count + 2 * d.download_count) DESC
        LIMIT ?4`,
    ).bind(since7, since2, now, Math.min(20, Math.max(1, limit))).all<{
      id: string; project_name: string | null; client_name: string | null; source: string; is_photoshop_battles: number;
      view_count: number; download_count: number; expires_at: number; last_activity: number | null; v7: number; d7: number; recent: number;
    }>()
  ).results;
  return rows.map((r) => ({
    id: r.id, project_name: r.project_name, client_name: r.client_name, source: r.source, is_photoshop_battles: r.is_photoshop_battles === 1,
    views_7d: r.v7, downloads_7d: r.d7, view_count: r.view_count, download_count: r.download_count,
    expires_at: iso(r.expires_at), last_activity: isoOrNull(r.last_activity),
    trending: r.recent >= 3 && r.recent >= (r.v7 + r.d7) * 0.5,
  }));
}

export async function getPageAnalytics(env: Env, days = 30): Promise<Array<{ page: string; views: number }>> {
  const since = localDay(env, nowSec() - (days - 1) * 86400);
  return (await env.DB.prepare("SELECT page, SUM(views) AS views FROM page_analytics WHERE day >= ? GROUP BY page ORDER BY views DESC").bind(since).all<{ page: string; views: number }>()).results;
}

export interface ShareSnapshot {
  totals: { total: number; today: number; last_7d: number; month: number };
  page_types: { deliveries: number; photoshop_battles: number };
  methods: Record<string, number>;
  top: Array<{ delivery_id: string; project_name: string | null; page_type: string; shares: number }>;
}

export async function getShareAnalytics(env: Env): Promise<ShareSnapshot> {
  const now = nowSec();
  const day = localDay(env);
  const since7 = localDay(env, now - 6 * 86400);
  const month = localMonth(env);
  const [t, pt, m, top] = await Promise.all([
    env.DB.prepare(
      `SELECT COALESCE(SUM(count),0) AS total,
              COALESCE(SUM(CASE WHEN day = ?1 THEN count END),0) AS today,
              COALESCE(SUM(CASE WHEN day >= ?2 THEN count END),0) AS w7,
              COALESCE(SUM(CASE WHEN substr(day,1,7) = ?3 THEN count END),0) AS month
         FROM share_metrics`,
    ).bind(day, since7, month).first<{ total: number; today: number; w7: number; month: number }>(),
    env.DB.prepare("SELECT page_type, SUM(count) AS n FROM share_metrics GROUP BY page_type").all<{ page_type: string; n: number }>(),
    env.DB.prepare("SELECT method, SUM(count) AS n FROM share_metrics GROUP BY method ORDER BY n DESC").all<{ method: string; n: number }>(),
    env.DB.prepare(
      `SELECT s.delivery_id, d.project_name, s.page_type, SUM(s.count) AS shares
         FROM share_metrics s LEFT JOIN deliveries d ON d.id = s.delivery_id
        GROUP BY s.delivery_id, s.page_type, d.project_name
        ORDER BY shares DESC LIMIT 10`,
    ).all<{ delivery_id: string; project_name: string | null; page_type: string; shares: number }>(),
  ]);
  const pageTypes = { deliveries: 0, photoshop_battles: 0 };
  for (const r of pt?.results ?? []) {
    if (r.page_type === "photoshop_battles") pageTypes.photoshop_battles = r.n;
    else pageTypes.deliveries += r.n;
  }
  const methods: Record<string, number> = {};
  for (const r of m?.results ?? []) methods[r.method] = r.n;
  return {
    totals: { total: t?.total ?? 0, today: t?.today ?? 0, last_7d: t?.w7 ?? 0, month: t?.month ?? 0 },
    page_types: pageTypes,
    methods,
    top: top?.results ?? [],
  };
}

export async function getDeliveryDailySeries(env: Env, id: string, days = 30): Promise<SeriesPoint[]> {
  const now = nowSec();
  const labels: string[] = [];
  for (let d = days - 1; d >= 0; d--) labels.push(localDay(env, now - d * 86400));
  const rows = (await env.DB.prepare("SELECT day, views, downloads FROM delivery_daily_metrics WHERE delivery_id = ? AND day >= ?").bind(id, labels[0]!).all<{ day: string; views: number; downloads: number }>()).results;
  const by = new Map(rows.map((r) => [r.day, r]));
  return labels.map((label) => ({ label, views: by.get(label)?.views ?? 0, downloads: by.get(label)?.downloads ?? 0 }));
}
