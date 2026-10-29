// GA4 Data API integration tests.
//
// IMPORTANT — WHAT THESE TESTS ARE: every response from Google below is a MOCK built in this file. They prove how the
// Worker builds requests, parses and merges responses, validates input, caches, rate-limits itself, authenticates and
// keeps secrets out of responses and logs. They do NOT prove that Google accepts these credentials or that the property
// returns data; that needs a live check (see docs/ga4-command-centre.md, "Live verification"). The RSA key is generated
// at run time and is never written to disk.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const loadBundle = async (entryPoint: string) => {
  const result = await build({ entryPoints: [entryPoint], bundle: true, platform: "node", format: "esm", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
};
const ga4 = await loadBundle("src/lib/ga4.ts");
const auth = await loadBundle("src/lib/auth.ts");
const worker = await loadBundle("src/index.ts");

let checks = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { ga4.resetGa4State(); await fn(); checks += 1; console.log(`  ok  ${name}`); };

// ---- fixed clock: 2026-10-25 12:00 SAST -------------------------------------------------------------------------
const T0 = Date.UTC(2026, 9, 25, 10, 0, 0);
let clock = T0;
const realNow = Date.now;
Date.now = () => clock;
const now = () => clock;

// ---- credentials (generated, in memory only) ---------------------------------------------------------------------
const keyPair = await webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64");
const PEM = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
const SA_EMAIL = "reader@boztik-test.iam.gserviceaccount.com";
const SA_JSON = JSON.stringify({ type: "service_account", client_email: SA_EMAIL, private_key: PEM, project_id: "boztik-test" });
const baseEnv = (extra: Record<string, unknown> = {}): any => ({ GA4_PROPERTY_ID: "412345678", GA4_SERVICE_ACCOUNT_JSON: SA_JSON, ...extra });

// ---- mocked Google -----------------------------------------------------------------------------------------------
interface Call { url: string; method: string; headers: Record<string, string>; body: any }
interface GoogleOpts {
  token?: () => { status: number; body: unknown };
  report?: (call: Call) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
  metadata?: () => { status: number; body: unknown };
  hang?: boolean;
}
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SECRET_TOKEN = "ya29.SECRET-ACCESS-TOKEN-VALUE";
const SECRET_BODY_MARKER = "GOOGLE-INTERNAL-PROJECT-12345";
function makeGoogle(o: GoogleOpts = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit).forEach((v, k) => { headers[k] = v; });
    const raw = typeof init.body === "string" ? init.body : "";
    const call: Call = { url, method: init.method ?? "GET", headers, body: headers["content-type"]?.includes("json") && raw ? JSON.parse(raw) : raw };
    calls.push(call);
    if (o.hang) return new Promise((_res, rej) => { init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))); });
    let out: { status: number; body: unknown };
    if (url === TOKEN_URL) out = o.token ? o.token() : { status: 200, body: { access_token: SECRET_TOKEN, expires_in: 3600, token_type: "Bearer" } };
    else if (url.endsWith("/metadata")) out = o.metadata ? o.metadata() : { status: 200, body: { dimensions: [{ apiName: "pagePath" }, { apiName: "customEvent:action" }, { apiName: "customEvent:destination" }, { apiName: "customEvent:position" }, { apiName: "customEvent:page_key" }] } };
    else if (url.endsWith(":runReport")) out = o.report ? await o.report(call) : { status: 200, body: {} };
    else out = { status: 404, body: { error: { status: "NOT_FOUND" } } };
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, calls, reports: () => calls.filter((c) => c.url.endsWith(":runReport")), tokens: () => calls.filter((c) => c.url === TOKEN_URL) };
}
const memCache = () => {
  const m = new Map<string, { value: unknown; storedAt: number; expiresAt: number }>();
  return {
    async get(k: string) { const e = m.get(k); return e && e.expiresAt > clock ? { value: e.value, storedAt: e.storedAt } : null; },
    async put(k: string, value: unknown, ttl: number, storedAt: number) { m.set(k, { value, storedAt, expiresAt: clock + ttl * 1000 }); },
  };
};
const mv = (...v: Array<string | number>) => v.map((x) => ({ value: String(x) }));
const sourcesBody = () => ({
  dimensionHeaders: [{ name: "sessionSourceMedium" }, { name: "dateRange" }],
  metricHeaders: [],
  rows: [
    { dimensionValues: mv("google / organic", "current"), metricValues: mv(10, 8, 6, 0.6) },
    { dimensionValues: mv("(direct) / (none)", "current"), metricValues: mv(4, 4, 1, 0.25) },
    { dimensionValues: mv("google / organic", "previous"), metricValues: mv(5, 5, 2, 0.4) },
    { dimensionValues: mv("reddit.com / referral", "previous"), metricValues: mv(3, 3, 1, 0.33) },
  ],
  totals: [
    { dimensionValues: mv("RESERVED_TOTAL", "current"), metricValues: mv(14, 12, 7, 0.5) },
    { dimensionValues: mv("RESERVED_TOTAL", "previous"), metricValues: mv(8, 8, 3, 0.375) },
  ],
  rowCount: 4,
  metadata: { timeZone: "Africa/Johannesburg", currencyCode: "USD", subjectToThresholding: false },
});
const q = (s: string) => new URLSearchParams(s);
const run = (env: any, report: string, query: string, g: ReturnType<typeof makeGoogle>, extra: Record<string, unknown> = {}) =>
  ga4.ga4Report(env, report, q(query), { fetch: g.fetch, cache: memCache(), now, ...extra });
