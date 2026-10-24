import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import vm from "node:vm";

const loadBundle = async (entryPoint: string) => {
  const result = await build({ entryPoints: [entryPoint], bundle: true, platform: "node", format: "esm", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
};

const classifier = await loadBundle("src/lib/traffic-sources.ts");
const database = await loadBundle("src/lib/db.ts");
const adminRoutes = await loadBundle("src/routes/admin.ts");
const cleanup = await loadBundle("src/lib/cleanup.ts");
const auth = await loadBundle("src/lib/auth.ts");
const { classifyTrafficSource, validateTrafficSourceVisit } = classifier;
const { recordTrafficSourceVisit, getTrafficSourceSummary } = database;

let checks = 0;
const check = async (name: string, assertion: () => void | Promise<void>) => {
  await assertion();
  checks += 1;
  console.log(`  ok  ${name}`);
};

console.log("traffic-source classification and validation");
await check("Reddit hosts classify separately", () => assert.equal(classifyTrafficSource("out.reddit.com", false), "reddit"));
await check("recognized social hosts classify separately", () => assert.equal(classifyTrafficSource("l.instagram.com", false), "social"));
await check("recognized search host with query evidence is organic", () => assert.equal(classifyTrafficSource("www.google.com", true), "organic_search"));
await check("search host without query evidence is only a referral", () => assert.equal(classifyTrafficSource("www.google.com", false), "referral"));
await check("other external sites are referrals", () => assert.equal(classifyTrafficSource("example.org", false), "referral"));
await check("missing referrer is direct / unknown", () => assert.equal(classifyTrafficSource(null, false), "direct_unknown"));
await check("Boztik's own host is not classified as an external referral", () => assert.equal(classifyTrafficSource("www.boztik.com", false), "direct_unknown"));
await check("search-like spoof host is not organic", () => assert.equal(classifyTrafficSource("google.evil.com", true), "referral"));
await check("unrecognized Google-like suffix is not organic", () => assert.equal(classifyTrafficSource("www.google.fake", true), "referral"));

const validBody = {
  session_id: "a".repeat(32),
  referrer_host: "www.reddit.com",
  search_referrer: false,
  utm_source: "newsletter",
  utm_medium: "email",
  utm_campaign: "spring launch",
};
await check("UTM data is trimmed, bounded and separate from source category", () => {
  const visit = validateTrafficSourceVisit(validBody);
  assert.equal(visit.source, "reddit");
  assert.equal(visit.utmSource, "newsletter");
  assert.equal(visit.utmCampaign, "spring launch");
});
await check("malformed URL in hostname is rejected", () => assert.throws(() => validateTrafficSourceVisit({ ...validBody, referrer_host: "https://reddit.com/path" }), /hostname/));
await check("malicious hostname injection is rejected", () => assert.throws(() => validateTrafficSourceVisit({ ...validBody, referrer_host: "<script>.example.com" }), /hostname/));
await check("overlong UTM campaign is rejected", () => assert.throws(() => validateTrafficSourceVisit({ ...validBody, utm_campaign: "x".repeat(201) }), /utm_campaign/));
await check("category cannot be client-injected", () => assert.equal(validateTrafficSourceVisit({ ...validBody, source: "direct_unknown" }).source, "reddit"));
await check("malformed session identifier is rejected", () => assert.throws(() => validateTrafficSourceVisit({ ...validBody, session_id: "not-a-random-session" }), /session_id/));

class SqliteD1 {
  db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }
  prepare(sql: string) {
    let params: unknown[] = [];
    const statement = this.db.prepare(sql);
    return {
      bind(...values: unknown[]) { params = values; return this; },
      async run() {
        const result = statement.run(...params as never[]);
        return { meta: { changes: Number(result.changes) } };
      },
      async all() { return { results: statement.all(...params as never[]) }; },
      async first() { return statement.get(...params as never[]) ?? null; },
    };
  }
}

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../migrations/0007_traffic_source_visits.sql", import.meta.url), "utf8"));
const d1 = new SqliteD1(db);
const originalNow = Date.now;
const now = Date.UTC(2026, 9, 20, 12) / 1000;
Date.now = () => now * 1000;
try {
  console.log("deduplication, retention and date aggregation");
  const first = validateTrafficSourceVisit(validBody);
  const duplicate = validateTrafficSourceVisit({
    ...validBody,
    referrer_host: "",
    source: "direct_unknown",
    utm_source: "changed",
    utm_medium: null,
    utm_campaign: null,
  });
  await check("first session attribution inserts once; later submissions retain it", async () => {
    assert.equal(await recordTrafficSourceVisit({ DB: d1 }, first), true);
    assert.equal(await recordTrafficSourceVisit({ DB: d1 }, duplicate), false);
    const row = db.prepare("SELECT source, utm_source FROM traffic_source_visits WHERE session_id = ?").get(first.sessionId);
    assert.deepEqual({ ...row }, { source: "reddit", utm_source: "newsletter" });
  });

  const insert = db.prepare("INSERT INTO traffic_source_visits (session_id, seen_at, source, utm_source, utm_medium, utm_campaign) VALUES (?, ?, ?, ?, ?, ?)");
  const add = (id: number, at: string, source: string, campaign: string | null = null) =>
    insert.run(id.toString(16).padStart(32, "0"), Date.parse(at) / 1000, source, campaign ? "search" : null, campaign ? "organic" : null, campaign);
  add(2, "2026-10-18T10:00:00Z", "organic_search", "october");
  add(3, "2026-10-10T10:00:00Z", "social");
  add(4, "2026-08-01T10:00:00Z", "direct_unknown");
  await check("selected date range aggregates only matching visits and campaign data", async () => {
    const week = await getTrafficSourceSummary({ DB: d1 }, "7d");
    assert.equal(week.total, 2);
    assert.equal(week.sources.find(row => row.source === "reddit")?.visits, 1);
    assert.equal(week.sources.find(row => row.source === "organic_search")?.visits, 1);
    assert.equal(week.campaigns[0]?.utm_campaign, "october");
    const month = await getTrafficSourceSummary({ DB: d1 }, "30d");
    assert.equal(month.total, 3);
    assert.equal(month.sources.find(row => row.source === "social")?.visits, 1);
    const all = await getTrafficSourceSummary({ DB: d1 }, "all");
    assert.equal(all.total, 4);
    assert.equal(all.period.since, "2026-08-01");
  });
  await check("90-day retention removes only records strictly older than cutoff", async () => {
    add(5, "2026-07-22T11:59:59Z", "referral");
    add(6, "2026-07-22T12:00:00Z", "referral");
    assert.equal(await cleanup.cleanupTrafficSourceVisits({ DB: d1 }), 1);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM traffic_source_visits WHERE session_id = ?").get("00000000000000000000000000000005").count), 0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM traffic_source_visits WHERE session_id = ?").get("00000000000000000000000000000006").count), 1);
  });
} finally {
  Date.now = originalNow;
  db.close();
}

