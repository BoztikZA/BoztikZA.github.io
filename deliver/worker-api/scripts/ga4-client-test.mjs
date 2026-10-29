// Unit tests for the PURE GA4 frontend modules (deliver-v3/js/analytics/ga4-views.js, ga4-client.js).
// No browser, no network. GA4 data below is hand-made fixtures, NOT live Google data.
//   node scripts/ga4-client-test.mjs        (npm run test:ga4-client)
import assert from "node:assert/strict";
import * as G from "../../../deliver-v3/js/analytics/ga4-views.js";

let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n    ", e.message); } };
const EVIL = `<img src=x onerror=alert(1)>"'&`;
const m = (o) => ({ sessions: 0, totalUsers: 0, engagedSessions: 0, engagementRate: 0, ...o });
const row = (key, cur, prev, dims = {}) => ({ key, dims, current: cur, previous: prev });
const okRep = (id, data, rows) => ({ id, phase: "ok", data: { state: "ok", period: { key: "7d", since: "2026-10-19", until: "2026-10-25" }, previous: { since: "2026-10-12", until: "2026-10-18" }, totals: { current: m({ sessions: 14 }), previous: m({ sessions: 8 }) }, has_more: false, row_count: rows.length, freshness: { fetched_at: "2026-10-25T10:00:00Z", cache: "hit", age_seconds: 300, includes_today: true, note: "lag note" }, property: { timezone: "Africa/Johannesburg" }, ...data }, rows });
const state = (reports, status = { phase: "ok", data: { configured: true } }) => ({ status, reports, verify: null });

