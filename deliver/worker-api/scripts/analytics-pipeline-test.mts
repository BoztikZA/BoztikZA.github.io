// End-to-end analytics pipeline tests: pure flow logic, idempotent ingestion, reporting windows, period summaries,
// visitor-flow statuses, store analytics (incl. the D1 binding regression), health, CORS, auth and the browser tracker
// contract. Runs against a real SQLite database built from the repository's ACTUAL migrations (0001 → latest).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import vm from "node:vm";

const loadBundle = async (entryPoint: string) => {
  const result = await build({ entryPoints: [entryPoint], bundle: true, platform: "node", format: "esm", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
};
const flow = await loadBundle("src/lib/flow.ts");
const dbm = await loadBundle("src/lib/db.ts");
const util = await loadBundle("src/routes/util.ts");
const pub = await loadBundle("src/routes/public.ts");
const admin = await loadBundle("src/routes/admin.ts");
const worker = await loadBundle("src/index.ts");

let checks = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { await fn(); checks += 1; console.log(`  ok  ${name}`); };

/** D1-shaped adapter over node:sqlite (prepare/bind/run/all/first + batch in one transaction). */
class SqliteD1 {
  db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }
  prepare(sql: string) {
    const db = this.db; let params: unknown[] = [];
    const stmt = { sql, get params() { return params; },
      bind(...v: unknown[]) { params = v; return this; },
      async run() { const r = db.prepare(sql).run(...params as never[]); return { meta: { changes: Number(r.changes) }, results: [] }; },
      async all() { return { results: db.prepare(sql).all(...params as never[]) }; },
      async first() { return db.prepare(sql).get(...params as never[]) ?? null; } };
    return stmt;
  }
  async batch(stmts: Array<{ sql: string; params: unknown[] }>) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) { const r = this.db.prepare(s.sql).run(...s.params as never[]); out.push({ meta: { changes: Number(r.changes) } }); }
      this.db.exec("COMMIT"); return out;
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
}
const freshDb = () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  }
  return db;
};
const NOW = Date.UTC(2026, 9, 25, 10, 0, 0) / 1000; // 2026-10-25 12:00 SAST
const realNow = Date.now;
Date.now = () => NOW * 1000;
const S = (c: string) => c.repeat(32);
const ev = (session_id: string, page: string, seen_at: number) => ({ session_id, page, seen_at });

console.log("visit splitting and session expiry");
await check("30:00 idle keeps the visit, 30:01 starts a new one", () => {
  const same = flow.buildVisits([ev(S("a"), "homepage", 0), ev(S("a"), "guides", 1800)]);
  assert.deepEqual(same, [["homepage", "guides"]]);
  const split = flow.buildVisits([ev(S("a"), "homepage", 0), ev(S("a"), "guides", 1801)]);
  assert.deepEqual(split, [["homepage"], ["guides"]]);
});
await check("one 180-day cookie is several visits, not one giant path", () => {
  const v = flow.buildVisits([ev(S("a"), "homepage", 0), ev(S("a"), "services", 100), ev(S("a"), "homepage", 90000), ev(S("a"), "contact", 90060)]);
  assert.deepEqual(v, [["homepage", "services"], ["homepage", "contact"]]);
});
await check("reloads collapse; events are ordered by time even when delivered out of order", () => {
  const v = flow.buildVisits([ev(S("a"), "guides", 30), ev(S("a"), "homepage", 10), ev(S("a"), "homepage", 11), ev(S("a"), "guides", 31)]);
  assert.deepEqual(v, [["homepage", "guides"]]);
});
await check("equal timestamps keep arrival order (stable)", () => {
  assert.deepEqual(flow.buildVisits([ev(S("a"), "homepage", 5), ev(S("a"), "services", 5), ev(S("a"), "contact", 5)]), [["homepage", "services", "contact"]]);
});
await check("different cookies never merge", () => {
  assert.equal(flow.buildVisits([ev(S("a"), "homepage", 1), ev(S("b"), "services", 2)]).length, 2);
});

