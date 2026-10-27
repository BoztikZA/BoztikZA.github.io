// Interactive time-series chart (SVG, no dependencies).
//
// Honesty rules baked in:
//   * one y-axis, starts at zero, nice round ticks
//   * `null` = NOT MEASURED: never drawn as zero and never bridged by a line. Buckets before the collector started
//     get a hatched "not measured" band; later gaps simply have no mark.
//   * the in-progress bucket (today / this hour) is drawn hollow + dashed and labelled "so far"
//   * later hours of today are not drawn at all
//   * the previous period is a muted dashed line aligned bucket-by-bucket (compare = true)
//   * hover/touch/keyboard all show the same tooltip; the table twin carries the same numbers for everything else
//   * the tooltip is built with textContent only (no innerHTML), so no value can inject markup
import { niceScale, labelIndexes, measuredRuns, unmeasuredLead, nearestIndex, barPath, axisLabel, fullLabel, fmtInt, compact } from "./chart-math.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
};
const htmlEl = (name, cls, text) => { const n = document.createElement(name); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

const BAR_LIMIT = 31; // up to a month of daily bars; beyond that the series is drawn as an area line
const HEIGHT = 264;
const M = { top: 14, right: 14, bottom: 30, left: 44 };

/**
 * @param {HTMLElement} host   empty container
 * @param {object} options     { onActive(index|null) } optional callback
 * @returns {{ update(state), destroy() }}
 *   state = { points:[{start,value,partial,future,prev,prevStart}], granularity:"day"|"hour", metricLabel, unit, compare:boolean,
 *             busy:boolean, emptyText:string, prevLabel:string }
 */
export function createTrendChart(host, options = {}) {
  host.textContent = "";
  host.classList.add("an-chart");
  const svg = svgEl("svg", { class: "an-chart-svg", role: "group", tabindex: "0", focusable: "true" });
  const tip = htmlEl("div", "an-tip");
  tip.hidden = true;
  tip.setAttribute("role", "presentation");
  const live = htmlEl("div", "an-sr-only");
  live.setAttribute("aria-live", "polite");
  host.append(svg, tip, live);

  let state = null, active = null, layout = null, width = 0, destroyed = false;

  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { const w = Math.round(host.clientWidth); if (w && w !== width) render(); }) : null;
  ro?.observe(host);

  function valueText(p, unit) {
    if (p.value === null) return "Not measured";
    return `${fmtInt(p.value)} ${unit}${p.partial ? " so far" : ""}`;
  }

  function showTip(i) {
    if (!state || !layout || i === null || i === undefined || !state.points[i] || state.points[i].future) { hideTip(); return; }
    active = i;
    const p = state.points[i];
    tip.textContent = "";
    tip.append(htmlEl("div", "an-tip-h", fullLabel(p.start, state.granularity)));
    const row = htmlEl("div", "an-tip-row");
    row.append(htmlEl("span", "an-key an-key-cur"), htmlEl("span", "an-tip-l", state.metricLabel), htmlEl("strong", "an-tip-v", p.value === null ? "Not measured" : fmtInt(p.value)));
    tip.append(row);
    if (p.partial) tip.append(htmlEl("div", "an-tip-note", state.granularity === "hour" ? "This hour is not finished." : "Today is not finished: this is the total so far."));
    if (state.compare && p.prevStart) {
      const r2 = htmlEl("div", "an-tip-row an-tip-prev");
      r2.append(htmlEl("span", "an-key an-key-prev"), htmlEl("span", "an-tip-l", fullLabel(p.prevStart, state.granularity).replace(/ 20\d\d$/, "")), htmlEl("strong", "an-tip-v", p.prev === null ? "Not measured" : fmtInt(p.prev)));
      tip.append(r2);
      if (p.value !== null && p.prev !== null && !p.partial) {
        const d = p.value - p.prev;
        tip.append(htmlEl("div", "an-tip-note", d === 0 ? "Same as the previous period." : `${d > 0 ? "+" : "−"}${fmtInt(Math.abs(d))} versus the previous period.`));
      }
    }
    tip.hidden = false;
    // position: above the bar/point, flipped inside the plot
    const cx = layout.centres[i];
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = cx - tw / 2;
    left = Math.max(M.left, Math.min(layout.right - tw, left));
    const yVal = p.value === null ? layout.base : layout.y(Math.max(p.value, state.compare && p.prev ? p.prev : 0));
    let top = yVal - th - 10;
    if (top < 0) top = Math.min(layout.base - th, yVal + 14);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.max(0, top))}px`;
    for (const g of svg.querySelectorAll("[data-i]")) g.classList.toggle("is-active", Number(g.dataset.i) === i);
    const cross = svg.querySelector(".an-cross");
    if (cross) { cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.style.display = ""; }
    live.textContent = `${fullLabel(p.start, state.granularity)}: ${valueText(p, state.unit)}${state.compare && p.prevStart ? `; previous period ${p.prev === null ? "not measured" : fmtInt(p.prev)}` : ""}`;
    options.onActive?.(i);
  }
  function hideTip() {
    active = null;
    tip.hidden = true;
    for (const g of svg.querySelectorAll(".is-active")) g.classList.remove("is-active");
    const cross = svg.querySelector(".an-cross"); if (cross) cross.style.display = "none";
    options.onActive?.(null);
  }

  function render() {
    if (destroyed || !state) return;
    width = Math.max(260, Math.round(host.clientWidth || 640));
    const { points, granularity, compare } = state;
    svg.textContent = "";
    svg.setAttribute("viewBox", `0 0 ${width} ${HEIGHT}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", HEIGHT);
    svg.setAttribute("aria-label", `${state.metricLabel} over time. ${points.length} ${granularity === "hour" ? "hours" : "days"}. Use the arrow keys to read each one; the same numbers are in the table below.`);
    host.classList.toggle("is-busy", !!state.busy);
    const n = points.length;
    if (!n) { const t = svgEl("text", { x: width / 2, y: HEIGHT / 2, "text-anchor": "middle", class: "an-chart-empty" }, svg); t.textContent = state.emptyText || "No data"; layout = null; return; }

    const cur = points.map(p => p.value);
    const prev = compare ? points.map(p => p.prev) : [];
    const rawMax = Math.max(0, ...cur.filter(v => v !== null), ...prev.filter(v => v !== null));
    const { max, ticks } = niceScale(rawMax);
    const plotW = width - M.left - M.right, plotH = HEIGHT - M.top - M.bottom;
    const base = M.top + plotH, right = width - M.right;
    const y = v => base - (v / max) * plotH;
    const slot = plotW / n;
    const centres = points.map((_, i) => M.left + slot * (i + 0.5));
    layout = { centres, base, right, y };
    const asBars = n <= BAR_LIMIT;

    // grid + y labels
    const grid = svgEl("g", { class: "an-grid" }, svg);
    for (const t of ticks) {
      svgEl("line", { x1: M.left, x2: right, y1: y(t), y2: y(t), class: t === 0 ? "an-axis" : "an-gridline" }, grid);
      const lab = svgEl("text", { x: M.left - 8, y: y(t) + 4, "text-anchor": "end", class: "an-tick" }, grid);
      lab.textContent = compact(t);
    }

    // x labels (at most ~8 so they never collide; hourly labels thin to every 3rd hour on narrow screens)
    const maxLabels = Math.max(2, Math.floor(plotW / (granularity === "hour" ? 44 : 62)));
    for (const i of labelIndexes(n, maxLabels)) {
      const t = svgEl("text", { x: centres[i], y: HEIGHT - 9, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle", class: "an-tick" }, svg);
      if (i === 0) t.setAttribute("x", Math.max(M.left - 14, centres[i] - slot / 2));
      if (i === n - 1) t.setAttribute("x", Math.min(width - 2, centres[i] + slot / 2));
      t.textContent = axisLabel(points[i].start, granularity);
    }

    // "not measured" band before the collector started
    const lead = unmeasuredLead(cur, points.map(p => p.future));
    if (lead > 0) {
      const defs = svgEl("defs", {}, svg);
      const pat = svgEl("pattern", { id: "an-hatch", width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
      svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 7, class: "an-hatch-line" }, pat);
      svgEl("rect", { x: M.left, y: M.top, width: slot * lead, height: plotH, fill: "url(#an-hatch)", class: "an-unmeasured" }, svg);
      const lt = svgEl("text", { x: M.left + 8, y: M.top + 16, class: "an-unmeasured-label" }, svg);
      lt.textContent = slot * lead > 120 ? "Not measured yet" : "n/m";
    }

    // previous period (muted dashed line, one segment per measured run: gaps are never bridged)
    if (compare) {
      for (const [a, b] of measuredRuns(prev)) {
        if (a === b) { svgEl("circle", { cx: centres[a], cy: y(prev[a]), r: 2.5, class: "an-prev-dot" }, svg); continue; }
        const d = []; for (let i = a; i <= b; i++) d.push(`${i === a ? "M" : "L"}${centres[i].toFixed(1)},${y(prev[i]).toFixed(1)}`);
        svgEl("path", { d: d.join(""), class: "an-prev-line" }, svg);
      }
    }

    // current series
    const marks = svgEl("g", { class: "an-marks" }, svg);
    if (asBars) {
      const bw = Math.max(3, Math.min(34, slot * 0.66));
      points.forEach((p, i) => {
        if (p.future || p.value === null) return;
        const h = (p.value / max) * plotH;
        const g = svgEl("g", { "data-i": i }, marks);
        if (p.value === 0) { svgEl("line", { x1: centres[i] - bw / 2, x2: centres[i] + bw / 2, y1: base - 1, y2: base - 1, class: "an-zero-mark" }, g); return; }
        svgEl("path", { d: barPath(centres[i] - bw / 2, base - h, bw, h, Math.min(4, bw / 2)), class: p.partial ? "an-bar an-bar-partial" : "an-bar" }, g);
      });
    } else {
      for (const [a, b] of measuredRuns(points.map(p => (p.future ? null : p.value)))) {
        const last = b;
        const pts = []; for (let i = a; i <= b; i++) pts.push([centres[i], y(points[i].value)]);
        // a partial final bucket is drawn as a dashed tail so it cannot read as a drop
        const solidEnd = points[last].partial && last > a ? last - 1 : last;
        const line = pts.slice(0, solidEnd - a + 1).map(([x, yy], k) => `${k ? "L" : "M"}${x.toFixed(1)},${yy.toFixed(1)}`).join("");
        if (solidEnd > a) {
          svgEl("path", { d: `${line}L${centres[solidEnd].toFixed(1)},${base}L${centres[a].toFixed(1)},${base}Z`, class: "an-area" }, marks);
          svgEl("path", { d: line, class: "an-line" }, marks);
        } else svgEl("circle", { cx: centres[a], cy: y(points[a].value), r: 3, class: "an-dot" }, marks);
        if (solidEnd < last) svgEl("path", { d: `M${centres[solidEnd].toFixed(1)},${y(points[solidEnd].value).toFixed(1)}L${centres[last].toFixed(1)},${y(points[last].value).toFixed(1)}`, class: "an-line an-line-partial" }, marks);
      }
    }
    // active-point dot (line mode) / crosshair
    svgEl("line", { x1: 0, x2: 0, y1: M.top, y2: base, class: "an-cross", style: "display:none" }, svg);

    // single full-plot hit area: pointer maps to the nearest bucket (works for touch, mouse and pen)
    const hit = svgEl("rect", { x: M.left, y: M.top, width: plotW, height: plotH, fill: "transparent", class: "an-hit" }, svg);
    const idxAt = ev => {
      const r = svg.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (width / (r.width || width));
      return nearestIndex(x, centres);
    };
    hit.addEventListener("pointermove", ev => showTip(idxAt(ev)));
    hit.addEventListener("pointerdown", ev => showTip(idxAt(ev)));
    hit.addEventListener("pointerleave", ev => { if (ev.pointerType !== "touch" && document.activeElement !== svg) hideTip(); });

    if (active !== null && active < n) showTip(active);
  }

  svg.addEventListener("keydown", ev => {
    if (!state?.points.length) return;
    const pts = state.points;
    const lastReal = (() => { for (let i = pts.length - 1; i >= 0; i--) if (!pts[i].future) return i; return 0; })();
    let i = active ?? lastReal;
    const step = ev.key === "ArrowRight" || ev.key === "ArrowUp" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowDown" ? -1 : 0;
    if (step) i = Math.max(0, Math.min(lastReal, active === null ? lastReal : i + step));
    else if (ev.key === "Home") i = 0;
    else if (ev.key === "End") i = lastReal;
    else if (ev.key === "Escape") { hideTip(); return; }
    else return;
    ev.preventDefault();
    showTip(i);
  });
  svg.addEventListener("blur", () => hideTip());

  return {
    update(next) { state = next; render(); },
    destroy() { destroyed = true; ro?.disconnect(); host.textContent = ""; },
  };
}
