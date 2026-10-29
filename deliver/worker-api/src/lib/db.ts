import type { DeliveryFileRow, DeliveryRow, Env } from "../types";
import { HttpError } from "../types";
import { milestoneNotificationsEnabled, queueMilestoneCheck } from "./notify";
import type { TrafficSourceVisit } from "./traffic-sources";
import { buildVisits, computeFlow, MIN_VISITS_FOR_FLOW, pageEntranceExit, VISIT_GAP_SECONDS } from "./flow";
import type { FlowEvent, FlowResult } from "./flow";

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
export async function createDeliveryFromUploads(env: Env, a: NewDelivery, ctx: ExecutionContext): Promise<void> {
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
  if (milestoneNotificationsEnabled(env)) queueMilestoneCheck(env, ctx, "deliveries");
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
export async function recordView(env: Env, id: string, ctx: ExecutionContext): Promise<boolean> {
  const ts = nowSec();
  const r = await env.DB.prepare(
    "UPDATE deliveries SET view_count = view_count + 1, last_viewed_at = ?1 WHERE id = ?2 AND expires_at > ?1 AND files_removed_at IS NULL",
  ).bind(ts, id).run();
  if ((r.meta.changes ?? 0) === 0) return false;
  // Private Deliver views (delivery pages AND direct PhotoshopBattles image requests) are counted only in the
  // Deliver-specific tables below. They deliberately do NOT touch page_analytics: the 'deliver' key there is
  // reserved for public website traffic to deliver.html (written by recordPageView from js/pageview.js), and
  // Command Centre keeps website traffic and private Deliver activity in separate blocks.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO delivery_analytics (delivery_id, month, views, downloads) VALUES (?1, ?2, 1, 0) ON CONFLICT (delivery_id, month) DO UPDATE SET views = views + 1").bind(id, localMonth(env, ts)),
    env.DB.prepare("INSERT INTO delivery_daily_metrics (delivery_id, day, views, downloads) VALUES (?1, ?2, 1, 0) ON CONFLICT (delivery_id, day) DO UPDATE SET views = views + 1").bind(id, localDay(env, ts)),
    env.DB.prepare("INSERT INTO site_hourly_metrics (hour, views, downloads) VALUES (?1, 1, 0) ON CONFLICT (hour) DO UPDATE SET views = views + 1").bind(localHour(env, ts)),
  ]);
  // Milestone emails run in the background; they can never break this event.
  if (milestoneNotificationsEnabled(env)) queueMilestoneCheck(env, ctx, "views");
  return true;
}

export async function recordDownload(env: Env, id: string, ctx: ExecutionContext): Promise<boolean> {
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
  if (milestoneNotificationsEnabled(env)) queueMilestoneCheck(env, ctx, "downloads");
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
export async function recordShare(env: Env, id: string, method: string, ctx: ExecutionContext): Promise<boolean> {
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
  if (kind === "completed" && milestoneNotificationsEnabled(env)) queueMilestoneCheck(env, ctx, "shares");
  return true;
}

// "toolkit" = creative-toolkit.html. js/pageview.js has always sent it, but it was missing from this
// allow-list, so those page views were silently dropped (recordPageView returns false for unknown keys).
export const PAGE_KEYS = ["homepage", "stores", "portfolio", "tools", "toolkit", "guides", "about", "support", "contact", "services", "deliver"] as const;

/** Records one public page view. Returns whether it was COUNTED.
 *  - Unknown page keys are never counted.
 *  - With a valid anonymous session id the event is stored first (INSERT OR IGNORE) and the daily counter is
 *    incremented ONLY if that insert really added a row, in the same D1 batch/transaction. A re-sent event
 *    (same event_id, or same session + page + second) is therefore ignored by both tables and can never be
 *    counted twice, and the counter can never move without a matching event row.
 *  - Without a usable session id (cookies blocked, very old cached client) the view is still counted in the
 *    daily counter but cannot be de-duplicated or placed in a journey. The dashboard reports that coverage gap. */
export async function recordPageView(env: Env, page: string, sessionId?: string, eventId?: string): Promise<boolean> {
  if (!(PAGE_KEYS as readonly string[]).includes(page)) return false;
  const ts = nowSec();
  const day = localDay(env);
  const cleanSession = typeof sessionId === "string" ? sessionId.trim().toLowerCase() : "";
  const cleanEvent = typeof eventId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(eventId) ? eventId : null;

  if (!/^[a-f0-9]{32}$/.test(cleanSession)) {
    await env.DB.prepare("INSERT INTO page_analytics (day, page, views) VALUES (?1, ?2, 1) ON CONFLICT (day, page) DO UPDATE SET views = views + 1")
      .bind(day, page).run();
    return true;
  }

  const [inserted] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO page_session_events (session_id, seen_at, page, event_id) VALUES (?1, ?2, ?3, ?4)")
      .bind(cleanSession, ts, page, cleanEvent),
    env.DB.prepare("INSERT INTO page_analytics (day, page, views) SELECT ?1, ?2, 1 WHERE changes() > 0 ON CONFLICT (day, page) DO UPDATE SET views = views + 1")
      .bind(day, page),
  ]);
  return (inserted?.meta?.changes ?? 0) > 0;
}

export async function recordTrafficSourceVisit(env: Env, visit: TrafficSourceVisit): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO traffic_source_visits
       (session_id, seen_at, source, utm_source, utm_medium, utm_campaign)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(visit.sessionId, nowSec(), visit.source, visit.utmSource, visit.utmMedium, visit.utmCampaign).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getTrafficSourceSummary(env: Env, input: WindowInput | PeriodWindow) {
  const pw = asWindow(env, input);
  const key = pw.key;
  const days = pw.days;
  const until = pw.until;
  const since = pw.since;
  const start = pw.startTs;
  const timeClause = start === null ? "seen_at <= ?1" : "seen_at >= ?1 AND seen_at <= ?2";
  const timeBindings = start === null ? [pw.endTs] : [start, pw.endTs];
  const [sourceRows, campaignRows, firstVisit] = await Promise.all([
    env.DB.prepare(`SELECT source, COUNT(*) AS visits FROM traffic_source_visits WHERE ${timeClause} GROUP BY source`)
      .bind(...timeBindings).all<{ source: string; visits: number }>(),
    env.DB.prepare(
      `SELECT utm_source, utm_medium, utm_campaign, COUNT(*) AS visits
         FROM traffic_source_visits
        WHERE (${timeClause}) AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
        GROUP BY utm_source, utm_medium, utm_campaign
        ORDER BY visits DESC, utm_campaign, utm_source, utm_medium
        LIMIT 20`,
    ).bind(...timeBindings).all<{ utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; visits: number }>(),
    days === null
      ? env.DB.prepare("SELECT MIN(seen_at) AS seen_at FROM traffic_source_visits").first<{ seen_at: number | null }>()
      : Promise.resolve(null),
  ]);
  // Additive fields for the dashboard: previous equivalent period, first/last recorded visit.
  const [prevCount, firstLast] = await Promise.all([
    pw.previous
      ? env.DB.prepare("SELECT COUNT(*) AS n FROM traffic_source_visits WHERE seen_at >= ?1 AND seen_at <= ?2").bind(pw.previous.startTs, pw.previous.endTs).first<{ n: number }>()
      : Promise.resolve(null),
    env.DB.prepare("SELECT MIN(seen_at) AS first_at, MAX(seen_at) AS last_at FROM traffic_source_visits").first<{ first_at: number | null; last_at: number | null }>(),
  ]);
  const sourceCounts = new Map(sourceRows.results.map(row => [row.source, row.visits]));
  const sources = ["reddit", "organic_search", "social", "referral", "direct_unknown"]
    .map(source => ({ source, visits: sourceCounts.get(source) ?? 0 }));
  return {
    period: { key, since: since ?? (firstVisit?.seen_at ? localDay(env, firstVisit.seen_at) : null), until },
    total: sources.reduce((sum, row) => sum + row.visits, 0),
    sources,
    campaigns: campaignRows.results,
    previous: pw.previous && prevCount ? { since: pw.previous.since, until: pw.previous.until, total: prevCount.n } : null,
    data_since: firstLast?.first_at != null ? localDay(env, firstLast.first_at) : null,
    last_visit_at: firstLast?.last_at != null ? iso(firstLast.last_at) : null,
  };
}

