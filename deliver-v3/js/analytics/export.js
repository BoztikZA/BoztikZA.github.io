// CSV export and the extended text report. PURE: both read the SAME model object the screen renders, so the exported
// numbers are the on-screen numbers by construction (the tests assert it).
import { buildReport, stamp } from "../analytics-report.js";
import { buildSignals } from "./signals.js";
import { METRICS, SOURCE_LABELS, comparisonNote } from "./model.js";
import { fmtInt } from "./chart-math.js";

/** CSV cell. Strings that a spreadsheet could execute as a formula (= + - @ tab CR) are prefixed with an apostrophe. */
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = cells => cells.map(csvCell).join(",");

/**
 * One CSV with labelled sections separated by a blank line. Unmeasured values are EMPTY cells (never 0).
 * Columns are the same numbers the page shows; derived values carry a "basis" column.
 */
export function buildCsv(model, { generatedAt = new Date() } = {}) {
  const L = [];
  const p = model.period;
  L.push(row(["Boztik analytics export"]));
  L.push(row(["Generated (local time)", stamp(generatedAt)]));
  L.push(row(["Period", model.periodLabel]));
  L.push(row(["From", p?.since ?? ""])); L.push(row(["To", p?.until ?? ""]));
  L.push(row(["Previous period", model.previous ? `${model.previous.since} to ${model.previous.until}` : "none"]));
  L.push(row(["Granularity", model.granularity === "hour" ? "hourly" : "daily"]));
  L.push(row(["Timezone", model.timezone?.label ?? ""]));
  L.push(row(["Note", "Empty cell = not measured (never zero). Page views are counted page loads, not people. Website, Deliver and Store numbers are separate counters and are not added together."]));
  L.push("");

  L.push(row(["SUMMARY"]));
  L.push(row(["Metric", "Value", "Previous (like-for-like)", "Change %", "Comparison status", "Basis"]));
  for (const [key, meta] of Object.entries(METRICS)) {
    const c = model.cmp?.[key];
    L.push(row([meta.label, model.totals?.[key] ?? null, c?.previous ?? null, c?.change ?? null, c?.status ?? "", "measured total; change derived"]));
  }
  L.push("");

  if (model.trend) {
    L.push(row(["TREND"]));
    L.push(row(["Bucket start", "In progress", "Page views", "Deliver views", "Deliver downloads", "Store clicks", "Deliveries created", "Previous bucket start", "Previous page views", "Previous deliver views", "Previous deliver downloads", "Previous store clicks", "Previous deliveries created"]));
    model.trend.buckets.forEach((b, i) => {
      if (b.future) return;
      const pb = model.trend.previous_buckets?.[i];
      L.push(row([b.start, b.partial ? "yes" : "no", b.website_views, b.deliver_views, b.deliver_downloads, b.store_clicks, b.new_deliveries, pb?.start ?? "", pb?.website_views ?? null, pb?.deliver_views ?? null, pb?.deliver_downloads ?? null, pb?.store_clicks ?? null, pb?.new_deliveries ?? null]));
    });
    L.push("");
  }

  L.push(row(["PAGES"]));
  L.push(row(["Page", "Key", "Page views", "Share %", "Previous page views", "Like-for-like change %", "Entrances", "Exits", "Session events"]));
  for (const pg of model.pages ?? []) L.push(row([pg.label, pg.page, pg.views, pg.share, pg.prev, pg.cmp?.change ?? null, pg.entrances, pg.exits, pg.sessionEvents]));
  L.push("");

  if (model.sources) {
    L.push(row(["TRAFFIC SOURCES"]));
    L.push(row(["Source", "Visits", "Share %"]));
    for (const r of model.sources.rows) L.push(row([r.label, r.visits, r.share]));
    L.push(row(["Total", model.sources.total, ""]));
    L.push("");
  }

  if (model.store) {
    L.push(row(["STORE CLICKS"]));
    L.push(row(["Destination", "Clicks", "Sessions"]));
    for (const d of model.store.by_destination ?? []) L.push(row([d.destination, d.clicks, d.unique_sessions]));
    L.push(row(["Total", model.store.total, model.store.unique_sessions]));
    L.push("");
  }

  if (model.deliver?.available) {
    L.push(row(["DELIVER BY TYPE"]));
    L.push(row(["Type", "Views", "Downloads", "Shares", "Active deliveries"]));
    for (const t of model.deliver.types) L.push(row([t.label, t.views, t.downloads, t.shares, t.active]));
    L.push("");
  }
  return L.join("\r\n");
}

