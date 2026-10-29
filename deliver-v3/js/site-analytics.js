// Boztik Command Centre → Analytics tab (orchestrator).
//
// Reads are admin-authenticated GETs to the Worker through analytics/client.js. Nothing here writes data.
// Rules this file enforces:
//   * every request carries an AbortSignal and a sequence token: an older selection can never overwrite a newer one
//   * a response is only shown if the Worker answered for the window that was asked for (an older Worker silently
//     falls back to 30 days for ranges it does not know; that is reported, not displayed as if it were correct)
//   * each section has its own loading / error / "Worker needs updating" state and a retry; one failing section
//     never blanks the others
//   * figures for a DIFFERENT range are never left on screen while a new range loads
//   * the report, CSV and screen all read the same view-model (analytics/model.js)
// The public exports (initSiteAnalytics, refreshSiteAnalytics) are unchanged: command-centre.js calls them as before.
import { fetchPageAnalytics } from "./api.js";
import { fetchSummary, fetchTrend, fetchSources, fetchStore, fetchFlow, fetchHealth, AnalyticsError } from "./analytics/client.js?v=an2";
import { PRESETS, DEFAULT_RANGE, normalizeRange, rangeId, rangeLabel, validateCustom, windowMatches, addDays, MIN_CUSTOM_DAY } from "./analytics/range.js?v=an2";
import { buildAnalyticsModel, metricPoints, METRICS } from "./analytics/model.js?v=an2";
import { buildSignals } from "./analytics/signals.js?v=an2";
import { createTrendChart } from "./analytics/chart.js?v=an2";
import { buildFullReport, buildCsv, csvFileName } from "./analytics/export.js?v=an2";
import * as V from "./analytics/views.js?v=an2";
import { initGa4Panel, updateGa4 } from "./analytics/ga4-panel.js?v=ga1";

const $ = id => document.getElementById(id);
const REFRESH_MS = 5 * 60 * 1000;
const STORE_KEY = "boztik.analytics.view.v1";
const KEYS = ["summary", "trend", "sources", "flow", "store", "health"];
const FETCH = { summary: fetchSummary, trend: fetchTrend, sources: fetchSources, flow: fetchFlow, store: fetchStore };

const S = {
  range: { ...DEFAULT_RANGE }, compare: true, metric: "website_views",
  data: {}, states: {}, fallback: null, loadedRange: null,
  ui: { sort: { key: "views", dir: "desc" }, q: "", page: 1, detail: null },
  model: null, signals: [], busy: false, refreshFailed: false, lastOk: null, customOpen: false,
};
let seq = 0, controller = null, chart = null, wired = false, timer = null, inFlight = false;

/* ------------------------------------------------------------- persistence */
function restore() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    if (!raw) return;
    S.range = normalizeRange(raw.range);
    if (typeof raw.compare === "boolean") S.compare = raw.compare;
    if (raw.metric in METRICS) S.metric = raw.metric;
  } catch { /* storage unavailable or corrupt: defaults */ }
}
function persist() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ range: S.range, compare: S.compare, metric: S.metric })); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ loading */
const fail = (key, err, sameRange) => {
  if (sameRange && S.data[key]) { S.states[key] = { status: "ok" }; S.refreshFailed = true; return; } // keep last good figures, say so
  S.data[key] = null;
  S.states[key] = err instanceof AnalyticsError && err.isMissingRoute ? { status: "missing", error: err.message } : { status: "error", error: err?.message || "Request failed." };
};

