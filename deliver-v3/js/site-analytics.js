// Boztik Command Centre → Analytics: the "decision dashboard" block at the top of the Analytics tab.
//
// Data: ONE read-only call to the Worker's /api/admin/analytics/summary (same admin session as every other
// Command Centre call). If the Worker has not been updated yet, it falls back to the older /analytics/pages
// (fixed 30 days) so the page still works, clearly labelled as limited.
//
// Nothing here is estimated. GA4-only measures (users, sessions, traffic sources, engagement, clicks) cannot be
// read from here and are shown as "not connected", never as zero. The public Deliver page (deliver.html) is
// counted here as a website page; private delivery activity is rendered in its own section and never added to
// website numbers.
import { fetchAnalyticsHealth, fetchAnalyticsSummary, fetchPageAnalytics, fetchStoreClickSummary, fetchTrafficSourceSummary, fetchVisitorFlow } from "./api.js";
import { escapeHtml } from "./shared.js";
import {
  PERIODS, KEY_PAGES, PAGE_LABELS, SHORT_LABELS, buildModel, buildObservations, buildReport,
  fmt, pctOf, pctChange, per100, perDelivery, MIN_COMPARE_BASE
} from "./analytics-report.js";

const $ = id => document.getElementById(id);
const icon = name => `<svg class="cc-i" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
/** Per-page / per-type percentage changes below this many previous-period events are shown as "—" (too noisy). */
const MIN_ROW_BASE = 10;

let periodKey = "30d";
let model = null;
/** Independent sections: each keeps its own data / loading / error so a failed request is never shown as zero. */
const sec = {
  traffic: { data: null, error: null, loading: false },
  store: { data: null, error: null, loading: false },
  flow: { data: null, error: null, loading: false },
  health: { data: null, error: null, loading: false }
};
let loadSeq = 0;
let wired = false;
let reportOpen = false;
let lastSuccessfulRefresh = null;
let lastRefreshFailed = false;
let siteAnalyticsTimer = null;
let siteAnalyticsRefreshInFlight = false;
const SITE_ANALYTICS_REFRESH_MS = 5 * 60 * 1000;

/* ----------------------------------------------------------------- helpers */
function deltaHtml(current, previous, base = MIN_COMPARE_BASE) {
  if (previous === null || previous === undefined) return "";
  if (previous < base) return `<span class="cc-delta is-flat">Too little earlier data to compare</span>`;
  const pct = pctChange(current, previous);
  if (pct === null) return "";
  if (pct === 0) return `<span class="cc-delta is-flat">▬ Same as the previous period</span>`;
  return `<span class="cc-delta ${pct > 0 ? "is-up" : "is-down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% <small>vs previous period</small></span>`;
}

function rowChange(current, previous) {
  if (previous === null || previous === undefined) return `<span class="cc-muted">—</span>`;
  if (previous === 0 && current > 0) return `<span class="cc-delta is-up" title="No activity in the previous period">▲ from 0</span>`;
  if (previous < MIN_ROW_BASE) return `<span class="cc-muted" title="Previous period had too few events for a reliable comparison">—</span>`;
  const pct = pctChange(current, previous);
  if (pct === 0) return `<span class="cc-delta is-flat">▬ 0%</span>`;
  return `<span class="cc-delta ${pct > 0 ? "is-up" : "is-down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%</span>`;
}

const rangeText = m => {
  if (!m?.range) return m?.limited ? "Last 30 days · website page views only" : "";
  const cur = m.range.since ? `${m.range.since} → ${m.range.until}` : "no data yet";
  return m.previous ? `${cur} · compared with ${m.previous.since} → ${m.previous.until}` : `${cur} · no earlier period to compare`;
};
const flowDaysForPeriod = key => key === "7d" ? 7 : key === "90d" ? 90 : key === "all" ? 90 : 30;

function renderDeliver() {
  const host = $("cc-site-deliver");
  if (!host) return;
  const d = model.deliver;
  if (!d.available) {
    host.innerHTML = `<p class="cc-empty">Deliver figures for a chosen period need the updated Worker. The all-time table below (“Where the attention goes”) still works.</p>`;
    return;
  }
  const shown = d.types.filter(t => t.type !== "deleted" || t.views || t.downloads || t.shares);
  const t = d.totals;
  const row = x => `<tr><th scope="row">${escapeHtml(x.label)}${x.type === "photoshop_battles" ? ` <span class="cc-badge">Reddit</span>` : ""}</th>
      <td class="num">${fmt(x.views)}</td><td class="num">${x.type === "photoshop_battles" ? `<span class="cc-muted" title="PhotoshopBattles images are public direct links">n/a</span>` : fmt(x.downloads)}</td><td class="num">${fmt(x.shares)}</td>
      <td class="num">${x.type === "photoshop_battles" ? "—" : per100(x.downloads, x.views)}</td><td class="num">${per100(x.shares, x.views)}</td>
      <td class="num">${perDelivery(x.views, x.active)}</td><td class="num">${rowChange(x.views, x.prevViews)}</td></tr>`;
  host.innerHTML = `<div class="cc-table-wrap"><table class="cc-table cc-table--wide">
      <caption class="cc-sr">Deliver views, downloads and shares by delivery type for the selected period</caption>
      <thead><tr><th scope="col">Delivery type</th><th scope="col" class="num">Views</th><th scope="col" class="num">Downloads</th><th scope="col" class="num">Shares</th>
        <th scope="col" class="num">Downloads / 100 views</th><th scope="col" class="num">Shares / 100 views</th><th scope="col" class="num">Views / active delivery</th><th scope="col" class="num">Views vs previous</th></tr></thead>
      <tbody>${shown.map(row).join("")}
        <tr class="cc-total"><th scope="row">All Deliver types</th><td class="num">${fmt(t.views)}</td><td class="num">${fmt(t.downloads)}</td><td class="num">${fmt(t.shares)}</td>
          <td class="num">${per100(t.downloads, t.views)}</td><td class="num">${per100(t.shares, t.views)}</td><td class="num">${perDelivery(t.views, t.active)}</td><td class="num">${d.prevTotals ? rowChange(t.views, d.prevTotals.views) : `<span class="cc-muted">—</span>`}</td></tr></tbody></table></div>
    <p class="cc-fineprint">Deliver's own counters — never added to website page views and never sent to GA4. Views count every load including repeats. “Active delivery” = a delivery with at least one view or download in the period. PhotoshopBattles images are public direct links, so they register views but no downloads. Shares include completed copies and opened WhatsApp / Facebook / X / Reddit sheets. Deleted deliveries keep their history but no longer have a type.</p>`;
}

