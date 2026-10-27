// Analytics view-model. PURE: every number the Analytics tab shows is derived here from the Worker responses, so the
// screen, the table twins, the CSV export and the text report can never disagree (they all read this one object).
//
// Vocabulary used throughout:
//   measured      a number the first-party collectors actually recorded (0 is a real measured zero)
//   unmeasured    `null`: the collector had not started yet / data not available. NEVER shown as 0.
//   derived       calculated from measured numbers (shares, per-100 ratios, changes) and labelled as such
//   like-for-like a comparison that leaves out the in-progress bucket (today / the current hour) AND any bucket the
//                 other period never measured, so a partial day can never look like a drop.
import { buildModel, PAGE_LABELS, KEY_PAGES } from "../analytics-report.js";
import { normalizeRange } from "./range.js";

/** Below this many events in the previous period a percentage swing is noise, so no percentage is shown. */
export const MIN_BASE = 20;
export const MIN_BASE_PAGE = 10;
export const MIN_BASE_HOURLY = 8;

export const SOURCE_ORDER = Object.freeze(["reddit", "organic_search", "social", "referral", "direct_unknown"]);
export const SOURCE_LABELS = Object.freeze({
  reddit: "Reddit", organic_search: "Search engines", social: "Social platforms", referral: "Other websites", direct_unknown: "Direct / unknown",
});
export const SOURCE_HELP = Object.freeze({
  reddit: "Referrer is reddit.com, redd.it or redditmedia.com.",
  organic_search: "Referrer is a known search engine AND the browser reported a search referral.",
  social: "Referrer is a known social platform (Facebook, Instagram, X, LinkedIn, YouTube, TikTok…).",
  referral: "Referred by any other website.",
  direct_unknown: "No referrer, a referrer from Boztik's own domains, or a referrer the browser hid. This is not proof the visit was typed in.",
});
export const METRICS = Object.freeze({
  website_views: { label: "Page views", unit: "page views", scope: "website" },
  deliver_views: { label: "Deliver views", unit: "views", scope: "deliver" },
  deliver_downloads: { label: "Deliver downloads", unit: "downloads", scope: "deliver" },
  store_clicks: { label: "Store clicks", unit: "clicks", scope: "store" },
  new_deliveries: { label: "Deliveries created", unit: "deliveries", scope: "deliver" },
});

const num = v => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const sum = arr => arr.reduce((t, n) => t + n, 0);

/**
 * Like-for-like comparison of two index-aligned series.
 *   current / previous   arrays of number|null (null = not measured)
 *   exclude              array of booleans: indexes to leave out (the in-progress and future buckets)
 * Returns { status, current, previous, change, used, excluded } where status is one of
 *   ok              change is a whole-percent integer
 *   from-zero       previous measured 0, current > 0  (no percentage exists)
 *   flat-zero       both measured 0
 *   small-base      previous has fewer than minBase events: a percentage would be noise
 *   previous-unmeasured   the comparison period starts before the collector did, so it is incomplete
 *   unmeasured      nothing measured in the current period
 *   no-previous     there is no comparison window ("all data")
 */
export function compareSeries({ current, previous, exclude = [], minBase = MIN_BASE }) {
  const excluded = exclude.filter(Boolean).length;
  if (!previous) return { status: "no-previous", current: null, previous: null, change: null, used: 0, excluded };
  const used = current.map((_, i) => i).filter(i => !exclude[i] && current[i] !== null && current[i] !== undefined);
  if (!used.length) return { status: "unmeasured", current: null, previous: null, change: null, used: 0, excluded };
  if (used.some(i => previous[i] === null || previous[i] === undefined)) return { status: "previous-unmeasured", current: sum(used.map(i => current[i])), previous: null, change: null, used: used.length, excluded };
  const cur = sum(used.map(i => current[i])), prev = sum(used.map(i => previous[i]));
  let status = "ok", change = null;
  if (prev === 0) status = cur > 0 ? "from-zero" : "flat-zero";
  else if (prev < minBase) status = "small-base";
  else change = Math.round(((cur - prev) / prev) * 100);
  return { status, current: cur, previous: prev, change, used: used.length, excluded };
}