export interface PageFlowSummary {
  path: string;
  sessions: number;
}

/** Within one browser session_id, a gap longer than this starts a new sub-session.
 *  Prevents recording fake page-to-page transitions between visits that are
 *  hours or days apart but happen to share the same anonymous session id. */
const SESSION_GAP_SECONDS = 30 * 60;

export async function getPageFlow(env: Env, days = 30, limit = 8): Promise<PageFlowSummary[]> {
  const cutoff = nowSec() - days * 86400;
  const rows = await env.DB.prepare("SELECT session_id, page, seen_at FROM page_session_events WHERE seen_at >= ?1 ORDER BY session_id, seen_at ASC")
    .bind(cutoff)
    .all<{ session_id: string; page: string; seen_at: number }>();

  const bySession = new Map<string, { page: string; seen_at: number }[]>();
  for (const row of rows.results) {
    const list = bySession.get(row.session_id) ?? [];
    list.push({ page: row.page, seen_at: row.seen_at });
    bySession.set(row.session_id, list);
  }

  const counts = new Map<string, number>();
  const flush = (pages: string[]) => {
    if (pages.length === 0) return;
    const path = pages.length > 1 ? pages.join(" → ") : pages[0]!;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  };

  for (const events of bySession.values()) {
    let subSession: string[] = [];
    let lastSeen: number | null = null;
    for (const e of events) {
      if (lastSeen !== null && e.seen_at - lastSeen > SESSION_GAP_SECONDS) {
        flush(subSession);
        subSession = [];
      }
      if (subSession.length === 0 || subSession[subSession.length - 1] !== e.page) {
        subSession.push(e.page);
      }
      lastSeen = e.seen_at;
    }
    flush(subSession);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path, sessions]) => ({ path, sessions }));
}

/* -----------------------------------------------------------------------------
   Website page-view timeseries (per-day totals for the selected period).
   Reuses page_analytics — no new table, no new writes, read-only aggregation.
   ---------------------------------------------------------------------------- */

export interface WebsiteTimeseriesPoint {
  day: string;
  views: number;
}