/* ------------------------------------------------------------ section state */
const errText = e => (e && (e.message || (e.status ? `HTTP ${e.status}` : ""))) || "request failed";
const retryBtn = name => `<button type="button" class="cc-btn cc-btn-inline" data-retry="${name}">Try again</button>`;
const failureHtml = (what, state, name) =>
  `<p class="cc-empty cc-empty--error" role="alert">${escapeHtml(what)} could not be loaded (${escapeHtml(errText(state.error))}). This is a failed request, <strong>not zero activity</strong>. ${retryBtn(name)}</p>`;
const loadingHtml = what => `<p class="cc-muted">Loading ${escapeHtml(what)}…</p>`;
/** Shared prologue for a section card: returns an HTML string when there is nothing to draw, else null. */
function sectionGate(name, what) {
  const s = sec[name];
  if (!s.data) return s.error ? failureHtml(what, s, name) : loadingHtml(what);
  return null;
}
const staleNote = (name, what) => sec[name].error
  ? `<p class="cc-note cc-note--warn" role="status">${icon("alert")}<span>Refreshing ${escapeHtml(what)} failed (${escapeHtml(errText(sec[name].error))}); showing the last successful data. ${retryBtn(name)}</span></p>` : "";

const SRC_LABELS = { reddit: "Reddit", organic_search: "Organic search", social: "Other social", referral: "Other website referrals", direct_unknown: "Direct / unknown" };
const pageLabel = key => SHORT_LABELS[key] || escapeHtml(String(key));
const ctr = (clicks, views) => (Number(views) > 0 ? `${(Math.round((Number(clicks) / Number(views)) * 1000) / 10).toFixed(1)}` : "—");
const pct1 = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 1000) / 10 : 0);
const day = v => (v ? escapeHtml(String(v).slice(0, 10)) : "—");

/* ----------------------------------------------------------------- renderers */
function renderPeriodBar() {
  const host = $("cc-period-toolbar");
  if (!host) return;
  host.innerHTML = PERIODS.map(([key, label]) =>
    `<button type="button" class="dash-range${key === periodKey ? " is-active" : ""}" data-period="${key}" aria-pressed="${key === periodKey}">${escapeHtml(label)}</button>`).join("");
}

function renderNotice(html, kind = "info") {
  const host = $("cc-site-notice");
  if (!host) return;
  host.innerHTML = html ? `<p class="cc-note cc-note--${kind}" role="${kind === "error" ? "alert" : "status"}">${icon(kind === "error" ? "alert" : "info")}<span>${html}</span></p>` : "";
}

function formatLocalDateTime(value) {
  if (!value) return "never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function renderStatusBar() {
  const host = $("cc-site-status");
  if (!host) return;
  const failed = Object.entries(sec).filter(([, s]) => s.error).map(([k]) => k);
  let state = "loading", label = "Loading";
  if (lastRefreshFailed && model) { state = "failed"; label = "Refresh failed"; }
  else if (model) {
    if (model.limited) { state = "limited"; label = "Limited mode"; }
    else if (failed.length) { state = "limited"; label = `Partial data · ${failed.length} section${failed.length > 1 ? "s" : ""} failed`; }
    else if (model.website?.available && model.website.total === 0) { state = "empty"; label = "No page views in this period"; }
    else { state = "full"; label = "All sections loaded"; }
  }
  host.innerHTML = `<span class="cc-status-pill is-${state}">${escapeHtml(label)}</span><span>Last successful refresh: ${escapeHtml(formatLocalDateTime(lastSuccessfulRefresh))}</span><span>Period: ${escapeHtml(model?.periodLabel || periodKey)}</span><span>Days run local midnight–midnight (${escapeHtml(sec.health.data?.timezone?.label || "SAST")}); today is partial</span>`;
}

