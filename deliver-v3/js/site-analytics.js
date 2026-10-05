// Boztik Command Centre → Analytics: the "decision dashboard" block at the top of the Analytics tab.
//
// Data: ONE read-only call to the Worker's /api/admin/analytics/summary (same admin session as every other
// Command Centre call). If the Worker has not been updated yet, it falls back to the older /analytics/pages
// (fixed 30 days) so the page still works, clearly labelled as limited.
//
// Nothing here is estimated. GA4-only measures (users, sessions, traffic sources, engagement, clicks) cannot be
// read from here and are shown as "not connected", never as zero. Deliver analytics are rendered in their own
// section and are never added to website numbers.
import { fetchAnalyticsSummary, fetchPageAnalytics } from "./api.js";
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
let loadSeq = 0;
let wired = false;
let reportOpen = false;

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

function renderKpis() {
  const host = $("cc-site-kpis");
  if (!host) return;
  const w = model.website, d = model.deliver;
  const top = w.available && w.total > 0 ? w.pages[0] : null;
  const card = (label, ic, value, delta, sub, cls = "") => `<article class="cc-kpi"><header><span>${label}</span>${icon(ic)}</header>
      <strong class="cc-kpi-val ${cls}">${value}</strong><p class="cc-kpi-delta">${delta}</p><p class="cc-kpi-sub">${sub}</p></article>`;
  host.innerHTML =
    card("Page views · website", "eye", w.available ? fmt(w.total) : "—", w.available ? deltaHtml(w.total, w.prevTotal) : "", "Counted page loads on the public site (first-party counter).") +
    card("Top page", "globe", top ? escapeHtml(top.label) : "—", "", top ? `<b>${fmt(top.views)}</b> views · <b>${pctOf(top.views, w.total)}%</b> of page views` : "No page views counted in this period.", "cc-kpi-val--text") +
    card("Deliver views", "box", d.available ? fmt(d.totals.views) : "—", d.available && d.prevTotals ? deltaHtml(d.totals.views, d.prevTotals.views) : "", d.available ? "Deliver only (incl. PhotoshopBattles) — not website traffic." : "Needs the Worker update (see notice).") +
    card("Deliver downloads", "download", d.available ? fmt(d.totals.downloads) : "—", d.available && d.prevTotals ? deltaHtml(d.totals.downloads, d.prevTotals.downloads) : "", d.available ? `<b>${fmt(d.totals.shares)}</b> shares · <b>${per100(d.totals.downloads, d.totals.views)}</b> downloads per 100 views` : "—");
}

function renderStandout() {
  const host = $("cc-standout-list");
  if (!host) return;
  const items = buildObservations(model);
  if (!items.length) { host.innerHTML = `<li class="cc-empty">Not enough recorded activity in this period to point at anything.</li>`; return; }
  host.innerHTML = items.slice(0, 7).map(o =>
    `<li><span class="cc-standout-tag is-${o.area}">${o.area === "deliver" ? "Deliver" : "Website"}</span><span>${escapeHtml(o.text)}</span></li>`).join("");
}

function renderPages() {
  const host = $("cc-site-pages");
  if (!host) return;
  const w = model.website;
  if (!w.available) { host.innerHTML = `<p class="cc-empty">Website page views could not be loaded.</p>`; return; }
  const byKey = new Map(w.pages.map(p => [p.page, p]));
  const rows = [...KEY_PAGES.filter(k => !byKey.has(k)).map(k => ({ page: k, label: PAGE_LABELS[k], views: 0, prev: null })), ...w.pages];
  rows.sort((a, b) => b.views - a.views || (KEY_PAGES.indexOf(a.page) + 1 || 99) - (KEY_PAGES.indexOf(b.page) + 1 || 99));
  const max = Math.max(1, ...rows.map(r => r.views));
  host.innerHTML = `<div class="cc-table-wrap"><table class="cc-table">
      <caption class="cc-sr">Public website pages ranked by counted page views</caption>
      <thead><tr><th scope="col">Page</th><th scope="col">Page views</th><th scope="col" class="num">Share</th><th scope="col" class="num">vs previous</th></tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row">${escapeHtml(r.label)}</th>
        <td>${r.views ? `<div class="cc-inline-bar"><span style="width:${Math.round((r.views / max) * 100)}%"></span><b>${fmt(r.views)}</b></div>` : `<span class="cc-muted">No views counted</span>`}</td>
        <td class="num">${r.views ? `${pctOf(r.views, w.total)}%` : "—"}</td>
        <td class="num">${rowChange(r.views, model.previous ? (r.prev ?? 0) : null)}</td></tr>`).join("")}</tbody></table></div>
    <p class="cc-fineprint">Page loads counted by Boztik's own counter${w.dataSince ? ` since ${escapeHtml(w.dataSince)}` : ""} — not unique people, and visitors who send Do Not Track / Global Privacy Control are not counted. Entrances, engagement and onward clicks per page exist only in GA4 and are not shown here. Creative Toolkit views are only recorded once the Worker update is deployed.</p>`;
}

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

function renderAll() {
  const range = $("cc-site-range");
  if (range) range.textContent = rangeText(model);
  renderKpis();
  renderStandout();
  renderPages();
  renderDeliver();
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
async function load() {
  const mine = ++loadSeq;
  const btn = $("cc-report-btn");
  if (btn) btn.disabled = true;
  renderNotice("");
  let summary = null, fallback = null, failure = null;
  try {
    summary = await fetchAnalyticsSummary(periodKey);
  } catch (error) {
    failure = error;
    // Worker not updated yet (404) or summary failed: keep the page useful with the older fixed-30-day page views.
    try { fallback = (await fetchPageAnalytics()).pages; } catch { /* reported below */ }
  }
  if (mine !== loadSeq) return; // a newer period was picked while this was loading

  if (!summary && !fallback) {
    model = null;
    renderNotice(`${escapeHtml(failure?.message || "Could not load analytics.")} <button type="button" class="cc-btn cc-btn-inline" data-retry>Try again</button>`, "error");
    for (const id of ["cc-site-kpis", "cc-standout-list", "cc-site-pages", "cc-site-deliver"]) { const el = $(id); if (el) el.innerHTML = ""; }
    return;
  }
  model = buildModel({ periodKey, summary, fallbackPages: fallback });
  if (model.limited) {
    renderNotice(`<strong>Limited mode.</strong> The Worker has not been updated with the analytics summary route yet (${escapeHtml(failure?.status === 404 ? "not found" : failure?.message || "request failed")}). Showing the last 30 days of website page views only; period selection, comparisons and Deliver-by-period need <code>deliver/worker-api</code> to be deployed.`, "warn");
  }
  renderAll();
}

/* ------------------------------------------------------------------- public */
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
}

export async function refreshSiteAnalytics() {
  if (!$("cc-site-analytics")) return;
  initSiteAnalytics();
  await load();
}
