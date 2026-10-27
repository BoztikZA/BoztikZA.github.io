// Unit tests for the PURE Analytics-tab modules (deliver-v3/js/analytics/*): range model, chart maths, comparisons,
// signals, HTML escaping, CSV/report reconciliation. No browser, no network, no database.
//   node scripts/analytics-client-test.mjs        (npm run test:client)
import assert from "node:assert/strict";
import * as R from "../../../deliver-v3/js/analytics/range.js";
import * as C from "../../../deliver-v3/js/analytics/chart-math.js";
import * as M from "../../../deliver-v3/js/analytics/model.js";
import { buildSignals } from "../../../deliver-v3/js/analytics/signals.js";
import * as V from "../../../deliver-v3/js/analytics/views.js";
import { buildCsv, buildFullReport, csvCell } from "../../../deliver-v3/js/analytics/export.js";

let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n    ", e.message); } };
const days = (start, n) => Array.from({ length: n }, (_, i) => R.addDays(start, i));

/* ---------------------------------------------------------------- range */
test("range: presets and garbage normalise, never throw", () => {
  assert.deepEqual(R.normalizeRange("7d"), { kind: "preset", key: "7d" });
  for (const bad of [null, undefined, 5, "banana", {}, { from: "x", to: "y" }, { kind: "custom", from: "2026-02-30", to: "2026-03-01" }]) assert.equal(R.normalizeRange(bad).key, "30d");
});
test("range: custom validation edge cases", () => {
  assert.equal(R.validateCustom("2028-02-29", "2028-03-01", "2030-01-01"), "");          // leap day
  assert.notEqual(R.validateCustom("2026-02-29", "2026-03-01", "2030-01-01"), "");       // not a real day
  assert.notEqual(R.validateCustom("2026-10-10", "2026-10-01", "2030-01-01"), "");       // reversed
  assert.notEqual(R.validateCustom("2026-10-01", "2026-10-30", "2026-10-20"), "");       // future end
  assert.notEqual(R.validateCustom("2019-12-31", "2020-01-02", "2030-01-01"), "");       // before minimum
  assert.equal(R.validateCustom("2025-10-28", "2026-10-28", "2030-01-01"), "");          // 366 days
  assert.notEqual(R.validateCustom("2025-10-27", "2026-10-28", "2030-01-01"), "");       // 367 days
  assert.notEqual(R.validateCustom("2026-10-01", "", "2030-01-01"), "");
});
test("range: query string and window match", () => {
  assert.equal(R.rangeQuery("7d"), "period=7d");
  assert.equal(R.rangeQuery({ kind: "custom", from: "2026-10-01", to: "2026-10-10" }), "from=2026-10-01&to=2026-10-10");
  assert.equal(R.windowMatches("30d", { key: "30d" }), true);
  assert.equal(R.windowMatches("today", { key: "30d" }), false);           // old Worker fallback must be detected
  assert.equal(R.windowMatches({ kind: "custom", from: "2026-10-01", to: "2026-10-10" }, { key: "30d", since: "2026-09-27", until: "2026-10-26" }), false);
  assert.equal(R.windowMatches({ kind: "custom", from: "2026-10-01", to: "2026-10-10" }, { key: "custom", since: "2026-10-01", until: "2026-10-10" }), true);
  assert.equal(R.windowMatches("7d", undefined), false);
});