function renderKpis() {
  const host = $("cc-site-kpis");
  if (!host) return;
  const w = model.website;
  const t = sec.traffic, st = sec.store;
  const card = (label, ic, value, delta, sub, cls = "") => `<article class="cc-kpi"><header><span>${label}</span>${icon(ic)}</header>
      <strong class="cc-kpi-val ${cls}">${value}</strong><p class="cc-kpi-delta">${delta}</p><p class="cc-kpi-sub">${sub}</p></article>`;
  const unavailable = (s, what) => (s.loading && !s.data ? "Loading…" : `${what} could not be loaded.`);
  const attributionNever = sec.health.data?.collectors?.attribution?.status === "no_data_yet";
  host.innerHTML =
    card("Page views", "eye", w.available ? fmt(w.total) : "—", w.available ? deltaHtml(w.total, w.prevTotal) : "",
      "Counted loads of public pages, including the public Deliver page. Not unique people.") +
    card("Recorded visits", "globe", t.data ? fmt(t.data.total) : "—", t.data ? deltaHtml(t.data.total, t.data.previous?.total ?? null) : "",
      t.data ? (t.data.total === 0 && attributionNever ? "None recorded yet — source collection has not received an event, so this is <b>unmeasured</b>, not zero traffic." : "Visits with a stored source record (a new visit after 30 min idle).") : unavailable(t, "Visits")) +
    card("Store page views", "box", st.data ? fmt(st.data.store_page_views) : "—", st.data && st.data.previous ? deltaHtml(st.data.store_page_views, st.data.previous.store_page_views) : "",
      st.data ? "Counted loads of the Boztik Stores page." : unavailable(st, "Store page views")) +
    card("Store outbound clicks", "download", st.data ? fmt(st.data.outbound_total) : "—", st.data && st.data.previous ? deltaHtml(st.data.outbound_total, st.data.previous.outbound_total) : "",
      st.data ? "Clicks to Redbubble, TeePublic and Ko-fi. <b>Clicks, not sales.</b>" : unavailable(st, "Store clicks")) +
    card("Users &amp; engagement", "alert", "Not connected", "", "Needs GA4. Never estimated, never shown as zero.", "cc-kpi-val--text");
}

function renderStandout() {
  const host = $("cc-standout-list");
  if (!host) return;
  const items = buildObservations(model);
  if (!items.length) { host.innerHTML = `<li class="cc-empty">Not enough recorded activity in this period to point at anything.</li>`; return; }
  host.innerHTML = items.slice(0, 7).map(o =>
    `<li><span class="cc-standout-tag is-${o.area}">${o.area === "deliver" ? "Deliver" : "Website"}</span><span>${escapeHtml(o.text)}</span></li>`).join("");
}

function renderTrafficSources() {
  const host = $("cc-traffic-sources");
  if (!host) return;
  const gate = sectionGate("traffic", "Traffic sources");
  if (gate) { host.innerHTML = gate; return; }
  const data = sec.traffic.data;
  const rows = data.sources.map(r => ({ ...r, share: pct1(r.visits, data.total) }));
  const bar = data.total > 0
    ? `<div class="cc-srcbar" role="img" aria-label="Share of recorded visits by source">${rows.filter(r => r.visits > 0).map(r => `<span class="cc-src cc-src-${r.source}" style="width:${r.share}%" title="${escapeHtml(SRC_LABELS[r.source])}: ${r.share}%"></span>`).join("")}</div>` : "";
  const tableRows = rows.map(r => `<tr><th scope="row"><i class="cc-swatch cc-src cc-src-${r.source}" aria-hidden="true"></i>${escapeHtml(SRC_LABELS[r.source] || r.source)}</th><td class="num">${fmt(r.visits)}</td><td class="num">${data.total ? `${r.share}%` : "—"}</td></tr>`).join("");
  const campaigns = data.campaigns?.length
    ? `<h3 class="cc-subhead">UTM campaigns</h3><div class="cc-table-wrap"><table class="cc-table"><caption class="cc-sr">Top UTM combinations in the selected period</caption><thead><tr><th scope="col">Campaign</th><th scope="col">Source / medium</th><th scope="col" class="num">Visits</th></tr></thead><tbody>${data.campaigns.map(r =>
      `<tr><th scope="row">${escapeHtml(r.utm_campaign || "—")}</th><td>${escapeHtml([r.utm_source, r.utm_medium].filter(Boolean).join(" / ") || "—")}</td><td class="num">${fmt(r.visits)}</td></tr>`).join("")}</tbody></table></div>` : "";

  // Missing data and zero activity are different things.
  let note = "";
  const neverStarted = sec.health.data?.collectors?.attribution?.status === "no_data_yet" || (!data.data_since && data.total === 0);
  if (data.total === 0 && neverStarted) note = `<p class="cc-note cc-note--warn" role="status">${icon("alert")}<span><strong>No source has ever been recorded.</strong> Every count below is zero because nothing was collected, not because nobody visited. Collection resumes once the fixed tracker reaches visitors; earlier visits cannot be recovered and are not estimated.</span></p>`;
  else if (data.data_since && data.period.key !== "all" && model?.range?.since && data.data_since > model.range.since) note = `<p class="cc-note cc-note--info" role="status">${icon("info")}<span>Source recording began on <strong>${day(data.data_since)}</strong>. Days before that in this period have no source data (not zero visits).</span></p>`;
  else if (data.total === 0) note = `<p class="cc-note cc-note--info" role="status">${icon("info")}<span>Collection is running, and no visit was recorded in this period.</span></p>`;

  host.innerHTML = `${staleNote("traffic", "Traffic sources")}${note}
    <p class="cc-card-desc">Recorded visits: <strong>${fmt(data.total)}</strong> · ${escapeHtml(data.period.since ? `${data.period.since} → ${data.period.until}` : `through ${data.period.until}`)} · percentages use recorded visits as the denominator.</p>
    ${bar}
    <div class="cc-table-wrap"><table class="cc-table"><caption class="cc-sr">Visits by traffic source and share of total</caption><thead><tr><th scope="col">Source</th><th scope="col" class="num">Visits</th><th scope="col" class="num">Share</th></tr></thead><tbody>${tableRows}</tbody></table></div>
    ${campaigns}
    <p class="cc-fineprint">Classification is conservative: a visit with no referrer is <strong>Direct / unknown</strong>, never “verified direct” (privacy settings, apps and bookmarks all hide the referrer). “Organic search” needs a recognised search engine <em>and</em> a query signal. Referrers and UTM values are supplied by the browser and can be missing or spoofed, so this is an estimate. Internal navigation is not a source.</p>`;
}