console.log("authorization");
await check("admin aggregation endpoint rejects unauthenticated requests", async () => {
  const response = await adminRoutes.handleAdmin(
    new Request("https://api.example.test/api/admin/analytics/traffic-sources"),
    "analytics/traffic-sources",
    { AUTH_TOKEN_SALT: "x".repeat(32) },
    {},
  );
  assert.equal(response.status, 401);
});
await check("admin aggregation endpoint returns only aggregates to a valid session", async () => {
  const salt = "s".repeat(32);
  const token = "valid-test-token";
  const tokenHash = await auth.sessionTokenHash(token, salt);
  const env = {
    AUTH_TOKEN_SALT: salt,
    ANALYTICS_UTC_OFFSET_MINUTES: 120,
    DB: {
      prepare(sql: string) {
        let params: unknown[] = [];
        return {
          bind(...values: unknown[]) { params = values; return this; },
          async all() { return { results: [] }; },
          async first() {
            if (sql.includes("SELECT email, expires_at, revoked")) {
              return params[0] === tokenHash ? { email: "admin@example.test", expires_at: Math.floor(Date.now() / 1000) + 3600, revoked: 0 } : null;
            }
            return null;
          },
        };
      },
    },
  };
  const response = await adminRoutes.handleAdmin(
    new Request("https://api.example.test/api/admin/analytics/traffic-sources?period=7d", { headers: { Authorization: `Bearer ${token}` } }),
    "analytics/traffic-sources",
    env,
    {},
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.total, 0);
  assert.equal(result.period.key, "7d");
  assert.equal(result.sources.length, 5);
});