/** The existing report plus the new sections. The original sections are untouched so older prompts still work. */
export function buildFullReport(model, { generatedAt = new Date() } = {}) {
  const base = buildReport(model, { generatedAt });
  const L = [base, "", "TREND (like-for-like)"];
  const t = model.trend;
  if (!t) L.push("- Trend data is unavailable (the Worker has not been updated with the trend route, or the request failed).");
  else {
    L.push(`- Granularity: ${model.granularity === "hour" ? "hourly (today so far)" : "daily"}${model.timezone?.label ? `; timezone ${model.timezone.label}` : ""}.`);
    for (const [key, meta] of Object.entries(METRICS)) {
      const c = model.cmp[key];
      const total = model.totals[key];
      const tail = c.status === "ok" ? `; ${c.change > 0 ? "+" : c.change < 0 ? "−" : ""}${Math.abs(c.change)}% vs ${fmtInt(c.previous)} in the matching completed days before`
        : comparisonNote(c, { noun: meta.unit, today: model.granularity === "hour" }) ? `; ${comparisonNote(c, { noun: meta.unit, today: model.granularity === "hour" })}` : "";
      L.push(`- ${meta.label}: ${total === null || total === undefined ? "not measured" : fmtInt(total)}${tail}`);
    }
    const open = t.buckets.filter(b => b.partial).length;
    if (open) L.push(`- The in-progress ${model.granularity === "hour" ? "hour" : "day"} is included in totals but left out of percentage comparisons.`);
    const gaps = t.buckets.filter(b => !b.future && b.website_views === null).length;
    if (gaps) L.push(`- ${gaps} bucket${gaps === 1 ? "" : "s"} at the start of the range have no page-view data (counting had not started). They are not zero.`);
  }

  L.push("", "TRAFFIC SOURCES (first-party attribution)");
  if (!model.sources) L.push("- Unavailable.");
  else if (model.sources.total === 0) L.push("- No visit with a recorded source in this period.");
  else {
    L.push(`- ${fmtInt(model.sources.total)} visits with a recorded source${model.sources.dataSince ? ` (recording began ${model.sources.dataSince})` : ""}.`);
    for (const r of [...model.sources.rows].sort((a, b) => b.visits - a.visits)) L.push(`- ${r.label}: ${fmtInt(r.visits)}${r.share !== null ? ` (${r.share}%)` : ""}`);
    L.push("- Attribution is a hostname-level estimate. “Direct / unknown” includes hidden referrers and is not proof of typed-in visits.");
  }

  L.push("", "WHAT STANDS OUT (rule-based, each traceable to the numbers above)");
  const sig = buildSignals(model);
  if (!sig.length) L.push("- Nothing in this range crosses a reporting threshold."); else for (const s of sig) L.push(`- [${s.level}] ${s.title}. ${s.detail}`);

  L.push("", "DATA HEALTH");
  const h = model.health;
  if (!h) L.push("- Health check unavailable.");
  else {
    const c = h.collectors;
    L.push(`- Page views: ${c.page_views.status}${c.page_views.first_day ? ` (${c.page_views.first_day} to ${c.page_views.last_day})` : ""}; sessions: ${c.sessions.status}; sources: ${c.attribution.status}; store clicks: ${c.store_clicks.status}.`);
    for (const g of h.known_gaps ?? []) L.push(`- ${g}`);
  }
  L.push("- This report was generated from the same figures shown on screen; CSV export uses the same model.");
  return L.join("\n");
}

export const csvFileName = (model, d = new Date()) => {
  const p = model.period;
  const slug = p?.since && p?.until ? `${p.since}_to_${p.until}` : model.periodKey;
  return `boztik-analytics-${String(slug).replace(/[^0-9A-Za-z_-]/g, "")}.csv`;
};