function renderPages() {
  const host = $("cc-site-pages");
  if (!host) return;
  const w = model.website;
  if (!w.available) { host.innerHTML = `<p class="cc-empty cc-empty--error" role="alert">Website page views could not be loaded. ${retryBtn("all")}</p>`; return; }
  const flow = sec.flow.data;
  const fp = new Map((flow?.pages || []).map(p => [p.page, p]));
  const byKey = new Map(w.pages.map(p => [p.page, p]));
  const rows = [...KEY_PAGES.filter(k => !byKey.has(k)).map(k => ({ page: k, label: PAGE_LABELS[k], views: 0, prev: null })), ...w.pages];
  rows.sort((a, b) => b.views - a.views || (KEY_PAGES.indexOf(a.page) + 1 || 99) - (KEY_PAGES.indexOf(b.page) + 1 || 99));
  const max = Math.max(1, ...rows.map(r => r.views));
  const cell = (r, f) => {
    if (!flow) return `<span class="cc-muted" title="Visitor-flow data could not be loaded">n/a</span>`;
    return fmt(f);
  };
  const coverage = r => {
    if (!r.views) return `<span class="cc-muted">No views counted</span>`;
    const p = fp.get(r.page);
    if (!flow || !p || p.coverage_pct === null) return `<span class="cc-muted">—</span>`;
    const cls = p.coverage_pct >= 90 ? "is-ok" : p.coverage_pct >= 50 ? "is-warn" : "is-bad";
    return `<span class="cc-cov ${cls}" title="${fmt(p.session_events)} of ${fmt(p.views)} counted views also have a stored path event">${p.coverage_pct}%</span>`;
  };
  host.innerHTML = `<div class="cc-table-wrap"><table class="cc-table cc-table--wide">
      <caption class="cc-sr">Public website pages ranked by counted page views, with entrances, exits and tracking coverage</caption>
      <thead><tr><th scope="col">Page</th><th scope="col">Page views</th><th scope="col" class="num">Share</th><th scope="col" class="num">vs previous</th><th scope="col" class="num">Entrances</th><th scope="col" class="num">Exits</th><th scope="col" class="num">Path coverage</th></tr></thead>
      <tbody>${rows.map(r => { const f = fp.get(r.page); return `<tr><th scope="row">${escapeHtml(r.label || PAGE_LABELS[r.page] || r.page)}</th>
        <td>${r.views ? `<div class="cc-inline-bar"><span style="width:${Math.round((r.views / max) * 100)}%"></span><b>${fmt(r.views)}</b></div>` : `<span class="cc-muted">No views counted</span>`}</td>
        <td class="num">${r.views ? `${pctOf(r.views, w.total)}%` : "—"}</td>
        <td class="num">${rowChange(r.views, model.previous ? (r.prev ?? 0) : null)}</td>
        <td class="num">${cell(r, f?.entrances ?? 0)}</td><td class="num">${cell(r, f?.exits ?? 0)}</td><td class="num">${coverage(r)}</td></tr>`; }).join("")}</tbody></table></div>
    <p class="cc-fineprint">Page views are loads counted by Boztik's own counter${w.dataSince ? ` since ${escapeHtml(w.dataSince)}` : ""} — not unique people; reloads count again. <strong>Entrances</strong> and <strong>Exits</strong> come from stored visitor-path events (first / last recorded page of a visit). <strong>Path coverage</strong> is the share of this page's counted views that also have a stored path event: below 100% means those views cannot appear in journeys (older data, blocked cookies, or a collection gap). Privacy and Terms are intentionally not counted. Visitors who send Do Not Track / Global Privacy Control are never counted. Views from before the path/attribution tracker existed are not back-filled.</p>`;
}

