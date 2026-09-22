// Command Centre insights: activity today, views/downloads over time, what is getting attention.
// Every number comes from the Worker's aggregate analytics (per-delivery / per-day counters).
// There is no per-visitor data anywhere in this system, so nothing here can identify a person.
import { fetchOverview, fetchTimeseries, fetchTopDeliveries, fetchDeliveryAnalytics } from "./api.js";
import { escapeHtml } from "./shared.js";

const RANGES = [["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]];
let range = "7d";
let root = null;

/** Last successful load, shared with command-centre.js so nothing is fetched twice. */
const snapshot = { overview: null, series30: null };
export const insightsSnapshot = () => snapshot;

const sum = (series, key) => series.reduce((t, p) => t + (Number(p[key]) || 0), 0);
const nf = n => Number(n || 0).toLocaleString();

/** Short axis label for a Worker bucket label: "YYYY-MM-DDTHH" -> "HH:00", "YYYY-MM-DD" -> "MM-DD". */
const shortLabel = s => (s.includes("T") ? `${s.slice(11, 13)}:00` : s.slice(5));

/** Percentage change, or null when the previous period has no data to compare against. */
export function percentChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Compact bar chart (kept for compatibility). */
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
  return `<svg class="dash-chart ${cssClass}" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(key)} over time">
    <line class="dash-chart-base" x1="0" y1="${base}" x2="${w}" y2="${base}"/>${bars}
    <text class="dash-chart-axis" x="${pad}" y="${height - 4}">${escapeHtml(shortLabel(first))}</text>
    <text class="dash-chart-axis" x="${w - pad}" y="${height - 4}" text-anchor="end">${escapeHtml(shortLabel(last))}</text>
    <text class="dash-chart-axis" x="${w - pad}" y="10" text-anchor="end">max ${max}</text></svg>`;
}

/**
 * Views (bars) + downloads (line with markers) on one shared axis.
 * The two series differ by shape as well as colour, so the chart never relies on colour alone.
 */
export function trendChart(series) {
  const W = 720, H = 240, L = 40, R = 12, T = 14, B = 28;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...series.map(p => Math.max(p.views, p.downloads)));
  const niceMax = max <= 5 ? max : Math.ceil(max / 5) * 5;
  const n = Math.max(1, series.length);
  const slot = iw / n;
  const bw = Math.max(2, Math.min(28, slot * 0.6));
  const y = v => T + ih - (v / niceMax) * ih;
  const cx = i => L + slot * i + slot / 2;

  const grid = [0, 0.5, 1].map(f => {
    const v = Math.round(niceMax * f);
    return `<line class="cc-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="cc-axis" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  }).join("");

  const bars = series.map((p, i) => {
    const h = Math.max(p.views ? 2 : 0, (p.views / niceMax) * ih);
    return `<rect class="cc-bar" x="${(cx(i) - bw / 2).toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${escapeHtml(p.label)} — ${p.views} views, ${p.downloads} downloads</title></rect>`;
  }).join("");

  const pts = series.map((p, i) => `${cx(i).toFixed(1)},${y(p.downloads).toFixed(1)}`);
  const line = series.length > 1 ? `<polyline class="cc-line" points="${pts.join(" ")}"/>` : "";
  const dotEvery = series.length > 40 ? Math.ceil(series.length / 40) : 1;
  const dots = series.map((p, i) => (i % dotEvery === 0 ? `<circle class="cc-dot-mark" cx="${cx(i).toFixed(1)}" cy="${y(p.downloads).toFixed(1)}" r="3"><title>${escapeHtml(p.label)} — ${p.downloads} downloads</title></circle>` : "")).join("");

  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i && series[v]);
  const xs = ticks.map(i => `<text class="cc-axis" x="${cx(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${escapeHtml(shortLabel(series[i].label))}</text>`).join("");

  const peak = series.reduce((b, p) => (p.views > (b?.views ?? -1) ? p : b), null);
  const summary = `Views ${nf(sum(series, "views"))}, downloads ${nf(sum(series, "downloads"))}${peak && peak.views ? `; busiest period ${peak.label} with ${peak.views} views` : ""}.`;
  return `<svg class="cc-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(summary)}">${grid}${bars}${line}${dots}${xs}</svg>`;
}

function renderShell() {
  root.innerHTML = `
    <div class="cc-today" id="dash-insights-today" aria-label="Today"></div>
    <div class="cc-toolbar" role="tablist" aria-label="Chart range">
      ${RANGES.map(([k, l]) => `<button type="button" class="dash-range${k === range ? " is-active" : ""}" data-range="${k}" role="tab" aria-selected="${k === range}">${l}</button>`).join("")}
    </div>
    <div id="dash-insights-charts"><p class="cc-muted">Loading…</p></div>`;
}

function tile(label, value, sub = "") {
  return `<div class="cc-today-tile"><span>${escapeHtml(label)}</span><strong>${nf(value)}</strong>${sub ? `<em>${escapeHtml(sub)}</em>` : ""}</div>`;
}

function deltaBadge(current, previous) {
  const pct = percentChange(current, previous);
  if (pct === null) return `<span class="cc-delta is-flat">No earlier data to compare</span>`;
  if (pct === 0) return `<span class="cc-delta is-flat">▬ Same as previous period</span>`;
  return `<span class="cc-delta ${pct > 0 ? "is-up" : "is-down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% <small>vs previous period</small></span>`;
}

