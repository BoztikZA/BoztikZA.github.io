// HTML renderers for the Analytics tab. Every function takes the view-model (model.js) and returns an HTML STRING.
// Pure (no DOM, no network) so the escaping and the numbers can be unit-tested in Node. EVERY dynamic value goes
// through esc(); nothing from the API is ever placed in markup unescaped.
import { fmtInt, shortDate, axisLabel, measuredRuns } from "./chart-math.js";
import { METRICS, comparisonNote, MIN_BASE_PAGE } from "./model.js";
import { per100, perDelivery, PAGE_LABELS } from "../analytics-report.js";

export const esc = (v = "") => String(v).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[c]));
const icon = name => `<svg class="cc-i" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const BASIS = { measured: ["Measured", "Recorded by Boztik's own counters."], derived: ["Calculated", "Calculated from measured numbers."], estimated: ["Estimate", "An approximation: see the note."], unavailable: ["Unavailable", "Not recorded here."] };
export const basisBadge = b => `<span class="an-basis an-basis-${esc(b)}" title="${esc(BASIS[b]?.[1] ?? "")}">${esc(BASIS[b]?.[0] ?? b)}</span>`;
const dash = `<span class="an-na" title="Not available">—</span>`;
const stateOf = (model, key) => model?.states?.[key]?.status ?? (model?.[key === "sources" ? "sourcesRaw" : key] ? "ok" : "loading");

/* ------------------------------------------------------------ shared pieces */
/** Inline panel for a section that is loading, failed or whose Worker route does not exist yet. */
export function sectionStatus(model, key, label) {
  const s = model?.states?.[key];
  if (!s || s.status === "ok") return "";
  if (s.status === "loading") return `<div class="an-state an-state-loading" role="status"><span class="an-spinner" aria-hidden="true"></span> Loading ${esc(label)}…</div>`;
  if (s.status === "missing") return `<div class="an-state an-state-missing" role="status">${icon("info")}<span><strong>${esc(label)} needs the updated Worker.</strong> This dashboard is newer than the deployed Worker, so this route is not available yet. Nothing is shown rather than guessing.</span></div>`;
  return `<div class="an-state an-state-error" role="alert">${icon("alert")}<span><strong>${esc(label)} could not be loaded.</strong> ${esc(s.error || "Request failed.")} <button type="button" class="cc-btn cc-btn-inline" data-retry="${esc(key)}">Try again</button></span></div>`;
}

export function deltaHtml(c, { noun = "events", today = false, compact = false } = {}) {
  if (!c) return "";
  const vs = compact ? "" : " <small>vs previous</small>";
  if (c.status === "ok") {
    if (c.change === 0) return `<span class="an-delta is-flat">No change${vs}</span>`;
    return `<span class="an-delta ${c.change > 0 ? "is-up" : "is-down"}"><span aria-hidden="true">${c.change > 0 ? "▲" : "▼"}</span> ${c.change > 0 ? "+" : "−"}${Math.abs(c.change)}%${vs}</span>`;
  }
  if (c.status === "from-zero") return `<span class="an-delta is-up" title="${esc(comparisonNote(c))}"><span aria-hidden="true">▲</span> New <small>none in the previous period</small></span>`;
  const note = comparisonNote(c, { noun, today });
  return note ? `<span class="an-delta is-flat">${esc(note)}</span>` : "";
}

export function sparkline(values, { w = 112, h = 30 } = {}) {
  const real = values.filter(v => v !== null && v !== undefined);
  if (real.length < 2) return "";
  const max = Math.max(1, ...real), n = values.length;
  const x = i => (n === 1 ? w / 2 : 2 + (i * (w - 4)) / (n - 1));
  const y = v => h - 3 - (v / max) * (h - 6);
  const paths = measuredRuns(values).filter(([a, b]) => b > a).map(([a, b]) => { let d = ""; for (let i = a; i <= b; i++) d += `${i === a ? "M" : "L"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`; return `<path d="${d}"/>`; }).join("");
  return `<svg class="an-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">${paths}</svg>`;
}

const periodNote = model => (model.period ? `${esc(model.period.since)} to ${esc(model.period.until)}` : "");

/* ----------------------------------------------------------------- KPI row */
export function kpiCards(model) {
  const t = model.totals, c = model.cmp, trend = model.trend, today = model.granularity === "hour";
  const spark = m => (trend && !today ? sparkline(trend.buckets.map(b => (b.future ? null : b[m]))) : "");
  const d = model.deliver.available ? model.deliver.totals : null;
  const card = ({ label, ic, value, delta = "", sub = "", basis = "measured", spk = "", text = false }) => `<article class="an-kpi"><header><span>${esc(label)}</span>${icon(ic)}</header>
    <strong class="an-kpi-val${text ? " is-text" : ""}">${value}</strong><div class="an-kpi-delta">${delta}</div>${spk ? `<div class="an-kpi-spark">${spk}</div>` : ""}<p class="an-kpi-sub">${sub}</p>${basisBadge(basis)}</article>`;
  const missing = (k, label) => ({ value: dash, sub: stateOf(model, k) === "loading" ? "Loading…" : `${esc(label)} not available right now.` });

  const cards = [];
  cards.push(model.website?.available || t.website_views !== null
    ? card({ label: "Page views", ic: "eye", value: fmtInt(t.website_views), delta: today ? `<span class="an-delta is-flat">${esc(comparisonNote({ status: "not-comparable" }, { today: true }))}</span>` : deltaHtml(c.website_views, { noun: "page views" }), sub: model.limited ? "Fixed last 30 days: the deployed Worker is older than this dashboard." : "Counted page loads on the public site. Not people.", spk: spark("website_views") })
    : card({ label: "Page views", ic: "eye", ...missing("summary", "Page views") }));
  cards.push(model.top
    ? card({ label: "Top page", ic: "globe", value: esc(model.top.label), text: true, sub: `<b>${fmtInt(model.top.views)}</b> views${model.top.share !== null ? ` · <b>${model.top.share}%</b> of page views` : ""}`, basis: "derived" })
    : card({ label: "Top page", ic: "globe", value: dash, sub: model.website?.available ? "No page views counted in this period." : "Loading…", basis: "derived" }));
  cards.push(model.sources && model.topSource
    ? card({ label: "Top traffic source", ic: "pulse", value: esc(model.topSource.label), text: true, sub: `<b>${fmtInt(model.topSource.visits)}</b> of ${fmtInt(model.sources.total)} visits${model.topSource.share !== null ? ` · <b>${model.topSource.share}%</b>` : ""}`, basis: "derived" })
    : card({ label: "Top traffic source", ic: "pulse", value: dash, sub: model.sources ? "No attributed visits in this period." : (stateOf(model, "sources") === "loading" ? "Loading…" : "Traffic sources not available right now."), basis: "derived" }));
  cards.push(d
    ? card({ label: "Deliver views", ic: "box", value: fmtInt(d.views), delta: deltaHtml(c.deliver_views, { noun: "views", today }), sub: "Private Deliver activity. Never added to website traffic.", spk: spark("deliver_views") })
    : card({ label: "Deliver views", ic: "box", ...missing("summary", "Deliver views") }));
  cards.push(d
    ? card({ label: "Deliver downloads", ic: "download", value: fmtInt(d.downloads), delta: deltaHtml(c.deliver_downloads, { noun: "downloads", today }), sub: `<b>${per100(d.downloads, d.views)}</b> downloads per 100 views (calculated)`, spk: spark("deliver_downloads") })
    : card({ label: "Deliver downloads", ic: "download", ...missing("summary", "Deliver downloads") }));
  cards.push(t.store_clicks !== null && t.store_clicks !== undefined
    ? card({ label: "Store-link clicks", ic: "chart", value: fmtInt(t.store_clicks), delta: deltaHtml(c.store_clicks, { noun: "clicks", today }), sub: "Tracked outbound store-link activations, not purchases.", spk: spark("store_clicks") })
    : card({ label: "Store-link clicks", ic: "chart", value: dash, sub: "Store-link clicks have not been measured for this period.", basis: "unavailable" }));
  return cards.join("");
}

/* ------------------------------------------------------------------ trend */
export function metricTabs(active, model) {
  return Object.entries(METRICS).map(([key, m]) => {
    const total = model.totals[key];
    return `<button type="button" class="an-seg${key === active ? " is-on" : ""}" data-metric="${esc(key)}" aria-pressed="${key === active}"><span>${esc(m.label)}</span><b>${total === null || total === undefined ? "—" : fmtInt(total)}</b></button>`;
  }).join("");
}

export function trendLegend(model, metric, compare) {
  const label = METRICS[metric].label;
  const items = [`<li><i class="an-key an-key-cur"></i>${esc(label)}</li>`];
  if (compare && model.trend?.previous_buckets) items.push(`<li><i class="an-key an-key-prev"></i>Previous period (${esc(model.period?.previous?.since ?? "")} to ${esc(model.period?.previous?.until ?? "")})</li>`);
  items.push(`<li class="an-legend-note">${model.granularity === "hour" ? "Hollow bar = this hour is not finished." : "Hollow bar = today is not finished."} Hatched = not measured.</li>`);
  return items.join("");
}

/** The chart's table twin: the same buckets, as text. */
export function trendTable(model, metric, compare) {
  const trend = model.trend;
  if (!trend) return "";
  const g = trend.granularity;
  const rows = trend.buckets.map((b, i) => ({ b, p: trend.previous_buckets?.[i] })).filter(({ b }) => !b.future);
  const showPrev = compare && trend.previous_buckets;
  const cell = (v, partial) => (v === null ? `<span class="an-na">Not measured</span>` : `${fmtInt(v)}${partial ? ` <small>so far</small>` : ""}`);
  const body = rows.map(({ b, p }) => `<tr${b.partial ? ` class="is-partial"` : ""}><th scope="row">${esc(g === "hour" ? `${axisLabel(b.start, g)} – ${axisLabel(b.start, g).replace(":00", ":59")}` : shortDate(b.start))}</th><td class="num">${cell(b[metric], b.partial)}</td>${showPrev ? `<td class="num">${p ? cell(p[metric], false) : dash}</td>` : ""}</tr>`).join("");
  return `<div class="an-table-wrap an-table-scroll"><table class="an-table"><caption class="cc-sr">${esc(METRICS[metric].label)} per ${g === "hour" ? "hour" : "day"}, ${periodNote(model)}</caption>
    <thead><tr><th scope="col">${g === "hour" ? "Hour" : "Day"}</th><th scope="col" class="num">${esc(METRICS[metric].label)}</th>${showPrev ? `<th scope="col" class="num">Previous period</th>` : ""}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** One-line description of what the chart basis is, so the reader knows how to read it. */
export function trendBasis(model, metric) {
  const cov = model.coverage;
  const bits = [];
  if (model.granularity === "hour") bits.push(`Hourly, ${esc(model.timezone?.label || "local time")}, today so far.`);
  else bits.push(`Daily totals, ${esc(model.timezone?.label || "local time")}.`);
  if (metric === "website_views" && model.granularity === "hour") bits.push(`Hour-by-hour page views come from per-visit session events (about ${cov?.website_views?.session_coverage_pct ?? "?"}% of today's page views), so the shape is an approximation; the daily total is exact.`);
  if (metric === "website_views" && model.granularity === "day") bits.push("Page views are counted page loads, not unique visitors.");
  if (metric === "store_clicks") bits.push("Clicks on store links; not purchases.");
  if (model.trend?.truncated) bits.push("Very long ranges are summarised; see the table for the exact buckets.");
  return bits.join(" ");
}

/* ---------------------------------------------------------------- sources */
export function sourcesView(model) {
  const s = model.sources;
  if (!s) return sectionStatus(model, "sources", "Traffic sources");
  if (s.total === 0) return `<p class="an-empty">No visits with a recorded source in this period.${s.dataSince ? ` Source recording started ${esc(s.dataSince)}.` : " Source recording has not captured any visit yet."}</p>`;
  const max = Math.max(1, ...s.rows.map(r => r.visits));
  const rows = s.rows.map(r => `<li class="an-bar-row" title="${esc(r.help)}"><span class="an-bar-label"><i class="an-swatch an-src-${esc(r.key)}"></i>${esc(r.label)}</span><span class="an-bar-track"><span class="an-bar-fill an-src-${esc(r.key)}" style="width:${Math.round((r.visits / max) * 100)}%"></span></span><span class="an-bar-val"><b>${fmtInt(r.visits)}</b>${r.share === null ? "" : ` <small>${r.share}%</small>`}</span></li>`).join("");
  const camp = s.campaigns.length
    ? `<h3 class="an-h3">Tagged campaigns</h3><div class="an-table-wrap"><table class="an-table"><caption class="cc-sr">Visits with UTM tags</caption><thead><tr><th scope="col">Campaign</th><th scope="col">Source</th><th scope="col">Medium</th><th scope="col" class="num">Visits</th></tr></thead><tbody>${s.campaigns.map(c => `<tr><th scope="row">${esc(c.utm_campaign || "—")}</th><td>${esc(c.utm_source || "—")}</td><td>${esc(c.utm_medium || "—")}</td><td class="num">${fmtInt(c.visits)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const pp = model.period?.previous;
  const prev = s.previousTotal === null ? ""
    : pp && s.dataSince && s.dataSince > pp.since ? " Source recording began after the previous period started, so the two cannot be compared."
      : ` Previous period: ${fmtInt(s.previousTotal)} visits.`;
  return `<ul class="an-bars" aria-label="Visits by source">${rows}</ul>
    <details class="an-data-details"><summary>Detailed source counts and tagged campaigns</summary>
    <div class="an-table-wrap"><table class="an-table an-table-twin"><caption class="cc-sr">Visits by source, ${periodNote(model)}</caption><thead><tr><th scope="col">Source</th><th scope="col" class="num">Visits</th><th scope="col" class="num">Share</th></tr></thead>
    <tbody>${s.rows.map(r => `<tr><th scope="row">${esc(r.label)}</th><td class="num">${fmtInt(r.visits)}</td><td class="num">${r.share === null ? "—" : `${r.share}%`}</td></tr>`).join("")}<tr class="an-total"><th scope="row">All sources</th><td class="num">${fmtInt(s.total)}</td><td class="num">100%</td></tr></tbody></table></div>
    ${camp}</details><p class="an-fine">${basisBadge("estimated")} One count per anonymous browser session, taken from the referrer the browser reports. Referrers can be hidden or stripped, so “Direct / unknown” is not proof anyone typed the address. A referring site shows where a visit started, not the whole journey.${prev}${s.dataSince ? ` Recording began ${esc(s.dataSince)}.` : ""}</p>`;
}

/* ------------------------------------------------------- visitor flow + store clicks */
const FLOW_LABELS = {
  homepage: "Home", stores: "Stores", deliver: "Deliver", services: "Services", portfolio: "Portfolio",
  toolkit: "Creative Toolkit", tools: "Tools", guides: "Guides", about: "About", support: "Support",
  contact: "Contact", spotlight: "Spotlight",
};
const STORE_LABELS = {
  redbubble: "Redbubble", teepublic: "TeePublic", kofi: "Ko-fi",
  ko_fi: "Ko-fi", boztik_store: "Boztik Stores",
};
const PLACEMENT_LABELS = {
  store_grid: "Store product cards", stores: "Stores page", homepage: "Homepage",
  home: "Homepage", footer: "Footer", toolkit: "Creative Toolkit",
};
const pageName = key => FLOW_LABELS[key] || key;
const number = value => fmtInt(Number(value) || 0);

export function flowView(model) {
  const f = model.flow;
  if (!f) return sectionStatus(model, "flow", "Visitor journey") || `<p class="an-empty">Visitor journey data is not available.</p>`;
  const coverage = f.session_coverage_pct;
  const journeys = (f.journeys || []).filter(j => Array.isArray(j.path) && j.path.length > 1);
  const transitions = f.transitions || [];
  const ranked = (rows, label) => rows?.length
    ? `<div class="an-flow-group"><h3 class="an-h4">${label}</h3><ul class="an-flow-list">${rows.slice(0, 5).map(r => `<li><span>${esc(pageName(r.page))}</span><b>${number(r.visits)}</b></li>`).join("")}</ul></div>`
    : "";
  const journeyRows = journeys.length
    ? `<ol class="an-journey-list">${journeys.slice(0, 6).map(j => `<li><span>${j.path.map(pageName).map(esc).join(" <i aria-hidden=\"true\">→</i> ")}${j.truncated ? " …" : ""}</span><b>${number(j.visits)} <small>sessions</small></b></li>`).join("")}</ol>`
    : `<p class="an-empty">No multi-page journeys were recorded in this period. Single-page visits are counted separately and do not appear as journeys.</p>`;
  const transitionRows = transitions.length
    ? `<div class="an-table-wrap"><table class="an-table"><thead><tr><th scope="col">Next step</th><th scope="col" class="num">Sessions</th></tr></thead><tbody>${transitions.slice(0, 8).map(t => `<tr><th scope="row">${esc(pageName(t.from))} <span aria-hidden="true">→</span> ${esc(pageName(t.to))}</th><td class="num">${number(t.visits)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const sample = f.status === "limited" || (Number(f.visits) > 0 && Number(f.visits) < Number(f.min_visits || 20))
    ? `<p class="an-state an-state-missing" role="status"><span><strong>Small sample.</strong> These patterns are directional, not a reliable picture of all visitors.</span></p>`
    : "";
  const cap = f.events_capped ? `<p class="an-fine">The event safety limit was reached; this view is based on a capped sample.</p>` : "";
  return `<div class="an-stats"><span><b>${number(f.visits)}</b> recorded visits</span><span><b>${number(f.multi_page_visits)}</b> multi-page visits</span><span><b>${number(f.single_page_visits)}</b> single-page visits</span><span><b>${coverage == null ? "—" : `${coverage}%`}</b> session coverage</span></div>
    ${sample}
    <div class="an-two an-flow-columns">${ranked(f.entries, "Where recorded visits started")}${ranked(f.exits, "Last page observed")}</div>
    <h3 class="an-h4">Most common visitor journeys</h3>${journeyRows}
    ${transitions.length ? `<details class="an-data-details"><summary>See page-to-page transitions</summary>${transitionRows}</details>` : ""}
    <p class="an-fine">${basisBadge("measured")} Built from anonymous first-party session events. A visit starts after 30 minutes without a recorded page event. “Last page observed” is not proof the visitor closed the site. Coverage is the share of page views with session events; older page views cannot be reconstructed.${f.session_data_since ? ` Path tracking began ${esc(f.session_data_since)}.` : ""}</p>${cap}`;
}

export function storeView(model) {
  const s = model.store;
  if (!s) return sectionStatus(model, "store", "Store-link performance") || `<p class="an-empty">Store-click data is not available.</p>`;
  const destinations = (s.by_destination || []).filter(r => r.clicks > 0).sort((a, b) => b.clicks - a.clicks);
  const placements = (s.sources || []).filter(r => r.clicks > 0).sort((a, b) => b.clicks - a.clicks);
  const rows = destinations.length
    ? `<div class="an-table-wrap"><table class="an-table"><thead><tr><th scope="col">Destination</th><th scope="col" class="num">Clicks</th><th scope="col" class="num">Sessions</th><th scope="col">Top placement</th></tr></thead><tbody>${destinations.map(r => `<tr><th scope="row">${esc(STORE_LABELS[r.destination] || r.destination)}</th><td class="num">${number(r.clicks)}</td><td class="num">${number(r.unique_sessions)}</td><td>${esc(PLACEMENT_LABELS[r.top_source] || r.top_source || "Not recorded")}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="an-empty">No store-link activations were recorded in this period.</p>`;
  const placementRows = placements.length
    ? `<ul class="an-flow-list">${placements.slice(0, 6).map(r => `<li><span>${esc(PLACEMENT_LABELS[r.source_placement] || r.source_placement)}</span><b>${number(r.clicks)}</b></li>`).join("")}</ul>`
    : `<p class="an-empty">No placement breakdown recorded.</p>`;
  const previous = s.previous ? `Previous period: ${number(s.previous.total)} tracked clicks.` : "No comparable earlier period.";
  return `<div class="an-stats"><span><b>${number(s.total)}</b> tracked link activations</span><span><b>${number(s.outbound_total)}</b> outbound store clicks</span><span><b>${number(s.unique_sessions)}</b> sessions with a click</span><span><b>${number(s.store_page_views)}</b> Stores page views</span><span><b>${number(s.product_card_clicks)}</b> product-card clicks</span></div>
    ${rows}
    <details class="an-data-details"><summary>Where clicks happened</summary>${placementRows}</details>
    <p class="an-fine">${basisBadge("measured")} Link activations only — not purchases or revenue. ${esc(previous)} Store-page views are not a conversion denominator for all clicks because some placements are outside the Stores page.${s.data_since ? ` Click tracking began ${esc(s.data_since)}.` : ""}</p>`;
}

/* ------------------------------------------------------------------ pages */
export const PAGE_SIZE = 8;
const sortValue = {
  label: r => r.label.toLowerCase(), views: r => r.views, share: r => r.share, change: r => r.cmp?.change ?? null,
  entrances: r => r.entrances, exits: r => r.exits,
};
export function filterPages(rows, q) {
  const t = String(q || "").trim().toLowerCase();
  return t ? rows.filter(r => r.label.toLowerCase().includes(t) || r.page.toLowerCase().includes(t)) : rows;
}
/** Sort with nulls always last (never treated as zero), ties broken by label so the order is stable. */
export function sortPages(rows, key = "views", dir = "desc") {
  const get = sortValue[key] ?? sortValue.views, sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x === null || x === undefined) return (y === null || y === undefined) ? a.label.localeCompare(b.label) : 1;
    if (y === null || y === undefined) return -1;
    if (x < y) return -1 * sign; if (x > y) return 1 * sign;
    return a.label.localeCompare(b.label);
  });
}
export function paginate(rows, page = 1, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length };
}

function changeCell(r, today) {
  const c = r.cmp;
  if (!c) return dash;
  if (c.status === "ok") return deltaHtml(c, { compact: true });
  if (c.status === "raw") return c.change === null ? (c.previous === null ? dash : `<span class="an-na" title="Previous period had fewer than ${MIN_BASE_PAGE} views">—</span>`) : deltaHtml({ status: "ok", change: c.change }, { compact: true });
  if (c.status === "from-zero") return `<span class="an-delta is-up">▲ New</span>`;
  if (c.status === "not-comparable") return `<span class="an-na" title="${esc(comparisonNote(c, { today }))}">—</span>`;
  return `<span class="an-na" title="${esc(comparisonNote(c))}">—</span>`;
}

export function pagesView(model, ui = {}) {
  if (!model.website?.available) return sectionStatus(model, "summary", "Page performance") || `<p class="an-empty">Loading…</p>`;
  const limited = model.limited ? `<p class="an-state an-state-missing" role="status">${icon("info")}<span><strong>Limited mode: fixed last 30 days.</strong> The deployed Worker cannot answer for the range you selected, so this table ignores it. Comparisons, entrances and exits are unavailable.</span></p>` : "";
  const sort = ui.sort ?? { key: "views", dir: "desc" };
  const all = filterPages(model.pages, ui.q);
  const sorted = sortPages(all, sort.key, sort.dir);
  const pg = paginate(sorted, ui.page ?? 1, PAGE_SIZE);
  const max = Math.max(1, ...model.pages.map(r => r.views));
  const ranked = sortPages(model.pages, "views", "desc").filter(r => r.views > 0).slice(0, 6);
  const rankMax = Math.max(1, ...ranked.map(r => r.views));
  const rankChart = ranked.length ? `<div class="an-page-rank" role="list" aria-label="Top pages by page views">${ranked.map(r => `<div class="an-rank-row" role="listitem"><span class="an-rank-label" title="${esc(r.label)}">${esc(r.label)}</span><span class="an-rank-track"><span style="width:${Math.max(2, Math.round((r.views / rankMax) * 100))}%"></span></span><b class="an-rank-value">${fmtInt(r.views)} <small>${r.share === null ? "" : `${r.share}%`}</small></b></div>`).join("")}</div>` : `<p class="an-empty">No page views recorded in this period.</p>`;
  const hasFlow = !!model.flow && model.flow.pages;
  const th = (key, label, cls = "") => `<th scope="col" class="${cls}" aria-sort="${sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="an-sort" data-sort="${key}">${esc(label)}<span aria-hidden="true">${sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span></button></th>`;
  const body = pg.rows.length ? pg.rows.map(r => `<tr><th scope="row"><button type="button" class="an-link" data-page-detail="${esc(r.page)}" aria-expanded="${ui.detail === r.page}">${esc(r.label)}</button><span class="an-sub">${esc(r.page)}</span></th>
      <td class="num">${r.views ? `<span class="an-inline-bar"><span style="width:${Math.max(2, Math.round((r.views / max) * 100))}%"></span></span><b>${fmtInt(r.views)}</b>` : `<span class="an-na">None counted</span>`}</td>
      <td class="num">${r.share === null || !r.views ? "—" : `${r.share}%`}</td><td class="num">${changeCell(r, model.granularity === "hour")}</td>
      <td class="num">${hasFlow && r.entrances !== null ? fmtInt(r.entrances) : dash}</td><td class="num">${hasFlow && r.exits !== null ? fmtInt(r.exits) : dash}</td></tr>`).join("")
    : `<tr><td colspan="6" class="an-empty">${ui.q ? `No pages match “${esc(ui.q)}”.` : "No pages."}</td></tr>`;
  const from = pg.total ? (pg.page - 1) * PAGE_SIZE + 1 : 0, to = Math.min(pg.total, pg.page * PAGE_SIZE);
  return `${limited}${rankChart}
    <div class="an-data-details an-page-table">
    <div class="an-toolbar"><label class="an-search"><span class="cc-sr">Filter pages</span><input type="search" id="an-page-q" class="cc-input" placeholder="Filter pages…" value="${esc(ui.q || "")}" autocomplete="off" maxlength="60"></label>
      <span class="an-count" role="status">${pg.total ? `${from}–${to} of ${pg.total} pages` : "0 pages"}</span></div>
    <div class="an-table-wrap"><table class="an-table an-pages"><caption class="cc-sr">Public website pages ranked by counted page views, ${periodNote(model)}</caption>
      <thead><tr>${th("label", "Page")}${th("views", "Page views", "num")}${th("share", "Share", "num")}${th("change", "vs previous", "num")}${th("entrances", "Entrances", "num")}${th("exits", "Exits", "num")}</tr></thead><tbody>${body}</tbody></table></div>
    <div class="an-pager" ${pg.pages > 1 ? "" : "hidden"}><button type="button" class="cc-btn" data-page-nav="prev" ${pg.page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${pg.page} of ${pg.pages}</span><button type="button" class="cc-btn" data-page-nav="next" ${pg.page >= pg.pages ? "disabled" : ""}>Next</button></div>
    <div id="an-page-detail">${ui.detail ? pageDetail(model, ui.detail) : ""}</div>
    <p class="an-fine">${basisBadge("measured")} Page loads counted by Boztik's own counter${model.website?.dataSince ? ` since ${esc(model.website.dataSince)}` : ""}. Not unique people; visitors who send Do Not Track or Global Privacy Control are not counted. “vs previous” compares completed days only and needs at least ${MIN_BASE_PAGE} views in the earlier period. Entrances and exits come from anonymous session events, which cover only part of all page views${model.flow?.session_coverage_pct != null ? ` (${model.flow.session_coverage_pct}% in this period)` : ""}. Engagement time and onward clicks per page are GA4-only and not shown.</p>`;
}

export function pageDetail(model, page) {
  const row = model.pages.find(p => p.page === page);
  if (!row) return "";
  return `<section class="an-detail" aria-label="${esc(row.label)} detail"><header><h3 class="an-h3">${esc(row.label)}</h3><button type="button" class="cc-btn" data-detail-close>Close</button></header>
    <p class="an-muted">${fmtInt(row.views)} counted page view${row.views === 1 ? "" : "s"} in this period${row.entrances !== null && row.entrances !== undefined ? ` · ${fmtInt(row.entrances)} entrance${row.entrances === 1 ? "" : "s"} · ${fmtInt(row.exits)} exit${row.exits === 1 ? "" : "s"} (session events)` : ""}.</p></section>`;
}

/* ---------------------------------------------------------------- deliver */
function typeChange(cur, prev) {
  if (prev === null || prev === undefined) return dash;
  if (prev === 0) return cur > 0 ? `<span class="an-delta is-up">▲ New</span>` : dash;
  if (prev < MIN_BASE_PAGE) return `<span class="an-na" title="Previous period had too few events">—</span>`;
  const c = Math.round(((cur - prev) / prev) * 100);
  return c === 0 ? `<span class="an-delta is-flat">0%</span>` : `<span class="an-delta ${c > 0 ? "is-up" : "is-down"}">${c > 0 ? "▲" : "▼"} ${Math.abs(c)}%</span>`;
}
export function deliverView(model) {
  const d = model.deliver;
  if (!d.available) return sectionStatus(model, "summary", "Deliver performance") || `<p class="an-empty">Loading…</p>`;
  const shown = d.types.filter(t => t.type !== "deleted" || t.views || t.downloads || t.shares);
  const t = d.totals;
  const battle = x => x.type === "photoshop_battles";
  const row = x => `<tr><th scope="row">${esc(x.label)}${battle(x) ? ` <span class="an-chip">Reddit</span>` : ""}</th><td class="num">${fmtInt(x.views)}</td><td class="num">${battle(x) ? `<span class="an-na" title="PhotoshopBattles images are public direct links, so downloads are not recorded">n/a</span>` : fmtInt(x.downloads)}</td><td class="num">${fmtInt(x.shares)}</td><td class="num">${battle(x) ? "—" : per100(x.downloads, x.views)}</td><td class="num">${per100(x.shares, x.views)}</td><td class="num">${perDelivery(x.views, x.active)}</td><td class="num">${typeChange(x.views, x.prevViews)}</td></tr>`;
  const maxViews = Math.max(1, ...shown.map(x => x.views));
  const bars = `<div class="an-type-rank" role="list" aria-label="Deliver views by type">${[...shown].sort((a,b) => b.views-a.views).map(x => `<div class="an-rank-row" role="listitem"><span class="an-rank-label">${esc(x.label)}</span><span class="an-rank-track"><span style="width:${Math.max(2, Math.round((x.views / maxViews) * 100))}%"></span></span><b class="an-rank-value">${fmtInt(x.views)} <small>${fmtInt(x.downloads)} downloads · ${fmtInt(x.shares)} shares</small></b></div>`).join("")}</div>`;
  const created = model.totals.new_deliveries;
  return `<div class="an-stats"><span><b>${fmtInt(t.views)}</b> views</span><span><b>${fmtInt(t.downloads)}</b> downloads</span><span><b>${fmtInt(t.shares)}</b> shares</span><span><b>${fmtInt(t.active)}</b> deliveries with activity</span>${created !== null && created !== undefined ? `<span><b>${fmtInt(created)}</b> deliveries created</span>` : ""}</div>
    ${bars}<details class="an-data-details"><summary>Detailed Deliver metrics and comparisons</summary>
    <div class="an-table-wrap"><table class="an-table an-wide"><caption class="cc-sr">Deliver activity by delivery type, ${periodNote(model)}</caption><thead><tr><th scope="col">Delivery type</th><th scope="col" class="num">Views</th><th scope="col" class="num">Downloads</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Downloads / 100 views</th><th scope="col" class="num">Shares / 100 views</th><th scope="col" class="num">Views / active delivery</th><th scope="col" class="num">Views vs previous</th></tr></thead>
    <tbody>${shown.map(row).join("")}<tr class="an-total"><th scope="row">All Deliver types</th><td class="num">${fmtInt(t.views)}</td><td class="num">${fmtInt(t.downloads)}</td><td class="num">${fmtInt(t.shares)}</td><td class="num">${per100(t.downloads, t.views)}</td><td class="num">${per100(t.shares, t.views)}</td><td class="num">${perDelivery(t.views, t.active)}</td><td class="num">${d.prevTotals ? typeChange(t.views, d.prevTotals.views) : dash}</td></tr></tbody></table></div>
    </details><p class="an-fine">${basisBadge("measured")} Deliver's own counters; never added to website page views and never sent to GA4. A view is every load, repeats included. “Per 100 views” columns are calculated, and a download rate is <em>not</em> a conversion rate. “Active delivery” = at least one view or download in the period. PhotoshopBattles images are public direct links: views only. Deleted deliveries keep their history but no longer have a type.</p>`;
}

/* ---------------------------------------------------------------- actions */

/* ----------------------------------------------------------------- health */
const STATUS_TEXT = { receiving: ["Receiving", "ok"], quiet: ["Quiet for 7+ days", "warn"], no_data_yet: ["No data yet", "none"] };
const when = iso => { if (!iso) return "—"; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };
export function healthView(model) {
  const h = model.health;
  if (!h) return sectionStatus(model, "health", "Data health");
  const c = h.collectors;
  const pill = s => { const [t, k] = STATUS_TEXT[s] ?? [s, "none"]; return `<span class="an-pill is-${k}">${esc(t)}</span>`; };
  const day = v => (v ? esc(v) : "—");
  const row = (name, x, first, last) => `<tr><th scope="row">${esc(name)}</th><td>${pill(x.status)}</td><td>${first}</td><td>${last}</td></tr>`;
  const cov = [];
  if (model.flow?.session_coverage_pct != null) cov.push(`Session events cover ${model.flow.session_coverage_pct}% of page views in this period.`);
  if (h.page_views_before_session_tracking) cov.push(`${fmtInt(h.page_views_before_session_tracking)} page views were counted before session tracking began and cannot appear in journeys.`);
  return `<div class="an-table-wrap"><table class="an-table"><caption class="cc-sr">Status of each analytics collector</caption><thead><tr><th scope="col">Collector</th><th scope="col">Status</th><th scope="col">First data</th><th scope="col">Latest data</th></tr></thead><tbody>
    ${row("Page views (daily counter)", c.page_views, day(c.page_views.first_day), day(c.page_views.last_day))}
    ${row("Session events (journeys)", c.sessions, when(c.sessions.first_at), when(c.sessions.last_at))}
    ${row("Traffic sources", c.attribution, when(c.attribution.first_at), when(c.attribution.last_at))}
    ${row("Store-link clicks", c.store_clicks, when(c.store_clicks.first_at), when(c.store_clicks.last_at))}
  </tbody></table></div>
    <ul class="an-notes"><li>“Quiet” means nothing arrived for 7 days. From the database alone, a quiet site and a broken collector look identical, so this is never reported as healthy or failed.</li>
    <li>Day boundaries use ${esc(h.timezone?.label || "the configured timezone")} (${esc(h.timezone?.boundary || "midnight")}). Session and source rows are kept ${fmtInt(h.retention_days)} days.</li>
    ${cov.map(x => `<li>${esc(x)}</li>`).join("")}
    ${(h.privacy_exclusions ?? []).map(x => `<li>${esc(x)}</li>`).join("")}${(h.known_gaps ?? []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    <p class="an-fine">Checked ${esc(when(h.generated_at))}.</p>`;
}

/* --------------------------------------------------------------- signals */
export function signalsView(signals, model) {
  if (!model.website?.available && !model.trend) return `<li class="an-empty">${stateOf(model, "summary") === "loading" ? "Loading…" : "Nothing to show until the data loads."}</li>`;
  if (!signals.length) return `<li class="an-empty">Not enough recorded activity in this period to point at anything. That is a finding too: no change here is large enough to be more than normal variation.</li>`;
  const TAG = { watch: "Check", notable: "Notable", info: "Note" };
  const rendered = signals.map(s => `<li class="an-signal is-${esc(s.level)}"><span class="an-signal-tag">${esc(TAG[s.level] ?? s.level)}</span><div><strong>${esc(s.title)}</strong><p>${esc(s.detail)}</p><dl class="an-evidence">${s.evidence.map(e => `<div><dt>${esc(e.label)}</dt><dd>${esc(e.value)}</dd></div>`).join("")}</dl></div>${basisBadge(s.basis)}</li>`);
  return rendered.length > 3 ? `${rendered.slice(0, 3).join("")}<li class="an-signal-more"><details class="an-data-details"><summary>More observations (${rendered.length - 3})</summary><ul class="cc-standout">${rendered.slice(3).join("")}</ul></details></li>` : rendered.join("");
}