function renderFlow() {
  const host = $("cc-visitor-flow");
  if (!host) return;
  const gate = sectionGate("flow", "Visitor flow");
  if (gate) { host.innerHTML = gate; return; }
  const f = sec.flow.data;
  const how = `<details class="cc-ga4-how"><summary>How paths are calculated</summary>
      <ol><li>Each counted page load stores one anonymous event: a random cookie id, the time, and the page. No IP, name, email or fingerprint.</li>
      <li>A cookie lasts up to 180 days, so it is split into <strong>visits</strong>: a new visit starts after ${fmt(f.visit_gap_minutes)} minutes without a page view.</li>
      <li>Reloading the same page in a row counts as one step. The <strong>entry</strong> is a visit's first page, the <strong>exit</strong> is its last <em>recorded</em> page.</li>
      <li>Everything here is counted from real stored events in the period. Nothing is inferred from totals, and visitors who send Do Not Track are absent entirely.</li></ol></details>`;
  const head = `<div class="cc-flow-stats"><span><b>${fmt(f.visits)}</b> visits</span><span><b>${fmt(f.multi_page_visits)}</b> multi-page (${f.visits ? pct1(f.multi_page_visits, f.visits) : 0}%)</span><span><b>${fmt(f.single_page_visits)}</b> single-page</span><span><b>${f.session_coverage_pct === null ? "—" : `${f.session_coverage_pct}%`}</b> of counted views have path data</span></div>`;
  if (f.status === "no_events") {
    const msg = f.reason === "page_views_without_session_events"
      ? `<strong>Page views were counted (${fmt(f.page_views_in_period)}) but no visitor-path event was stored.</strong> That points to broken or not-yet-working path collection for this period, not to an absence of visitors. Paths cannot be reported until events arrive${f.session_data_since ? `; the first path event on record is ${day(f.session_data_since)}` : "; none has ever been stored"}.`
      : `No page views were counted in this period, so there are no paths to show.`;
    host.innerHTML = `${staleNote("flow", "Visitor flow")}<p class="cc-note cc-note--${f.reason === "page_views_without_session_events" ? "warn" : "info"}" role="status">${icon(f.reason === "page_views_without_session_events" ? "alert" : "info")}<span>${msg}</span></p>${how}`;
    return;
  }
  const banner = f.status === "limited"
    ? `<p class="cc-note cc-note--warn" role="status">${icon("alert")}<span><strong>Small sample.</strong> Only ${fmt(f.visits)} recorded visit${f.visits === 1 ? "" : "s"} (below ${fmt(f.min_visits)}). Treat these as anecdotes, not patterns.</span></p>` : "";
  const rank = (items, labelFn, total) => items.length
    ? `<ol class="cc-ranklist">${items.slice(0, 6).map(i => `<li><span>${labelFn(i)}</span><b>${fmt(i.visits)}</b><small>${total ? `${pct1(i.visits, total)}%` : ""}</small></li>`).join("")}</ol>` : `<p class="cc-muted">None recorded.</p>`;
  const transitions = f.transitions.length
    ? `<div class="cc-table-wrap"><table class="cc-table"><caption class="cc-sr">Most common page-to-page steps</caption><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col" class="num">Visits</th><th scope="col" class="num">Share of multi-page visits</th></tr></thead><tbody>${f.transitions.slice(0, 10).map(t =>
      `<tr><th scope="row">${pageLabel(t.from)}</th><td>${pageLabel(t.to)}</td><td class="num">${fmt(t.visits)}</td><td class="num">${pct1(t.visits, f.multi_page_visits)}%</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="cc-muted">No visit has moved between pages yet.</p>`;
  const journeys = f.journeys.length
    ? `<ol class="cc-flow-list">${f.journeys.slice(0, 6).map(j => `<li><span class="cc-flow-path">${j.path.map(pageLabel).join(" → ")}${j.truncated ? " → …" : ""}</span><span class="cc-flow-sessions">${fmt(j.visits)} visit${j.visits === 1 ? "" : "s"}</span></li>`).join("")}</ol>`
    : `<p class="cc-muted">No multi-page journey recorded yet.</p>`;
  // Movement into the destinations the business cares about (direct steps, one per distinct from→to per visit).
  const DEST = ["guides", "tools", "stores", "services", "contact", "toolkit", "portfolio"];
  const into = DEST.map(d => ({ page: d, visits: f.transitions.filter(t => t.to === d).reduce((n, t) => n + t.visits, 0) })).filter(x => x.visits > 0).sort((a, b) => b.visits - a.visits);
  host.innerHTML = `${staleNote("flow", "Visitor flow")}${banner}${head}
    <div class="cc-flow-cols">
      <div class="cc-flow-col"><h3 class="cc-subhead">Entry pages</h3>${rank(f.entries, i => pageLabel(i.page), f.visits)}<p class="cc-fineprint">Where visits began (share of all visits).</p></div>
      <div class="cc-flow-col"><h3 class="cc-subhead">Exit pages</h3>${rank(f.exits, i => pageLabel(i.page), f.visits)}<p class="cc-fineprint">Last <em>recorded</em> page of a visit — not proof the visitor left the site.</p></div>
      <div class="cc-flow-col"><h3 class="cc-subhead">Steps into key pages</h3>${rank(into, i => pageLabel(i.page), null)}<p class="cc-fineprint">Direct steps from another page into guides, tools, stores, services, contact, toolkit or portfolio.</p></div>
    </div>
    <h3 class="cc-subhead">Common page-to-page steps</h3>${transitions}
    <h3 class="cc-subhead">Frequent multi-page journeys</h3>${journeys}
    ${how}
    <p class="cc-fineprint">${fmt(f.events_used)} stored path events used${f.events_capped ? " (capped — oldest in the period kept)" : ""}. Path data starts ${day(f.session_data_since)}; older page views have none.</p>`;
}

function renderStoreClicks() {
  const host = $("cc-store-clicks");
  if (!host) return;
  const gate = sectionGate("store", "Store performance");
  if (gate) { host.innerHTML = gate; return; }
  const d = sec.store.data;
  const LABELS = { boztik_store: "Boztik Stores (internal link)", redbubble: "Redbubble", teepublic: "TeePublic", kofi: "Ko-fi shop" };
  const rows = d.by_destination.map(r => `<tr><th scope="row">${escapeHtml(LABELS[r.destination] || r.destination)}</th><td class="num">${fmt(r.clicks)}</td><td class="num">${fmt(r.store_page_clicks)}</td>
      <td class="num">${r.destination === "boztik_store" ? `<span class="cc-muted">n/a</span>` : `${ctr(r.store_page_clicks, d.store_page_views)}`}</td><td class="num">${fmt(r.unique_sessions)}</td><td>${escapeHtml(r.top_source || "—")}</td></tr>`).join("");
  const noClicks = d.total === 0;
  const clickNote = noClicks
    ? (d.data_since ? `<p class="cc-note cc-note--info" role="status">${icon("info")}<span>Click tracking is running (first event ${day(d.data_since)}); no Store click was recorded in this period.</span></p>`
      : `<p class="cc-note cc-note--warn" role="status">${icon("alert")}<span><strong>No Store click has ever been recorded.</strong> Click tracking was only just repaired, so counts start from the next visitor. Earlier clicks cannot be recovered.</span></p>`) : "";
  host.innerHTML = `${staleNote("store", "Store performance")}${clickNote}
    <div class="cc-store-kpis"><span><b>${fmt(d.store_page_views)}</b> Store page views</span><span><b>${fmt(d.product_card_clicks)}</b> product-card clicks</span><span><b>${fmt(d.outbound_total)}</b> outbound storefront clicks</span><span><b>${fmt(d.unique_sessions)}</b> anonymous sessions clicking</span></div>
    <div class="cc-table-wrap"><table class="cc-table cc-table--wide"><caption class="cc-sr">Store-link clicks by destination with click-through</caption><thead><tr><th scope="col">Destination</th><th scope="col" class="num">All clicks</th><th scope="col" class="num">From Store page</th><th scope="col" class="num">Clicks / 100 Store views</th><th scope="col" class="num">Sessions</th><th scope="col">Top placement</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="cc-fineprint"><strong>Click-through definition:</strong> clicks on that destination from the Store page ÷ Store page views in the same period × 100. Both are counted events (a visitor can view the page or click several times), so this is clicks per 100 views, not a share of people. “All clicks” also includes links on other pages (e.g. the homepage). <strong>A click is not a purchase</strong>; Redbubble, TeePublic and Ko-fi report sales only inside their own dashboards, which are not connected here.</p>`;
}

function renderActions() {
  const host = $("cc-actions");
  if (!host) return;
  const d = sec.store.data;
  const count = dest => (d ? fmt(d.by_destination.find(x => x.destination === dest)?.clicks ?? 0) : sec.store.error ? `<span class="cc-muted">failed to load</span>` : "…");
  const fp = (label, dest) => `<tr><th scope="row">${label}</th><td>First-party click counter</td><td class="num">${count(dest)}</td></tr>`;
  const ga = label => `<tr><th scope="row">${label}</th><td>GA4 <code>boztik_action</code></td><td class="num"><span class="cc-muted">Not connected</span></td></tr>`;
  host.innerHTML = `<div class="cc-table-wrap"><table class="cc-table"><caption class="cc-sr">Important actions, their data source and the count for this period</caption>
      <thead><tr><th scope="col">Action</th><th scope="col">Data source</th><th scope="col" class="num">This period</th></tr></thead><tbody>
      ${fp("Redbubble store click", "redbubble")}${fp("TeePublic store click", "teepublic")}${fp("Ko-fi shop click", "kofi")}${fp("Boztik Stores link click", "boztik_store")}
      ${ga("Chrome Web Store click")}${ga("Edge store click")}${ga("Ko-fi support / PayPal click")}${ga("Email &amp; contact page click")}${ga("Portfolio &amp; services click")}
      </tbody></table></div>
    <p class="cc-fineprint">Store-link rows are counted by Boztik's own endpoint. The remaining actions are sent only to GA4 as the event <code>boztik_action</code> (parameters <code>action</code>, <code>destination</code>, <code>position</code>, <code>page_key</code>) and cannot be read here until the GA4 Data API is connected. The two sources are never added together, so nothing is counted twice. Clicks are not sales or sign-ups.</p>`;
}