async function load() {
  const mine = ++seq;
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const range = S.range, rid = rangeId(range);
  void updateGa4(range, S.compare); // GA4 is a separate source: it loads, fails and retries on its own
  const sameRange = rid === S.loadedRange;
  if (!sameRange) { S.data = {}; S.fallback = null; }
  S.refreshFailed = false;
  for (const k of KEYS) S.states[k] = sameRange && S.data[k] ? { status: "ok" } : { status: "loading" };
  S.busy = true;
  render();

  const run = (key, promise) => promise.then(resp => {
    if (mine !== seq) return;
    if (key !== "health" && !windowMatches(range, resp?.period)) throw new AnalyticsError("The deployed Worker answered for a different date range, so it was not shown. Deploy the updated Worker to use this range.", { status: 404 });
    S.data[key] = resp;
    S.states[key] = { status: "ok" };
  }).catch(err => {
    if (mine !== seq || err?.name === "AbortError") return;
    fail(key, err, sameRange);
  }).then(() => { if (mine === seq) render(); });

  await Promise.all([
    ...Object.entries(FETCH).map(([k, f]) => run(k, f(range, { signal }))),
    run("health", fetchHealth({ signal })),
  ]);
  if (mine !== seq) return;

  // Older Worker without the summary route: keep the page useful with fixed-30-day page views (clearly labelled).
  if (!S.data.summary && S.states.summary.status === "missing") {
    try { const r = await fetchPageAnalytics(); if (mine === seq) S.fallback = r.pages; } catch { /* reported by the section state */ }
  }
  if (mine !== seq) return;
  S.busy = false;
  S.loadedRange = rid;
  if (KEYS.some(k => S.states[k].status === "ok")) S.lastOk = new Date();
  render();
}

