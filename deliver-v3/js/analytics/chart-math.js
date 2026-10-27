// Pure maths and formatting for the trend chart (no DOM), so scales, ticks, labels and gap handling are unit-tested.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Fixed English names (not Intl) so labels are identical in every browser and in the Node tests.

export const parseDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
export const weekday = s => { const p = parseDay(s); return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : 0; };
export const isWeekend = s => { const w = weekday(s); return w === 0 || w === 6; };

/** Axis label: "20 Oct" (daily) or "14:00" (hourly). */
export function axisLabel(start, granularity) {
  const p = parseDay(start); if (!p) return String(start);
  if (granularity === "hour") return `${String(start.slice(11, 13)).padStart(2, "0")}:00`;
  return `${p.d} ${MONTHS[p.m - 1]}`;
}
/** Tooltip heading: "Tuesday 20 October 2026" or "Tuesday 20 October, 14:00–14:59". */
export function fullLabel(start, granularity) {
  const p = parseDay(start); if (!p) return String(start);
  const base = `${WEEKDAYS_LONG[weekday(start)]} ${p.d} ${MONTHS_LONG[p.m - 1]}`;
  if (granularity === "hour") { const h = start.slice(11, 13); return `${base}, ${h}:00–${h}:59`; }
  return `${base} ${p.y}`;
}
export const shortDate = start => { const p = parseDay(start); return p ? `${WEEKDAYS[weekday(start)]} ${p.d} ${MONTHS[p.m - 1]}` : String(start); };

/** 1,234 -> "1,234"; used everywhere a number is shown, so the screen, table twin and export agree. */
export const fmtInt = v => (v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Math.round(Number(v)).toLocaleString("en-US"));
/** Axis tick: 1200 -> "1.2k". */
export const compact = v => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : Math.abs(v) >= 1000 ? `${(Math.round(v / 100) / 10).toString()}k` : String(Math.round(v)));

/** Nice axis: returns { max, ticks } with ~`target` intervals and round step sizes (1, 2, 5 × 10ⁿ). */
export function niceScale(rawMax, target = 4) {
  const max = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 1;
  if (max <= 4) { const top = Math.max(1, Math.ceil(max)); return { max: top, ticks: Array.from({ length: top + 1 }, (_, i) => i) }; }
  const rough = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 5, 10].map(f => f * pow).find(s => s >= rough) ?? 10 * pow;
  const top = Math.ceil(max / step) * step;
  const ticks = []; for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}

/** Which indexes get an x-axis label so labels never collide: roughly `maxLabels`, always including first and last. */
export function labelIndexes(n, maxLabels) {
  if (n <= 0) return [];
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (maxLabels - 1));
  const out = []; for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) { if (n - 1 - out[out.length - 1] < step * 0.6) out[out.length - 1] = n - 1; else out.push(n - 1); }
  return out;
}

/** Contiguous runs of measured (non-null) indexes: a line is drawn per run, so missing data is never bridged. */
export function measuredRuns(values) {
  const runs = []; let start = -1;
  values.forEach((v, i) => { if (v === null || v === undefined) { if (start >= 0) { runs.push([start, i - 1]); start = -1; } } else if (start < 0) start = i; });
  if (start >= 0) runs.push([start, values.length - 1]);
  return runs;
}

/** Index range [0, k) of buckets that are "not measured": null buckets before the first measured one (excluding future). */
export function unmeasuredLead(values, futureFlags = []) {
  let k = 0;
  while (k < values.length && (values[k] === null || values[k] === undefined) && !futureFlags[k]) k++;
  return k;
}

/** Nearest bucket for a pointer x. `slots` are bucket centres in px. */
export function nearestIndex(x, centres) {
  let best = 0, d = Infinity;
  for (let i = 0; i < centres.length; i++) { const dd = Math.abs(centres[i] - x); if (dd < d) { d = dd; best = i; } }
  return best;
}

/** SVG path for a bar whose TOP corners are rounded (data end) and whose base sits square on the baseline. */
export function barPath(x, y, w, h, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  if (h <= 0 || w <= 0) return "";
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
