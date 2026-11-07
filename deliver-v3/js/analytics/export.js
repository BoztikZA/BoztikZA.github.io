// CSV export and the extended text report. PURE: both read the SAME model object the screen renders, so the exported
// numbers are the on-screen numbers by construction (the tests assert it).
import { stamp } from "../analytics-report.js";
import { buildSignals } from "./signals.js";
import { METRICS, comparisonNote } from "./model.js";
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

/** Decision-ready report for analysing Boztik website traffic and performance. */
export function buildFullReport(model, { generatedAt = new Date() } = {}) {
  const L = [], line = (s = "") => L.push(s);
  const n = v => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "not measured" : fmtInt(Number(v)));
  const w = model.website ?? {}, d = model.deliver, t = model.trend, sources = model.sources;

  line("BOZTIK WEBSITE TRAFFIC & PERFORMANCE REPORT");
  line(`Period: ${model.periodLabel || "Selected period"}${model.period?.since ? ` (${model.period.since} to ${model.period.until})` : ""}`);
  if (model.period?.previous) line(`Comparison: ${model.period.previous.since} to ${model.period.previous.until}`);
  line(`Generated: ${stamp(generatedAt)} (local time)`);
  if (model.timezone?.label) line(`Reporting timezone: ${model.timezone.label}`);
  line("Purpose: understand which public pages attract attention, the traffic sources they receive, tracked store-link clicks and separate Deliver usage.");

  line(); line("1. EXECUTIVE SUMMARY");
  line(`- Page views (counted page loads): ${n(w.total)} (not unique people).`);
  line(`- Most-viewed page: ${model.top ? `${model.top.label} — ${fmtInt(model.top.views)} views (${model.top.share ?? "—"}% of counted page views)` : "No page recorded"}.`);
  line(`- Tracked store-link clicks: ${n(model.totals?.store_clicks)} (link activations, not purchases).`);
  line(`- Private Deliver views: ${d?.available ? fmtInt(d.totals.views) : "not available"} (separate counter; not website page views).`);

  line(); line("2. WEBSITE PAGE PERFORMANCE");
  line(`Total counted page views: ${n(w.total)}.`);
  line("Page views count page loads, including repeat loads; they do not identify unique visitors.");
  if (model.pages?.length) {
    line("Page ranking (views, share, entrances and exits):");
    model.pages.forEach((p, i) => line(`${i + 1}. ${p.label} [${p.page}]: ${fmtInt(p.views)} views; ${p.share === null ? "share not measured" : `${p.share}% of page views`}; entrances ${n(p.entrances)}; exits ${n(p.exits)}.`));
  } else line("- Page-level data is unavailable.");

  line(); line("3. TRAFFIC SOURCES");
  if (!sources) line("- Traffic-source attribution is unavailable.");
  else {
    line(`- ${fmtInt(sources.total)} visits had an attributable source.`);
    [...sources.rows].sort((a, b) => b.visits - a.visits).forEach(x => line(`- ${x.label}: ${fmtInt(x.visits)} visits (${x.share === null ? "share not measured" : `${x.share}%`}).`));
    line("- Attribution uses the referrer hostname. Hidden referrers and visits without a referrer are grouped as Direct / unknown; this is not proof someone typed the address.");
  }

  line(); line("4. TRACKED STORE-LINK CLICKS");
  line(`- Store-link clicks: ${n(model.totals?.store_clicks)}.`);
  line("- These are recorded link activations, not completed purchases. A destination-level breakdown is not available in the current dashboard connection.");
  line(); line("5. DELIVER ACTIVITY (SEPARATE SYSTEM)");
  if (!d?.available) line("- Deliver activity is unavailable for this period.");
  else {
    line(`- Views: ${fmtInt(d.totals.views)}; downloads: ${fmtInt(d.totals.downloads)}; shares: ${fmtInt(d.totals.shares)}; active deliveries: ${fmtInt(d.totals.active)}.`);
    d.types.forEach(x => {
      if (x.type === "deleted" && !x.views && !x.downloads && !x.shares) return;
      line(`- ${x.label}: ${fmtInt(x.views)} views; ${fmtInt(x.downloads)} downloads; ${fmtInt(x.shares)} shares; ${fmtInt(x.active)} active deliveries.`);
    });
    line("- Deliver views are private delivery-page or direct-image loads. They are not added to public website page views.");
  }

  line(); line("6. TREND (like-for-like) — DAILY TRAFFIC & ACTIVITY");
  if (!t?.buckets?.length) line("- Trend data is unavailable.");
  else {
    line(`- Bucket granularity: ${model.granularity === "hour" ? "hourly" : "daily"}.`);
    line("Period totals and like-for-like comparisons:");
    for (const [key, meta] of Object.entries(METRICS)) {
      const c = model.cmp?.[key];
      const total = model.totals?.[key];
      const comparison = c?.status === "ok"
        ? `${c.change > 0 ? "+" : ""}${c.change}% vs ${fmtInt(c.previous)} in the previous matching period`
        : comparisonNote(c, { noun: meta.unit, today: model.granularity === "hour" }) || "comparison unavailable";
      line(`- ${meta.label}: ${n(total)}; ${comparison}.`);
    }
    t.buckets.filter(b => !b.future).forEach(b => line(`- ${b.start}${b.partial ? " (in progress)" : ""}: page views ${n(b.website_views)}; Deliver views ${n(b.deliver_views)}; downloads ${n(b.deliver_downloads)}; store clicks ${n(b.store_clicks)}.`));
    line("- Null / not measured values are deliberately not treated as zero. The final in-progress bucket is included as partial data.");
  }

  line(); line("7. WHAT STANDS OUT");
  const signals = buildSignals(model);
  if (!signals.length) line("- No pattern crossed the dashboard's reporting thresholds.");
  else signals.forEach(x => line(`- [${x.level.toUpperCase()}] ${x.title}: ${x.detail}`));

  line(); line("8. DATA HEALTH & LIMITATIONS");
  if (model.limited) line("- Limited mode: the deployed Worker does not provide the selected reporting range; some sections may only show the fixed 30-day page counter.");
  if (f) line(`- Visitor-flow coverage: ${f.session_coverage_pct === null ? "not measured" : `${f.session_coverage_pct}%`}; this is a subset of page views, not every page load.`);
  if (model.website?.dataSince) line(`- Website page-view collection began: ${model.website.dataSince}.`);
  if (s?.data_since) line(`- Store-click collection began: ${s.data_since}.`);
  if (model.health) {
    const c = model.health.collectors || {};
    for (const [key, label] of [["page_views", "Page views"], ["sessions", "Session events"], ["attribution", "Traffic sources"], ["store_clicks", "Store clicks"]]) {
      if (c[key]?.status) line(`- ${label} collector: ${c[key].status}.`);
    }
    (model.health.known_gaps || []).forEach(x => line(`- Tracking note: ${x}`));
  }
  line("- Page views count page loads, not unique people. Session journeys use anonymous first-party events and cover only the measured share shown above.");
  line("- Store clicks measure outbound link activation, not purchases. The report does not infer sales, revenue, bounce rate, unique visitors or engagement time.");
  line("- Website, store-click and Deliver counters are separate measures and must not be added together.");

  line(); line("9. ANALYSIS GUIDE");
  line("- Identify the strongest entry pages and whether recorded visitors continue to another page or leave.");
  line("- Look for high-view pages with few onward transitions, and pages that repeatedly appear as exits.");
  line("- Compare Reddit/search/social/referral traffic with the pages and journeys that follow.");
  line("- Assess which storefront destinations and page placements attract the most outbound clicks.");
  line("- Distinguish measured patterns from missing session coverage; do not infer purchases or visitor identity.");
  line("- Recommend only changes supported by the observed traffic, with a clear reason and expected benefit.");

  return L.join("\n");
}

const PAGE_LABELS_FOR_REPORT = {
  homepage: "Home", stores: "Boztik Stores", deliver: "Deliver", services: "Services", portfolio: "Portfolio",
  toolkit: "Creative Toolkit", tools: "Tools", guides: "Guides", about: "About", support: "Support", contact: "Contact",
};

export const csvFileName = (model, d = new Date()) => {
  const p = model.period;
  const slug = p?.since && p?.until ? `${p.since}_to_${p.until}` : model.periodKey;
  return `boztik-analytics-${String(slug).replace(/[^0-9A-Za-z_-]/g, "")}.csv`;
};