async function seriesFor(r) {
  if (r === "30d" && snapshot.series30) return snapshot.series30;
  const { series } = await fetchTimeseries(r);
  if (r === "30d") snapshot.series30 = series;
  return series;
}

async function paintCharts() {
  const host = root.querySelector("#dash-insights-charts");
  try {
    const series = await seriesFor(range);
    let previous = null;
    if (range === "7d") {
      const s30 = await seriesFor("30d");
      previous = s30.slice(-14, -7);
    }
    const v = sum(series, "views"), d = sum(series, "downloads");
    const rangeLabel = RANGES.find(([k]) => k === range)?.[1] ?? "";
    host.innerHTML = `
      <div class="cc-trend-head">
        <div class="cc-trend-stat"><span>Views · ${escapeHtml(rangeLabel)}</span><strong>${nf(v)}</strong>${previous ? deltaBadge(v, sum(previous, "views")) : ""}</div>
        <div class="cc-trend-stat"><span>Downloads · ${escapeHtml(rangeLabel)}</span><strong>${nf(d)}</strong>${previous ? deltaBadge(d, sum(previous, "downloads")) : ""}</div>
        <ul class="cc-legend" aria-hidden="true"><li><i class="cc-key cc-key-bar"></i>Views</li><li><i class="cc-key cc-key-line"></i>Downloads</li></ul>
      </div>
      ${series.length ? trendChart(series) : `<p class="cc-muted">No activity recorded in this period yet.</p>`}`;
  } catch (e) {
    host.innerHTML = `<p class="cc-inline-error" role="alert">${escapeHtml(e.message || "Could not load chart data.")}</p>`;
  }
}

/** "What is getting attention": active deliveries ranked by the last 7 days of views + downloads. */
async function paintTop() {
  const host = document.getElementById("cc-top-body");
  if (!host) return;
  try {
    const { top } = await fetchTopDeliveries();
    if (!top.length) {
      host.innerHTML = `<p class="cc-empty">No views or downloads on active deliveries yet. Once a client opens a link, it shows up here.</p>`;
      return;
    }
    host.innerHTML = `<ol class="cc-top-list">${top.map((d, i) => {
      const badge = d.trending ? `<span class="cc-badge is-hot">Trending</span>` : (d.views_7d + d.downloads_7d >= 10 ? `<span class="cc-badge">High traffic</span>` : "");
      const name = d.project_name || d.client_name || d.id;
      return `<li><span class="cc-rank" aria-hidden="true">${i + 1}</span>
        <div class="cc-top-main"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(d.id)}${d.is_photoshop_battles ? " · PhotoshopBattles" : ""}</small></div>
        <div class="cc-top-nums"><span><b>${nf(d.views_7d)}</b> views</span><span><b>${nf(d.downloads_7d)}</b> downloads</span><em>last 7 days</em></div>${badge}</li>`;
    }).join("")}</ol>`;
  } catch (e) {
    host.innerHTML = `<p class="cc-inline-error" role="alert">${escapeHtml(e.message || "Could not load traffic data.")}</p>`;
  }
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

  snapshot.series30 = null; // force fresh numbers on every refresh
  let overview = null;
  try {
    overview = await fetchOverview();
    snapshot.overview = overview;
    const a = overview.activity;
    root.querySelector("#dash-insights-today").innerHTML =
      tile("Views today", a.today.views, `${nf(a.last_7d.views)} in 7 days`) +
      tile("Downloads today", a.today.downloads, `${nf(a.last_7d.downloads)} in 7 days`) +
      tile("New deliveries today", a.today.new_deliveries, `${overview.deliveries.active} active`) +
      tile("Awaiting cleanup", overview.deliveries.awaiting_cleanup, overview.deliveries.awaiting_cleanup ? "expired, files still stored" : "all clean");
  } catch (e) { console.error("[Boztik Deliver] overview failed:", e); }
  await Promise.all([paintCharts(), paintTop(), seriesFor("30d").catch(() => null)]);
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
  dlg.setAttribute("aria-label", `Analytics for ${name}`);
  dlg.innerHTML = `<div class="dash-analytics-body"><header><div><h3>${escapeHtml(name)}</h3><small>${escapeHtml(delivery.id)} · last 30 days</small></div>
    <button type="button" class="dash-btn dash-compact" data-close>Close</button></header><div id="dash-analytics-content"><p class="cc-muted">Loading…</p></div></div>`;
  dlg.showModal();
  const host = dlg.querySelector("#dash-analytics-content");
  try {
    const { series } = await fetchDeliveryAnalytics(delivery.id);
    host.innerHTML = `<div class="cc-today">${tile("Views (30d)", sum(series, "views"), `${nf(delivery.lifetime_views ?? 0)} all-time`)}${tile("Downloads (30d)", sum(series, "downloads"), `${nf(delivery.lifetime_downloads ?? 0)} all-time`)}</div>
      <div class="cc-trend-wrap">${trendChart(series)}</div>
      <ul class="cc-legend" aria-hidden="true"><li><i class="cc-key cc-key-bar"></i>Views</li><li><i class="cc-key cc-key-line"></i>Downloads</li></ul>`;
  } catch (e) { host.innerHTML = `<p class="cc-inline-error" role="alert">${escapeHtml(e.message || "Could not load analytics.")}</p>`; }
}