/* ------------------------------------------------------------------ render */
function rebuild() {
  S.model = buildAnalyticsModel({ range: S.range, ...S.data, fallbackPages: S.data.summary ? null : S.fallback, states: S.states, generatedAt: S.lastOk || new Date() });
  S.signals = buildSignals(S.model);
}
const hasData = () => !!(S.model && (S.model.website?.available || S.model.trend));
const timeText = d => (d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never");

function render() {
  rebuild();
  const m = S.model;
  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  renderStatus();
  set("cc-site-kpis", V.kpiCards(m));
  renderTrend();
  set("cc-standout-list", V.signalsView(S.signals, m));
  set("cc-traffic-sources", V.sourcesView(m));
  renderPages();
  set("cc-visitor-flow", V.flowView(m));
  set("cc-store-clicks", V.storeView(m));
  set("cc-actions", V.actionsView(m));
  set("cc-data-health", V.healthView(m));
  set("cc-site-deliver", V.deliverView(m));
  const btn = $("cc-report-btn"), csv = $("cc-report-csv");
  const ready = hasData();
  for (const b of [btn, csv]) if (b) { b.disabled = !ready; b.title = ready ? "" : "Available once data has loaded"; }
}

function renderStatus() {
  const m = S.model;
  const range = $("cc-site-range"), status = $("cc-site-status"), notice = $("cc-site-notice");
  if (range) {
    const p = m.period;
    range.textContent = p ? `${p.since ?? "start"} to ${p.until}${p.previous ? ` · compared with ${p.previous.since} to ${p.previous.until}` : " · no earlier period to compare"}${m.timezone?.label ? ` · ${m.timezone.label}` : ""}` : (S.busy ? "Loading…" : "");
  }
  const failed = KEYS.filter(k => ["error", "missing"].includes(S.states[k]?.status));
  let kind = "full", label = "Full analytics";
  if (S.busy && !hasData()) { kind = "loading"; label = "Loading"; }
  else if (m.limited && m.website?.available) { kind = "limited"; label = "Limited mode"; }
  else if (!hasData()) { kind = "failed"; label = "Unavailable"; }
  else if (S.refreshFailed) { kind = "failed"; label = "Refresh failed"; }
  else if (failed.length) { kind = "limited"; label = `${failed.length} section${failed.length === 1 ? "" : "s"} unavailable`; }
  else if ((m.totals.website_views ?? 0) === 0 && (m.totals.deliver_views ?? 0) === 0 && (m.totals.store_clicks ?? 0) === 0) { kind = "empty"; label = "No data for this period"; }
  if (status) {
    status.textContent = "";
    const pill = document.createElement("span"); pill.className = `cc-status-pill is-${kind}`; pill.textContent = label + (S.busy && hasData() ? " · updating" : "");
    const mk = t => { const s = document.createElement("span"); s.textContent = t; return s; };
    status.append(pill, mk(`Last successful update: ${timeText(S.lastOk)}`), mk(`Period: ${m.periodLabel || rangeLabel(S.range)}`), mk("Source: Boztik first-party counters"));
  }
  if (notice) {
    const msgs = [];
    if (m.limited && m.website?.available) msgs.push(`<strong>Limited mode.</strong> The deployed Worker does not have the analytics summary route yet, so only fixed 30-day page views are shown. Period selection, comparisons and Deliver-by-period need <code>deliver/worker-api</code> deployed.`);
    if (S.refreshFailed) msgs.push(`<strong>Refresh failed.</strong> Showing the last successful figures${S.lastOk ? ` from ${V.esc(timeText(S.lastOk))}` : ""}. <button type="button" class="cc-btn cc-btn-inline" data-retry="all">Try again</button>`);
    notice.innerHTML = msgs.map(t => `<p class="cc-note cc-note--warn" role="status"><svg class="cc-i" aria-hidden="true" focusable="false"><use href="#i-info"/></svg><span>${t}</span></p>`).join("");
  }
}

function renderTrend() {
  const host = $("an-trend");
  if (!host) return;
  const m = S.model, trend = m.trend;
  host.classList.toggle("is-busy", S.busy);
  const tabs = $("an-metrics"); if (tabs) tabs.innerHTML = V.metricTabs(S.metric, m);
  const state = $("an-trend-state"); if (state) state.innerHTML = trend ? "" : V.sectionStatus(m, "trend", "The traffic chart");
  const compare = S.compare && !!trend?.previous_buckets;
  if ($("an-chart")) {
    chart ??= createTrendChart($("an-chart"));
    const meta = METRICS[S.metric];
    chart.update({
      points: metricPoints(trend, S.metric), granularity: m.granularity, metricLabel: meta.label, unit: meta.unit, compare, busy: S.busy && !!trend,
      emptyText: trend ? "No data in this range" : (S.states.trend?.status === "loading" ? "Loading…" : "Chart unavailable"),
    });
  }
  const legend = $("an-legend"); if (legend) legend.innerHTML = trend ? V.trendLegend(m, S.metric, compare) : "";
  const basis = $("an-basis"); if (basis) basis.innerHTML = trend ? V.trendBasis(m, S.metric) : "";
  const table = $("an-trend-table"); if (table) table.innerHTML = trend ? V.trendTable(m, S.metric, compare) : "";
  const wrap = $("an-trend-details"); if (wrap) wrap.hidden = !trend;
}

function renderPages(refocus) {
  const host = $("cc-site-pages");
  if (!host) return;
  const q = host.querySelector("#an-page-q");
  const caret = q && document.activeElement === q ? [q.selectionStart, q.selectionEnd] : null;
  host.innerHTML = V.pagesView(S.model, S.ui);
  if (caret) { const n = host.querySelector("#an-page-q"); n?.focus(); try { n?.setSelectionRange(...caret); } catch { /* ignore */ } }
  else if (refocus) host.querySelector(refocus)?.focus();
}

/* ----------------------------------------------------------------- controls */
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function renderControls() {
  const bar = $("cc-period-toolbar");
  if (!bar) return;
  const custom = S.range.kind === "custom";
  // The toolbar is rebuilt on every change; put keyboard focus back on the same control afterwards.
  const f = document.activeElement && bar.contains(document.activeElement) ? document.activeElement : null;
  const refocus = f ? (f.dataset.anRange ? `[data-an-range="${f.dataset.anRange}"]` : "customToggle" in f.dataset ? "[data-custom-toggle]" : "compare" in f.dataset ? "[data-compare]" : "") : "";
  bar.innerHTML = PRESETS.map(p => `<button type="button" class="cc-btn an-range${!custom && S.range.key === p.key ? " is-on" : ""}" data-an-range="${p.key}" aria-pressed="${!custom && S.range.key === p.key}">${V.esc(p.label)}</button>`).join("")
    + `<button type="button" class="cc-btn an-range${custom ? " is-on" : ""}" data-custom-toggle aria-expanded="${S.customOpen}" aria-controls="an-custom" aria-pressed="${custom}">${custom ? V.esc(`${S.range.from} → ${S.range.to}`) : "Custom range"}</button>`
    + `<label class="an-check"><input type="checkbox" data-compare ${S.compare ? "checked" : ""} ${S.range.key === "all" && !custom ? "disabled" : ""}> <span>Compare with previous period</span></label>`;
  if (refocus) bar.querySelector(refocus)?.focus();
  const host = $("an-custom");
  if (host) {
    host.hidden = !S.customOpen;
    if (S.customOpen && !host.firstElementChild) {
      const max = addDays(localToday(), 0);
      const from = custom ? S.range.from : addDays(max, -29), to = custom ? S.range.to : max;
      host.innerHTML = `<form class="an-custom-form" id="an-custom-form" novalidate>
        <label>From <input type="date" name="from" value="${V.esc(from)}" min="${MIN_CUSTOM_DAY}" max="${V.esc(max)}" required></label>
        <label>To <input type="date" name="to" value="${V.esc(to)}" min="${MIN_CUSTOM_DAY}" max="${V.esc(max)}" required></label>
        <button type="submit" class="cc-btn cc-btn--primary">Apply</button><button type="button" class="cc-btn" data-custom-cancel>Cancel</button>
        <p class="an-form-error" id="an-custom-error" role="alert"></p></form>`;
    }
  }
}
function closeCustom(focus) {
  S.customOpen = false;
  const host = $("an-custom"); if (host) { host.hidden = true; host.innerHTML = ""; }
  renderControls();
  if (focus) document.querySelector("[data-custom-toggle]")?.focus();
}
function selectRange(range) {
  const next = normalizeRange(range);
  if (rangeId(next) === rangeId(S.range)) return;
  S.range = next; S.ui.page = 1; S.ui.detail = null;
  persist(); renderControls(); void load();
}

/* ------------------------------------------------------------------- report */
function setReportStatus(text, kind = "ok") { const el = $("cc-report-status"); if (el) { el.textContent = text; el.dataset.kind = text ? kind : ""; } }

function fillReport(focus) {
  const box = $("cc-report-text"), panel = $("cc-report-panel");
  if (!box || !panel) return;
  panel.hidden = false;
  try {
    if (!hasData()) throw new Error("There is no data on screen yet. Wait for the figures to load, then try again.");
    box.value = buildFullReport(S.model, { generatedAt: new Date() });
    setReportStatus("");
    if (focus) { box.focus(); box.select(); panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }
  } catch (e) {
    box.value = "";
    setReportStatus(`The report could not be built: ${e?.message || "unknown error"}`, "warn");
  }
}

async function copyReport() {
  const box = $("cc-report-text");
  if (!box || !box.value) { setReportStatus("There is no report to copy. Generate it first.", "warn"); return; }
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(box.value);
    setReportStatus("Report copied. Paste it into ChatGPT.");
  } catch {
    box.focus(); box.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; }
    setReportStatus(ok ? "Report copied. Paste it into ChatGPT." : "Couldn't copy automatically. The report is selected: press Ctrl+C (Cmd+C on Mac).", ok ? "ok" : "warn");
  }
}