test("change: from zero is 'New', zero to zero is flat, never an infinite percentage", () => {
  assert.deepEqual(G.ga4Change(5, 0), { kind: "up", text: "New" });
  assert.deepEqual(G.ga4Change(0, 0), { kind: "flat", text: "No change" });
});
test("change: small bases show the raw difference, large bases a rounded percentage", () => {
  assert.equal(G.ga4Change(8, 5).text, "+3 (small base)");
  assert.equal(G.ga4Change(150, 100).text, "+50%");
  assert.equal(G.ga4Change(75, 100).text, "−25%");
  assert.equal(G.ga4Change(100, 100).kind, "flat");
});
test("change: missing numbers are 'No comparison', never treated as zero", () => {
  for (const [a, b] of [[null, 5], [5, null], [undefined, undefined], [NaN, 1]]) assert.equal(G.ga4Change(a, b).kind, "none");
});
test("change: rates use percentage points, durations use time", () => {
  assert.equal(G.ga4Change(0.6, 0.4, { unit: "rate" }).text, "+20.0 pp");
  assert.equal(G.ga4Change(0.4, 0.4, { unit: "rate" }).kind, "flat");
  assert.equal(G.ga4Change(125, 60, { unit: "duration" }).text, "+1m 05s");
});
test("formatters: missing is a dash, zero is a number", () => {
  assert.equal(G.fmtRate(null), "—"); assert.equal(G.fmtRate(0), "0.0%"); assert.equal(G.fmtRate(0.5714), "57.1%");
  assert.equal(G.fmtDuration(null), "—"); assert.equal(G.fmtDuration(0), "0s"); assert.equal(G.fmtDuration(59), "59s"); assert.equal(G.fmtDuration(3725), "1h 02m");
});
test("merge: halves from different pages combine; zero only after the last page of a comparison", () => {
  const p1 = { rows: [row("a", m({ sessions: 9 }), null), row("b", null, m({ sessions: 4 }))] };
  const p2 = { rows: [row("a", null, m({ sessions: 3 })), row("c", m({ sessions: 1 }), null)] };
  const mid = G.mergeReportPages([p1, p2], { compared: true, complete: false });
  assert.equal(mid.find(r => r.key === "a").previous.sessions, 3);
  assert.equal(mid.find(r => r.key === "c").previous, null, "unknown until every page is in");
  const done = G.mergeReportPages([p1, p2], { compared: true, complete: true });
  assert.equal(done.find(r => r.key === "c").previous.sessions, 0);
  assert.equal(done.find(r => r.key === "b").current.sessions, 0);
  const noCmp = G.mergeReportPages([p1], { compared: false, complete: true });
  assert.equal(noCmp.find(r => r.key === "a").previous, null, "no comparison requested: previous stays absent");
});
test("states: no rows is a calm real zero; an error is an alert with a retry; the two never share wording", () => {
  const empty = G.reportState({ id: "sources", phase: "ok", data: { state: "empty" } }, "Sources");
  assert.match(empty, /real zero/); assert.ok(!/role="alert"/.test(empty));
  const err = G.reportState({ id: "sources", phase: "error", error: { code: "ga4_permission_denied", message: "x" } }, "Sources");
  assert.match(err, /role="alert"/); assert.match(err, /data-ga4-retry="sources"/); assert.match(err, /Viewer/); assert.ok(!/real zero/.test(err));
  assert.match(G.reportState({ id: "sources", phase: "loading" }, "Sources"), /Loading Sources/);
  assert.match(G.reportState({ id: "sources", phase: "error", error: { isMissingRoute: true } }, "Sources"), /updated Worker/);
  assert.equal(G.reportState(okRep("sources", {}, []), "Sources"), "");
});
test("states: quota errors say when to retry", () => {
  assert.match(G.reportState({ id: "pages", phase: "error", error: { code: "ga4_quota_exceeded", retryAfter: 60 } }, "Pages"), /about 1 minute/);
});
test("common failure: several reports failing the same way collapse into one banner", () => {
  const e = { code: "ga4_permission_denied" };
  const reps = { a: { phase: "error", error: e }, b: { phase: "error", error: e }, c: { phase: "error", error: e }, d: { phase: "ok" } };
  assert.equal(G.commonFailure(reps), e);
  assert.equal(G.commonFailure({ a: { phase: "error", error: e }, b: { phase: "error", error: { code: "other" } }, c: { phase: "error", error: e } }), null);
  assert.equal(G.commonFailure({ a: { phase: "error", error: e } }), null);
  const body = G.bodyView(state(reps));
  assert.equal((body.match(/Google refused access/g) || []).length, 1, "one banner, not one per report");
});
test("badge: not connected / connected / access problem / worker too old", () => {
  assert.equal(G.badgeFor(state({}, { phase: "ok", data: { configured: false } })).text, "GA4: not connected");
  assert.equal(G.badgeFor(state({ o: { phase: "ok" } })).text, "GA4: connected");
  assert.equal(G.badgeFor(state({}, { phase: "error", error: { isMissingRoute: true } })).text, "GA4: needs updated Worker");
  const e = { code: "x" };
  assert.equal(G.badgeFor(state({ a: { phase: "error", error: e }, b: { phase: "error", error: e }, c: { phase: "error", error: e } })).text, "GA4: access problem");
});
test("not connected: names what is missing, explains setup, invents no numbers", () => {
  const html = G.bodyView(state({}, { phase: "ok", data: { configured: false, missing: ["GA4_PROPERTY_ID"], invalid: ["GA4_SERVICE_ACCOUNT_JSON"] } }));
  assert.match(html, /GA4_PROPERTY_ID/); assert.match(html, /analytics\.readonly/); assert.match(html, /numeric/);
  assert.ok(!/an-kpi/.test(html) && !/<table/.test(html), "no figures while disconnected");
});
test("header: shows period, comparison period, GA4 timezone, last refresh and the freshness caveat", () => {
  const html = G.headerView(state({ overview: okRep("overview", {}, []) }));
  for (const t of ["2026-10-19 to 2026-10-25", "compared with 2026-10-12 to 2026-10-18", "Africa/Johannesburg", "Last successful refresh", "cached, 5 min old", "lag note", "still in progress"]) assert.ok(html.includes(t), t);
  assert.match(G.headerView(state({})), /Last successful refresh: never/);
});
test("KPIs: zero stays 0, missing is a dash, GA4 badge on every card", () => {
  const rep = okRep("overview", { totals: { current: { totalUsers: 0, newUsers: 5, sessions: 20, engagedSessions: 9, engagementRate: 0.45, screenPageViews: 50, avgEngagementSeconds: null }, previous: { totalUsers: 4, sessions: 10 } } }, []);
  const html = G.kpiView(rep);
  assert.match(html, /an-kpi-val">0</); assert.match(html, /an-kpi-val"><span class="an-na"/);
  assert.equal((html.match(/GA4 · Google/g) || []).length, 7);
  assert.ok(html.includes("45.0%"));
});
test("tables: GA4 total row, comparison column, user-type labels, show-more with progress", () => {
  const rep = okRep("sources", { has_more: true, row_count: 40, next_offset: 2 }, [row("g", m({ sessions: 30 }), m({ sessions: 20 }), { source_medium: "google / organic" })]);
  const html = G.tableView("sources", rep);
  assert.match(html, /google \/ organic/); assert.match(html, /\+50%/); assert.match(html, /GA4 total/); assert.match(html, /data-ga4-more="sources"/); assert.match(html, /1 of 40 loaded/);
  const nr = G.tableView("new-returning", okRep("new-returning", {}, [row("n", m({ totalUsers: 3 }), null, { user_type: "new" }), row("r", m({ totalUsers: 2 }), null, { user_type: "(not set)" })]));
  assert.match(nr, /New users/); assert.match(nr, /Not classified/);
});
test("actions: grouped by category, a click is never called a purchase, destinations are hosts only", () => {
  const rep = okRep("actions", { extra: { groups: [{ group: "outbound_store", label: "Outbound store links", clicks: 10, previous_clicks: 4 }], rows: [{ key: "k", label: "Redbubble", dims: { action: "redbubble_store", destination: "redbubble.com" }, current: { eventCount: 7, totalUsers: 5 }, previous: null }] } }, []);
  const html = G.actionsView(rep);
  assert.match(html, /Outbound store links/); assert.match(html, /Redbubble/); assert.match(html, /redbubble\.com/);
  assert.match(html, /not a purchase/); assert.ok(!/purchases? (made|completed)|sales/i.test(html));
});
test("actions: unregistered custom dimensions get an exact, actionable explanation", () => {
  const rep = okRep("actions", { state: "custom_dimensions_missing", extra: { missing_dimensions: ["action", "destination"] } }, [row("e", m({ eventCount: 14 }), null, {})]);
  rep.rows[0].current = { eventCount: 14 };
  const html = G.actionsView(rep);
  for (const t of ["<code>action</code>", "<code>destination</code>", "event-scoped", "14"]) assert.ok(html.includes(t), t);
});
test("ESCAPING: every value that comes from the API is escaped", () => {
  const html = [
    G.tableView("sources", okRep("sources", {}, [row("x", m({ sessions: 1 }), null, { source_medium: EVIL })])),
    G.tableView("pages", okRep("pages", {}, [row("y", { screenPageViews: 1 }, null, { page_path: EVIL })])),
    G.actionsView(okRep("actions", { extra: { groups: [{ group: "g", label: EVIL, clicks: 1, previous_clicks: 0 }], rows: [{ key: "k", label: EVIL, dims: { destination: EVIL }, current: { eventCount: 1, totalUsers: 1 }, previous: null }] } }, [])),
    G.reportState({ id: EVIL, phase: "error", error: { code: "zzz", message: EVIL } }, EVIL),
    G.headerView(state({ o: okRep("overview", { period: { since: EVIL, until: EVIL }, previous: { since: EVIL, until: EVIL }, property: { timezone: EVIL }, freshness: { fetched_at: "2026-10-25T10:00:00Z", cache: "miss", age_seconds: 0, note: EVIL } }, []) })),
    G.bodyView(state({}, { phase: "ok", data: { configured: false, missing: [EVIL], invalid: [EVIL] } })),
    G.bodyView(state({}, { phase: "error", error: { message: EVIL } })),
  ].join("\n");
  assert.ok(!html.includes("<img"), "raw markup from the API must never be rendered");
  assert.ok(html.includes("&lt;img"));
});
test("SEPARATION: GA4 views never reference first-party or Deliver models, and always label their source", () => {
  const html = G.bodyView(state({ overview: okRep("overview", { totals: { current: { totalUsers: 1 }, previous: null } }, []) }));
  assert.match(html, /never added together/);
  assert.ok(!/Deliver views|Store-link clicks|Counted page loads/.test(html));
});
globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
const C = await import("../../../deliver-v3/js/analytics/ga4-client.js");
const authMod = await import("../../../deliver-v3/js/auth.js");
const calls = [];
const stubFetch = (status, body, headers = {}) => { globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status, headers }); }; };
const run = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n    ", e.message); } };

