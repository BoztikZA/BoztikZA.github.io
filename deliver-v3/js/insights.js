// Command Centre insights: today's activity, views/downloads over time, trending.
// All numbers come from the Worker's aggregate analytics (no per-visitor data).
import { fetchOverview, fetchTimeseries, fetchTopDeliveries, fetchDeliveryAnalytics } from "./api.js";
import { escapeHtml } from "./shared.js";

const RANGES = [["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]];
let range = "7d";
let root = null;

/** Inline-SVG bar chart. Values are numbers only; labels are Worker-generated date strings. */
export function barChart(series, key, { height = 130, cssClass = "" } = {}) {
  const w = 600, pad = 4, base = height - 18;
  const max = Math.max(1, ...series.map(p => p[key]));
  const slot = (w - pad * 2) / Math.max(1, series.length);
  const bw = Math.max(1, slot * 0.68);
  const bars = series.map((p, i) => {
    const h = Math.round((p[key] / max) * (base - 8));
    const x = pad + i * slot + (slot - bw) / 2;
    return `<rect class="dash-bar" x="${x.toFixed(1)}" y="${base - h}" width="${bw.toFixed(1)}" height="${Math.max(h, p[key] ? 2 : 0)}" rx="2"><title>${escapeHtml(p.label)}: ${p[key]}</title></rect>`;
  }).join("");
  const first = series[0]?.label ?? "", last = series[series.length - 1]?.label ?? "";
  const short = s => (s.includes("T") ? `${s.slice(11, 13)}:00` : s.slice(5));
  return `<svg class="dash-chart ${cssClass}" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(key)} over time">
    <line class="dash-chart-base" x1="0" y1="${base}" x2="${w}" y2="${base}"/>${bars}
    <text class="dash-chart-axis" x="${pad}" y="${height - 4}">${escapeHtml(short(first))}</text>
    <text class="dash-chart-axis" x="${w - pad}" y="${height - 4}" text-anchor="end">${escapeHtml(short(last))}</text>
    <text class="dash-chart-axis" x="${w - pad}" y="10" text-anchor="end">max ${max}</text></svg>`;
}

const sum = (series, key) => series.reduce((t, p) => t + p[key], 0);

function renderShell() {
  root.innerHTML = `
    <div class="dash-insights-today" id="dash-insights-today"></div>
    <div class="dash-insights-toolbar" role="tablist" aria-label="Chart range">
      ${RANGES.map(([k, l]) => `<button type="button" class="dash-range${k === range ? " is-active" : ""}" data-range="${k}" role="tab" aria-selected="${k === range}">${l}</button>`).join("")}
    </div>
    <div class="dash-insights-charts" id="dash-insights-charts"><p class="dash-usage-muted">Loading…</p></div>
    <h4 class="dash-insights-sub">Trending &amp; high traffic</h4>
    <div id="dash-insights-top"><p class="dash-usage-muted">Loading…</p></div>`;
}

function tile(label, value, sub = "") {
  return `<div class="dash-insights-tile"><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString()}</strong>${sub ? `<em>${escapeHtml(sub)}</em>` : ""}</div>`;
}

async function paintCharts() {
  const host = root.querySelector("#dash-insights-charts");
  try {
    const { series } = await fetchTimeseries(range);
    host.innerHTML = `
      <div class="dash-chart-card"><header><h4>Views</h4><strong>${sum(series, "views").toLocaleString()}</strong></header>${barChart(series, "views", { cssClass: "is-views" })}</div>
      <div class="dash-chart-card"><header><h4>Downloads</h4><strong>${sum(series, "downloads").toLocaleString()}</strong></header>${barChart(series, "downloads", { cssClass: "is-downloads" })}</div>`;
  } catch (e) { host.innerHTML = `<p class="dash-usage-message">${escapeHtml(e.message || "Could not load chart data.")}</p>`; }
}

async function paintTop() {
  const host = root.querySelector("#dash-insights-top");
  try {
    const { top } = await fetchTopDeliveries();
    if (!top.length) { host.innerHTML = `<p class="dash-usage-muted">No traffic on active deliveries yet.</p>`; return; }
    host.innerHTML = `<ol class="dash-top-list">${top.map(d => {
      const badge = d.trending ? `<span class="dash-badge is-hot">Trending</span>` : (d.views_7d + d.downloads_7d >= 10 ? `<span class="dash-badge">High traffic</span>` : "");
      const name = d.project_name || d.client_name || d.id;
      return `<li><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(d.id)}</small></div>
        <span>${d.views_7d} views · ${d.downloads_7d} downloads <em>7d</em></span>${badge}</li>`;
    }).join("")}</ol>`;
  } catch (e) { host.innerHTML = `<p class="dash-usage-message">${escapeHtml(e.message || "Could not load traffic data.")}</p>`; }
}

/** Renders/refreshes the panel and returns the Worker overview (for the stat cards). */
export async function loadInsights(container, { keepRange = true } = {}) {
  if (!container) return null;
  if (root !== container) {
    root = container;
    renderShell();
    root.addEventListener("click", event => {
      const b = event.target.closest("[data-range]");
      if (!b) return;
      range = b.dataset.range;
      root.querySelectorAll(".dash-range").forEach(x => { const on = x === b; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", String(on)); });
      void paintCharts();
    });
  } else if (!keepRange) renderShell();

  let overview = null;
  try {
    overview = await fetchOverview();
    const a = overview.activity;
    root.querySelector("#dash-insights-today").innerHTML =
      tile("Views today", a.today.views, `${a.last_7d.views.toLocaleString()} in 7 days`) +
      tile("Downloads today", a.today.downloads, `${a.last_7d.downloads.toLocaleString()} in 7 days`) +
      tile("New deliveries today", a.today.new_deliveries, `${overview.deliveries.active} active`) +
      tile("Awaiting cleanup", overview.deliveries.awaiting_cleanup, overview.deliveries.awaiting_cleanup ? "expired, files still stored" : "all clean");
  } catch (e) { console.error("[Boztik Deliver] overview failed:", e); }
  await Promise.all([paintCharts(), paintTop()]);
  return overview;
}

/** Per-delivery 30-day analytics in a lightweight <dialog>. */
export async function openDeliveryAnalytics(delivery) {
  let dlg = document.getElementById("dash-analytics-dialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "dash-analytics-dialog";
    dlg.className = "dash-analytics-dialog";
    document.body.append(dlg);
    dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
  }
  const name = delivery.project_name || delivery.client_name || delivery.id;
  dlg.innerHTML = `<div class="dash-analytics-body"><header><div><h3>${escapeHtml(name)}</h3><small>${escapeHtml(delivery.id)} · last 30 days</small></div>
    <button type="button" class="dash-btn dash-compact" data-close>Close</button></header><div id="dash-analytics-content"><p class="dash-usage-muted">Loading…</p></div></div>`;
  dlg.showModal();
  const host = dlg.querySelector("#dash-analytics-content");
  try {
    const { series } = await fetchDeliveryAnalytics(delivery.id);
    host.innerHTML = `<div class="dash-insights-today">${tile("Views (30d)", sum(series, "views"), `${delivery.lifetime_views ?? 0} all-time`)}${tile("Downloads (30d)", sum(series, "downloads"), `${delivery.lifetime_downloads ?? 0} all-time`)}</div>
      <div class="dash-chart-card"><header><h4>Views</h4></header>${barChart(series, "views", { cssClass: "is-views" })}</div>
      <div class="dash-chart-card"><header><h4>Downloads</h4></header>${barChart(series, "downloads", { cssClass: "is-downloads" })}</div>`;
  } catch (e) { host.innerHTML = `<p class="dash-usage-message">${escapeHtml(e.message || "Could not load analytics.")}</p>`; }
}