/** The series of one metric as chart points (current + aligned previous). */
export function metricPoints(trend, metric) {
  if (!trend) return [];
  const prev = trend.previous_buckets;
  return trend.buckets.map((b, i) => ({ start: b.start, value: num(b[metric]), partial: !!b.partial, future: !!b.future, prev: prev ? num(prev[i]?.[metric]) : null, prevStart: prev?.[i]?.start ?? null }));
}
export const sparkValues = (trend, metric) => (trend ? trend.buckets.map(b => (b.future ? null : num(b[metric]))) : []);

/** Like-for-like comparison of one trend metric. */
export function compareMetric(trend, metric, { minBase } = {}) {
  if (!trend) return { status: "no-data", current: null, previous: null, change: null, used: 0, excluded: 0 };
  const base = minBase ?? (trend.granularity === "hour" ? MIN_BASE_HOURLY : MIN_BASE);
  if (metric === "website_views" && trend.granularity === "hour") return { status: "not-comparable", current: null, previous: null, change: null, used: 0, excluded: 0 };
  const exclude = trend.buckets.map(b => b.partial || b.future);
  return compareSeries({ current: trend.buckets.map(b => num(b[metric])), previous: trend.previous_buckets ? trend.previous_buckets.map(b => num(b[metric])) : null, exclude, minBase: base });
}

/** Plain-language reason a change is not shown, or "" when it is. */
export function comparisonNote(c, { noun = "events", today = false } = {}) {
  switch (c.status) {
    case "ok": return "";
    case "from-zero": return `New activity: none in the previous period.`;
    case "flat-zero": return "No activity in either period.";
    case "small-base": return `Previous period had only ${c.previous} ${noun}: too few for a percentage.`;
    case "previous-unmeasured": return "The comparison period starts before this was being recorded, so it is incomplete.";
    case "unmeasured": return "Not measured in this period.";
    case "no-previous": return "No earlier period to compare with.";
    case "not-comparable": return today ? "Today is only part of a day, so it is not compared with a full day." : "Not comparable.";
    default: return "";
  }
}

/* ------------------------------------------------------------------ pages */
function pageRows({ website, periodHasPrevious, trend, flow }) {
  const total = website?.available ? website.total : 0;
  const byFlow = new Map((flow?.pages ?? []).map(p => [p.page, p]));
  const exclude = trend ? trend.buckets.map(b => b.partial || b.future) : [];
  const rows = new Map();
  for (const p of website?.pages ?? []) rows.set(p.page, { page: p.page, views: num(p.views) ?? 0, prevRaw: num(p.prev) });
  for (const k of KEY_PAGES) if (!rows.has(k)) rows.set(k, { page: k, views: 0, prevRaw: website?.available ? (periodHasPrevious ? 0 : null) : null });
  return [...rows.values()].map(r => {
    const series = trend?.page_series?.[r.page] ?? null;
    const prevSeries = trend?.previous_page_series?.[r.page] ?? null;
    // The API returns no series for a page with no rows: where the counter was running that means zero, where it was not it means not measured.
    const zeros = trend && !trend.page_series?.[r.page] && trend.page_series ? trend.buckets.map(b => (b.website_views === null ? null : 0)) : null;
    const cur = series ?? zeros;
    const prv = trend?.previous_buckets ? (prevSeries ?? trend.previous_buckets.map(b => (b.website_views === null ? null : 0))) : null;
    const cmp = cur && trend && trend.granularity === "day"
      ? compareSeries({ current: cur, previous: prv, exclude, minBase: MIN_BASE_PAGE })
      : trend?.granularity === "hour" ? { status: "not-comparable", current: null, previous: null, change: null, used: 0, excluded: 0 }
        : { status: r.prevRaw === null ? "no-previous" : "raw", current: r.views, previous: r.prevRaw, change: r.prevRaw && r.prevRaw >= MIN_BASE_PAGE ? Math.round(((r.views - r.prevRaw) / r.prevRaw) * 100) : null, used: 0, excluded: 0 };
    const f = byFlow.get(r.page);
    return {
      page: r.page, label: PAGE_LABELS[r.page] || r.page, views: r.views, share: total > 0 ? Math.round((r.views / total) * 1000) / 10 : null,
      prev: r.prevRaw, cmp, series: cur, entrances: f ? f.entrances : null, exits: f ? f.exits : null, sessionEvents: f ? f.session_events : null, coveragePct: f ? f.coverage_pct : null,
    };
  }).sort((a, b) => b.views - a.views || a.label.localeCompare(b.label));
}