await run("client: unknown report ids are refused before any request", async () => {
  calls.length = 0; stubFetch(200, {});
  for (const bad of ["nope", "__proto__", "constructor", "sources/../../deliveries", ""]) assert.throws(() => C.fetchGa4Report(bad, "7d"), C.Ga4Error);
  assert.equal(calls.length, 0);
});
await run("client: builds GET URLs from the range, bounds the page size and sends only the session header", async () => {
  calls.length = 0; stubFetch(200, { ok: true });
  localStorage.setItem("boztik-deliver-session-v3", JSON.stringify({ token: "tok-123", email: "a@b.c", expires_at: new Date(Date.now() + 3600e3).toISOString() }));
  await C.fetchGa4Report("sources", { kind: "custom", from: "2026-10-01", to: "2026-10-07" }, { compare: false, limit: 5000, offset: 50, refresh: true });
  await C.fetchGa4Report("pages", "7d", { compare: true });
  await C.fetchGa4Status(true);
  assert.match(calls[0].url, /\/api\/admin\/analytics\/ga4\/sources\?from=2026-10-01&to=2026-10-07&compare=0&limit=100&offset=50&refresh=1$/);
  assert.match(calls[1].url, /ga4\/pages\?period=7d&compare=1$/);
  assert.match(calls[2].url, /ga4\/status\?verify=1$/);
  for (const c of calls) { assert.equal(c.init.headers.Authorization, "Bearer tok-123"); assert.equal(c.init.method, "GET"); assert.ok(!c.init.body); assert.deepEqual(Object.keys(c.init.headers).filter(h => h.toLowerCase() !== "authorization"), []); }
});
await run("client: Worker errors keep their code, missing/invalid setting names and Retry-After", async () => {
  stubFetch(503, { ok: false, error: "GA4 is not connected to the Worker yet.", code: "ga4_not_configured", missing: ["GA4_PROPERTY_ID"], invalid: [] });
  const e = await C.fetchGa4Status(false).catch(x => x);
  assert.ok(e instanceof C.Ga4Error && e.isNotConfigured && e.missing[0] === "GA4_PROPERTY_ID");
  stubFetch(429, { ok: false, error: "quota", code: "ga4_quota_exceeded" }, { "Retry-After": "60" });
  assert.equal((await C.fetchGa4Report("pages", "7d").catch(x => x)).retryAfter, 60);
  stubFetch(404, { ok: false, error: "Not found" });
  assert.equal((await C.fetchGa4Status(false).catch(x => x)).isMissingRoute, true, "an older Worker without the routes is detected");
});
await run("client: a 401 clears the local session; network failure is a friendly Ga4Error; abort stays an abort", async () => {
  localStorage.setItem("boztik-deliver-session-v3", JSON.stringify({ token: "t", email: "a@b.c", expires_at: new Date(Date.now() + 3600e3).toISOString() }));
  assert.equal(authMod.authToken(), "t", "precondition: a session is stored");
  stubFetch(401, { ok: false, error: "Authentication required", code: "unauthorized" });
  await C.fetchGa4Status(false).catch(() => {});
  assert.equal(authMod.authToken(), null);
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  assert.equal((await C.fetchGa4Status(false).catch(x => x)).code, "network");
  globalThis.fetch = async () => { throw Object.assign(new Error("a"), { name: "AbortError" }); };
  assert.equal((await C.fetchGa4Status(false).catch(x => x)).name, "AbortError");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
