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
import { fetchAnalyticsSummary, fetchPageAnalytics, fetchPageFlow, fetchStoreClickSummary, fetchWebsiteTimeseries } from "./api.js";
import { escapeHtml } from "./shared.js";
import {
  PERIODS, KEY_PAGES, PAGE_LABELS, buildModel, buildObservations, buildReport,
  fmt, pctOf, pctChange, per100, perDelivery, MIN_COMPARE_BASE
} from "./analytics-report.js";

const $ = id => document.getElementById(id);
const icon = name => `<svg class="cc-i" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
/** Per-page / per-type percentage changes below this many previous-period events are shown as "—" (too noisy). */
const MIN_ROW_BASE = 10;

let periodKey = "30d";
let model = null;
let storeClickSummary = null;
let storeClickFailure = null;
let storeClickLoading = false;
let websiteTimeseries = null;
let websiteTimeseriesFailure = null;
let websiteTimeseriesLoading = false;
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
  if (pct === 0) return `<span class="cc-delta is-flat">¬ Same as the previous period</span>`;
  return `<span class="cc-delta ${pct > 0 ? "is-up" : "is-down"}">${pct > 0 ? "²" : "¼"} ${Math.abs(pct)}% <small>vs previous period</small></span>`;
}

function rowChange(current, previous) {
  if (previous === null || previous === undefined) return `<span class="cc-muted">â€”</span>`;
  if (previous === 0 && current > 0) return `<span class="cc-delta is-up" title="No activity in the previous period">â–² from 0</span>`;
  if (previous < MIN_ROW_BASE) return `<span class="cc-muted" title="Previous period had too few events for a reliable comparison">â€”</span>`;
  const pct = pctChange(current, previous);
  if (pct === 0) return `<span class="cc-delta is-flat">â–¬ 0%</span>`;
  return `<span class="cc-delta ${pct > 0 ? "is-up" : "is-down"}">${pct > 0 ? "â–²" : "â–¼"} ${Math.abs(pct)}%</span>`;
}

const rangeText = m => {
  if (!m?.range) return m?.limited ? "Last 30 days Â· website page views only" : "";
  const cur = m.range.since ? `${m.range.since} â†’ ${m.range.until}` : "no data yet";
  return m.previous ? `${cur} Â· compared with ${m.previous.since} â†’ ${m.previous.until}` : `${cur} Â· no earlier period to compare`;
};
const flowDaysForPeriod = key => key === "7d" ? 7 : key === "90d" ? 90 : key === "all" ? 90 : 30;

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
  if (lastRefreshFailed && model) {
    host.innerHTML = `<span class="cc-status-pill is-failed">Refresh failed</span><span>Last successful refresh: ${escapeHtml(formatLocalDateTime(lastSuccessfulRefresh))}</span><span>Reporting period: ${escapeHtml(model.periodLabel || periodKey)}</span><span>Data source: ${escapeHtml(model.limited ? "Fallback: website page views only" : "Full summary endpoint")}</span>`;
    return;
  }
  let state = "loading";
  let label = "Loading";
  if (model) {
    if (model.limited) { state = "limited"; label = "Limited mode"; }
    else if (model.website?.available && model.website.total === 0 && (!model.deliver || !model.deliver.available || (model.deliver.totals.views === 0 && model.deliver.totals.downloads === 0 && model.deliver.totals.shares === 0))) {
      state = "empty"; label = "No data for this period";
    }
    else { state = "full"; label = "Full analytics"; }
  }
  const source = model?.limited ? "Fallback: website page views only" : model ? "Full summary endpoint" : "Loading";
  const period = model?.periodLabel || periodKey;
  const last = formatLocalDateTime(lastSuccessfulRefresh);
  const tsState = websiteTimeseriesLoading ? " Â· trend loading" : websiteTimeseriesFailure ? " Â· trend unavailable" : "";
  host.innerHTML = `<span class="cc-status-pill is-${state}">${escapeHtml(label)}</span><span>Last successful refresh: ${escapeHtml(last)}</span><span>Reporting period: ${escapeHtml(period)}</span><span>Data source: ${escapeHtml(source)}${escapeHtml(tsState)}</span>`;
}

function renderKpis() {
  const host = $("cc-site-kpis");
  if (!host) return;
  const w = model.website, d = model.deliver;
  const top = w.available && w.total > 0 ? w.pages[0] : null;
  const ts = websiteTimeseries || [];
  const tsTotal = ts.reduce((a, b) => a + b.views, 0);
  const tsDays = ts.length;
  const tsAvg = tsDays > 0 ? Math.round(tsTotal / tsDays) : 0;
  const card = (label, ic, value, delta, sub, cls = "") => `<article class="cc-kpi"><header><span>${label}</span>${icon(ic)}</header>
      <strong class="cc-kpi-val ${cls}">${value}</strong><p class="cc-kpi-delta">${delta}</p><p class="cc-kpi-sub">${sub}</p></article>`;
  host.innerHTML =
    card("Page views Â· website", "eye", w.available ? fmt(w.total) : "â€”", w.available ? deltaHtml(w.total, w.prevTotal) : "", `Counted page loads on the public site (first-party counter). Avg ${fmt(tsAvg)}/day over ${tsDays} day${tsDays === 1 ? "" : "s"} in range.`) +
    card("Top page", "globe", top ? escapeHtml(top.label) : "â€”", "", top ? `<b>${fmt(top.views)}</b> views Â· <b>${pctOf(top.views, w.total)}%</b> of page views` : "No page views counted in this period.", "cc-kpi-val--text") +
    card("Avg views / day", "clock", tsDays > 0 ? fmt(tsAvg) : "â€”", "", tsDays > 0 ? `Across ${tsDays} day${tsDays === 1 ? "" : "s"} in range Â· zero days with no recorded views show as 0` : "Trend unavailable") +
    card("Deliver views", "box", d.available ? fmt(d.totals.views) : "â€”", d.available && d.prevTotals ? deltaHtml(d.totals.views, d.prevTotals.views) : "", d.available ? "Deliver only (incl. PhotoshopBattles) â€” not website traffic." : "Needs the Worker update (see notice).") +
    card("Deliver downloads", "download", d.available ? fmt(d.totals.downloads) : "â€”", d.available && d.prevTotals ? deltaHtml(d.totals.downloads, d.prevTotals.downloads) : "", d.available ? `<b>${fmt(d.totals.shares)}</b> shares Â· <b>${per100(d.totals.downloads, d.totals.views)}</b> downloads per 100 views` : "â€”");
}

function renderStandout() {
  const host = $("cc-standout-list");
  if (!host) return;
  const items = buildObservations(model);
  if (!items.length) { host.innerHTML = `<li class="cc-empty">Not enough recorded activity in this period to point at anything.</li>`; return; }
  host.innerHTML = items.slice(0, 7).map(o =>
    `<li><span class="cc-standout-tag is-${o.area}">${o.area === "deliver" ? "Deliver" : "Website"}</span><span>${escapeHtml(o.text)}</span></li>`).join("");
}

/* ---------------------------------------------------------------- visitor flow */

function renderPages() {
  const host = $("cc-site-pages");
  if (!host) return;
  const w = model.website;
  if (!w.available) { host.innerHTML = `<p class="cc-empty">Website page views could not be loaded.</p>`; return; }

  const rows = [...w.pages];
  rows.sort((a, b) => b.views - a.views || (KEY_PAGES.indexOf(a.page) + 1 || 99) - (KEY_PAGES.indexOf(b.page) + 1 || 99));

  const searchInput = $("cc-page-search");
  const currentTerm = (searchInput && searchInput.value) ? searchInput.value.toLowerCase() : "";
  if (currentTerm) {
    const filtered = rows.filter(r => r.label.toLowerCase().includes(currentTerm) || r.page.toLowerCase().includes(currentTerm));
    if (filtered.length) rows.splice(0, rows.length, ...filtered); else rows.splice(0, rows.length);
  }

  const max = Math.max(1, ...rows.map(r => r.views));
  const flow = model.pageFlow || [];

  let rowsHtml = "";
  if (rows.length === 0) {
    rowsHtml = `<tr><td colspan="4" class="cc-muted">No pages match "` + escapeHtml(currentTerm) + `".</td></tr>`;
  } else {
    rowsHtml = rows.map(r => {
      const delta = rowChange(r.views, r.prev);
      const pathFlow = flow.filter(f => f.path.startsWith(r.page + " â†’") || f.path.endsWith(" â†’ " + r.page));
      const nextHint = pathFlow.length ? ` Â· most common onward: ` + escapeHtml(pathFlow.sort((a, b) => b.sessions - a.sessions)[0].path.split(" â†’ ").pop()) : "";
      return `<tr data-page="` + escapeHtml(r.page) + `" class="cc-page-row" role="button" tabindex="0" aria-label="` + escapeHtml(r.label) + `: ` + fmt(r.views) + ` views` + nextHint + `">
        <th scope="row">` + escapeHtml(r.label) + `<span class="cc-muted cc-page-key"> Â· ` + escapeHtml(r.page) + `</span></th>
        <td>` + (r.views ? `<div class="cc-inline-bar"><span style="width:` + Math.round((r.views / max) * 100) + `%"></span><b>` + fmt(r.views) + `</b></div>` : `<span class="cc-muted">No views counted</span>`) + `</td>
        <td class="num">` + (r.views ? `${pctOf(r.views, w.total)}%` : "â€”") + `</td>
        <td class="num">` + delta + `</td>
      </tr>`;
    }).join("");
  }

  host.innerHTML = `
    <div class="cc-page-controls">
      <label class="cc-field-label"><span class="cc-i" aria-hidden="true"><use href="#i-search"/></span><span class="cc-sr">Search pages</span><input type="search" id="cc-page-search" class="cc-input" placeholder="Search pagesâ€¦" value="` + escapeHtml(currentTerm) + `" aria-label="Filter pages by name or path"/></label>
      <span class="cc-muted cc-page-count">` + rows.length + ` page` + (rows.length === 1 ? "" : "s") + (currentTerm ? ` matching "` + escapeHtml(currentTerm) + `"` : "") + `</span>
    </div>
    <div class="cc-table-wrap"><table class="cc-table">
      <caption class="cc-sr">Public website pages ranked by counted page views for the selected period</caption>
      <thead><tr><th scope="col">Page</th><th scope="col" class="num">Page views</th><th scope="col" class="num">Share</th><th scope="col" class="num">vs previous</th></tr></thead>
      <tbody>` + rowsHtml + `</tbody></table></div>
    <p class="cc-fineprint">Page loads counted by Boztik's own counter` + (w.dataSince ? ` since ` + escapeHtml(w.dataSince) : "") + ` â€” not unique people, and visitors who send Do Not Track / Global Privacy Control are not counted. Entrances, engagement and onward clicks per page exist only in GA4 and are not shown here. Creative Toolkit views are only recorded once the Worker update is deployed. Rows are clickable to inspect visitor paths.</p>
  `;
  wirePageRows();
}

function wirePageRows() {
  document.querySelectorAll(".cc-page-row").forEach(row => {
    const onEnter = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPageDetail(row.dataset.page); } };
    row.addEventListener("click", () => openPageDetail(row.dataset.page));
    row.addEventListener("keydown", onEnter);
  });
}

function openPageDetail(pageKey) {
  const flow = (model && model.pageFlow) || [];
  const fromThis = flow.filter(f => f.path.startsWith(pageKey + " â†’")).sort((a, b) => b.sessions - a.sessions);
  const toThis = flow.filter(f => f.path.endsWith(" â†’ " + pageKey)).sort((a, b) => b.sessions - a.sessions);
  const detail = $("cc-page-detail");
  if (!detail) return;
  const w = model.website;
  const row = w.pages.find(p => p.page === pageKey);
  const label = PAGE_LABELS[pageKey] || pageKey;
  detail.innerHTML = `
    <h3 class="cc-subhead">` + escapeHtml(label) + `</h3>
    <p class="cc-muted">` + escapeHtml(pageKey) + ` â€” ` + fmt(row ? row.views : 0) + ` counted page view` + (row && row.views !== 1 ? "s" : "") + ` in this period.</p>
    ` + (fromThis.length ? `<h4 class="cc-subhead--small">Visitors most often go <b>from</b> this page to:</h4><ul class="cc-flow-list">` + fromThis.slice(0, 5).map(f => `<li><span class="cc-flow-path">` + escapeHtml(f.path.split(" â†’ ").pop()) + `</span><span class="cc-flow-sessions">` + fmt(f.sessions) + ` sessions</span></li>`).join("") + `</ul>` : `<p class="cc-muted">No recorded onward transitions from this page.</p>`) + `
    ` + (toThis.length ? `<h4 class="cc-subhead--small">Visitors most often arrive <b>at</b> this page from:</h4><ul class="cc-flow-list">` + toThis.slice(0, 5).map(f => `<li><span class="cc-flow-path">` + escapeHtml(f.path.split(" â†’ ").shift()) + `</span><span class="cc-flow-sessions">` + fmt(f.sessions) + ` sessions</span></li>`).join("") + `</ul>` : `<p class="cc-muted">No recorded incoming transitions to this page.</p>`) + `
  </div>`;
  detail.hidden = false;
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}


function renderDeliver() {
  const host = $("cc-site-deliver");
  if (!host) return;
  const d = model.deliver;
  if (!d.available) {
    host.innerHTML = `<p class="cc-empty">Deliver figures for a chosen period need the updated Worker. The all-time table below (â€œWhere the attention goesâ€) still works.</p>`;
    return;
  }
  const shown = d.types.filter(t => t.type !== "deleted" || t.views || t.downloads || t.shares);
  const t = d.totals;
  const row = x => `<tr><th scope="row">${escapeHtml(x.label)}${x.type === "photoshop_battles" ? ` <span class="cc-badge">Reddit</span>` : ""}</th>
      <td class="num">${fmt(x.views)}</td><td class="num">${x.type === "photoshop_battles" ? `<span class="cc-muted" title="PhotoshopBattles images are public direct links">n/a</span>` : fmt(x.downloads)}</td><td class="num">${fmt(x.shares)}</td>
      <td class="num">${x.type === "photoshop_battles" ? "â€”" : per100(x.downloads, x.views)}</td><td class="num">${per100(x.shares, x.views)}</td>
      <td class="num">${perDelivery(x.views, x.active)}</td><td class="num">${rowChange(x.views, x.prevViews)}</td></tr>`;
  host.innerHTML = `<div class="cc-table-wrap"><table class="cc-table cc-table--wide">
      <caption class="cc-sr">Deliver views, downloads and shares by delivery type for the selected period</caption>
      <thead><tr><th scope="col">Delivery type</th><th scope="col" class="num">Views</th><th scope="col" class="num">Downloads</th><th scope="col" class="num">Shares</th>
        <th scope="col" class="num">Downloads / 100 views</th><th scope="col" class="num">Shares / 100 views</th><th scope="col" class="num">Views / active delivery</th><th scope="col" class="num">Views vs previous</th></tr></thead>
      <tbody>${shown.map(row).join("")}
        <tr class="cc-total"><th scope="row">All Deliver types</th><td class="num">${fmt(t.views)}</td><td class="num">${fmt(t.downloads)}</td><td class="num">${fmt(t.shares)}</td>
          <td class="num">${per100(t.downloads, t.views)}</td><td class="num">${per100(t.shares, t.views)}</td><td class="num">${perDelivery(t.views, t.active)}</td><td class="num">${d.prevTotals ? rowChange(t.views, d.prevTotals.views) : `<span class="cc-muted">â€”</span>`}</td></tr></tbody></table></div>
    <p class="cc-fineprint">Deliver's own counters â€” never added to website page views and never sent to GA4. Views count every load including repeats. â€œActive deliveryâ€ = a delivery with at least one view or download in the period. PhotoshopBattles images are public direct links, so they register views but no downloads. Shares include completed copies and opened WhatsApp / Facebook / X / Reddit sheets. Deleted deliveries keep their history but no longer have a type.</p>`;
}