function renderHealth() {
  const host = $("cc-data-health");
  if (!host) return;
  const gate = sectionGate("health", "Data health");
  if (gate) { host.innerHTML = gate; return; }
  const h = sec.health.data;
  const STATUS = { receiving: ["is-ok", "Receiving"], quiet: ["is-warn", "Quiet (7+ days)"], no_data_yet: ["is-bad", "Never received"] };
  const pill = s => `<span class="cc-health-pill ${STATUS[s][0]}">${STATUS[s][1]}</span>`;
  const t = v => (v ? escapeHtml(formatLocalDateTime(v)) : "—");
  const c = h.collectors;
  const partial = Object.entries(sec).filter(([k, s]) => k !== "health" && s.error).map(([k]) => k);
  host.innerHTML = `${staleNote("health", "Data health")}
    <div class="cc-health-top"><span>Last event stored: <b>${t(h.last_event_at)}</b></span><span>Last dashboard refresh: <b>${escapeHtml(formatLocalDateTime(lastSuccessfulRefresh))}</b></span><span>Timezone: <b>${escapeHtml(h.timezone.label)}</b></span>${partial.length ? `<span class="cc-health-pill is-bad">Failed this refresh: ${escapeHtml(partial.join(", "))}</span>` : ""}</div>
    <div class="cc-table-wrap"><table class="cc-table"><caption class="cc-sr">Status of each analytics collector</caption><thead><tr><th scope="col">Collector</th><th scope="col">Status</th><th scope="col">Coverage starts</th><th scope="col">Last event</th></tr></thead><tbody>
      <tr><th scope="row">Page-view counter</th><td>${pill(c.page_views.status)}</td><td>${day(c.page_views.first_day)}</td><td>${day(c.page_views.last_day)} <span class="cc-muted">(day only)</span></td></tr>
      <tr><th scope="row">Visitor paths (sessions)</th><td>${pill(c.sessions.status)}</td><td>${t(c.sessions.first_at)}</td><td>${t(c.sessions.last_at)}</td></tr>
      <tr><th scope="row">Traffic-source attribution</th><td>${pill(c.attribution.status)}</td><td>${t(c.attribution.first_at)}</td><td>${t(c.attribution.last_at)}</td></tr>
      <tr><th scope="row">Store clicks</th><td>${pill(c.store_clicks.status)}</td><td>${t(c.store_clicks.first_at)}</td><td>${t(c.store_clicks.last_at)}</td></tr>
      <tr><th scope="row">GA4 Data API</th><td><span class="cc-health-pill is-bad">Not connected</span></td><td colspan="2">${escapeHtml(h.ga4.detail)}</td></tr>
    </tbody></table></div>
    <p class="cc-fineprint"><strong>Reading the status:</strong> “Quiet” means rows exist but none arrived for 7 days. The database alone cannot tell low traffic from a broken collector, so a quiet or empty collector is never called healthy or failed — check it against the page. Successful zero activity is shown as 0; a failed request is shown as an error, never as 0.</p>
    <div class="cc-flow-cols"><div class="cc-flow-col"><h3 class="cc-subhead">Known gaps</h3><ul class="cc-bullets">${h.known_gaps.map(g => `<li>${escapeHtml(g)}</li>`).join("")}</ul></div>
      <div class="cc-flow-col"><h3 class="cc-subhead">Privacy exclusions &amp; retention</h3><ul class="cc-bullets">${h.privacy_exclusions.map(g => `<li>${escapeHtml(g)}</li>`).join("")}<li>${escapeHtml(h.timezone.boundary)}</li></ul></div></div>
    <p><button type="button" class="cc-btn" data-retry="all">Refresh all data</button></p>`;
}