function downloadCsv() {
  try {
    if (!hasData()) throw new Error("There is no data on screen yet.");
    const text = `﻿${buildCsv(S.model, { generatedAt: new Date() })}`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = csvFileName(S.model); a.rel = "noopener";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    const panel = $("cc-report-panel"); if (panel && !panel.hidden) setReportStatus("CSV downloaded.");
  } catch (e) {
    const panel = $("cc-report-panel"); if (panel) panel.hidden = false;
    setReportStatus(`The CSV could not be built: ${e?.message || "unknown error"}`, "warn");
  }
}

/* ------------------------------------------------------------------- events */
function onClick(ev) {
  const t = ev.target.closest("[data-an-range],[data-custom-toggle],[data-custom-cancel],[data-metric],[data-sort],[data-page-detail],[data-detail-close],[data-page-nav],[data-retry]");
  if (!t) return;
  if (t.dataset.anRange) { closeCustom(false); selectRange(t.dataset.anRange); return; }
  if ("customToggle" in t.dataset) { S.customOpen = !S.customOpen; renderControls(); document.querySelector(S.customOpen ? "#an-custom-form input" : "[data-custom-toggle]")?.focus(); return; }
  if ("customCancel" in t.dataset) { closeCustom(true); return; }
  if (t.dataset.metric) { S.metric = t.dataset.metric in METRICS ? t.dataset.metric : S.metric; persist(); renderTrend(); document.querySelector(`[data-metric="${S.metric}"]`)?.focus(); return; }
  if (t.dataset.sort) {
    const key = t.dataset.sort;
    S.ui.sort = S.ui.sort.key === key ? { key, dir: S.ui.sort.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "label" ? "asc" : "desc" };
    S.ui.page = 1; renderPages(`[data-sort="${key}"]`); return;
  }
  if (t.dataset.pageDetail) { S.ui.detail = S.ui.detail === t.dataset.pageDetail ? null : t.dataset.pageDetail; renderPages(`[data-page-detail="${t.dataset.pageDetail}"]`); return; }
  if ("detailClose" in t.dataset) { const was = S.ui.detail; S.ui.detail = null; renderPages(`[data-page-detail="${was}"]`); return; }
  if (t.dataset.pageNav) { S.ui.page += t.dataset.pageNav === "next" ? 1 : -1; renderPages(`[data-page-nav="${t.dataset.pageNav}"]:not([disabled])`); return; }
  if (t.dataset.retry) void load();
}