function renderStoreClicks() {
  const host = $("cc-store-clicks");
  if (!host) return;
  if (storeClickLoading && !storeClickSummary) { host.innerHTML = `<p class="cc-muted">Loading Store activityâ€¦</p>`; return; }
  if (storeClickFailure || !storeClickSummary) {
    host.innerHTML = `<p class="cc-empty">Store activity could not be loaded. <button type="button" class="cc-btn cc-btn-inline" data-retry>Try again</button></p>`;
    return;
  }
  const labels = { boztik_store: "Boztik Stores", redbubble: "Redbubble", teepublic: "TeePublic", kofi: "Ko-fi Wallpapers" };
  const data = storeClickSummary;
  const rows = data.by_destination.map(row => `<tr><th scope="row">${labels[row.destination] || row.destination}</th><td class="num">${fmt(row.clicks)}</td><td class="num">${fmt(row.unique_sessions)}</td><td>${escapeHtml(row.top_source || "â€”")}</td></tr>`).join("");
  const range = data.period.since ? `${data.period.since} â†’ ${data.period.until}` : `All recorded activity through ${data.period.until}`;
  host.innerHTML = `<div class="cc-store-kpis"><span><b>${fmt(data.total)}</b> tracked clicks</span><span><b>${fmt(data.unique_sessions)}</b> anonymous sessions</span></div>
    <div class="cc-table-wrap"><table class="cc-table"><caption class="cc-sr">Store-link clicks by destination</caption><thead><tr><th scope="col">Destination</th><th scope="col" class="num">Clicks</th><th scope="col" class="num">Sessions</th><th scope="col">Top placement</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="cc-fineprint">${escapeHtml(range)}. A click records an activation of a Store link, not a completed external purchase. Data begins ${escapeHtml(data.data_since || "when the first click is recorded")}.</p>`;
}