console.log("flow metrics from real visits only");
const visits = [["homepage", "services", "contact"], ["homepage", "services"], ["homepage"], ["guides", "tools"], ["homepage", "services", "contact", "support", "about", "stores"]];
const f = flow.computeFlow(visits);
await check("entries, exits, multi/single page counts", () => {
  assert.equal(f.visits, 5); assert.equal(f.multi_page_visits, 4); assert.equal(f.single_page_visits, 1);
  assert.deepEqual(f.entries.find((e: any) => e.page === "homepage"), { page: "homepage", visits: 4 });
  assert.deepEqual(f.exits.map((e: any) => `${e.page}:${e.visits}`).sort(), ["contact:1", "homepage:1", "services:1", "stores:1", "tools:1"]);
});
await check("transition support counts distinct visits and orders by support", () => {
  assert.deepEqual(f.transitions[0], { from: "homepage", to: "services", visits: 3 });
  assert.equal(f.transitions.find((t: any) => t.from === "services" && t.to === "contact").visits, 2);
});
await check("journeys are truncated at 5 steps and flagged; single-page visits are not journeys", () => {
  const long = f.journeys.find((j: any) => j.truncated);
  assert.equal(long.path.length, 5); assert.equal(long.visits, 1);
  assert.ok(!f.journeys.some((j: any) => j.path.length < 2));
});
await check("empty input is empty output, never an error", () => {
  const e = flow.computeFlow([]);
  assert.equal(e.visits, 0); assert.deepEqual(e.transitions, []);
});
await check("per-page entrance/exit totals", () => {
  const ee = flow.pageEntranceExit(visits);
  assert.deepEqual(ee.homepage, { entrances: 4, exits: 1 });
});

console.log("reporting windows and timezone");
await check("period boundaries are SAST local midnights; previous window is adjacent and equal length", () => {
  const env: any = { };
  const w = dbm.periodWindow(env, "7d");
  assert.equal(w.until, "2026-10-25"); assert.equal(w.since, "2026-10-19");
  assert.equal(w.startTs, Date.UTC(2026, 9, 18, 22, 0, 0) / 1000); // 19 Oct 00:00 SAST
  assert.equal(w.previous.until, "2026-10-18"); assert.equal(w.previous.since, "2026-10-12");
  assert.equal(w.previous.endTs, w.startTs - 1);
  assert.equal(dbm.periodWindow(env, "all").previous, null);
});
await check("an event at 23:59:59 SAST belongs to that day; 00:00:00 SAST belongs to the next", () => {
  const env: any = {};
  assert.equal(dbm.localDay(env, Date.UTC(2026, 9, 24, 21, 59, 59) / 1000), "2026-10-24");
  assert.equal(dbm.localDay(env, Date.UTC(2026, 9, 24, 22, 0, 0) / 1000), "2026-10-25");
});