/* ----------------------------------------------------------- chart maths */
test("chart-math: niceScale gives round ticks covering the max", () => {
  for (const max of [0, 1, 3, 4, 5, 7, 99, 100, 101, 550, 1234, 98765]) {
    const s = C.niceScale(max);
    assert.ok(s.max >= max, `max ${max}`); assert.equal(s.ticks[0], 0); assert.equal(s.ticks.at(-1), s.max);
    assert.ok(s.ticks.length >= 2 && s.ticks.length <= 8, `ticks for ${max}: ${s.ticks}`);
  }
  assert.deepEqual(C.niceScale(0).ticks, [0, 1]);
  assert.deepEqual(C.niceScale(550).ticks, [0, 200, 400, 600]);
});
test("chart-math: labelIndexes never collide and keep first/last", () => {
  assert.deepEqual(C.labelIndexes(3, 8), [0, 1, 2]);
  const idx = C.labelIndexes(30, 8); assert.equal(idx[0], 0); assert.equal(idx.at(-1), 29); assert.ok(idx.length <= 9);
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1]);
  assert.deepEqual(C.labelIndexes(0, 8), []);
});
test("chart-math: gaps are runs, null is never bridged or zero", () => {
  assert.deepEqual(C.measuredRuns([null, null, 1, 2, null, 0, 3]), [[2, 3], [5, 6]]);
  assert.deepEqual(C.measuredRuns([]), []);
  assert.equal(C.unmeasuredLead([null, null, 0, 5], []), 2);
  assert.equal(C.unmeasuredLead([null, null, null], [false, true, true]), 1);
});
test("chart-math: labels and numbers", () => {
  assert.equal(C.axisLabel("2026-10-05", "day"), "5 Oct");
  assert.equal(C.axisLabel("2026-10-05T14:00", "hour"), "14:00");
  assert.equal(C.fullLabel("2026-10-05", "day"), "Monday 5 October 2026");
  assert.equal(C.fmtInt(null), "—"); assert.equal(C.fmtInt(0), "0"); assert.equal(C.fmtInt(1234567), "1,234,567");
  assert.equal(C.compact(1200), "1.2k"); assert.equal(C.compact(15000), "15k");
  assert.equal(C.barPath(0, 10, 10, 0), ""); assert.ok(C.barPath(0, 0, 10, 20).startsWith("M"));
});

/* ----------------------------------------------------------- comparisons */
test("model: like-for-like comparison excludes the in-progress bucket", () => {
  const c = M.compareSeries({ current: [100, 100, 100, 5], previous: [100, 100, 100, 100], exclude: [false, false, false, true] });
  assert.equal(c.status, "ok"); assert.equal(c.change, 0); assert.equal(c.current, 300); assert.equal(c.excluded, 1);
});
test("model: comparison statuses", () => {
  const cmp = (cur, prev, o = {}) => M.compareSeries({ current: cur, previous: prev, ...o });
  assert.equal(cmp([30], [20]).change, 50);
  assert.equal(cmp([5], [0]).status, "from-zero");
  assert.equal(cmp([0], [0]).status, "flat-zero");
  assert.equal(cmp([50], [10]).status, "small-base");                         // 10 < 20 events: no percentage
  assert.equal(cmp([50], [null]).status, "previous-unmeasured");
  assert.equal(cmp([null], [10]).status, "unmeasured");
  assert.equal(cmp([5], null).status, "no-previous");
  assert.equal(cmp([100, 100], [200, 200], { exclude: [true, true] }).status, "unmeasured");
});
test("model: today's hourly page views are not compared with a full day", () => {
  const trend = { granularity: "hour", buckets: [{ start: "2026-10-26T00:00", website_views: 1 }], previous_buckets: [{ start: "2026-10-25T00:00", website_views: 9 }] };
  assert.equal(M.compareMetric(trend, "website_views").status, "not-comparable");
});