/* ----------------------------------------------------------- timeseries chart */
function renderTimeseriesChart() {
  const host = $("cc-site-timeseries");
  if (!host) return;
  const ts = websiteTimeseries || [];
  if (websiteTimeseriesLoading && websiteTimeseries === null) {
    host.innerHTML = `<p class="cc-muted">Loading trendâ€¦</p>`; return;
  }
  if (websiteTimeseriesFailure || (websiteTimeseries === null && !model)) {
    host.innerHTML = `<p class="cc-empty">Trend data could not be loaded. <button type="button" class="cc-btn cc-btn-inline" data-retry>Try again</button></p>`; return;
  }
  if (!ts.length) {
    host.innerHTML = `<p class="cc-empty">No page-view trend data for this period.</p>`; return;
  }
  const W = 640, H = 160, L = 36, R = 10, T = 12, B = 30;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...ts.map(p => p.views));
  const niceMax = max <= 5 ? max : Math.ceil(max / 10) * 10;
  const n = ts.length;
  const slot = iw / Math.max(1, n - 1 || 1);
  const y = v => T + ih - (v / niceMax) * ih;
  const cx = i => L + i * slot;
  const grid = [0, 0.5, 1].map(f => {
    const v = Math.round(niceMax * f);
    return `<line class="cc-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="cc-axis" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  }).join("");
  const bars = ts.map((p, i) => {
    const h = Math.max(p.views ? 2 : 0, (p.views / niceMax) * ih);
    const x = cx(i) - Math.max(2, slot * 0.3) / 2;
    return `<rect class="cc-bar" x="${x.toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${Math.max(2, slot * 0.3).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${escapeHtml(p.day)} â€” ${p.views} views</title></rect>`;
  }).join("");
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i && ts[v]);
  const xs = ticks.map(i => `<text class="cc-axis" x="${cx(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${escapeHtml(shortDayLabel(ts[i].day))}</text>`).join("");
  const total = ts.reduce((a, b) => a + b.views, 0);
  const active = ts.filter(p => p.views > 0).length;
  const peak = ts.reduce((b, p) => (p.views > (b?.views ?? -1) ? p : b), null);
  const summary = `${fmt(total)} page views over ${n} days Â· ${active} day${active === 1 ? "" : "s"} with activity${peak ? ` Â· busiest: ${escapeHtml(peak.day)} (${fmt(peak.views)})` : ""}.`;
  host.innerHTML = `<div class="cc-chart-wrap"><svg class="cc-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(summary)}">${grid}${bars}${xs}</svg></div><p class="cc-fineprint">${summary}</p>`;
}