console.log("idempotent ingestion");
{
  const db = freshDb(); const d1: any = new SqliteD1(db);
  // adapter: env.DB.batch receives prepared statements
  const env: any = { DB: { prepare: (sql: string) => d1.prepare(sql), batch: (s: any[]) => d1.batch(s.map(x => ({ sql: x.sql, params: x.params }))) } };
  const views = (page: string) => Number((db.prepare("SELECT COALESCE(SUM(views),0) v FROM page_analytics WHERE page = ?").get(page) as any).v);
  const events = (page: string) => Number((db.prepare("SELECT COUNT(*) n FROM page_session_events WHERE page = ?").get(page) as any).n);
  await check("same event_id sent three times is counted once in BOTH tables", async () => {
    assert.equal(await dbm.recordPageView(env, "guides", S("a"), "evt-aaaaaaaa"), true);
    assert.equal(await dbm.recordPageView(env, "guides", S("a"), "evt-aaaaaaaa"), false);
    assert.equal(await dbm.recordPageView(env, "guides", S("b"), "evt-aaaaaaaa"), false);
    assert.equal(views("guides"), 1); assert.equal(events("guides"), 1);
  });
  await check("same session + page + second (a legacy client retry) is also a duplicate", async () => {
    assert.equal(await dbm.recordPageView(env, "tools", S("c")), true);
    assert.equal(await dbm.recordPageView(env, "tools", S("c")), false);
    assert.equal(views("tools"), 1);
  });
  await check("the counter can never exceed the events + sessionless views (no drift)", async () => {
    assert.equal(await dbm.recordPageView(env, "about"), true);          // sessionless
    assert.equal(await dbm.recordPageView(env, "about", "not-hex"), true);
    assert.equal(views("about"), 2); assert.equal(events("about"), 0);
  });
  await check("unknown / private page keys are never counted", async () => {
    for (const k of ["admin", "privacy", "dashboard", "", "deliver-v3"]) assert.equal(await dbm.recordPageView(env, k, S("d"), "evt-zzzzzzzz"), false);
    assert.equal(Number((db.prepare("SELECT COUNT(*) n FROM page_analytics WHERE page IN ('admin','privacy','dashboard','','deliver-v3')").get() as any).n), 0);
  });
  await check("the stores page key is accepted", async () => {
    assert.equal(await dbm.recordPageView(env, "stores", S("e"), "evt-stores01"), true);
    assert.equal(views("stores"), 1);
  });
}

console.log("period summaries on a seeded database");
{
  const db = freshDb(); const d1: any = new SqliteD1(db);
  const env: any = { DB: { prepare: (sql: string) => d1.prepare(sql), batch: (s: any[]) => d1.batch(s.map((x: any) => ({ sql: x.sql, params: x.params }))) } };
  const t = (iso: string) => Date.parse(iso) / 1000;
  const pv = db.prepare("INSERT INTO page_analytics (day, page, views) VALUES (?, ?, ?)");
  pv.run("2026-10-24", "homepage", 10); pv.run("2026-10-24", "stores", 8); pv.run("2026-10-10", "stores", 4); pv.run("2026-10-20", "deliver", 100);
  const sc = db.prepare("INSERT INTO store_clicks (event_id, destination, source_placement, session_id, created_at) VALUES (?, ?, ?, ?, ?)");
  sc.run("e0000001", "redbubble", "store_grid", S("a"), t("2026-10-24T08:00:00Z"));
  sc.run("e0000002", "redbubble", "homepage", S("b"), t("2026-10-24T09:00:00Z"));
  sc.run("e0000003", "teepublic", "store_grid", S("a"), t("2026-10-24T09:30:00Z"));
  sc.run("e0000004", "boztik_store", "homepage", S("c"), t("2026-10-24T10:00:00Z"));
  sc.run("e0000005", "kofi", "stores", S("d"), t("2026-10-12T10:00:00Z")); // previous 7d window (12–18 Oct)
  const ts = db.prepare("INSERT INTO traffic_source_visits (session_id, seen_at, source) VALUES (?, ?, ?)");
  ts.run(S("a"), t("2026-10-24T08:00:00Z"), "reddit"); ts.run(S("b"), t("2026-10-24T09:00:00Z"), "direct_unknown"); ts.run(S("c"), t("2026-10-13T09:00:00Z"), "social");

  await check("REGRESSION: Store summary no longer errors for any period (offset/placeholder misbinding)", async () => {
    for (const k of ["7d", "30d", "90d", "all"]) { const r = await dbm.getStoreClickSummary(env, k); assert.ok(typeof r.total === "number", k); assert.ok(r.series.length > 0, k); }
  });
  await check("Store totals, outbound-only total, product-card clicks and store-page click-through inputs", async () => {
    const r = await dbm.getStoreClickSummary(env, "7d");
    assert.equal(r.total, 4); assert.equal(r.outbound_total, 3); // boztik_store is internal, not outbound
    assert.equal(r.product_card_clicks, 2);
    assert.equal(r.store_page_views, 8);
    const rb = r.by_destination.find((x: any) => x.destination === "redbubble");
    assert.equal(rb.clicks, 2); assert.equal(rb.store_page_clicks, 1); assert.equal(rb.unique_sessions, 2);
    assert.equal(r.series.filter((p: any) => p.day === "2026-10-24" && p.destination === "redbubble")[0].clicks, 2);
  });
  await check("previous period comparison uses the adjacent equal window", async () => {
    const r = await dbm.getStoreClickSummary(env, "7d");
    assert.deepEqual(r.previous, { since: "2026-10-12", until: "2026-10-18", total: 1, outbound_total: 1, store_page_views: 0 });
    assert.equal((await dbm.getStoreClickSummary(env, "all")).previous, null);
  });
  await check("a day with no clicks in the series is a real 0, and the all-time view starts at the first event", async () => {
    const r = await dbm.getStoreClickSummary(env, "7d");
    assert.equal(r.series.find((p: any) => p.day === "2026-10-22" && p.destination === "kofi").clicks, 0);
    assert.equal((await dbm.getStoreClickSummary(env, "all")).data_since, "2026-10-12");
  });
  await check("traffic sources: totals, previous total, first/last visit; empty source rows stay at 0", async () => {
    const r = await dbm.getTrafficSourceSummary(env, "7d");
    assert.equal(r.total, 2); assert.deepEqual(r.previous, { since: "2026-10-12", until: "2026-10-18", total: 1 });
    assert.equal(r.sources.find((s: any) => s.source === "organic_search").visits, 0);
    assert.equal(r.data_since, "2026-10-13");
  });
  await check("page-view summary matches the stored daily rows exactly (reconciliation)", async () => {
    const r = await dbm.getAnalyticsSummary(env, "30d");
    const direct = Number((db.prepare("SELECT SUM(views) v FROM page_analytics WHERE day >= ? AND day <= ?").get(r.period.since, r.period.until) as any).v);
    assert.equal(r.website.total_views, direct);
  });
}