/* ------------------------------------------------------------ fixtures */
const D = days("2026-09-27", 30);
const bucket = (start, v, extra = {}) => ({ start, partial: false, future: false, website_views: v, deliver_views: v === null ? null : 2, deliver_downloads: 1, store_clicks: 0, new_deliveries: 0, ...extra });
const trendFor = (vals, prevVals = null) => ({
  granularity: "day", timezone: { label: "UTC+2" }, truncated: false,
  period: { key: "30d", since: D[0], until: D.at(-1), previous: { since: "2026-08-28", until: "2026-09-26" }, includes_today: true },
  buckets: vals.map((v, i) => bucket(D[i], v, i === vals.length - 1 ? { partial: true } : {})),
  previous_buckets: prevVals ? prevVals.map((v, i) => bucket(R.addDays("2026-08-28", i), v)) : null,
  coverage: { website_views: { since: "2026-08-13", basis: "page_analytics", session_coverage_pct: null }, deliver: { since: "2026-08-13" }, store_clicks: { since: "2026-10-01" }, new_deliveries: { since: "2026-08-13" } },
  totals: { current: { website_views: vals.reduce((a, b) => a + (b ?? 0), 0) } }, page_series: { homepage: vals }, previous_page_series: null,
});
const summaryFor = (pages, total) => ({
  period: { key: "30d", since: D[0], until: D.at(-1), previous: { since: "2026-08-28", until: "2026-09-26" } },
  website: { total_views: total, prev_total_views: 100, data_since: "2026-08-13", pages: pages.map(([page, views]) => ({ page, views, prev_views: 10 })) },
  deliver: { types: [{ type: "paid", deliveries_active: 2, views: 40, downloads: 5, shares: 1, prev_views: 30, prev_downloads: 4, prev_shares: 0 }], stored: {} },
});
const vals = D.map((_, i) => 100); vals[29] = 20; // last bucket is today (partial)
const model = (over = {}) => M.buildAnalyticsModel({ range: "30d", summary: summaryFor([["homepage", 2920], ["stores", 80]], 3000), trend: trendFor(vals, D.map(() => 70)), states: {}, generatedAt: new Date("2026-10-26T10:00:00Z"), ...over });

test("model: totals reconcile with the summary and the chart", () => {
  const m = model();
  assert.equal(m.totals.website_views, 3000);
  assert.equal(m.pages.reduce((a, p) => a + p.views, 0), 3000);
  assert.equal(m.pages[0].page, "homepage"); assert.equal(m.pages[0].share, 97.3);
  assert.equal(m.cmp.website_views.status, "ok"); assert.equal(m.cmp.website_views.change, 43); // (2900 / 2030) - 1, partial day left out
});
test("model: a never-recorded collector is 'not measured', not zero", () => {
  const s = summaryFor([], 0); s.website.data_since = null;
  const m = model({ summary: s });
  assert.equal(m.totals.website_views, null);
});

/* -------------------------------------------------------------- signals */
test("signals: a real change is reported with evidence, sparse data is silent", () => {
  const sig = buildSignals(model());
  const ch = sig.find(s => s.id === "views-change");
  assert.ok(ch && /up 43%/.test(ch.title)); assert.ok(ch.evidence.length >= 3); assert.equal(ch.basis, "derived");
  const quiet = buildSignals(model({ trend: trendFor(D.map(() => 3), D.map(() => 3)), summary: summaryFor([["homepage", 90]], 90) }));
  assert.equal(quiet.filter(s => s.level === "notable").length, 0);
});
test("signals: spike and tracking-gap detection", () => {
  const v = D.map(() => 20); v[10] = 400; v[29] = 5;
  assert.ok(buildSignals(model({ trend: trendFor(v, D.map(() => 20)) })).some(s => s.id === "spike"));
  const q = D.map((_, i) => (i < 20 ? 30 : 0)); q[29] = 0;
  const quiet = buildSignals(model({ trend: trendFor(q, D.map(() => 30)) })).find(s => s.id === "quiet");
  assert.ok(quiet && quiet.level === "watch");
});
test("signals: no causal claims", () => {
  const text = JSON.stringify(buildSignals(model()));
  assert.ok(!/because|caused by|due to/i.test(text));
});

