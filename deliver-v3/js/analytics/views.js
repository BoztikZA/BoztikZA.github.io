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
  cards.push(model.store
    ? card({ label: "Store-link clicks", ic: "chart", value: fmtInt(model.store.total), delta: deltaHtml(c.store_clicks, { noun: "clicks", today }), sub: `Clicks on store links, not purchases. <b>${fmtInt(model.store.unique_sessions)}</b> anonymous sessions.`, spk: spark("store_clicks") })
    : card({ label: "Store-link clicks", ic: "chart", ...missing("store", "Store clicks") }));
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
    <div class="an-table-wrap"><table class="an-table an-table-twin"><caption class="cc-sr">Visits by source, ${periodNote(model)}</caption><thead><tr><th scope="col">Source</th><th scope="col" class="num">Visits</th><th scope="col" class="num">Share</th></tr></thead>
    <tbody>${s.rows.map(r => `<tr><th scope="row">${esc(r.label)}</th><td class="num">${fmtInt(r.visits)}</td><td class="num">${r.share === null ? "—" : `${r.share}%`}</td></tr>`).join("")}<tr class="an-total"><th scope="row">All sources</th><td class="num">${fmtInt(s.total)}</td><td class="num">100%</td></tr></tbody></table></div>
    ${camp}<p class="an-fine">${basisBadge("estimated")} One count per anonymous browser session, taken from the referrer the browser reports. Referrers can be hidden or stripped, so “Direct / unknown” is not proof anyone typed the address. A referring site shows where a visit started, not the whole journey.${prev}${s.dataSince ? ` Recording began ${esc(s.dataSince)}.` : ""}</p>`;
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
  const hasFlow = !!model.flow && model.flow.pages;
  const th = (key, label, cls = "") => `<th scope="col" class="${cls}" aria-sort="${sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="an-sort" data-sort="${key}">${esc(label)}<span aria-hidden="true">${sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span></button></th>`;
  const body = pg.rows.length ? pg.rows.map(r => `<tr><th scope="row"><button type="button" class="an-link" data-page-detail="${esc(r.page)}" aria-expanded="${ui.detail === r.page}">${esc(r.label)}</button><span class="an-sub">${esc(r.page)}</span></th>
      <td class="num">${r.views ? `<span class="an-inline-bar"><span style="width:${Math.max(2, Math.round((r.views / max) * 100))}%"></span></span><b>${fmtInt(r.views)}</b>` : `<span class="an-na">None counted</span>`}</td>
      <td class="num">${r.share === null || !r.views ? "—" : `${r.share}%`}</td><td class="num">${changeCell(r, model.granularity === "hour")}</td>
      <td class="num">${hasFlow && r.entrances !== null ? fmtInt(r.entrances) : dash}</td><td class="num">${hasFlow && r.exits !== null ? fmtInt(r.exits) : dash}</td></tr>`).join("")
    : `<tr><td colspan="6" class="an-empty">${ui.q ? `No pages match “${esc(ui.q)}”.` : "No pages."}</td></tr>`;
  const from = pg.total ? (pg.page - 1) * PAGE_SIZE + 1 : 0, to = Math.min(pg.total, pg.page * PAGE_SIZE);
  return `${limited}<div class="an-toolbar"><label class="an-search"><span class="cc-sr">Filter pages</span><input type="search" id="an-page-q" class="cc-input" placeholder="Filter pages…" value="${esc(ui.q || "")}" autocomplete="off" maxlength="60"></label>
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
  const tr = model.flow?.transitions ?? [];
  const next = tr.filter(t => t.from === page).sort((a, b) => b.visits - a.visits).slice(0, 5);
  const prev = tr.filter(t => t.to === page).sort((a, b) => b.visits - a.visits).slice(0, 5);
  const list = (items, key) => (items.length ? `<ul class="an-flow-list">${items.map(t => `<li><span>${esc(PAGE_LABELS[t[key]] || t[key])}</span><b>${fmtInt(t.visits)} visits</b></li>`).join("")}</ul>` : `<p class="an-empty">None recorded.</p>`);
  return `<section class="an-detail" aria-label="${esc(row.label)} detail"><header><h3 class="an-h3">${esc(row.label)}</h3><button type="button" class="cc-btn" data-detail-close>Close</button></header>
    <p class="an-muted">${fmtInt(row.views)} counted page view${row.views === 1 ? "" : "s"} in this period${row.entrances !== null && row.entrances !== undefined ? ` · ${fmtInt(row.entrances)} entrance${row.entrances === 1 ? "" : "s"} · ${fmtInt(row.exits)} exit${row.exits === 1 ? "" : "s"} (session events)` : ""}.</p>
    <div class="an-two"><div><h4 class="an-h4">Visitors go next to</h4>${model.flow ? list(next, "to") : `<p class="an-empty">Visitor flow is not available.</p>`}</div><div><h4 class="an-h4">Visitors arrive from</h4>${model.flow ? list(prev, "from") : `<p class="an-empty">Visitor flow is not available.</p>`}</div></div></section>`;
}

/* ------------------------------------------------------------ visitor flow */
export function flowView(model) {
  const f = model.flow;
  if (!f) return sectionStatus(model, "flow", "Visitor flow");
  const REASONS = { no_page_views_in_period: "No page views were counted in this period, so there is nothing to follow.", page_views_without_session_events: "Page views were counted, but none carry session events, so journeys cannot be built. This is a tracking gap, not a quiet period." };
  if (f.status === "no_events") return `<p class="an-empty">${esc(REASONS[f.reason] || "No session events recorded in this period.")}</p>`;
  const label = p => esc(PAGE_LABELS[p] || p);
  const list = (items, empty) => (items.length ? `<ul class="an-flow-list">${items.slice(0, 6).map(i => `<li><span>${i.label}</span><b>${fmtInt(i.visits)}</b></li>`).join("")}</ul>` : `<p class="an-empty">${esc(empty)}</p>`);
  const limited = f.status === "limited" ? `<p class="an-state an-state-missing" role="status">${icon("info")}<span>Only ${fmtInt(f.visits)} visit${f.visits === 1 ? "" : "s"} recorded: fewer than ${fmtInt(f.min_visits)}, so these patterns are shown for reference and are not reliable.</span></p>` : "";
  return `${limited}<div class="an-stats"><span><b>${fmtInt(f.visits)}</b> visits</span><span><b>${fmtInt(f.multi_page_visits)}</b> multi-page</span><span><b>${fmtInt(f.single_page_visits)}</b> single-page</span><span class="an-muted">Session coverage ${f.session_coverage_pct === null ? "—" : `${f.session_coverage_pct}%`} of page views</span></div>
    <div class="an-two"><div><h3 class="an-h3">Where visits start</h3>${list(f.entries.map(e => ({ label: label(e.page), visits: e.visits })), "None.")}</div><div><h3 class="an-h3">Where visits end</h3>${list(f.exits.map(e => ({ label: label(e.page), visits: e.visits })), "None.")}</div></div>
    <div class="an-two"><div><h3 class="an-h3">Most common steps</h3>${list(f.transitions.map(t => ({ label: `${label(t.from)} <span aria-hidden="true">→</span><span class="cc-sr"> to </span> ${label(t.to)}`, visits: t.visits })), "No page-to-page movement recorded.")}</div>
    <div><h3 class="an-h3">Most common journeys</h3>${list(f.journeys.map(j => ({ label: `${j.path.map(label).join(' <span aria-hidden="true">→</span> ')}${j.truncated ? " …" : ""}`, visits: j.visits })), "No multi-page journeys recorded.")}</div></div>
    <p class="an-fine">${basisBadge("measured")} Built from anonymous session events only: a new visit starts after ${fmtInt(f.visit_gap_minutes)} minutes of inactivity. No IP addresses or personal data. Journeys cover only the share of page views that also stored a session event${f.session_data_since ? ` (recorded since ${esc(f.session_data_since)})` : ""}${f.events_capped ? "; the event cap was hit, so very busy periods are truncated" : ""}.</p>`;
}

/* ------------------------------------------------------------------ store */
const STORE_LABELS = { boztik_store: "Boztik Stores", redbubble: "Redbubble", teepublic: "TeePublic", kofi: "Ko-fi Wallpapers" };
export const storeLabel = d => STORE_LABELS[d] || d;
export function storeView(model) {
  const s = model.store;
  if (!s) return sectionStatus(model, "store", "Store activity");
  const rows = s.by_destination.map(r => `<tr><th scope="row">${esc(storeLabel(r.destination))}</th><td class="num">${fmtInt(r.clicks)}</td><td class="num">${fmtInt(r.unique_sessions)}</td><td>${esc(r.top_source || "—")}</td></tr>`).join("");
  const place = (s.sources ?? []).slice(0, 6).map(r => `<tr><th scope="row">${esc(r.source_placement)}</th><td class="num">${fmtInt(r.clicks)}</td></tr>`).join("");
  const prev = !s.previous || !s.data_since ? ""
    : s.data_since > s.previous.since ? `<span class="an-muted">Click recording began after the previous period started, so it cannot be compared.</span>`
      : `<span class="an-muted">Previous period: ${fmtInt(s.previous.total)} clicks</span>`;
  return `<div class="an-stats"><span><b>${fmtInt(s.total)}</b> store-link clicks</span><span><b>${fmtInt(s.outbound_total)}</b> to outside stores</span><span><b>${fmtInt(s.unique_sessions)}</b> anonymous sessions</span><span><b>${fmtInt(s.store_page_views)}</b> Stores page views</span><span><b>${fmtInt(s.product_card_clicks)}</b> product-card clicks</span>${prev}</div>
    <div class="an-two"><div class="an-table-wrap"><table class="an-table"><caption class="cc-sr">Store-link clicks by destination</caption><thead><tr><th scope="col">Destination</th><th scope="col" class="num">Clicks</th><th scope="col" class="num">Sessions</th><th scope="col">Top placement</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="an-table-wrap"><table class="an-table"><caption class="cc-sr">Clicks by placement on the site</caption><thead><tr><th scope="col">Placement</th><th scope="col" class="num">Clicks</th></tr></thead><tbody>${place || `<tr><td colspan="2" class="an-empty">No clicks recorded.</td></tr>`}</tbody></table></div></div>
    <p class="an-fine">${basisBadge("measured")} A click records activation of a store link, not a completed purchase.${s.data_since ? ` Click recording began ${esc(s.data_since)}.` : " No click has been recorded yet."}</p>`;
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
  const created = model.totals.new_deliveries;
  return `<div class="an-stats"><span><b>${fmtInt(t.views)}</b> views</span><span><b>${fmtInt(t.downloads)}</b> downloads</span><span><b>${fmtInt(t.shares)}</b> shares</span><span><b>${fmtInt(t.active)}</b> deliveries with activity</span>${created !== null && created !== undefined ? `<span><b>${fmtInt(created)}</b> deliveries created</span>` : ""}</div>
    <div class="an-table-wrap"><table class="an-table an-wide"><caption class="cc-sr">Deliver activity by delivery type, ${periodNote(model)}</caption><thead><tr><th scope="col">Delivery type</th><th scope="col" class="num">Views</th><th scope="col" class="num">Downloads</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Downloads / 100 views</th><th scope="col" class="num">Shares / 100 views</th><th scope="col" class="num">Views / active delivery</th><th scope="col" class="num">Views vs previous</th></tr></thead>
    <tbody>${shown.map(row).join("")}<tr class="an-total"><th scope="row">All Deliver types</th><td class="num">${fmtInt(t.views)}</td><td class="num">${fmtInt(t.downloads)}</td><td class="num">${fmtInt(t.shares)}</td><td class="num">${per100(t.downloads, t.views)}</td><td class="num">${per100(t.shares, t.views)}</td><td class="num">${perDelivery(t.views, t.active)}</td><td class="num">${d.prevTotals ? typeChange(t.views, d.prevTotals.views) : dash}</td></tr></tbody></table></div>
    <p class="an-fine">${basisBadge("measured")} Deliver's own counters; never added to website page views and never sent to GA4. A view is every load, repeats included. “Per 100 views” columns are calculated, and a download rate is <em>not</em> a conversion rate. “Active delivery” = at least one view or download in the period. PhotoshopBattles images are public direct links: views only. Deleted deliveries keep their history but no longer have a type.</p>`;
}