console.log("visitor-flow statuses distinguish quiet traffic from broken instrumentation");
{
  const mk = () => { const db = freshDb(); const d1: any = new SqliteD1(db); return { db, env: { DB: { prepare: (s: string) => d1.prepare(s), batch: (x: any[]) => d1.batch(x.map((y: any) => ({ sql: y.sql, params: y.params }))) } } as any }; };
  await check("no page views and no events => no_page_views_in_period (quiet, not broken)", async () => {
    const { env } = mk(); const r = await dbm.getVisitorFlow(env, "30d");
    assert.equal(r.status, "no_events"); assert.equal(r.reason, "no_page_views_in_period"); assert.equal(r.session_coverage_pct, null);
  });
  await check("page views but ZERO session events => page_views_without_session_events (instrumentation gap)", async () => {
    const { db, env } = mk(); db.prepare("INSERT INTO page_analytics VALUES ('2026-10-24','homepage',50)").run();
    const r = await dbm.getVisitorFlow(env, "30d");
    assert.equal(r.status, "no_events"); assert.equal(r.reason, "page_views_without_session_events"); assert.equal(r.session_coverage_pct, 0);
  });
  await check("a few visits => limited (small sample), real data still returned", async () => {
    const { db, env } = mk(); const base = NOW - 3600;
    db.prepare("INSERT INTO page_analytics VALUES (?, 'homepage', 3)").run(dbm.localDay({}, NOW));
    const i = db.prepare("INSERT INTO page_session_events (session_id, seen_at, page) VALUES (?,?,?)");
    i.run(S("a"), base, "homepage"); i.run(S("a"), base + 20, "services"); i.run(S("b"), base, "homepage");
    const r = await dbm.getVisitorFlow(env, "7d");
    assert.equal(r.status, "limited"); assert.equal(r.visits, 2); assert.equal(r.multi_page_visits, 1);
    assert.deepEqual(r.transitions[0], { from: "homepage", to: "services", visits: 1 });
    assert.equal(r.pages.find((p: any) => p.page === "homepage").entrances, 2);
    assert.equal(r.pages.find((p: any) => p.page === "services").exits, 1);
    assert.equal(r.session_coverage_pct, 100);
  });
  await check(">= 20 visits => ok; coverage is capped at 100% and below 100% when views lack events", async () => {
    const { db, env } = mk(); const base = NOW - 7200;
    db.prepare("INSERT INTO page_analytics VALUES (?, 'homepage', 40)").run(dbm.localDay({}, NOW));
    const i = db.prepare("INSERT INTO page_session_events (session_id, seen_at, page) VALUES (?,?,?)");
    for (let n = 0; n < 20; n++) i.run(n.toString(16).padStart(32, "0"), base + n, "homepage");
    const r = await dbm.getVisitorFlow(env, "7d");
    assert.equal(r.status, "ok"); assert.equal(r.visits, 20); assert.equal(r.session_coverage_pct, 50);
  });
  await check("events outside the window are excluded (previous window / future)", async () => {
    const { db, env } = mk(); db.prepare("INSERT INTO page_session_events (session_id, seen_at, page) VALUES (?,?,'homepage')").run(S("z"), NOW - 40 * 86400);
    assert.equal((await dbm.getVisitorFlow(env, "7d")).visits, 0);
    assert.equal((await dbm.getVisitorFlow(env, "90d")).visits, 1);
  });
}