/* ---------------------------------------------------------------- views */
const EVIL = `<img src=x onerror=alert(1)>"'&`;
test("views: API strings are escaped everywhere", () => {
  const m = model({
    sources: { total: 5, sources: [{ source: "reddit", visits: 5 }], campaigns: [{ utm_campaign: EVIL, utm_source: EVIL, utm_medium: EVIL, visits: 5 }], previous: null, data_since: "2026-10-06" },
    store: { total: 1, outbound_total: 1, unique_sessions: 1, store_page_views: 1, product_card_clicks: 0, by_destination: [{ destination: EVIL, clicks: 1, unique_sessions: 1, top_source: EVIL }], sources: [{ source_placement: EVIL, clicks: 1 }], previous: null, data_since: "2026-10-01" },
    health: { generated_at: "2026-10-26T10:00:00Z", timezone: { label: EVIL, boundary: EVIL }, collectors: { page_views: { status: "receiving", first_day: EVIL, last_day: EVIL }, sessions: { status: "quiet" }, attribution: { status: "no_data_yet" }, store_clicks: { status: "receiving" } }, ga4: { detail: EVIL }, retention_days: 90, privacy_exclusions: [EVIL], known_gaps: [EVIL], page_views_before_session_tracking: 0 },
  });
  const html = [V.sourcesView(m), V.storeView(m), V.healthView(m), V.pagesView(m, { q: EVIL }), V.signalsView(buildSignals(m), m)].join("");
  assert.ok(!html.includes("<img"), "raw <img> reached the markup");
  assert.ok(!/onerror=alert/.test(html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, "")), "event handler attribute reached the markup");
});
test("views: sort puts null last in both directions; paginate clamps; filter is case-insensitive", () => {
  const rows = [{ label: "B", page: "b", views: 5, cmp: { change: null } }, { label: "A", page: "a", views: 5, cmp: { change: 10 } }, { label: "C", page: "c", views: 9, cmp: { change: -5 } }];
  assert.deepEqual(V.sortPages(rows, "change", "desc").map(r => r.label), ["A", "C", "B"]);
  assert.deepEqual(V.sortPages(rows, "change", "asc").map(r => r.label), ["C", "A", "B"]);
  assert.deepEqual(V.sortPages(rows, "views", "desc").map(r => r.label), ["C", "A", "B"]);   // tie broken by label
  assert.equal(V.paginate(rows, 99, 2).page, 2); assert.equal(V.paginate(rows, -3, 2).page, 1); assert.equal(V.paginate([], 1, 8).pages, 1);
  assert.equal(V.filterPages(rows, " A ").length, 1); assert.equal(V.filterPages(rows, "").length, 3);
});
test("views: unavailable sections say so and offer retry", () => {
  const m = model({ states: { sources: { status: "error", error: "boom" }, flow: { status: "missing" }, health: { status: "loading" } } });
  assert.ok(V.sourcesView(m).includes("data-retry"));
  assert.ok(V.flowView(m).includes("updated Worker"));
  assert.ok(V.healthView(m).includes("Loading"));
});

/* --------------------------------------------------------------- export */
test("export: CSV cells are safe and quoted", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+1"), "'+1"); assert.equal(csvCell("a,b"), "\"a,b\""); assert.equal(csvCell(null), ""); assert.equal(csvCell(0), "0");
  assert.equal(csvCell(NaN), "");
});
test("export: CSV and report carry the same numbers as the model", () => {
  const m = model();
  const csv = buildCsv(m, { generatedAt: new Date("2026-10-26T10:00:00Z") });
  assert.ok(csv.includes("Page views,3000,"));
  const trendRows = csv.split("\r\n").filter(l => /^2026-(09|10)-\d\d,(yes|no),/.test(l));
  assert.equal(trendRows.length, 30);
  assert.equal(trendRows.reduce((a, l) => a + Number(l.split(",")[2]), 0), vals.reduce((a, b) => a + b, 0));
  const rep = buildFullReport(m, { generatedAt: new Date("2026-10-26T10:00:00Z") });
  assert.ok(rep.includes("Page views (counted page loads): 3,000"));
  assert.ok(rep.includes("TREND (like-for-like)") && rep.includes("WHAT STANDS OUT") && rep.includes("DATA HEALTH"));
});
test("export: unmeasured stays an empty CSV cell", () => {
  const t = trendFor(D.map((_, i) => (i < 3 ? null : 10)), D.map(() => 10));
  const csv = buildCsv(model({ trend: t }));
  assert.ok(csv.split("\r\n").some(l => l.startsWith(`${D[0]},no,,`)), "first bucket should have an empty page-views cell");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