export async function getWebsiteTimeseries(env: Env, days: number): Promise<WebsiteTimeseriesPoint[]> {
  const now = nowSec();
  const until = localDay(env, now);
  const since = localDay(env, now - (days - 1) * 86400);

  const rows = await env.DB.prepare(
    "SELECT day, SUM(views) AS views FROM page_analytics WHERE day >= ?1 AND day <= ?2 GROUP BY day"
  )
    .bind(since, until)
    .all<{ day: string; views: number }>();

  const by = new Map<string, number>(rows.results.map((r) => [r.day, r.views]));

  // Build a contiguous day label list so missing days render as zero, not gaps.
  const labels: string[] = [];
  const sinceSec = Date.parse(`${since}T00:00:00Z`) / 1000;
  const untilSec = Date.parse(`${until}T00:00:00Z`) / 1000;
  for (let d = 0; sinceSec + d * 86400 <= untilSec; d++) {
    labels.push(localDay(env, sinceSec + d * 86400));
  }

  return labels.map((day) => ({ day, views: by.get(day) ?? 0 }));
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

// -----------------------------------------------------------------------------
// Analytics summary (Command Centre → Analytics). READ-ONLY aggregation over tables that
// already exist (page_analytics, delivery_daily_metrics, share_metrics, deliveries). It adds no
// table, stores nothing and exposes nothing per visitor. Website page views and Deliver
// activity are returned in SEPARATE blocks on purpose: Deliver views (including direct
// PhotoshopBattles image requests) must never be mixed into public-website numbers.
// -----------------------------------------------------------------------------
// "today" = the current local calendar day so far, compared with yesterday (a full day). Added for the 24-hour view.
export const SUMMARY_PERIODS = { today: 1, "7d": 7, "30d": 30, "90d": 90, all: null } as const;
export type SummaryPeriod = keyof typeof SUMMARY_PERIODS;

export interface SummaryDeliverType {
  type: string;                 // private | paid | free | returning | other | reddit | photoshop_battles | deleted
  deliveries_active: number;    // distinct deliveries with at least one view/download in the window
  views: number; downloads: number; shares: number;
  prev_views: number | null; prev_downloads: number | null; prev_shares: number | null;
}

export interface AnalyticsSummary {
  /** `includes_today`: the last day of the window is today, so it is still in progress (a partial day). */
  period: { key: SummaryPeriod | "custom"; days: number | null; since: string | null; until: string; previous: { since: string; until: string } | null; includes_today: boolean };
  website: { pages: Array<{ page: string; views: number; prev_views: number | null }>; total_views: number; prev_total_views: number | null; data_since: string | null };
  deliver: { types: SummaryDeliverType[]; stored: Record<string, number> };
}

interface TypeAgg { active: number; views: number; downloads: number; shares: number }

/** Deliver activity per delivery type inside [since, until] (inclusive local days). A deleted delivery keeps its
 *  daily rows but no longer has a type, so it is reported as "deleted" rather than guessed. */
async function deliverTypeAggregates(env: Env, since: string, until: string): Promise<Map<string, TypeAgg>> {
  const [activity, shares] = await Promise.all([
    env.DB.prepare(
      `SELECT CASE WHEN d.id IS NULL THEN 'deleted' WHEN d.is_photoshop_battles = 1 THEN 'photoshop_battles' ELSE COALESCE(d.source, 'private') END AS type,
              COUNT(DISTINCT m.delivery_id) AS active, COALESCE(SUM(m.views), 0) AS views, COALESCE(SUM(m.downloads), 0) AS downloads
         FROM delivery_daily_metrics m LEFT JOIN deliveries d ON d.id = m.delivery_id
        WHERE m.day >= ?1 AND m.day <= ?2
        GROUP BY type`,
    ).bind(since, until).all<{ type: string; active: number; views: number; downloads: number }>(),
    env.DB.prepare(
      `SELECT CASE WHEN d.id IS NULL THEN 'deleted' WHEN d.is_photoshop_battles = 1 THEN 'photoshop_battles' ELSE COALESCE(d.source, 'private') END AS type,
              COALESCE(SUM(s.count), 0) AS shares
         FROM share_metrics s LEFT JOIN deliveries d ON d.id = s.delivery_id
        WHERE s.day >= ?1 AND s.day <= ?2
        GROUP BY type`,
    ).bind(since, until).all<{ type: string; shares: number }>(),
  ]);
  const out = new Map<string, TypeAgg>();
  const slot = (t: string): TypeAgg => { let a = out.get(t); if (!a) { a = { active: 0, views: 0, downloads: 0, shares: 0 }; out.set(t, a); } return a; };
  for (const r of activity.results) { const a = slot(r.type); a.active = r.active; a.views = r.views; a.downloads = r.downloads; }
  for (const r of shares.results) slot(r.type).shares = r.shares;
  return out;
}

/** Public website page views per page key. The public Deliver page (deliver.html) records under the 'deliver'
 *  key and is a normal website page; private Deliver activity lives in delivery_daily_metrics/share_metrics and
 *  is returned separately (never here). */
async function websitePageViews(env: Env, since: string, until: string): Promise<Map<string, number>> {
  const rows = (await env.DB.prepare("SELECT page, COALESCE(SUM(views), 0) AS views FROM page_analytics WHERE day >= ?1 AND day <= ?2 GROUP BY page")
    .bind(since, until).all<{ page: string; views: number }>()).results;
  return new Map(rows.map((r) => [r.page, r.views]));
}

export async function getAnalyticsSummary(env: Env, input: WindowInput | PeriodWindow): Promise<AnalyticsSummary> {
  const w = asWindow(env, input);
  const key = w.key;
  const days = w.days;
  const until = w.until;
  const since = w.since ?? "";
  // The comparison window is the same number of days immediately before; "all available" has nothing to compare to.
  const prev = w.previous ? { since: w.previous.since, until: w.previous.until } : null;

  const [pages, prevPages, firstDay, types, prevTypes, stored] = await Promise.all([
    websitePageViews(env, since, until),
    prev ? websitePageViews(env, prev.since, prev.until) : Promise.resolve(null),
    env.DB.prepare("SELECT MIN(day) AS d FROM page_analytics").first<{ d: string | null }>(),
    deliverTypeAggregates(env, since, until),
    prev ? deliverTypeAggregates(env, prev.since, prev.until) : Promise.resolve(null),
    env.DB.prepare("SELECT CASE WHEN is_photoshop_battles = 1 THEN 'photoshop_battles' ELSE COALESCE(source, 'private') END AS type, COUNT(*) AS n FROM deliveries GROUP BY type").all<{ type: string; n: number }>(),
  ]);

  const pageKeys = new Set<string>([...pages.keys(), ...(prevPages ? [...prevPages.keys()] : [])]);
  const pageRows = [...pageKeys].map((page) => ({ page, views: pages.get(page) ?? 0, prev_views: prevPages ? prevPages.get(page) ?? 0 : null }))
    .sort((a, b) => b.views - a.views || a.page.localeCompare(b.page));
  const sum = (m: Map<string, number> | null) => (m ? [...m.values()].reduce((t, n) => t + n, 0) : null);

  const typeKeys = new Set<string>([...types.keys(), ...(prevTypes ? [...prevTypes.keys()] : [])]);
  const typeRows: SummaryDeliverType[] = [...typeKeys].map((type) => {
    const cur = types.get(type); const old = prevTypes ? prevTypes.get(type) : undefined;
    return {
      type, deliveries_active: cur?.active ?? 0, views: cur?.views ?? 0, downloads: cur?.downloads ?? 0, shares: cur?.shares ?? 0,
      prev_views: prevTypes ? old?.views ?? 0 : null, prev_downloads: prevTypes ? old?.downloads ?? 0 : null, prev_shares: prevTypes ? old?.shares ?? 0 : null,
    };
  }).sort((a, b) => b.views - a.views || a.type.localeCompare(b.type));

  return {
    period: { key, days, since: days === null ? firstDay?.d ?? null : since, until, previous: prev, includes_today: w.includesToday },
    website: { pages: pageRows, total_views: sum(pages) ?? 0, prev_total_views: sum(prevPages), data_since: firstDay?.d ?? null },
    deliver: { types: typeRows, stored: Object.fromEntries(stored.results.map((r) => [r.type, r.n])) },
  };
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

/** Aggregated store-link click statistics for the Command Centre Stores
 *  Analytics tab. Bucketing follows the site's existing analytics timezone
 *  convention (ANALYTICS_UTC_OFFSET_MINUTES, default SAST/UTC+2). */
export async function getStoreClickSummary(env: Env, input: WindowInput | PeriodWindow): Promise<StoreClickSummary> {
  const w = asWindow(env, input);
  const key = w.key;
  const offset = utcOffsetSeconds(env);
  // ROOT-CAUSE FIX: the old series query bound (offset, start, now) against a clause that referenced ?1/?2, so
  // the offset was compared with created_at and D1 rejected the extra parameter => the Store card showed an error.
  // Every query now numbers its own placeholders explicitly.
  const clause = (n: number) => (w.startTs === null ? `created_at <= ?${n}` : `created_at >= ?${n} AND created_at <= ?${n + 1}`);
  const bind = w.startTs === null ? [w.endTs] : [w.startTs, w.endTs];
  const STORE_PAGE_PLACEMENTS = "('store_grid','stores')";

  const [destRows, seriesRows, sourceRows, totalSessions, firstEvent, lastEvent, storePageClicks, storeViews, prevRows, prevStoreViews] = await Promise.all([
    env.DB.prepare(`SELECT destination, COUNT(*) AS clicks, COUNT(DISTINCT session_id) AS unique_sessions FROM store_clicks WHERE ${clause(1)} GROUP BY destination`)
      .bind(...bind).all<StoreClickDestinationRow>(),
    env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', datetime(created_at + ?1, 'unixepoch')) AS day, destination, COUNT(*) AS clicks
         FROM store_clicks WHERE ${clause(2)} GROUP BY day, destination`,
    ).bind(offset, ...bind).all<StoreClickSeriesPoint>(),
    env.DB.prepare(`SELECT destination, source_placement, COUNT(*) AS clicks FROM store_clicks WHERE ${clause(1)} GROUP BY destination, source_placement`)
      .bind(...bind).all<{ destination: string; source_placement: string; clicks: number }>(),
    env.DB.prepare(`SELECT COUNT(DISTINCT session_id) AS n FROM store_clicks WHERE ${clause(1)}`).bind(...bind).first<{ n: number }>(),
    env.DB.prepare("SELECT MIN(created_at) AS created_at FROM store_clicks").first<{ created_at: number | null }>(),
    env.DB.prepare("SELECT MAX(created_at) AS created_at FROM store_clicks").first<{ created_at: number | null }>(),
    env.DB.prepare(`SELECT destination, COUNT(*) AS clicks FROM store_clicks WHERE ${clause(1)} AND source_placement IN ${STORE_PAGE_PLACEMENTS} GROUP BY destination`)
      .bind(...bind).all<{ destination: string; clicks: number }>(),
    w.since === null
      ? env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS v FROM page_analytics WHERE page = 'stores'").first<{ v: number }>()
      : env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS v FROM page_analytics WHERE page = 'stores' AND day >= ?1 AND day <= ?2").bind(w.since, w.until).first<{ v: number }>(),
    w.previous
      ? env.DB.prepare("SELECT destination, COUNT(*) AS clicks FROM store_clicks WHERE created_at >= ?1 AND created_at <= ?2 GROUP BY destination").bind(w.previous.startTs, w.previous.endTs).all<{ destination: string; clicks: number }>()
      : Promise.resolve(null),
    w.previous
      ? env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS v FROM page_analytics WHERE page = 'stores' AND day >= ?1 AND day <= ?2").bind(w.previous.since, w.previous.until).first<{ v: number }>()
      : Promise.resolve(null),
  ]);

  const byDestination = new Map<string, { clicks: number; unique_sessions: number }>();
  for (const r of destRows.results) byDestination.set(r.destination, { clicks: r.clicks, unique_sessions: r.unique_sessions });
  const storePageByDest = new Map(storePageClicks.results.map(r => [r.destination, r.clicks]));

  // Top placement per destination (ties broken alphabetically so the answer is stable).
  const topSourceByDestination = new Map<string, string>();
  const best = new Map<string, number>();
  for (const r of [...sourceRows.results].sort((a, b) => a.source_placement.localeCompare(b.source_placement))) {
    if (r.clicks > (best.get(r.destination) ?? 0)) { best.set(r.destination, r.clicks); topSourceByDestination.set(r.destination, r.source_placement); }
  }

  // One label per local calendar day from the window start (or the first recorded click for "all") to its end.
  const dayLabels: string[] = [];
  const firstLabel = w.since ?? (firstEvent?.created_at != null ? localDay(env, firstEvent.created_at) : w.until);
  const spanDays = Math.min(MAX_CUSTOM_RANGE_DAYS, Math.max(1, dayDiff(firstLabel, w.until) + 1));
  for (let d = spanDays - 1; d >= 0; d--) dayLabels.push(addDays(w.until, -d));

  const clicksByDayDest = new Map<string, number>();
  for (const r of seriesRows.results) clicksByDayDest.set(`${r.day}|${r.destination}`, r.clicks);
  const series: StoreClickSeriesPoint[] = [];
  for (const day of dayLabels) for (const destination of STORE_CLICK_DESTINATIONS) {
    series.push({ day, destination, clicks: clicksByDayDest.get(`${day}|${destination}`) ?? 0 });
  }

  const by_destination = STORE_CLICK_DESTINATIONS.map(destination => {
    const row = byDestination.get(destination);
    return {
      destination,
      clicks: row?.clicks ?? 0,
      unique_sessions: row?.unique_sessions ?? 0,
      top_source: topSourceByDestination.get(destination) ?? null,
      store_page_clicks: storePageByDest.get(destination) ?? 0,
    };
  });

  const sourceTotals = new Map<string, number>();
  for (const r of sourceRows.results) sourceTotals.set(r.source_placement, (sourceTotals.get(r.source_placement) ?? 0) + r.clicks);
  const sources: StoreClickSourceRow[] = [];
  for (const [source_placement, clicks] of sourceTotals) sources.push({ source_placement, clicks });
  sources.sort((a, b) => b.clicks - a.clicks || a.source_placement.localeCompare(b.source_placement));

  const sumOutbound = (rows: Array<{ destination: string; clicks: number }>) => rows.filter(r => STORE_OUTBOUND.includes(r.destination)).reduce((t, r) => t + r.clicks, 0);
  const total = destRows.results.reduce((sum, r) => sum + r.clicks, 0);
  return {
    period: { key, since: w.since, until: w.until },
    total,
    outbound_total: sumOutbound(destRows.results),
    unique_sessions: totalSessions?.n ?? 0,
    by_destination,
    series,
    sources,
    store_page_views: storeViews?.v ?? 0,
    product_card_clicks: sourceRows.results.filter(r => r.source_placement === "store_grid").reduce((t, r) => t + r.clicks, 0),
    previous: w.previous && prevRows ? {
      since: w.previous.since, until: w.previous.until,
      total: prevRows.results.reduce((t, r) => t + r.clicks, 0),
      outbound_total: sumOutbound(prevRows.results),
      store_page_views: prevStoreViews?.v ?? 0,
    } : null,
    data_since: firstEvent?.created_at != null ? localDay(env, firstEvent.created_at) : null,
    last_event_at: lastEvent?.created_at != null ? iso(lastEvent.created_at) : null,
  };
}

/* -----------------------------------------------------------------------------
   Store-link clicks (Command Centre -> Stores Analytics)
   ---------------------------------------------------------------------------- */

export const STORE_CLICK_DESTINATIONS = ["boztik_store", "redbubble", "teepublic", "kofi"] as const;
export type StoreClickDestination = (typeof STORE_CLICK_DESTINATIONS)[number];

export interface StoreClickInput {
  event_id: string;
  destination: StoreClickDestination;
  source_placement: string;
  session_id: string;
  event_version: number;
}

export interface StoreClickDestinationRow {
  destination: string;
  clicks: number;
  unique_sessions: number;
  top_source: string | null;
  /** Clicks whose placement is the Store page itself (store_grid / stores) — numerator for Store-page click-through. */
  store_page_clicks: number;
}

export interface StoreClickSeriesPoint {
  day: string;
  destination: string;
  clicks: number;
}

export interface StoreClickSourceRow {
  source_placement: string;
  clicks: number;
}

/** Destinations that leave Boztik. "boztik_store" is an internal link to the Store page, not an outbound store click. */
export const STORE_OUTBOUND: string[] = ["redbubble", "teepublic", "kofi"];

export interface StoreClickSummary {
  period: { key: SummaryPeriod | "custom"; since: string | null; until: string };
  total: number;
  /** Clicks to Redbubble + TeePublic + Ko-fi (leaves Boztik). A click is NOT a purchase. */
  outbound_total: number;
  /** Public Boztik Stores page views (first-party counter) in the same window — the denominator for click-through. */
  store_page_views: number;
  /** Clicks on product / release cards inside the Store page grid. */
  product_card_clicks: number;
  previous: { since: string; until: string; total: number; outbound_total: number; store_page_views: number } | null;
  last_event_at: string | null;
  unique_sessions: number;
  by_destination: StoreClickDestinationRow[];
  series: StoreClickSeriesPoint[];
  sources: StoreClickSourceRow[];
  data_since: string | null;
}

/** Records one store-link click. Idempotent: re-sending the same event_id is
 *  a no-op because event_id is the primary key. Returns whether the event was
 *  newly counted. */
export async function recordStoreClick(env: Env, click: StoreClickInput): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO store_clicks
       (event_id, destination, source_placement, session_id, event_version, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(click.event_id, click.destination, click.source_placement, click.session_id, click.event_version, nowSec())
    .run();
  return (result.meta.changes ?? 0) > 0;
}


// -----------------------------------------------------------------------------
// Reporting windows, visitor flow and data health (Command Centre → Analytics)
// -----------------------------------------------------------------------------
export interface PeriodWindow {
  key: SummaryPeriod | "custom";
  /** Number of local calendar days in the window, or null for "all available". */
  days: number | null;
  /** First local calendar day of the window, or null for "all available". */
  since: string | null;
  /** Last local calendar day of the window. For every preset this is today (a partial day). */
  until: string;
  startTs: number | null;
  endTs: number;
  /** True when the last day of the window is today, i.e. the final day is still in progress. */
  includesToday: boolean;
  /** The same number of whole local days immediately before `since`. null for "all". */
  previous: { since: string; until: string; startTs: number; endTs: number } | null;
}

/** Earliest custom date accepted (the site did not exist before this) and the longest custom span. */
export const MIN_CUSTOM_DAY = "2020-01-01";
export const MAX_CUSTOM_RANGE_DAYS = 366;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day. `new Date("2026-13-01")` is an Invalid Date and `toISOString()` THROWS on it, so test first. */
const isRealDay = (s: string): boolean => {
  if (!DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;   // also rejects 2026-02-31
};
/** 'YYYY-MM-DD' ± n calendar days (pure calendar arithmetic, no timezone involved). */
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
/** Unix time of local midnight at the START of the given local calendar day. Correct for any UTC offset. */
export const dayStartTs = (env: Env, day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000 - utcOffsetSeconds(env);

/** What an analytics request may ask for: a preset key, or a custom local-day range. */
export type WindowInput = string | null | undefined | { period?: string | null; from?: string | null; to?: string | null };

/** ONE definition of "the reporting period" shared by every analytics query: whole local calendar days in the
 *  site's analytics timezone (ANALYTICS_UTC_OFFSET_MINUTES, default SAST = UTC+2).
 *   - preset (today / 7d / 30d / 90d / all): ends now, so the last day is partial. Unknown presets fall back to 30d.
 *   - custom (from + to, both 'YYYY-MM-DD'): STRICTLY validated; a bad range is a 422, never silently replaced.
 *  The comparison window is always the same number of whole days immediately before `since`. */
export function resolveWindow(env: Env, input: WindowInput): PeriodWindow {
  const now = nowSec();
  const today = localDay(env, now);
  const req = typeof input === "string" || input == null ? { period: input ?? null } : input;
  const custom = req.from != null || req.to != null || req.period === "custom";

  if (custom) {
    const from = typeof req.from === "string" ? req.from : "";
    const to = typeof req.to === "string" ? req.to : "";
    if (!isRealDay(from) || !isRealDay(to)) throw new HttpError(422, "invalid_range", "A custom range needs both dates as YYYY-MM-DD.");
    if (from > to) throw new HttpError(422, "invalid_range", "The start date must not be after the end date.");
    if (to > today) throw new HttpError(422, "invalid_range", "The end date cannot be in the future.");
    if (from < MIN_CUSTOM_DAY) throw new HttpError(422, "invalid_range", `The start date cannot be before ${MIN_CUSTOM_DAY}.`);
    const days = dayDiff(from, to) + 1;
    if (days > MAX_CUSTOM_RANGE_DAYS) throw new HttpError(422, "range_too_long", `A custom range can cover at most ${MAX_CUSTOM_RANGE_DAYS} days.`);
    const startTs = dayStartTs(env, from);
    const includesToday = to === today;
    const prevSince = addDays(from, -days), prevUntil = addDays(from, -1);
    return {
      key: "custom", days, since: from, until: to, startTs, endTs: includesToday ? now : dayStartTs(env, addDays(to, 1)) - 1, includesToday,
      previous: { since: prevSince, until: prevUntil, startTs: dayStartTs(env, prevSince), endTs: startTs - 1 },
    };
  }

  const key = (typeof req.period === "string" && req.period in SUMMARY_PERIODS ? req.period : "30d") as SummaryPeriod;
  const days = SUMMARY_PERIODS[key];
  if (days === null) return { key, days: null, since: null, until: today, startTs: null, endTs: now, includesToday: true, previous: null };
  const since = addDays(today, -(days - 1));
  const startTs = dayStartTs(env, since);
  const prevSince = addDays(today, -(2 * days - 1)), prevUntil = addDays(today, -days);
  return {
    key, days, since, until: today, startTs, endTs: now, includesToday: true,
    previous: { since: prevSince, until: prevUntil, startTs: dayStartTs(env, prevSince), endTs: startTs - 1 },
  };
}

/** Back-compatible wrapper: every existing caller passes a preset key. */
export function periodWindow(env: Env, key: SummaryPeriod): PeriodWindow {
  return resolveWindow(env, key);
}
const asWindow = (env: Env, input: WindowInput | PeriodWindow): PeriodWindow =>
  typeof input === "object" && input !== null && "endTs" in input ? (input as PeriodWindow) : resolveWindow(env, input as WindowInput);

const FLOW_EVENT_CAP = 50000;

export interface VisitorFlowResponse extends FlowResult {
  period: { key: SummaryPeriod | "custom"; since: string | null; until: string };
  /** no_events = nothing recorded; limited = fewer than MIN_VISITS_FOR_FLOW visits; ok = enough to read patterns. */
  status: "no_events" | "limited" | "ok";
  /** Why a section is empty: real quiet traffic vs. page views arriving WITHOUT session events (instrumentation gap). */
  reason: "none" | "no_page_views_in_period" | "page_views_without_session_events";
  min_visits: number;
  visit_gap_minutes: number;
  events_used: number;
  events_capped: boolean;
  page_views_in_period: number;
  /** Share of counted page views that also have a stored session event (0–100). Below 100 = some views cannot appear in journeys. */
  session_coverage_pct: number | null;
  session_data_since: string | null;
  pages: Array<{ page: string; views: number; session_events: number; entrances: number; exits: number; coverage_pct: number | null }>;
}

export async function getVisitorFlow(env: Env, input: WindowInput | PeriodWindow): Promise<VisitorFlowResponse> {
  const w = asWindow(env, input);
  const key = w.key;
  const dayClause = w.since === null ? "1=1" : "day >= ?1 AND day <= ?2";
  const dayBind = w.since === null ? [] : [w.since, w.until];
  const evClause = w.startTs === null ? "seen_at <= ?1" : "seen_at >= ?1 AND seen_at <= ?2";
  const evBind = w.startTs === null ? [w.endTs] : [w.startTs, w.endTs];

  const [events, views, firstEvent] = await Promise.all([
    env.DB.prepare(`SELECT session_id, page, seen_at FROM page_session_events WHERE ${evClause} ORDER BY seen_at ASC, rowid ASC LIMIT ${FLOW_EVENT_CAP + 1}`)
      .bind(...evBind).all<FlowEvent>(),
    env.DB.prepare(`SELECT page, COALESCE(SUM(views), 0) AS views FROM page_analytics WHERE ${dayClause} GROUP BY page`)
      .bind(...dayBind).all<{ page: string; views: number }>(),
    env.DB.prepare("SELECT MIN(seen_at) AS seen_at FROM page_session_events").first<{ seen_at: number | null }>(),
  ]);

  const capped = events.results.length > FLOW_EVENT_CAP;
  const rows = capped ? events.results.slice(0, FLOW_EVENT_CAP) : events.results;
  const visits = buildVisits(rows);
  const flow = computeFlow(visits);
  const ee = pageEntranceExit(visits);

  const viewsByPage = new Map(views.results.map(r => [r.page, r.views]));
  const eventsByPage = new Map<string, number>();
  for (const r of rows) eventsByPage.set(r.page, (eventsByPage.get(r.page) ?? 0) + 1);
  const pageKeys = new Set<string>([...viewsByPage.keys(), ...eventsByPage.keys()]);
  const pages = [...pageKeys].map(page => {
    const v = viewsByPage.get(page) ?? 0;
    const e = eventsByPage.get(page) ?? 0;
    return { page, views: v, session_events: e, entrances: ee[page]?.entrances ?? 0, exits: ee[page]?.exits ?? 0, coverage_pct: v > 0 ? Math.min(100, Math.round((e / v) * 1000) / 10) : null };
  }).sort((a, b) => b.views - a.views || a.page.localeCompare(b.page));

  const totalViews = pages.reduce((t, p) => t + p.views, 0);
  const totalEvents = rows.length;
  const status = totalEvents === 0 ? "no_events" : visits.length < MIN_VISITS_FOR_FLOW ? "limited" : "ok";
  const reason = totalEvents > 0 ? "none" : totalViews > 0 ? "page_views_without_session_events" : "no_page_views_in_period";

  return {
    ...flow,
    period: { key, since: w.since, until: w.until },
    status, reason,
    min_visits: MIN_VISITS_FOR_FLOW,
    visit_gap_minutes: VISIT_GAP_SECONDS / 60,
    events_used: totalEvents,
    events_capped: capped,
    page_views_in_period: totalViews,
    session_coverage_pct: totalViews > 0 ? Math.min(100, Math.round((totalEvents / totalViews) * 1000) / 10) : null,
    session_data_since: firstEvent?.seen_at != null ? localDay(env, firstEvent.seen_at) : null,
    pages,
  };
}

export type CollectorStatus = "no_data_yet" | "receiving" | "quiet";
export interface AnalyticsHealth {
  generated_at: string;
  timezone: { offset_minutes: number; label: string; boundary: string };
  /** Latest ISO time any first-party analytics event was stored (page views are day-resolution only). */
  last_event_at: string | null;
  collectors: {
    page_views: { status: CollectorStatus; first_day: string | null; last_day: string | null };
    sessions: { status: CollectorStatus; first_at: string | null; last_at: string | null };
    attribution: { status: CollectorStatus; first_at: string | null; last_at: string | null };
    store_clicks: { status: CollectorStatus; first_at: string | null; last_at: string | null };
  };
  /** `not_connected` = no credentials on the Worker; `configured` = credentials are set (NOT proof that Google accepts them —
   *  that is what GET /analytics/ga4/status?verify=1 is for). Kept as strings the older dashboard already understands. */
  ga4: { status: "not_connected" | "configured"; detail: string };
  page_views_before_session_tracking: number;
  retention_days: number;
  privacy_exclusions: string[];
  known_gaps: string[];
}

/** A collector with rows but nothing for 7 days is "quiet": from the database alone, low traffic and a broken
 *  collector look identical, so it is never reported as healthy OR as failed. */
const collectorStatus = (last: number | null, now: number): CollectorStatus => (last === null ? "no_data_yet" : now - last <= 7 * 86400 ? "receiving" : "quiet");

export async function getAnalyticsHealth(env: Env): Promise<AnalyticsHealth> {
  const now = nowSec();
  const [pv, se, ts, sc] = await Promise.all([
    env.DB.prepare("SELECT MIN(day) AS first_day, MAX(day) AS last_day FROM page_analytics").first<{ first_day: string | null; last_day: string | null }>(),
    env.DB.prepare("SELECT MIN(seen_at) AS first_at, MAX(seen_at) AS last_at FROM page_session_events").first<{ first_at: number | null; last_at: number | null }>(),
    env.DB.prepare("SELECT MIN(seen_at) AS first_at, MAX(seen_at) AS last_at FROM traffic_source_visits").first<{ first_at: number | null; last_at: number | null }>(),
    env.DB.prepare("SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM store_clicks").first<{ first_at: number | null; last_at: number | null }>(),
  ]);
  const lastDayTs = pv?.last_day ? Math.floor(Date.parse(`${pv.last_day}T23:59:59Z`) / 1000) - utcOffsetSeconds(env) : null;
  const before = se?.first_at != null
    ? (await env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS v FROM page_analytics WHERE day < ?1").bind(localDay(env, se.first_at)).first<{ v: number }>())?.v ?? 0
    : (await env.DB.prepare("SELECT COALESCE(SUM(views), 0) AS v FROM page_analytics").first<{ v: number }>())?.v ?? 0;
  const lasts = [se?.last_at, ts?.last_at, sc?.last_at].filter((v): v is number => typeof v === "number");
  const lastEvent = lasts.length ? Math.max(...lasts) : null;
  const iso0 = (v: number | null | undefined) => (v == null ? null : iso(v));

  const gaps: string[] = [];
  if (se?.first_at == null) gaps.push("No visitor-path (session) event has ever been stored, so entrances, exits and journeys cannot be reported yet.");
  else gaps.push(`Visitor paths exist only from ${localDay(env, se.first_at)}. ${before.toLocaleString("en-US")} page views counted before that date have no path data.`);
  if (ts?.first_at == null) gaps.push("No traffic-source visit has ever been stored, so every source count is zero because nothing was recorded, not because there were no sources.");
  else gaps.push(`Traffic sources were first recorded on ${localDay(env, ts.first_at)}; earlier visits have no source and are not estimated.`);
  if (sc?.first_at == null) gaps.push("No Store click has ever been stored.");
  else gaps.push(`Store clicks were first recorded on ${localDay(env, sc.first_at)}.`);
  gaps.push("Page views are daily totals (no time of day) for the whole history; only session, source and click events have exact timestamps.");
  gaps.push("A page view is a counted page load, not a person. Reloads and returning visitors count again.");

  return {
    generated_at: iso(now),
    timezone: { offset_minutes: utcOffsetSeconds(env) / 60, label: `UTC${utcOffsetSeconds(env) >= 0 ? "+" : "-"}${Math.abs(utcOffsetSeconds(env) / 3600)}`, boundary: "Reporting days run local midnight to local midnight in this timezone; today is a partial day." },
    last_event_at: iso0(lastEvent),
    collectors: {
      page_views: { status: collectorStatus(lastDayTs, now), first_day: pv?.first_day ?? null, last_day: pv?.last_day ?? null },
      sessions: { status: collectorStatus(se?.last_at ?? null, now), first_at: iso0(se?.first_at), last_at: iso0(se?.last_at) },
      attribution: { status: collectorStatus(ts?.last_at ?? null, now), first_at: iso0(ts?.first_at), last_at: iso0(ts?.last_at) },
      store_clicks: { status: collectorStatus(sc?.last_at ?? null, now), first_at: iso0(sc?.first_at), last_at: iso0(sc?.last_at) },
    },
    ga4: env.GA4_PROPERTY_ID && env.GA4_SERVICE_ACCOUNT_JSON
      ? { status: "configured", detail: "GA4 credentials are set on the Worker. Whether Google accepts them is checked in the Google Analytics 4 section." }
      : { status: "not_connected", detail: "No GA4 Data API credentials are configured on the Worker. GA4 numbers are never estimated or shown as zero." },
    page_views_before_session_tracking: before,
    retention_days: 90,
    privacy_exclusions: [
      "Visitors sending Do Not Track or Global Privacy Control send no analytics events at all.",
      "Command Centre, private delivery links and other unlisted pages are never counted as website pages.",
      "No IP address, name, email or fingerprint is stored. Session and attribution identifiers are random and cannot identify a person.",
      "Session paths and attribution rows are deleted after 90 days; daily page-view totals are kept.",
    ],
    known_gaps: gaps,
  };
}


// -----------------------------------------------------------------------------
// Trend: aligned time buckets for the Command Centre chart (READ-ONLY, no new table, no new writes).
//
//   * Daily buckets for 7d / 30d / 90d / all / custom; HOURLY buckets for the "today" view.
//   * Every series is `null` for a bucket that lies BEFORE that collector started recording ("not measured")
//     and a real number (possibly 0) afterwards. The dashboard draws nulls as gaps / an "unmeasured" band, never as 0.
//   * The bucket that contains "now" is flagged `partial`; hours after now are `future`. Neither is a confirmed 0.
//   * `previous_buckets` is the same number of buckets for the comparison window, index-aligned with `buckets`.
//   * Website page views are DAILY totals only. In hourly mode the website series is built from the stored
//     session events instead (`coverage.website_views.basis = "session_events"`) and the response says what share
//     of the day's counted page views that covers, so a partial series is never presented as the full count.
// -----------------------------------------------------------------------------
export interface TrendBucket {
  /** Local bucket start: 'YYYY-MM-DD' (daily) or 'YYYY-MM-DDTHH' (hourly), in the analytics timezone. */
  start: string;
  /** "Now" falls inside this bucket, so its value is still growing. */
  partial: boolean;
  /** The bucket starts after "now" (hourly view of today only). */
  future: boolean;
  website_views: number | null;
  deliver_views: number | null;
  deliver_downloads: number | null;
  store_clicks: number | null;
  /** Deliveries created that are still on record (a deleted delivery's row is removed, so this can undercount). */
  new_deliveries: number | null;
}
export type TrendMetric = "website_views" | "deliver_views" | "deliver_downloads" | "store_clicks" | "new_deliveries";
export const TREND_METRICS: TrendMetric[] = ["website_views", "deliver_views", "deliver_downloads", "store_clicks", "new_deliveries"];
export type TrendTotals = Record<TrendMetric, number | null>;

export interface AnalyticsTrend {
  period: { key: SummaryPeriod | "custom"; days: number | null; since: string; until: string; previous: { since: string; until: string } | null; includes_today: boolean };
  granularity: "day" | "hour";
  timezone: { offset_minutes: number; label: string };
  generated_at: string;
  buckets: TrendBucket[];
  previous_buckets: TrendBucket[] | null;
  /** First day each collector has data for (null = never recorded). Buckets earlier than this are `null`, not 0. */
  coverage: {
    website_views: { since: string | null; basis: "page_analytics" | "session_events"; session_coverage_pct: number | null };
    deliver: { since: string | null };
    store_clicks: { since: string | null };
    new_deliveries: { since: string | null };
  };
  /** Sum of the measured buckets, so the chart can be reconciled with the summary endpoint. */
  totals: { current: TrendTotals; previous: TrendTotals | null };
  /** Daily mode only: views per page key aligned with `buckets` (null = before the counter started). */
  page_series: Record<string, Array<number | null>> | null;
  /** The same for the comparison window, index-aligned with `page_series`. */
  previous_page_series: Record<string, Array<number | null>> | null;
  /** The window was longer than the bucket cap and its oldest part was cut off. */
  truncated: boolean;
}

const emptyBucket = (start: string): TrendBucket => ({ start, partial: false, future: false, website_views: null, deliver_views: null, deliver_downloads: null, store_clicks: null, new_deliveries: null });

/** Counts rows per local bucket. `table`/`col` come from this fixed whitelist, never from user input. */
async function countPerBucket(env: Env, table: "page_session_events" | "store_clicks" | "deliveries", col: "seen_at" | "created_at", fmt: "%Y-%m-%d" | "%Y-%m-%dT%H", startTs: number, endTs: number): Promise<Map<string, number>> {
  const rows = (await env.DB.prepare(
    `SELECT strftime('${fmt}', datetime(${col} + ?1, 'unixepoch')) AS b, COUNT(*) AS n FROM ${table} WHERE ${col} >= ?2 AND ${col} <= ?3 GROUP BY b`,
  ).bind(utcOffsetSeconds(env), startTs, endTs).all<{ b: string; n: number }>()).results;
  return new Map(rows.map(r => [r.b, r.n]));
}

export async function getAnalyticsTrend(env: Env, input: WindowInput | PeriodWindow): Promise<AnalyticsTrend> {
  const now = nowSec();
  const w = asWindow(env, input);
  const today = localDay(env, now);
  const hourly = w.key === "today";
  const offset = utcOffsetSeconds(env);

  // ---- when did each collector start? (a bucket before this is "not measured")
  const [pvFirst, dmFirst, delFirst, scFirst, evFirst] = await Promise.all([
    env.DB.prepare("SELECT MIN(day) AS d FROM page_analytics").first<{ d: string | null }>(),
    env.DB.prepare("SELECT MIN(day) AS d FROM delivery_daily_metrics").first<{ d: string | null }>(),
    env.DB.prepare("SELECT MIN(created_at) AS t FROM deliveries").first<{ t: number | null }>(),
    env.DB.prepare("SELECT MIN(created_at) AS t FROM store_clicks").first<{ t: number | null }>(),
    env.DB.prepare("SELECT MIN(seen_at) AS t FROM page_session_events").first<{ t: number | null }>(),
  ]);
  const firstDeliveryDay = delFirst?.t != null ? localDay(env, delFirst.t) : null;
  const deliverSince = [dmFirst?.d ?? null, firstDeliveryDay].filter((d): d is string => !!d).sort()[0] ?? null;
  const websiteSince = pvFirst?.d ?? null;
  const storeSince = scFirst?.t != null ? localDay(env, scFirst.t) : null;
  const sessionSince = evFirst?.t != null ? localDay(env, evFirst.t) : null;

  // ---- the bucket labels for the current window (and the comparison window, index-aligned)
  let truncated = false;
  const labelsFor = (since: string, until: string): string[] => {
    if (hourly) return Array.from({ length: 24 }, (_, h) => `${since}T${String(h).padStart(2, "0")}`);
    const out: string[] = []; let n = dayDiff(since, until) + 1;
    if (n > MAX_CUSTOM_RANGE_DAYS) { n = MAX_CUSTOM_RANGE_DAYS; truncated = true; }
    for (let i = n - 1; i >= 0; i--) out.push(addDays(until, -i));
    return out;
  };
  // "all" starts at the earliest day any collector has data for.
  const earliest = [websiteSince, deliverSince, storeSince, sessionSince].filter((d): d is string => !!d).sort()[0] ?? w.until;
  const since = w.since ?? earliest;
  const labels = labelsFor(since, w.until);
  const prevLabels = w.previous ? labelsFor(hourly ? w.previous.since : addDays(w.previous.until, -(labels.length - 1)), w.previous.until) : null;

  const fmt = hourly ? "%Y-%m-%dT%H" : "%Y-%m-%d";
  const spanStart = (ls: string[]) => (hourly ? dayStartTs(env, ls[0]!.slice(0, 10)) : dayStartTs(env, ls[0]!));
  const spanEnd = (ls: string[]) => (hourly ? dayStartTs(env, addDays(ls[0]!.slice(0, 10), 1)) - 1 : dayStartTs(env, addDays(ls[ls.length - 1]!, 1)) - 1);

  const fill = async (ls: string[]): Promise<{ buckets: TrendBucket[]; pageViewsByDay: Map<string, number> }> => {
    const [a, b] = [ls[0]!.slice(0, 10), ls[ls.length - 1]!.slice(0, 10)];
    const [store, created, events, pageDaily, deliverDaily, deliverHourly] = await Promise.all([
      countPerBucket(env, "store_clicks", "created_at", fmt, spanStart(ls), spanEnd(ls)),
      countPerBucket(env, "deliveries", "created_at", fmt, spanStart(ls), spanEnd(ls)),
      hourly ? countPerBucket(env, "page_session_events", "seen_at", fmt, spanStart(ls), spanEnd(ls)) : Promise.resolve(new Map<string, number>()),
      env.DB.prepare("SELECT day, COALESCE(SUM(views),0) AS v FROM page_analytics WHERE day >= ?1 AND day <= ?2 GROUP BY day").bind(a, b).all<{ day: string; v: number }>(),
      hourly
        ? Promise.resolve({ results: [] as Array<{ day: string; v: number; d: number }> })
        : env.DB.prepare("SELECT day, COALESCE(SUM(views),0) AS v, COALESCE(SUM(downloads),0) AS d FROM delivery_daily_metrics WHERE day >= ?1 AND day <= ?2 GROUP BY day").bind(a, b).all<{ day: string; v: number; d: number }>(),
      hourly
        ? env.DB.prepare("SELECT hour, views AS v, downloads AS d FROM site_hourly_metrics WHERE hour >= ?1 AND hour <= ?2").bind(ls[0]!, ls[ls.length - 1]!).all<{ hour: string; v: number; d: number }>()
        : Promise.resolve({ results: [] as Array<{ hour: string; v: number; d: number }> }),
    ]);
    const pv = new Map(pageDaily.results.map(r => [r.day, r.v]));
    const dd = new Map((deliverDaily.results as Array<{ day: string; v: number; d: number }>).map(r => [r.day, r]));
    const dh = new Map((deliverHourly.results as Array<{ hour: string; v: number; d: number }>).map(r => [r.hour, r]));
    const nowBucket = hourly ? localHour(env, now) : today;
    const buckets = ls.map((start): TrendBucket => {
      const day = start.slice(0, 10);
      const bk = emptyBucket(start);
      bk.partial = start === nowBucket;
      bk.future = start > nowBucket;
      if (bk.future) return bk;                                   // after "now": nothing can have happened yet
      const deliverOk = deliverSince !== null && day >= deliverSince;
      if (hourly) {
        // Hourly website numbers exist only for page views recorded WITH a session id.
        if (sessionSince !== null && day >= sessionSince) bk.website_views = events.get(start) ?? 0;
        if (deliverOk) { bk.deliver_views = dh.get(start)?.v ?? 0; bk.deliver_downloads = dh.get(start)?.d ?? 0; }
      } else {
        if (websiteSince !== null && day >= websiteSince) bk.website_views = pv.get(day) ?? 0;
        if (deliverOk) { bk.deliver_views = dd.get(day)?.v ?? 0; bk.deliver_downloads = dd.get(day)?.d ?? 0; }
      }
      if (storeSince !== null && day >= storeSince) bk.store_clicks = store.get(start) ?? 0;
      if (firstDeliveryDay !== null && day >= firstDeliveryDay) bk.new_deliveries = created.get(start) ?? 0;
      return bk;
    });
    return { buckets, pageViewsByDay: pv };
  };

  const [cur, prev] = await Promise.all([fill(labels), prevLabels ? fill(prevLabels) : Promise.resolve(null)]);
  const totalOf = (bs: TrendBucket[]): TrendTotals => Object.fromEntries(TREND_METRICS.map(m => {
    const vals = bs.map(b => b[m]).filter((v): v is number => v !== null);
    return [m, vals.length ? vals.reduce((t, n) => t + n, 0) : null];
  })) as TrendTotals;

  // Share of the day's counted page views that also have a stored session event (hourly mode caveat).
  let sessionCoveragePct: number | null = null;
  if (hourly) {
    const counted = cur.pageViewsByDay.get(labels[0]!.slice(0, 10)) ?? 0;
    const recorded = cur.buckets.reduce((t, b) => t + (b.website_views ?? 0), 0);
    sessionCoveragePct = counted > 0 ? Math.min(100, Math.round((recorded / counted) * 1000) / 10) : null;
  }

  // Per-page daily series for the page table's sparklines and "rising/declining" signal (current AND previous window,
  // so page-level changes can be compared on completed days only).
  const pageSeriesFor = async (ls: string[]): Promise<Record<string, Array<number | null>>> => {
    const rows = (await env.DB.prepare("SELECT day, page, COALESCE(SUM(views),0) AS v FROM page_analytics WHERE day >= ?1 AND day <= ?2 GROUP BY day, page")
      .bind(ls[0]!, ls[ls.length - 1]!).all<{ day: string; page: string; v: number }>()).results;
    const idx = new Map(ls.map((d, i) => [d, i]));
    const out: Record<string, Array<number | null>> = {};
    for (const r of rows) {
      const i = idx.get(r.day);
      if (i === undefined) continue;
      const arr = (out[r.page] ??= ls.map(d => (websiteSince !== null && d >= websiteSince && d <= today ? 0 : null)));
      arr[i] = r.v;
    }
    return out;
  };
  const [pageSeries, previousPageSeries] = hourly
    ? [null, null]
    : await Promise.all([pageSeriesFor(labels), prevLabels ? pageSeriesFor(prevLabels) : Promise.resolve(null)]);

  const label = `UTC${offset >= 0 ? "+" : "-"}${Math.abs(offset / 3600)}`;
  return {
    period: { key: w.key, days: w.days, since, until: w.until, previous: w.previous ? { since: w.previous.since, until: w.previous.until } : null, includes_today: w.includesToday },
    granularity: hourly ? "hour" : "day",
    timezone: { offset_minutes: offset / 60, label },
    generated_at: iso(now),
    buckets: cur.buckets,
    previous_buckets: prev ? prev.buckets : null,
    coverage: {
      website_views: hourly ? { since: sessionSince, basis: "session_events", session_coverage_pct: sessionCoveragePct } : { since: websiteSince, basis: "page_analytics", session_coverage_pct: null },
      deliver: { since: deliverSince },
      store_clicks: { since: storeSince },
      new_deliveries: { since: firstDeliveryDay },
    },
    totals: { current: totalOf(cur.buckets), previous: prev ? totalOf(prev.buckets) : null },
    page_series: pageSeries,
    previous_page_series: previousPageSeries,
    truncated,
  };
}