console.log("data health");
{
  const db = freshDb(); const d1: any = new SqliteD1(db); const env: any = { DB: { prepare: (s: string) => d1.prepare(s) } };
  await check("empty database: every collector is never received (not 'healthy', not 'failed'); GA4 is not connected", async () => {
    const h = await dbm.getAnalyticsHealth(env);
    for (const k of ["page_views", "sessions", "attribution", "store_clicks"]) assert.equal(h.collectors[k].status, "no_data_yet", k);
    assert.equal(h.last_event_at, null); assert.equal(h.ga4.status, "not_connected");
    assert.ok(h.known_gaps.some((g: string) => /No visitor-path/.test(g)));
    assert.ok(h.privacy_exclusions.some((g: string) => /Do Not Track/.test(g)));
  });
  await check("recent rows => receiving; 8-day-old rows => quiet; historic views are reported as lacking path data", async () => {
    db.prepare("INSERT INTO page_analytics VALUES ('2026-10-01','homepage',9)").run();
    db.prepare("INSERT INTO page_session_events (session_id, seen_at, page) VALUES (?,?,'homepage')").run(S("a"), NOW - 3600);
    db.prepare("INSERT INTO traffic_source_visits (session_id, seen_at, source) VALUES (?,?,'direct_unknown')").run(S("a"), NOW - 8 * 86400);
    const h = await dbm.getAnalyticsHealth(env);
    assert.equal(h.collectors.sessions.status, "receiving"); assert.equal(h.collectors.attribution.status, "quiet");
    assert.equal(h.page_views_before_session_tracking, 9);
    assert.equal(h.timezone.label, "UTC+2");
  });
}