function shortDayLabel(day) {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return day;
  return `${new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
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
    // Clipboard blocked (permissions, insecure context, in-app browserâ€¦). Leave the text selected so Ctrl/Cmd+C works.
    box.focus();
    box.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    setCopyStatus(ok ? "Report copied. Paste it into ChatGPT." : "Couldn't copy automatically â€” the report is selected, press Ctrl+C (Cmd+C on Mac).", ok ? "ok" : "warn");
  }
}

/* ------------------------------------------------------------- visitor flow */
function renderVisitorFlow() {
  const host = $("cc-site-flow");
  if (!host) return;
  const flow = model?.pageFlow || [];
  if (websiteTimeseriesLoading && websiteTimeseries === null) {
    host.innerHTML = `<p class="cc-muted">Loading flow data…</p>`; return;
  }
  if (flow.length === 0) {
    host.innerHTML = `<p class="cc-empty">No page-flow data for this period.</p>`; return;
  }
  const rows = flow.map(([path, sessions]) => {
    const pages = path.split(" → ");
    return `<tr><td class="cc-flow-path">${escapeHtml(pages.map(p => `<span class="cc-flow-page">${escapeHtml(p)}</span>`).join(" "))}</td><td class="num cc-flow-sessions">${fmt(sessions)}</td></tr>`;
  }).join("");
  host.innerHTML = `
    <div class="cc-table-wrap"><table class="cc-table"><caption class="cc-sr">Visitor page-flow sequence</caption><thead>
      <tr><th scope="col">Sequence</th><th scope="col" class="num">Sessions</th>
    </thead><tbody>${rows}</tbody></table></div>
  `;
}

/* ------------------------------------------------------------- visitor flow */
function renderAll() {
  const range = $("cc-site-range");
  if (range) range.textContent = rangeText(model);
  renderStatusBar();
  renderKpis();
  renderStandout();
  renderTimeseriesChart();
  renderVisitorFlow();
  renderPages();
  renderDeliver();

  renderStoreClicks();
  const btn = $("cc-report-btn");
  if (btn) btn.disabled = false;
  if (reportOpen) fillReport(false);
}

/* ---------------------------------------------------------------------- load */
async function load() {
  const mine = ++loadSeq;
  const btn = $("cc-report-btn");
  if (btn) btn.disabled = true;
  const previousModel = model;
  lastRefreshFailed = false;
  renderNotice("");
  // Keep the last known-good figures while a refresh is in progress or fails; only clear them when nothing useful is available.
  renderStatusBar();
  let summary = null, fallback = null, failure = null;
  let pageFlow = [];
  let websiteTimeseriesResult = null, websiteTimeseriesFailure = null;
  websiteTimeseriesLoading = true;
  let storeResult = null, storeFailure = null;
  storeClickLoading = true;

  renderStoreClicks();
  const storeRequest = fetchStoreClickSummary(periodKey).then(value => { storeResult = value; }).catch(error => { storeFailure = error; });
  try {
    summary = await fetchAnalyticsSummary(periodKey);
  } catch (error) {
    failure = error;
    // Worker not updated yet (404) or summary failed: keep the page useful with the older fixed-30-day page views.
    try { fallback = (await fetchPageAnalytics()).pages; } catch { /* reported below */ }
  }
  try {
    pageFlow = (await fetchPageFlow(flowDaysForPeriod(periodKey))).paths || [];
  } catch {
    pageFlow = [];
  }
  try {
    websiteTimeseriesResult = (await fetchWebsiteTimeseries(periodKey === "7d" ? "7" : "30")).series;
  } catch (error) {
    websiteTimeseriesFailure = error;
  }
  await storeRequest;
  websiteTimeseries = websiteTimeseriesResult;
  websiteTimeseriesLoading = false;
  if (mine !== loadSeq) return; // a newer period was picked while this was loading
  storeClickSummary = storeResult;
  storeClickFailure = storeFailure;
  storeClickLoading = false;

  if (!summary && !fallback) {
    model = previousModel;
    lastRefreshFailed = true;
    renderNotice(`${escapeHtml(failure?.message || "Could not load analytics.")} <button type="button" class="cc-btn cc-btn-inline" data-retry>Try again</button>`, "error");
    if (!model) {
      for (const id of ["cc-site-kpis", "cc-standout-list", "cc-site-pages", "cc-site-deliver", "cc-store-clicks"]) { const el = $(id); if (el) el.innerHTML = ""; }

    } else {
      renderAll();
    }
    renderStatusBar();
    return;
  }
  model = buildModel({ periodKey, summary, fallbackPages: fallback, websiteTimeseries, websiteTimeseriesLoading });
  model.pageFlow = pageFlow;
  model.storeClicks = storeClickSummary;
  lastSuccessfulRefresh = Date.now();
  lastRefreshFailed = false;
  if (model.limited) {
    renderNotice(`<strong>Limited mode.</strong> The Worker has not been updated with the analytics summary route yet (${escapeHtml(failure?.status === 404 ? "not found" : failure?.message || "request failed")}). Showing the last 30 days of website page views only; period selection, comparisons and Deliver-by-period need <code>deliver/worker-api</code> to be deployed.`, "warn");
  }
  renderAll();
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
    void load();
  });
  $("cc-site-notice")?.addEventListener("click", event => { if (event.target.closest("[data-retry]")) void load(); });
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