function renderAll() {
  const range = $("cc-site-range");
  if (range) range.textContent = rangeText(model);
  renderStatusBar();
  renderKpis();
  renderStandout();
  renderTrafficSources();
  renderPages();
  renderFlow();
  renderStoreClicks();
  renderActions();
  renderDeliver();
  renderHealth();
  const btn = $("cc-report-btn");
  if (btn) btn.disabled = false;
  if (reportOpen) fillReport(false);
}

/* -------------------------------------------------------------------- report */
function fillReport(focus) {
  const box = $("cc-report-text");
  if (!box || !model) return;
  box.value = buildReport(model, { generatedAt: new Date() });
  const panel = $("cc-report-panel");
  if (panel) panel.hidden = false;
  reportOpen = true;
  setCopyStatus("");
  if (focus) {
    box.focus();
    box.select();
    panel?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
}

function setCopyStatus(text, kind = "ok") {
  const el = $("cc-report-status");
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = text ? kind : "";
}

async function copyReport() {
  const box = $("cc-report-text");
  if (!box || !box.value) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(box.value);
    setCopyStatus("Report copied. Paste it into ChatGPT.");
  } catch {
    // Clipboard blocked (permissions, insecure context, in-app browser…). Leave the text selected so Ctrl/Cmd+C works.
    box.focus();
    box.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    setCopyStatus(ok ? "Report copied. Paste it into ChatGPT." : "Couldn't copy automatically — the report is selected, press Ctrl+C (Cmd+C on Mac).", ok ? "ok" : "warn");
  }
}

/* ---------------------------------------------------------------------- load */
const SECTION_FETCHERS = {
  traffic: () => fetchTrafficSourceSummary(periodKey),
  store: () => fetchStoreClickSummary(periodKey),
  flow: () => fetchVisitorFlow(periodKey),
  health: () => fetchAnalyticsHealth()
};
const SECTION_RENDERERS = { traffic: () => { renderKpis(); renderTrafficSources(); }, store: () => { renderKpis(); renderStoreClicks(); renderActions(); }, flow: () => { renderPages(); renderFlow(); }, health: () => { renderKpis(); renderTrafficSources(); renderHealth(); } };