function onChange(ev) {
  if (ev.target.matches("[data-compare]")) { S.compare = ev.target.checked; persist(); renderTrend(); void updateGa4(S.range, S.compare); }
}

function onInput(ev) {
  if (ev.target.id === "an-page-q") { S.ui.q = ev.target.value.slice(0, 60); S.ui.page = 1; renderPages(); }
}

function onSubmit(ev) {
  if (ev.target.id !== "an-custom-form") return;
  ev.preventDefault();
  const f = new FormData(ev.target), from = String(f.get("from") || ""), to = String(f.get("to") || "");
  const err = validateCustom(from, to, addDays(localToday(), 1)); // +1 day: tolerate a browser clock one day behind the business timezone; the Worker is authoritative
  const out = $("an-custom-error");
  if (err) { if (out) out.textContent = err; return; }
  closeCustom(false);
  selectRange({ kind: "custom", from, to });
  document.querySelector("[data-custom-toggle]")?.focus();
}

function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
function startTimer() {
  stopTimer();
  if (document.hidden) return;
  timer = setInterval(() => { if (!document.hidden && !inFlight && !$("panel-analytics")?.hidden) void refreshSiteAnalytics(); }, REFRESH_MS);
}

/* ------------------------------------------------------------------- public */
export function initSiteAnalytics() {
  if (wired) return;
  wired = true;
  restore();
  renderControls();
  initGa4Panel(() => ({ range: S.range, compare: S.compare }));
  const root = $("cc-site-analytics");
  root?.addEventListener("click", onClick);
  root?.addEventListener("change", onChange);
  root?.addEventListener("input", onInput);
  root?.addEventListener("submit", onSubmit);
  root?.addEventListener("keydown", ev => { if (ev.key === "Escape" && S.customOpen && ev.target.closest("#an-custom")) closeCustom(true); });
  $("cc-report-btn")?.addEventListener("click", () => fillReport(true));
  $("cc-report-csv")?.addEventListener("click", downloadCsv);
  $("cc-report-copy")?.addEventListener("click", () => void copyReport());
  $("cc-report-close")?.addEventListener("click", () => { const p = $("cc-report-panel"); if (p) p.hidden = true; $("cc-report-btn")?.focus(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopTimer(); else startTimer(); });
  render();
  startTimer();
}

export async function refreshSiteAnalytics() {
  if (!$("cc-site-analytics")) return;
  initSiteAnalytics();
  if (inFlight) return;
  inFlight = true;
  try { await load(); } finally { inFlight = false; startTimer(); }
}