console.log("public tracking integration");
const script = readFileSync(new URL("../../../js/pageview.js", import.meta.url), "utf8");
function runTracker({ dnt = "0", gpc = false, path = "/", clock = { now: Date.now() }, values = new Map() } = {}) {
  const requests: Array<{ url: string; body: string }> = [];
  const listeners = new Map<string, () => void>();
  const fixedDate = class extends Date { static now() { return clock.now; } };
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const document = { cookie: "", readyState: "complete", referrer: "https://www.google.com/search?q=boztik" };
  const navigator = { doNotTrack: dnt, globalPrivacyControl: gpc };
  const window = { doNotTrack: dnt, crypto: webcrypto, addEventListener(eventName: string, listener: () => void) { listeners.set(eventName, listener); } };
  const context = {
    navigator, window, document, sessionStorage: storage,
    location: { pathname: path, hostname: "www.boztik.com", protocol: "https:", search: "?utm_source=mail&utm_campaign=autumn" },
    URL, URLSearchParams, Blob, Uint8Array, Date: fixedDate, Math,
    fetch: (url: string, options: { body: string }) => { requests.push({ url, body: options.body }); return Promise.resolve({ ok: true }); },
  };
  vm.runInNewContext(script, context);
  return { requests, values, document, listeners };
}
await check("DNT opt-out suppresses both tracking requests", () => {
  const result = runTracker({ dnt: "1" });
  assert.equal(result.requests.length, 0);
  assert.equal(result.values.size, 0);
});
await check("GPC opt-out suppresses both tracking requests", () => {
  const result = runTracker({ gpc: true });
  assert.equal(result.requests.length, 0);
  assert.equal(result.values.size, 0);
});
await check("unlisted pages remain excluded from both counters", () => {
  const result = runTracker({ path: "/privacy.html" });
  assert.equal(result.requests.length, 0);
  assert.equal(result.values.size, 0);
});
await check("existing page-view payload remains intact and attribution sends only hostname/signal/UTMs", () => {
  const result = runTracker();
  const pageView = result.requests.find(item => item.url.endsWith("/api/public/pageview"));
  const traffic = result.requests.find(item => item.url.endsWith("/api/public/traffic-source"));
  assert.ok(pageView);
  assert.ok(traffic);
  const pageBody = JSON.parse(pageView.body);
  assert.equal(pageBody.page, "homepage");
  assert.match(pageBody.session_id, /^[a-f0-9]{32}$/);
  const trafficBody = JSON.parse(traffic.body);
  assert.equal(trafficBody.referrer_host, "www.google.com");
  assert.equal(trafficBody.search_referrer, true);
  assert.equal(trafficBody.utm_source, "mail");
  assert.equal(trafficBody.utm_campaign, "autumn");
  assert.equal(trafficBody.session_id, result.values.get("boztik_traffic_session"));
  assert.notEqual(trafficBody.session_id, pageBody.session_id);
  assert.equal(trafficBody.referrer_url, undefined);
  assert.equal(trafficBody.page, undefined);
});
await check("traffic identifier is reused before 30 minutes and rotates at inactivity timeout", () => {
  const clock = { now: Date.now() };
  const first = runTracker({ clock });
  const firstId = first.values.get("boztik_traffic_session");
  clock.now += 29 * 60 * 1000;
  first.listeners.get("pointerdown")?.();
  const active = runTracker({ clock, values: first.values });
  assert.equal(active.values.get("boztik_traffic_session"), firstId);
  clock.now += 30 * 60 * 1000;
  const expired = runTracker({ clock, values: active.values });
  assert.notEqual(expired.values.get("boztik_traffic_session"), firstId);
});

console.log(`\nAll ${checks} traffic-source checks passed.`);