/* ---------------------------------------------------------------- sources */
function sourceRows(sources) {
  if (!sources) return null;
  const by = new Map((sources.sources ?? []).map(s => [s.source, s.visits]));
  const total = sources.total ?? 0;
  const rows = SOURCE_ORDER.map(key => ({ key, label: SOURCE_LABELS[key], help: SOURCE_HELP[key], visits: by.get(key) ?? 0, share: total > 0 ? Math.round(((by.get(key) ?? 0) / total) * 1000) / 10 : null }));
  return { total, rows, campaigns: sources.campaigns ?? [], previousTotal: sources.previous?.total ?? null, dataSince: sources.data_since ?? null, lastVisitAt: sources.last_visit_at ?? null };
}

/* ------------------------------------------------------------------- main */
/**
 * @param {object} inputs  range, summary, trend, sources, flow, store, health, overview (each may be null) and
 *                         states: { summary: {status, error}, … } so the UI can show per-section loading/error.
 */
export function buildAnalyticsModel({ range, summary = null, trend = null, sources = null, flow = null, store = null, health = null, overview = null, fallbackPages = null, states = {}, generatedAt = new Date() } = {}) {
  const period = trend?.period ?? summary?.period ?? null;
  const granularity = trend?.granularity ?? (period?.key === "today" ? "hour" : "day");
  const includesToday = !!(period?.includes_today ?? period?.includesToday);
  const asked = normalizeRange(range);
  const periodKey = period?.key ?? (asked.kind === "custom" ? "custom" : asked.key);

  // The legacy shape (website/deliver blocks) keeps the text report and "What stands out" working unchanged.
  const legacy = buildModel({ periodKey: ["today", "7d", "30d", "90d", "all"].includes(periodKey) ? periodKey : "30d", summary, fallbackPages });
  if (periodKey === "custom" && period) legacy.periodLabel = `${period.since} to ${period.until}`;
  if (periodKey === "today") legacy.periodLabel = "Today so far";

  const pages = pageRows({ website: legacy.website, periodHasPrevious: !!(summary?.period?.previous), trend, flow });
  const websiteTotal = legacy.website.available ? legacy.website.total : num(trend?.totals?.current?.website_views);
  const deliverTotals = legacy.deliver.available ? legacy.deliver.totals : null;
  // A total of 0 from a collector that has never recorded anything is "not measured", not a measured zero.
  const cov = trend?.coverage;
  const neverRecorded = { website_views: legacy.website.available && legacy.website.dataSince === null, deliver_views: cov?.deliver?.since === null, deliver_downloads: cov?.deliver?.since === null, store_clicks: cov?.store_clicks?.since === null, new_deliveries: cov?.new_deliveries?.since === null };
  const metricTotal = m => {
    let v = null;
    if (m === "deliver_views" && deliverTotals) v = deliverTotals.views;
    else if (m === "deliver_downloads" && deliverTotals) v = deliverTotals.downloads;
    else if (m === "store_clicks" && store) v = store.total;
    else if (m === "website_views") v = websiteTotal;
    else v = num(trend?.totals?.current?.[m]);
    return v === 0 && neverRecorded[m] ? null : v;
  };

  const cmp = {};
  for (const m of Object.keys(METRICS)) cmp[m] = compareMetric(trend, m);

  const top = pages.find(p => p.views > 0) ?? null;
  const src = sourceRows(sources);
  const topSource = src && src.total > 0 ? [...src.rows].sort((a, b) => b.visits - a.visits)[0] : null;

  return {
    ...legacy,
    // ---- additive fields
    askedRange: asked, period: period ? { key: period.key, since: period.since, until: period.until, days: period.days ?? null, previous: period.previous ?? null, includesToday } : null,
    granularity, includesToday, timezone: trend?.timezone ?? null, generatedAt,
    states, summary, trend, sourcesRaw: sources, flow, store, health, overview,
    pages, sources: src, top, topSource,
    totals: Object.fromEntries(Object.keys(METRICS).map(m => [m, metricTotal(m)])),
    cmp,
    coverage: trend?.coverage ?? null,
    // keep the legacy fields the report builder reads
    websiteTimeseries: trend ? trend.buckets.filter(b => b.website_views !== null && !b.future).map(b => ({ day: b.start, views: b.website_views })) : null,
    pageFlow: flow?.journeys ? flow.journeys.filter(j => j.path.length > 1).map(j => ({ path: j.path.join(" → "), sessions: j.visits })) : [],
    storeClicks: store,
  };
}
