// Reporting-range model for the Analytics tab. PURE (no DOM, no network) so it can be unit-tested in Node.
//
// A range is either a preset ("today" | "7d" | "30d" | "90d" | "all") or a custom span of whole local calendar days
// { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }. The Worker is authoritative: it validates the range again and answers
// with the window it actually used, and `windowMatches` lets the UI refuse to show numbers for a different window
// than the one requested (an older Worker silently falls back to 30 days for ranges it does not know).

export const PRESETS = Object.freeze([
  { key: "today", label: "Today", long: "Today so far" },
  { key: "7d", label: "7 days", long: "Last 7 days" },
  { key: "30d", label: "30 days", long: "Last 30 days" },
  { key: "90d", label: "90 days", long: "Last 90 days" },
  { key: "all", label: "All data", long: "All available data" },
]);
export const DEFAULT_RANGE = Object.freeze({ kind: "preset", key: "30d" });
export const MIN_CUSTOM_DAY = "2020-01-01";
export const MAX_CUSTOM_DAYS = 366;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isRealDay(s) {
  if (typeof s !== "string" || !DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
export const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Client-side pre-check for the custom range form. The Worker repeats every rule. Returns "" when valid. */
export function validateCustom(from, to, today) {
  if (!isRealDay(from) || !isRealDay(to)) return "Choose both a start and an end date.";
  if (from > to) return "The start date must not be after the end date.";
  if (today && to > today) return "The end date cannot be in the future.";
  if (from < MIN_CUSTOM_DAY) return `The start date cannot be before ${MIN_CUSTOM_DAY}.`;
  if (dayDiff(from, to) + 1 > MAX_CUSTOM_DAYS) return `Choose at most ${MAX_CUSTOM_DAYS} days.`;
  return "";
}

/** Anything the UI or storage hands us -> a clean range object, or the default. Never throws. */
export function normalizeRange(input) {
  if (typeof input === "string") return PRESETS.some(p => p.key === input) ? { kind: "preset", key: input } : { ...DEFAULT_RANGE };
  if (input && typeof input === "object") {
    if (input.kind === "custom" || (input.from && input.to)) {
      return validateCustom(input.from, input.to, null) === "" ? { kind: "custom", from: input.from, to: input.to } : { ...DEFAULT_RANGE };
    }
    if (typeof input.key === "string" || typeof input.period === "string") return normalizeRange(input.key ?? input.period);
  }
  return { ...DEFAULT_RANGE };
}

export const isCustom = r => normalizeRange(r).kind === "custom";
export const rangeId = r => { const n = normalizeRange(r); return n.kind === "custom" ? `custom:${n.from}:${n.to}` : n.key; };

/** Query string for the Worker: ?period=… or ?from=…&to=… */
export function rangeQuery(range) {
  const n = normalizeRange(range);
  return n.kind === "custom" ? `from=${encodeURIComponent(n.from)}&to=${encodeURIComponent(n.to)}` : `period=${encodeURIComponent(n.key)}`;
}

export function rangeLabel(range) {
  const n = normalizeRange(range);
  if (n.kind === "custom") return `${n.from} to ${n.to}`;
  return PRESETS.find(p => p.key === n.key)?.long ?? n.key;
}

/** Did the Worker answer for the window that was asked for? `period` is the `period` object of any analytics response. */
export function windowMatches(range, period) {
  if (!period) return false;
  const n = normalizeRange(range);
  if (n.kind === "custom") return period.key === "custom" && period.since === n.from && period.until === n.to;
  return period.key === n.key;
}