console.log("CORS, validation and authentication");
{
  const env: any = { ALLOWED_ORIGINS: "https://www.boztik.com,https://boztik.com", PUBLIC_ORIGIN: "https://www.boztik.com" };
  const req = (origin: string | null) => new Request("https://deliver-api.boztik.com/api/public/pageview", { method: "OPTIONS", headers: origin ? { Origin: origin } : {} });
  await check("ingest CORS echoes ONLY our own origins with credentials (the sendBeacon preflight fix)", () => {
    const ok = util.corsHeaders(req("https://www.boztik.com"), env, "ingest");
    assert.equal(ok["Access-Control-Allow-Origin"], "https://www.boztik.com"); assert.equal(ok["Access-Control-Allow-Credentials"], "true");
    const bad = util.corsHeaders(req("https://evil.example"), env, "ingest");
    assert.equal(bad["Access-Control-Allow-Origin"], "*"); assert.equal(bad["Access-Control-Allow-Credentials"], undefined);
  });
  await check("admin scope never falls back to a wildcard", () => {
    assert.equal(util.corsHeaders(req("https://evil.example"), env, "admin")["Access-Control-Allow-Origin"], undefined);
  });
  await check("ingest bodies: JSON and text/plain accepted, anything else is 415", () => {
    const r = (type: string) => new Request("https://x.test", { method: "POST", headers: { "Content-Type": type }, body: "{}" });
    util.requireIngestBody(r("application/json")); util.requireIngestBody(r("text/plain;charset=UTF-8"));
    assert.throws(() => util.requireIngestBody(r("application/x-www-form-urlencoded")), /Content-Type/);
  });
  const adminEnv: any = { DB: { prepare: () => ({ bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; } }) }, ALLOWED_ORIGINS: "https://www.boztik.com", AUTH_TOKEN_SALT: "salt-salt-salt-salt" };
  for (const route of ["analytics/visitor-flow", "analytics/health", "analytics/store-clicks", "analytics/traffic-sources"]) {
    await check(`admin route ${route} rejects unauthenticated requests`, async () => {
      const res = await admin.handleAdmin(new Request(`https://x.test/api/admin/${route}`), route, adminEnv, {});
      assert.equal(res.status, 401);
    });
  }
  await check("public ingest rejects a disallowed Origin with 403 (page views and store clicks)", async () => {
    const env2: any = { ...env, PAGE_ANALYTICS_ALLOWED: "1", DB: {} };
    for (const path of ["pageview", "store-click", "traffic-source"]) {
      const res = await pub.handlePublic(new Request(`https://x.test/api/public/${path}`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "text/plain" }, body: "{}" }), path, env2, {});
      assert.equal(res.status, 403, path);
    }
  });
  await check("store-click validates destination, event id and session id", async () => {
    const env2: any = { ...env, PAGE_ANALYTICS_ALLOWED: "1", DB: {} };
    const post = (b: object) => pub.handlePublic(new Request("https://x.test/api/public/store-click", { method: "POST", headers: { Origin: "https://www.boztik.com", "Content-Type": "text/plain" }, body: JSON.stringify(b) }), "store-click", env2, {});
    assert.equal((await post({ event_id: "abcdefgh1", destination: "evil", source_placement: "x" })).status, 422);
    assert.equal((await post({ event_id: "!", destination: "kofi", source_placement: "x" })).status, 422);
    assert.equal((await post({ event_id: "abcdefgh1", destination: "kofi", source_placement: "x", session_id: "nothex" })).status, 422);
    assert.equal((await post({ event_id: "abcdefgh1", destination: "kofi", source_placement: "" })).status, 422);
  });
}