/* ---------------------------------------------------------------- actions */
export function actionsView(model) {
  const s = model.store;
  const row = (label, value, source, basis) => `<tr><th scope="row">${esc(label)}</th><td class="num">${value}</td><td>${esc(source)}</td><td>${basisBadge(basis)}</td></tr>`;
  const na = `<span class="an-na">Not available</span>`;
  return `<div class="an-table-wrap"><table class="an-table"><caption class="cc-sr">Important actions and where each number comes from</caption><thead><tr><th scope="col">Action</th><th scope="col" class="num">Count</th><th scope="col">Source</th><th scope="col">Status</th></tr></thead><tbody>
    ${row("Store-link clicks (all destinations)", s ? fmtInt(s.total) : na, "First-party click log", s ? "measured" : "unavailable")}
    ${row("Product-card clicks on the Stores page", s ? fmtInt(s.product_card_clicks) : na, "First-party click log", s ? "measured" : "unavailable")}
    ${row("Chrome / Edge store, PayPal, email, portfolio links", na, "GA4 event “boztik_action”", "unavailable")}</tbody></table></div>
    <p class="an-fine">First-party and GA4 numbers are kept apart and never added together. GA4 is not connected to Command Centre.</p>`;
}

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
    <tr><th scope="row">GA4</th><td><span class="an-pill is-none">Not connected</span></td><td colspan="2">${esc(h.ga4?.detail || "")}</td></tr></tbody></table></div>
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
  return signals.map(s => `<li class="an-signal is-${esc(s.level)}"><span class="an-signal-tag">${esc(TAG[s.level] ?? s.level)}</span><div><strong>${esc(s.title)}</strong><p>${esc(s.detail)}</p><dl class="an-evidence">${s.evidence.map(e => `<div><dt>${esc(e.label)}</dt><dd>${esc(e.value)}</dd></div>`).join("")}</dl></div>${basisBadge(s.basis)}</li>`).join("");
}