/** Loads ONE independent section. A failure is recorded as an error (never as zero). Data from the SAME period is
 *  kept on a failed refresh so the page stays useful; data from another period is dropped. */
async function loadSection(name, mine, resetData) {
  const s = sec[name];
  if (resetData) s.data = null;
  s.loading = true;
  try {
    const data = await SECTION_FETCHERS[name]();
    if (mine !== loadSeq) return;
    sec[name] = { data, error: null, loading: false };
  } catch (error) {
    if (mine !== loadSeq) return;
    sec[name] = { data: s.data, error, loading: false };
  }
}

async function load(onlySection = null, { periodChanged = false } = {}) {
  const mine = ++loadSeq;
  const btn = $("cc-report-btn");
  if (btn) btn.disabled = true;
  const previousModel = model;
  lastRefreshFailed = false;
  renderNotice("");
  const names = onlySection ? [onlySection] : Object.keys(sec);
  for (const n of names) { sec[n].loading = true; if (periodChanged && n !== "health") sec[n].data = null; sec[n].error = null; }
  renderStatusBar();
  if (model) { renderTrafficSources(); renderFlow(); renderStoreClicks(); renderHealth(); renderKpis(); }

  const sectionJobs = names.map(n => loadSection(n, mine, false));
  let summary = null, fallback = null, failure = null;
  if (!onlySection) {
    try {
      summary = await fetchAnalyticsSummary(periodKey);
    } catch (error) {
      failure = error;
      // Worker not updated yet (404) or summary failed: keep the page useful with the older fixed-30-day page views.
      try { fallback = (await fetchPageAnalytics()).pages; } catch { /* reported below */ }
    }
  }
  await Promise.all(sectionJobs);
  if (mine !== loadSeq) return; // a newer period was picked while this was loading

  if (!onlySection) {
    if (!summary && !fallback) {
      model = previousModel;
      lastRefreshFailed = true;
      renderNotice(`${escapeHtml(failure?.message || "Could not load analytics.")} This is a failed request, not zero activity. <button type="button" class="cc-btn cc-btn-inline" data-retry="all">Try again</button>`, "error");
      if (!model) {
        for (const id of ["cc-site-kpis", "cc-standout-list", "cc-site-pages", "cc-site-deliver", "cc-visitor-flow", "cc-actions"]) { const el = $(id); if (el) el.innerHTML = ""; }
        renderTrafficSources(); renderStoreClicks(); renderHealth();
      } else {
        renderAll();
      }
      renderStatusBar();
      return;
    }
    model = buildModel({ periodKey, summary, fallbackPages: fallback });
    model.storeClicks = sec.store.data;
    model.pageFlow = [];
    lastSuccessfulRefresh = Date.now();
    if (model.limited) {
      renderNotice(`<strong>Limited mode.</strong> The Worker has not been updated with the analytics summary route yet (${escapeHtml(failure?.status === 404 ? "not found" : failure?.message || "request failed")}). Showing the last 30 days of website page views only; period selection, comparisons and Deliver-by-period need <code>deliver/worker-api</code> to be deployed.`, "warn");
    }
    renderAll();
  } else if (model) {
    SECTION_RENDERERS[onlySection]?.();
    renderStatusBar();
  }
}

/* ------------------------------------------------------------------- public */
function stopPeriodicRefresh() {
  if (siteAnalyticsTimer) {
    window.clearInterval(siteAnalyticsTimer);
    siteAnalyticsTimer = null;
  }
}

function startPeriodicRefresh() {
  if (document.hidden) {
    stopPeriodicRefresh();
    return;
  }
  stopPeriodicRefresh();
  siteAnalyticsTimer = window.setInterval(() => {
    if (document.hidden || siteAnalyticsRefreshInFlight) return;
    void refreshSiteAnalytics();
  }, SITE_ANALYTICS_REFRESH_MS);
}

export function initSiteAnalytics() {
  if (wired) return;
  wired = true;
  renderPeriodBar();
  $("cc-period-toolbar")?.addEventListener("click", event => {
    const b = event.target.closest("[data-period]");
    if (!b || b.dataset.period === periodKey) return;
    periodKey = b.dataset.period;
    renderPeriodBar();
    void load(null, { periodChanged: true });
  });
  // One delegated retry handler for every "Try again" button (data-retry = section name or "all").
  $("cc-site-analytics")?.addEventListener("click", event => {
    const r = event.target.closest("[data-retry]");
    if (!r) return;
    const target = r.dataset.retry;
    void (target && target !== "all" && sec[target] && model ? load(target) : load());
  });
  $("cc-report-btn")?.addEventListener("click", () => { if (model) fillReport(true); });
  $("cc-report-copy")?.addEventListener("click", () => void copyReport());
  $("cc-report-close")?.addEventListener("click", () => { const p = $("cc-report-panel"); if (p) p.hidden = true; reportOpen = false; $("cc-report-btn")?.focus(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPeriodicRefresh();
    else startPeriodicRefresh();
  });
  startPeriodicRefresh();
}

export async function refreshSiteAnalytics() {
  if (!$("cc-site-analytics")) return;
  initSiteAnalytics();
  if (siteAnalyticsRefreshInFlight) return;
  siteAnalyticsRefreshInFlight = true;
  try {
    await load();
  } finally {
    siteAnalyticsRefreshInFlight = false;
    startPeriodicRefresh();
  }
}