const reject = async (p: Promise<unknown>, status: number, code: string) => {
  try { await p; } catch (e: any) { assert.equal(e.status, status, `status ${e.status} ${e.message}`); assert.equal(e.code, code); return e; }
  assert.fail(`expected ${status} ${code}`);
};

console.log("configuration (no network)");
await check("missing settings are named, values are never echoed", () => {
  const none = ga4.readGa4Config({});
  assert.equal(none.config, null);
  assert.deepEqual(none.missing, ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"]);
  const ok = ga4.readGa4Config(baseEnv());
  assert.equal(ok.config?.propertyId, "412345678");
  assert.deepEqual([ok.missing, ok.invalid], [[], []]);
});
await check("the G- measurement ID is rejected as a property ID; bad JSON and non-service-account keys are invalid", () => {
  assert.deepEqual(ga4.readGa4Config(baseEnv({ GA4_PROPERTY_ID: "G-H8W54EBM20" })).invalid, ["GA4_PROPERTY_ID"]);
  assert.deepEqual(ga4.readGa4Config(baseEnv({ GA4_PROPERTY_ID: "12" })).invalid, ["GA4_PROPERTY_ID"]);
  assert.deepEqual(ga4.readGa4Config(baseEnv({ GA4_SERVICE_ACCOUNT_JSON: "{not json" })).invalid, ["GA4_SERVICE_ACCOUNT_JSON"]);
  assert.deepEqual(ga4.readGa4Config(baseEnv({ GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "authorized_user", client_email: "x", private_key: "y" }) })).invalid, ["GA4_SERVICE_ACCOUNT_JSON"]);
});
await check("an unconfigured Worker answers 503 ga4_not_configured naming only the missing settings", async () => {
  const g = makeGoogle();
  const e = await reject(run({}, "overview", "period=7d", g), 503, "ga4_not_configured");
  assert.deepEqual(e.details.missing, ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"]);
  assert.equal(g.calls.length, 0, "no request may leave the Worker when it is not configured");
});

console.log("authentication with Google (mocked)");
await check("the JWT asks for exactly analytics.readonly, is signed by the service account key, and the token is reused", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  const deps = { fetch: g.fetch, cache: memCache(), now };
  await ga4.ga4Report(baseEnv(), "sources", q("period=7d"), deps);
  await ga4.ga4Report(baseEnv(), "channels", q("period=7d"), deps); // different report -> second Google call, same token
  assert.equal(g.tokens().length, 1, "access token must be cached between calls");
  const form = new URLSearchParams(g.tokens()[0].body as string);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [h, c, s] = form.get("assertion")!.split(".");
  const dec = (x: string) => JSON.parse(Buffer.from(x, "base64url").toString());
  assert.deepEqual(dec(h), { alg: "RS256", typ: "JWT" });
  const claims = dec(c);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/analytics.readonly");
  assert.equal(claims.iss, SA_EMAIL);
  assert.equal(claims.aud, TOKEN_URL);
  assert.equal(claims.exp - claims.iat, 3600);
  const valid = await webcrypto.subtle.verify("RSASSA-PKCS1-v1_5", keyPair.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${c}`));
  assert.equal(valid, true, "signature must verify with the service account's public key");
  for (const r of g.reports()) assert.equal(r.headers.authorization, `Bearer ${SECRET_TOKEN}`);
});
await check("an expired token is renewed", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  await run(baseEnv(), "sources", "period=7d", g);
  clock += 3600_000;
  await run(baseEnv(), "channels", "period=7d", g);
  assert.equal(g.tokens().length, 2);
  clock = T0;
});
await check("Google rejecting the credentials becomes ga4_auth_failed with no Google detail", async () => {
  const g = makeGoogle({ token: () => ({ status: 400, body: { error: "invalid_grant", error_description: SECRET_BODY_MARKER } }) });
  const e = await reject(run(baseEnv(), "overview", "period=7d", g), 502, "ga4_auth_failed");
  assert.ok(!e.message.includes(SECRET_BODY_MARKER));
});

console.log("report requests and responses (mocked)");
await check("the request is built from the fixed catalogue: named date ranges, bounded page, allow-listed fields only", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  await run(baseEnv(), "sources", "period=7d&limit=10&offset=20", g);
  const r = g.reports()[0];
  assert.equal(r.url, "https://analyticsdata.googleapis.com/v1beta/properties/412345678:runReport");
  assert.deepEqual(r.body.dateRanges, [
    { startDate: "2026-10-19", endDate: "2026-10-25", name: "current" },
    { startDate: "2026-10-12", endDate: "2026-10-18", name: "previous" },
  ]);
  assert.deepEqual(r.body.dimensions, [{ name: "sessionSourceMedium" }]);
  assert.deepEqual(r.body.metrics.map((m: any) => m.name), ["sessions", "totalUsers", "engagedSessions", "engagementRate"]);
  assert.equal(r.body.limit, "10"); assert.equal(r.body.offset, "20");
  assert.equal(r.body.keepEmptyRows, false);
  assert.deepEqual(r.body.metricAggregations, ["TOTAL"]);
});
await check("current and previous rows merge per dimension value; a value seen in one period only is a real zero in the other", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  const res = await run(baseEnv(), "sources", "period=7d", g);
  assert.equal(res.state, "ok");
  const by = Object.fromEntries(res.rows.map((r: any) => [r.dims.source_medium, r]));
  assert.equal(by["google / organic"].current.sessions, 10);
  assert.equal(by["google / organic"].previous.sessions, 5);
  assert.equal(by["(direct) / (none)"].previous.sessions, 0, "absent from the previous period = genuine zero");
  assert.equal(by["reddit.com / referral"].current.sessions, 0, "absent from the current period = genuine zero");
  assert.deepEqual(res.rows.map((r: any) => r.dims.source_medium), ["google / organic", "(direct) / (none)", "reddit.com / referral"], "sorted by current sessions");
  assert.equal(res.totals.current.sessions, 14); assert.equal(res.totals.previous.sessions, 8);
  assert.equal(res.property.timezone, "Africa/Johannesburg");
  assert.deepEqual(res.period, { key: "7d", since: "2026-10-19", until: "2026-10-25" });
  assert.deepEqual(res.previous, { since: "2026-10-12", until: "2026-10-18" });
});
await check("the overview computes average engagement time per active user and keeps zero distinct from missing", async () => {
  const body = { dimensionHeaders: [{ name: "dateRange" }], rows: [
    { dimensionValues: mv("current"), metricValues: mv(12, 9, 14, 8, 0.57, 40, 10, 500) },
    { dimensionValues: mv("previous"), metricValues: mv(0, 0, 0, 0, 0, 0, 0, 0) },
  ], rowCount: 2 };
  const res = await run(baseEnv(), "overview", "period=7d", makeGoogle({ report: () => ({ status: 200, body }) }));
  assert.equal(res.totals.current.avgEngagementSeconds, 50);
  assert.equal(res.totals.current.totalUsers, 12);
  assert.equal(res.totals.previous.totalUsers, 0, "0 stays 0");
  assert.equal(res.totals.previous.avgEngagementSeconds, null, "no active users -> not computable, never 0 or NaN");
});
await check("an empty report is state=empty (a genuine zero), not an error and not missing data", async () => {
  const res = await run(baseEnv(), "sources", "period=7d", makeGoogle({ report: () => ({ status: 200, body: { rowCount: 0 } }) }));
  assert.equal(res.state, "empty"); assert.deepEqual(res.rows, []);
});
await check("pagination: has_more follows Google's rowCount; the offset is passed through", async () => {
  const page = (rows: number, total: number) => ({ dimensionHeaders: [{ name: "pagePath" }, { name: "dateRange" }],
    rows: Array.from({ length: rows }, (_, i) => ({ dimensionValues: mv(`/p${i}`, "current"), metricValues: mv(10 - i, 5, 3, 100) })), rowCount: total });
  const more = await run(baseEnv(), "pages", "period=30d&compare=0&limit=2", makeGoogle({ report: () => ({ status: 200, body: page(2, 5) }) }));
  assert.equal(more.has_more, true); assert.equal(more.row_count, 5);
  assert.equal(more.next_offset, 2); assert.equal(more.complete, false);
  const last = await run(baseEnv(), "pages", "period=30d&compare=0&limit=2&offset=4", makeGoogle({ report: () => ({ status: 200, body: page(1, 5) }) }));
  assert.equal(last.has_more, false);
  assert.equal(last.offset, 4); assert.equal(last.next_offset, null); assert.equal(last.complete, false, "a later page is never the whole result");
  const whole = await run(baseEnv(), "pages", "period=30d&compare=0", makeGoogle({ report: () => ({ status: 200, body: page(3, 3) }) }));
  assert.equal(whole.complete, true); assert.equal(whole.next_offset, null);
});
await check("with a comparison, a later page does not zero-fill a half that may sit on another page", async () => {
  const body = { dimensionHeaders: [{ name: "pagePath" }, { name: "dateRange" }], rows: [{ dimensionValues: mv("/z", "previous"), metricValues: mv(2, 1, 1, 10) }], rowCount: 3 };
  const res = await run(baseEnv(), "pages", "period=7d&limit=2&offset=2", makeGoogle({ report: () => ({ status: 200, body }) }));
  assert.equal(res.has_more, false); assert.equal(res.complete, false);
  assert.equal(res.rows[0].current, null, "current half is unknown on this page — the client fills it after merging every page");
});
await check("on a partial page, 'not listed' is not turned into zero", async () => {
  const body = { dimensionHeaders: [{ name: "pagePath" }, { name: "dateRange" }], rows: [{ dimensionValues: mv("/a", "current"), metricValues: mv(9, 5, 3, 100) }], rowCount: 40 };
  const res = await run(baseEnv(), "pages", "period=7d&limit=1", makeGoogle({ report: () => ({ status: 200, body }) }));
  assert.equal(res.has_more, true);
  assert.equal(res.rows[0].previous, null, "previous period for this row is unknown, not zero");
});

console.log("boztik_action events (mocked)");
const actionsBody = () => ({ dimensionHeaders: [{ name: "customEvent:action" }, { name: "customEvent:destination" }, { name: "dateRange" }], rows: [
  { dimensionValues: mv("redbubble_store", "redbubble.com", "current"), metricValues: mv(7, 5) },
  { dimensionValues: mv("kofi", "ko-fi.com", "current"), metricValues: mv(2, 2) },
  { dimensionValues: mv("teepublic_store", "teepublic.com", "current"), metricValues: mv(1, 1) },
  { dimensionValues: mv("contact_email", "email", "current"), metricValues: mv(3, 3) },
  { dimensionValues: mv("brand_new_action", "owner@example.com", "current"), metricValues: mv(1, 1) },
  { dimensionValues: mv("redbubble_store", "redbubble.com", "previous"), metricValues: mv(4, 4) },
], rowCount: 6 });
await check("with the custom dimensions registered, actions are grouped into safe categories (clicks, never purchases)", async () => {
  const res = await run(baseEnv(), "actions", "period=7d", makeGoogle({ report: () => ({ status: 200, body: actionsBody() }) }));
  assert.equal(res.state, "ok");
  const groups = Object.fromEntries(res.extra.groups.map((g: any) => [g.group, g]));
  assert.equal(groups.outbound_store.clicks, 10); assert.equal(groups.outbound_store.previous_clicks, 4);
  assert.equal(groups.contact.clicks, 3);
  assert.equal(groups.other.clicks, 1, "an unrecognised action lands in 'other', it is not dropped");
  const labels = res.extra.rows.map((r: any) => r.label);
  assert.ok(labels.includes("Redbubble") && labels.includes("Ko-fi") && labels.includes("TeePublic"));
  assert.ok(!JSON.stringify(res).includes("owner@example.com"), "an e-mail-like value from GA4 is masked");
});
await check("the report sends the boztik_action filter and only the two custom dimensions", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: actionsBody() }) });
  await run(baseEnv(), "actions", "period=7d", g);
  const b = g.reports()[0].body;
  assert.deepEqual(b.dimensions, [{ name: "customEvent:action" }, { name: "customEvent:destination" }]);
  assert.deepEqual(b.dimensionFilter, { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "boztik_action" } } });
});
await check("with the custom dimensions NOT registered, it falls back to the plain event count and says exactly what to register", async () => {
  const basic = { dimensionHeaders: [{ name: "eventName" }, { name: "dateRange" }], rows: [{ dimensionValues: mv("boztik_action", "current"), metricValues: mv(14, 9) }], rowCount: 1 };
  const g = makeGoogle({ metadata: () => ({ status: 200, body: { dimensions: [{ apiName: "pagePath" }, { apiName: "customEvent:action" }] } }), report: () => ({ status: 200, body: basic }) });
  const res = await run(baseEnv(), "actions", "period=7d&compare=0", g);
  assert.equal(res.state, "custom_dimensions_missing");
  assert.deepEqual(res.extra.missing_dimensions, ["destination"]);
  assert.deepEqual(g.reports()[0].body.dimensions, [{ name: "eventName" }], "must not send a query Google would reject");
  assert.equal(res.rows[0].current.eventCount, 14);
});
await check("key events: asks only for events with keyEvents > 0; none is an honest empty state", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: { rowCount: 0 } }) });
  const res = await run(baseEnv(), "key-events", "period=30d", g);
  assert.equal(res.state, "empty");
  assert.equal(g.reports()[0].body.metricFilter.filter.numericFilter.operation, "GREATER_THAN");
});

console.log("errors, quota and timeouts (mocked)");
await check("403 -> ga4_permission_denied with an actionable fixed message and no Google body", async () => {
  const g = makeGoogle({ report: () => ({ status: 403, body: { error: { status: "PERMISSION_DENIED", message: SECRET_BODY_MARKER } } }) });
  const e = await reject(run(baseEnv(), "sources", "period=7d", g), 502, "ga4_permission_denied");
  assert.ok(/Viewer/.test(e.message)); assert.ok(!e.message.includes(SECRET_BODY_MARKER));
});
await check("404 -> ga4_property_not_found; 5xx -> ga4_unavailable; 400 -> ga4_bad_request", async () => {
  await reject(run(baseEnv(), "sources", "period=7d", makeGoogle({ report: () => ({ status: 404, body: { error: { status: "NOT_FOUND" } } }) })), 502, "ga4_property_not_found");
  ga4.resetGa4State();
  await reject(run(baseEnv(), "sources", "period=7d", makeGoogle({ report: () => ({ status: 503, body: {} }) })), 502, "ga4_unavailable");
  ga4.resetGa4State();
  await reject(run(baseEnv(), "sources", "period=7d", makeGoogle({ report: () => ({ status: 400, body: { error: { status: "INVALID_ARGUMENT" } } }) })), 502, "ga4_bad_request");
});
await check("quota exhaustion -> 429 with retry_after, then NO further Google calls during the cool-down", async () => {
  const g = makeGoogle({ report: () => ({ status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } }) });
  const e = await reject(run(baseEnv(), "sources", "period=7d", g), 429, "ga4_quota_exceeded");
  assert.equal(e.details.retry_after, 60);
  const before = g.calls.length;
  await reject(run(baseEnv(), "channels", "period=7d", g), 429, "ga4_quota_exceeded");
  assert.equal(g.calls.length, before, "the circuit breaker must stop calling Google");
  clock += 61_000;
  await reject(run(baseEnv(), "channels", "period=7d", g), 429, "ga4_quota_exceeded");
  assert.ok(g.calls.length > before, "after the cool-down Google is tried again");
  clock = T0;
});
await check("a hung Google request times out with 504 ga4_timeout", async () => {
  await reject(run(baseEnv(), "sources", "period=7d", makeGoogle({ hang: true }), { timeoutMs: 30 }), 504, "ga4_timeout");
});
await check("a network failure -> 502 ga4_unreachable", async () => {
  const boom = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await reject(ga4.ga4Report(baseEnv(), "sources", q("period=7d"), { fetch: boom, cache: memCache(), now }), 502, "ga4_unreachable");
});

console.log("input validation and date arithmetic");
await check("bad parameters are 422, never silently replaced; unknown reports (incl. prototype keys) are 404", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  for (const bad of ["limit=0", "limit=101", "limit=abc", "limit=-1", "offset=901", "offset=1.5", "compare=2", "refresh=yes"]) {
    await reject(run(baseEnv(), "sources", `period=7d&${bad}`, g), 422, "invalid_param");
  }
  for (const range of ["from=2026-13-01&to=2026-13-02", "from=2026-02-31&to=2026-03-01", "from=2026-10-10&to=2026-10-01", "from=2026-10-01&to=2026-10-26", "from=2019-12-31&to=2020-01-02", "from=2026-10-01", "from=x&to=y"]) {
    await reject(run(baseEnv(), "sources", range, g), 422, "invalid_range");
  }
  await reject(run(baseEnv(), "sources", "from=2025-01-01&to=2026-10-25", g), 422, "range_too_long");
  for (const name of ["nope", "__proto__", "constructor", "toString", "sources/extra"]) await reject(run(baseEnv(), name, "period=7d", g), 404, "not_found");
  assert.equal(g.calls.length, 0, "nothing invalid may reach Google");
});
await check("windows and comparison periods: presets, custom, month/year boundaries, 'all', and an unknown preset", async () => {
  const win = async (query: string) => {
    const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
    await run(baseEnv(), "sources", query, g);
    return g.reports()[0].body.dateRanges.map((r: any) => `${r.startDate}..${r.endDate}`);
  };
  assert.deepEqual(await win("period=today"), ["2026-10-25..2026-10-25", "2026-10-24..2026-10-24"]);
  assert.deepEqual(await win("period=30d"), ["2026-09-26..2026-10-25", "2026-08-27..2026-09-25"]);
  assert.deepEqual(await win("from=2026-03-01&to=2026-03-07"), ["2026-03-01..2026-03-07", "2026-02-22..2026-02-28"]);
  assert.deepEqual(await win("from=2026-01-01&to=2026-01-07"), ["2026-01-01..2026-01-07", "2025-12-25..2025-12-31"], "year boundary");
  assert.deepEqual(await win("from=2026-10-25&to=2026-10-25"), ["2026-10-25..2026-10-25", "2026-10-24..2026-10-24"], "a one-day custom range ending today");
  assert.deepEqual(await win("period=all"), ["2020-01-01..2026-10-25"], "'all' has no comparison period");
  assert.deepEqual(await win("period=7d&compare=0"), ["2026-10-19..2026-10-25"]);
  assert.deepEqual(await win("period=bogus"), ["2026-09-26..2026-10-25", "2026-08-27..2026-09-25"], "an unknown preset is the same 30d fallback as every other endpoint");
});

console.log("caching and refresh");
await check("an identical request is served from cache; freshness says so", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  const deps = { fetch: g.fetch, cache: memCache(), now };
  const a = await ga4.ga4Report(baseEnv(), "sources", q("period=7d"), deps);
  clock += 120_000;
  const b = await ga4.ga4Report(baseEnv(), "sources", q("period=7d"), deps);
  assert.equal(g.reports().length, 1);
  assert.equal(a.freshness.cache, "miss"); assert.equal(b.freshness.cache, "hit");
  assert.equal(b.freshness.age_seconds, 120);
  assert.equal(b.freshness.fetched_at, a.freshness.fetched_at, "last successful refresh time is the original fetch time");
  assert.equal(b.freshness.includes_today, true);
  clock = T0;
});
await check("forced refresh is throttled for 60 s, allowed after, and the cache expires after the TTL", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  const deps = { fetch: g.fetch, cache: memCache(), now };
  await ga4.ga4Report(baseEnv(), "sources", q("period=7d"), deps);
  clock += 30_000;
  const throttled = await ga4.ga4Report(baseEnv(), "sources", q("period=7d&refresh=1"), deps);
  assert.equal(throttled.freshness.refresh_throttled, true); assert.equal(g.reports().length, 1);
  clock += 31_000;
  const fresh = await ga4.ga4Report(baseEnv(), "sources", q("period=7d&refresh=1"), deps);
  assert.equal(fresh.freshness.cache, "miss"); assert.equal(g.reports().length, 2);
  clock += 601_000;
  await ga4.ga4Report(baseEnv(), "sources", q("period=7d"), deps);
  assert.equal(g.reports().length, 3, "default TTL is 10 minutes");
  clock = T0;
});
await check("a failed refresh never poisons the cache", async () => {
  let fail = true;
  const g = makeGoogle({ report: () => (fail ? { status: 503, body: {} } : { status: 200, body: sourcesBody() }) });
  const deps = { fetch: g.fetch, cache: memCache(), now };
  await reject(ga4.ga4Report(baseEnv(), "sources", q("period=7d"), deps), 502, "ga4_unavailable");
  fail = false;
  assert.equal((await ga4.ga4Report(baseEnv(), "sources", q("period=7d"), deps)).state, "ok");
});
await check("concurrent identical requests share a single Google call", async () => {
  const g = makeGoogle({ report: async () => { await new Promise((r) => setTimeout(r, 20)); return { status: 200, body: sourcesBody() }; } });
  const deps = { fetch: g.fetch, cache: memCache(), now };
  await Promise.all([1, 2, 3, 4].map(() => ga4.ga4Report(baseEnv(), "sources", q("period=7d"), deps)));
  assert.equal(g.reports().length, 1);
});
await check("GA4_CACHE_SECONDS is clamped to 60–3600", async () => {
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  for (const [val, wait, expectCalls] of [["5", 61_000, 2], ["999999", 3_599_000, 1]] as const) {
    ga4.resetGa4State(); g.calls.length = 0;
    const deps = { fetch: g.fetch, cache: memCache(), now };
    await ga4.ga4Report(baseEnv({ GA4_CACHE_SECONDS: val }), "sources", q("period=7d"), deps);
    clock += wait;
    await ga4.ga4Report(baseEnv({ GA4_CACHE_SECONDS: val }), "sources", q("period=7d"), deps);
    assert.equal(g.reports().length, expectCalls, `GA4_CACHE_SECONDS=${val}`);
    clock = T0;
  }
});

console.log("status endpoint (mocked)");
await check("status without verify makes no Google call; with verify it proves the credentials and lists custom dimensions", async () => {
  const g = makeGoogle();
  const plain = await ga4.ga4Status(baseEnv(), false, { fetch: g.fetch, cache: memCache(), now });
  assert.equal(plain.configured, true); assert.equal(plain.verified, null); assert.equal(g.calls.length, 0);
  const verified = await ga4.ga4Status(baseEnv(), true, { fetch: g.fetch, cache: memCache(), now });
  assert.equal(verified.verified, true);
  assert.deepEqual(verified.custom_dimensions, { action: true, destination: true, position: true, page_key: true });
  assert.equal(plain.scope, "https://www.googleapis.com/auth/analytics.readonly");
});
await check("status reports an upstream failure as data (verified=false + code), never as a thrown error or a secret", async () => {
  const g = makeGoogle({ metadata: () => ({ status: 403, body: { error: { status: "PERMISSION_DENIED", message: SECRET_BODY_MARKER } } }) });
  const s = await ga4.ga4Status(baseEnv(), true, { fetch: g.fetch, cache: memCache(), now });
  assert.equal(s.verified, false); assert.equal(s.error.code, "ga4_permission_denied");
  assert.ok(!JSON.stringify(s).includes(SECRET_BODY_MARKER));
  const unconfigured = await ga4.ga4Status({}, true, { fetch: g.fetch, cache: memCache(), now });
  assert.equal(unconfigured.configured, false); assert.equal(unconfigured.verified, null);
});

console.log("secrets, privacy and separation");
await check("no response and no log line ever contains the private key, the service-account e-mail or the access token", async () => {
  const logged: string[] = [];
  const realErr = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try {
    const outputs: string[] = [];
    for (const g of [
      makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) }),
      makeGoogle({ report: () => ({ status: 403, body: { error: { status: "PERMISSION_DENIED", message: SECRET_BODY_MARKER } } }) }),
      makeGoogle({ report: () => ({ status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } }) }),
      makeGoogle({ token: () => ({ status: 401, body: { error: SECRET_BODY_MARKER } }) }),
    ]) {
      ga4.resetGa4State();
      try { outputs.push(JSON.stringify(await run(baseEnv(), "sources", "period=7d", g))); }
      catch (e: any) { outputs.push(JSON.stringify({ message: e.message, code: e.code, details: e.details ?? null })); }
    }
    outputs.push(JSON.stringify(await ga4.ga4Status(baseEnv(), false)));
    const everything = outputs.join("\n") + "\n" + logged.join("\n");
    for (const secret of [pkcs8.slice(0, 40), "BEGIN PRIVATE KEY", SA_EMAIL, SECRET_TOKEN, SECRET_BODY_MARKER, "boztik-test"]) {
      assert.ok(!everything.includes(secret), `leaked: ${secret.slice(0, 12)}…`);
    }
    assert.ok(logged.length > 0, "failures are still logged (status words only)");
  } finally { console.error = realErr; }
});
await check("dimension values from Google are capped and control characters removed", () => {
  assert.equal(ga4.cleanDimensionValue("a@b.co"), "[redacted]");
  assert.equal(ga4.cleanDimensionValue("x".repeat(500)).length, 200);
  assert.equal(ga4.cleanDimensionValue("a\u0000b\nc"), "a b c");
});

// ---- HTTP surface through the real Worker entry point ------------------------------------------------------------
class SqliteD1 {
  db: DatabaseSync; statements: string[] = [];
  constructor(db: DatabaseSync) { this.db = db; }
  prepare(sql: string) {
    const db = this.db, log = this.statements; let params: unknown[] = [];
    const stmt = { sql, get params() { return params; },
      bind(...v: unknown[]) { params = v; return this; },
      async run() { log.push(sql); const r = db.prepare(sql).run(...params as never[]); return { meta: { changes: Number(r.changes) }, results: [] }; },
      async all() { log.push(sql); return { results: db.prepare(sql).all(...params as never[]) }; },
      async first() { log.push(sql); return db.prepare(sql).get(...params as never[]) ?? null; } };
    return stmt;
  }
  async batch(stmts: Array<{ sql: string; params: unknown[] }>) { return stmts.map((s) => { this.statements.push(s.sql); const r = this.db.prepare(s.sql).run(...s.params as never[]); return { meta: { changes: Number(r.changes) } }; }); }
}
const freshDb = () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  return db;
};
const SALT = "s".repeat(40);
const httpEnv = async (extra: Record<string, unknown> = {}) => {
  const d1 = new SqliteD1(freshDb());
  const token = "t".repeat(48);
  const hash = await auth.sessionTokenHash(token, SALT);
  const sec = Math.floor(T0 / 1000);
  d1.db.prepare("INSERT INTO sessions (token_hash, email, created_at, expires_at, revoked) VALUES (?, ?, ?, ?, 0)").run(hash, "admin@example.test", sec, sec + 3600);
  const env: any = { DB: d1, AUTH_TOKEN_SALT: SALT, ALLOWED_ORIGINS: "https://www.boztik.com", PUBLIC_ORIGIN: "https://www.boztik.com", ...extra };
  return { env, d1, token };
};
const call = (env: any, path: string, init: RequestInit = {}) => worker.default.fetch(new Request(`https://deliver-api.boztik.com${path}`, init), env, { waitUntil() {} });

console.log("HTTP surface (real Worker entry point)");
await check("every GA4 route requires the admin session: no token, a wrong token and an expired token are all 401", async () => {
  const { env, d1 } = await httpEnv(baseEnv());
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  const realFetch = globalThis.fetch; globalThis.fetch = g.fetch;
  try {
    for (const path of ["/api/admin/analytics/ga4/status", "/api/admin/analytics/ga4/status?verify=1", "/api/admin/analytics/ga4/overview?period=7d", "/api/admin/analytics/ga4/sources", "/api/admin/analytics/ga4/actions"]) {
      assert.equal((await call(env, path)).status, 401, path);
      assert.equal((await call(env, path, { headers: { Authorization: `Bearer ${"x".repeat(48)}` } })).status, 401, `${path} wrong token`);
    }
    const hash = await auth.sessionTokenHash("e".repeat(48), SALT);
    d1.db.prepare("INSERT INTO sessions (token_hash, email, created_at, expires_at, revoked) VALUES (?, 'old@example.test', 1, 2, 0)").run(hash);
    assert.equal((await call(env, "/api/admin/analytics/ga4/sources", { headers: { Authorization: `Bearer ${"e".repeat(48)}` } })).status, 401, "expired session");
    assert.equal(g.calls.length, 0, "an unauthenticated request must never cause a Google call");
  } finally { globalThis.fetch = realFetch; }
});
await check("authenticated: status and reports answer; a foreign Origin gets no CORS grant; POST is refused", async () => {
  const { env, token } = await httpEnv(baseEnv());
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  const realFetch = globalThis.fetch; globalThis.fetch = g.fetch;
  try {
    const H = { Authorization: `Bearer ${token}`, Origin: "https://www.boztik.com" };
    const st = await call(env, "/api/admin/analytics/ga4/status", { headers: H });
    assert.equal(st.status, 200);
    assert.equal(st.headers.get("Access-Control-Allow-Origin"), "https://www.boztik.com");
    assert.equal(st.headers.get("Cache-Control"), "no-store");
    const stBody: any = await st.json();
    assert.equal(stBody.configured, true); assert.ok(!JSON.stringify(stBody).includes("PRIVATE"));
    const rep = await call(env, "/api/admin/analytics/ga4/sources?period=7d", { headers: H });
    assert.equal(rep.status, 200);
    const repBody: any = await rep.json();
    assert.equal(repBody.ok, true); assert.equal(repBody.source, "ga4");
    const evil = await call(env, "/api/admin/analytics/ga4/sources?period=7d", { headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example" } });
    assert.equal(evil.headers.get("Access-Control-Allow-Origin"), null, "no CORS grant for a foreign origin");
    assert.equal((await call(env, "/api/admin/analytics/ga4/sources", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}" })).status, 405);
    assert.equal((await call(env, "/api/admin/analytics/ga4/sources?limit=500", { headers: H })).status, 422);
    assert.equal((await call(env, "/api/admin/analytics/ga4/nope", { headers: H })).status, 404);
  } finally { globalThis.fetch = realFetch; }
});
await check("an unconfigured Worker answers 503 over HTTP and the status endpoint still works", async () => {
  const { env, token } = await httpEnv();
  const H = { Authorization: `Bearer ${token}` };
  const r = await call(env, "/api/admin/analytics/ga4/overview?period=7d", { headers: H });
  assert.equal(r.status, 503);
  const body: any = await r.json();
  assert.equal(body.code, "ga4_not_configured"); assert.deepEqual(body.missing, ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"]);
  const st: any = await (await call(env, "/api/admin/analytics/ga4/status", { headers: H })).json();
  assert.equal(st.configured, false);
});
await check("quota errors carry a Retry-After header over HTTP", async () => {
  const { env, token } = await httpEnv(baseEnv());
  const g = makeGoogle({ report: () => ({ status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } }) });
  const realFetch = globalThis.fetch; globalThis.fetch = g.fetch;
  try {
    // A report no earlier HTTP test fetched: the Worker bundle keeps its own cache, separate from this file's `ga4` import.
    const r = await call(env, "/api/admin/analytics/ga4/channels?period=90d", { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 429); assert.equal(r.headers.get("Retry-After"), "60");
  } finally {
    globalThis.fetch = realFetch;
    clock += 120_000; // let the Worker bundle's 60 s quota cool-down expire so later checks are unaffected
  }
});
await check("SEPARATION: a GA4 report reads only the session table — never first-party analytics or Deliver data — and writes nothing", async () => {
  const { env, d1, token } = await httpEnv(baseEnv());
  const g = makeGoogle({ report: () => ({ status: 200, body: sourcesBody() }) });
  const realFetch = globalThis.fetch; globalThis.fetch = g.fetch;
  try {
    d1.statements.length = 0;
    await call(env, "/api/admin/analytics/ga4/sources?period=7d", { headers: { Authorization: `Bearer ${token}` } });
    await call(env, "/api/admin/analytics/ga4/actions?period=7d", { headers: { Authorization: `Bearer ${token}` } });
    assert.ok(d1.statements.length > 0);
    for (const sql of d1.statements) {
      assert.match(sql, /FROM sessions/i, `unexpected D1 statement: ${sql}`);
      assert.ok(!/INSERT|UPDATE|DELETE|page_analytics|traffic_source|store_clicks|deliver/i.test(sql.replace(/FROM sessions/i, "")), `unexpected D1 statement: ${sql}`);
    }
  } finally { globalThis.fetch = realFetch; }
});
await check("the first-party endpoints are unchanged by GA4: the summary has no GA4 fields and the health endpoint reports configuration only", async () => {
  const { env, token } = await httpEnv(baseEnv());
  const H = { Authorization: `Bearer ${token}` };
  const summary: any = await (await call(env, "/api/admin/analytics/summary?period=7d", { headers: H })).json();
  assert.ok(!JSON.stringify(summary).toLowerCase().includes("ga4"), "first-party summary must not mix in GA4");
  const health: any = await (await call(env, "/api/admin/analytics/health", { headers: H })).json();
  assert.equal(health.ga4.status, "configured");
  const bare = await httpEnv();
  const health2: any = await (await call(bare.env, "/api/admin/analytics/health", { headers: { Authorization: `Bearer ${bare.token}` } })).json();
  assert.equal(health2.ga4.status, "not_connected");
});

Date.now = realNow;
console.log(`\nAll ${checks} GA4 checks passed (Google responses were MOCKED; no live Google call was made).`);