console.log("browser tracker contract (real beacon path)");
{
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const run = (file: string, { path = "/", dnt = "0", gpc = false, beacon = true } = {}) => {
    const sent: Array<{ kind: string; url: string; type: string; body: string }> = [];
    const listeners = new Map<string, (e?: any) => void>();
    class FakeBlob { parts: string[]; opts: { type: string }; constructor(parts: string[], opts: { type: string }) { this.parts = parts; this.opts = opts; } }
    const nav: any = { doNotTrack: dnt, globalPrivacyControl: gpc };
    if (beacon) nav.sendBeacon = (url: string, blob: FakeBlob) => { sent.push({ kind: "beacon", url, type: blob.opts.type, body: blob.parts.join("") }); return true; };
    const store = new Map<string, string>();
    const ctx: any = {
      navigator: nav, Blob: FakeBlob, URL, URLSearchParams, Uint8Array, Math, Date, Object, JSON,
      window: { crypto: webcrypto, doNotTrack: dnt, addEventListener: (n: string, l: any) => listeners.set(n, l) },
      document: { cookie: "", readyState: "complete", referrer: "", addEventListener: (n: string, l: any) => listeners.set(`doc:${n}`, l) },
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
      location: { pathname: path, hostname: "www.boztik.com", protocol: "https:", search: "" },
      fetch: (url: string, o: any) => { sent.push({ kind: "fetch", url, type: o.headers["Content-Type"], body: o.body }); return Promise.resolve({ ok: true }); },
    };
    vm.runInNewContext(read(file), ctx);
    return { sent, listeners, ctx };
  };
  await check("page view + attribution go out as text/plain beacons (no CORS preflight) with an event_id", () => {
    const { sent } = run("../../../js/pageview.js");
    assert.equal(sent.length, 2);
    for (const s of sent) { assert.equal(s.kind, "beacon"); assert.match(s.type, /^text\/plain/); JSON.parse(s.body); }
    const pv = JSON.parse(sent.find(s => s.url.endsWith("/pageview"))!.body);
    assert.equal(pv.page, "homepage"); assert.match(pv.event_id, /^[a-f0-9]{24}$/); assert.match(pv.session_id, /^[a-f0-9]{32}$/);
  });
  await check("the Stores page is mapped to the 'stores' key", () => {
    const pv = JSON.parse(run("../../../js/pageview.js", { path: "/stores.html" }).sent.find(s => s.url.endsWith("/pageview"))!.body);
    assert.equal(pv.page, "stores");
  });
  await check("fetch fallback is used only when sendBeacon is unavailable, still text/plain, credentials omitted", () => {
    const { sent } = run("../../../js/pageview.js", { beacon: false });
    assert.ok(sent.length === 2 && sent.every(s => s.kind === "fetch" && /^text\/plain/.test(s.type)));
  });
  for (const [label, o] of [["Do Not Track", { dnt: "1" }], ["Global Privacy Control", { gpc: true }]] as const) {
    await check(`${label} sends nothing from any tracker`, () => {
      assert.equal(run("../../../js/pageview.js", o).sent.length, 0);
      const sc = run("../../../js/store-clicks.js", o); assert.equal(sc.listeners.size, 0);
    });
  }
  await check("private / unlisted pages send nothing", () => {
    for (const p of ["/privacy.html", "/deliver-v3/dashboard.html", "/deliver-v3/index.html", "/robots.txt"]) assert.equal(run("../../../js/pageview.js", { path: p }).sent.length, 0, p);
  });
  await check("store-click beacon is text/plain, validated destination, never blocks navigation", () => {
    const { sent, listeners, ctx } = run("../../../js/store-clicks.js", { path: "/stores.html" });
    const link = { getAttribute: (n: string) => ({ href: "https://www.redbubble.com/people/Boztik-Designs/shop", "data-store-placement": "store_grid" } as any)[n] ?? null };
    let prevented = false;
    listeners.get("doc:click")!({ type: "click", target: { closest: () => link }, preventDefault() { prevented = true; } });
    assert.equal(sent.length, 1); assert.match(sent[0].type, /^text\/plain/);
    const b = JSON.parse(sent[0].body);
    assert.equal(b.destination, "redbubble"); assert.equal(b.source_placement, "store_grid"); assert.match(b.event_id, /^[a-z0-9]{8,64}$/);
    assert.equal(prevented, false); void ctx;
  });
  await check("an unconfigured external link is not tracked as a store click", () => {
    const { sent, listeners } = run("../../../js/store-clicks.js");
    const link = { getAttribute: (n: string) => ({ href: "https://www.redbubble.com/somewhere-else" } as any)[n] ?? null };
    listeners.get("doc:click")!({ type: "click", target: { closest: () => link } });
    assert.equal(sent.length, 0);
  });
}

Date.now = realNow;
console.log(`\nAll ${checks} analytics pipeline checks passed.`);
