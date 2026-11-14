/**
 * Spotlight analytics v2 against a REAL SQLite database built from the actual migrations (0001..0021).
 * Covers: event validation, idempotency, link-type and source buckets, featured-only player events, completion
 * integrity, admin-preview and bot exclusion, owner-scoped analytics (hash lookup, isolation, ranges), storage cleanup
 * by cascade, and that nothing private leaks into the owner response.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleSpotlightAdmin, handleSpotlightPublic } from "../src/routes/spotlight.ts";
import { sessionTokenHash } from "../src/lib/auth.ts";
import { parseRange } from "../src/lib/spotlight-analytics.ts";
import { HARD_CAP_BYTES } from "../src/lib/storage.ts";

const SALT = "analytics-test-salt", ADMIN = "analytics-admin-token";
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed += 1; console.log("  ok  " + name); } catch (e) { console.error("FAIL  " + name); throw e; }
}
class SqliteD1 {
  constructor(readonly db: DatabaseSync) {}
  prepare(sql: string) {
    const db = this.db; let params: unknown[] = [];
    return {
      sql, get params() { return params; }, bind(...v: unknown[]) { params = v; return this; },
      async run() { const r = db.prepare(sql).run(...params as never[]); return { meta: { changes: Number(r.changes) }, results: [] }; },
      async all() { return { results: db.prepare(sql).all(...params as never[]) }; },
      async first() { return db.prepare(sql).get(...params as never[]) ?? null; },
    };
  }
  async batch(stmts: Array<{ sql: string; params: unknown[] }>) {
    this.db.exec("BEGIN");
    try { const out = []; for (const s of stmts) { const r = this.db.prepare(s.sql).run(...s.params as never[]); out.push({ meta: { changes: Number(r.changes) } }); } this.db.exec("COMMIT"); return out; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
}
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
sqlite.prepare("INSERT INTO sessions(token_hash,email,created_at,expires_at,revoked) VALUES(?,?,?,?,0)").run(await sessionTokenHash(ADMIN, SALT), "admin@example.com", 1, Math.floor(Date.now() / 1000) + 3600);
const env = { DB: new SqliteD1(sqlite), BUCKET: {}, AUTH_TOKEN_SALT: SALT, STORAGE_LIMIT_BYTES: String(HARD_CAP_BYTES), ALLOWED_ORIGINS: "https://www.boztik.com", RATE_LIMIT_PUBLIC_PER_MINUTE: "100000" } as never;
globalThis.fetch = (async () => { throw new Error("unexpected network"); }) as typeof fetch;

const nowS = () => Math.floor(Date.now() / 1000);
const hex = (n: number) => n.toString(16).padStart(20, "0");
const ID_A = hex(0xa1), ID_B = hex(0xb2), ID_PENDING = hex(0xc3), ID_PLAIN = hex(0xd4);
function seed(id: string, slug: string, opts: { status?: string; featured?: boolean; token?: string; published?: boolean } = {}) {
  const t = nowS();
  sqlite.prepare(`INSERT INTO spotlight_profiles(id,slug,display_name,tagline,description,category,contact_email,social_links,status,application_status,created_at,updated_at,published_at,listing_expires_at,featured_until,owner_token_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, slug, "Profile " + slug, "tagline here", "d".repeat(40), "music", "private@example.com", "{}", opts.status ?? "published", opts.status === "pending" ? "new" : "published", t, t, opts.published === false ? null : t, t + 86400, opts.featured ? t + 3600 : null, opts.token ?? null);
}
const ownerToken = (c: string) => c.repeat(43);
const { hashOwnerToken } = await import("../src/lib/spotlight-owner.ts");
seed(ID_A, "a", { featured: true, token: await hashOwnerToken(ownerToken("A")) });
seed(ID_B, "b", { featured: true, token: await hashOwnerToken(ownerToken("B")) });
seed(ID_PENDING, "pending", { status: "pending", published: false, token: await hashOwnerToken(ownerToken("C")) });
seed(ID_PLAIN, "plain", { featured: false });

let counter = 0;
const eid = () => "evt" + String(++counter).padStart(12, "0");
const uuid = () => crypto.randomUUID();
async function ev(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight/event", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.boztik.com", ...headers }, body: JSON.stringify(body),
  }), "/event", env, {} as never);
  return { status: res.status, data: await res.json() as any };
}
async function owner(token: string, days?: number) {
  const res = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight/owner/analytics", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.boztik.com" }, body: JSON.stringify({ token, days }),
  }), "/owner/analytics", env, {} as never);
  const text = await res.text(); return { status: res.status, data: JSON.parse(text), text };
}
const metrics = (id: string) => sqlite.prepare("SELECT * FROM spotlight_daily_metrics WHERE profile_id=?").get(id) as any;

await test("a counted view records views, unique visitors and a source bucket; retries are idempotent", async () => {
  const id = eid(), visitor = uuid();
  const first = await ev({ event_id: id, profile_id: ID_A, type: "view", visitor_id: visitor, source: "search" });
  assert.equal(first.data.counted, true);
  assert.equal((await ev({ event_id: id, profile_id: ID_A, type: "view", visitor_id: visitor, source: "search" })).data.counted, false);
  await ev({ event_id: eid(), profile_id: ID_A, type: "view", visitor_id: visitor, source: "directory" });
  const m = metrics(ID_A);
  assert.equal(m.views, 2); assert.equal(m.unique_views, 1, "same visitor, same day");
  const src = Object.fromEntries((sqlite.prepare("SELECT source,views FROM spotlight_source_daily WHERE profile_id=?").all(ID_A) as any[]).map(r => [r.source, r.views]));
  assert.deepEqual(src, { search: 1, directory: 1 });
});

await test("a view without a source is bucketed as direct; unknown sources are rejected", async () => {
  await ev({ event_id: eid(), profile_id: ID_A, type: "view", visitor_id: uuid() });
  assert.equal((sqlite.prepare("SELECT views FROM spotlight_source_daily WHERE profile_id=? AND source='direct'").get(ID_A) as any).views, 1);
  assert.equal((await ev({ event_id: eid(), profile_id: ID_A, type: "view", visitor_id: uuid(), source: "http://evil.example/x" })).status, 422);
});

await test("clicks are split by destination type while outbound_clicks stays the total", async () => {
  for (const target of ["website", "website", "social", "media", "other", undefined]) await ev({ event_id: eid(), profile_id: ID_A, type: "click", target });
  const m = metrics(ID_A);
  assert.equal(m.outbound_clicks, 6); assert.equal(m.website_clicks, 2); assert.equal(m.social_clicks, 1); assert.equal(m.media_clicks, 1);
  assert.equal((await ev({ event_id: eid(), profile_id: ID_A, type: "click", target: "payload" })).status, 422);
});

await test("player and completed-play events: featured-only, deliberate, and a completion needs its own player start", async () => {
  const play = "play" + "x".repeat(12);
  assert.equal((await ev({ event_id: eid(), profile_id: ID_A, type: "complete", play_id: play })).data.counted, false, "no start, no completion");
  assert.equal((await ev({ event_id: eid(), profile_id: ID_A, type: "player", play_id: play })).data.counted, true);
  assert.equal((await ev({ event_id: eid(), profile_id: ID_A, type: "player", play_id: play })).data.counted, false, "same play is not counted twice");
  assert.equal((await ev({ event_id: eid(), profile_id: ID_B, type: "complete", play_id: play })).data.counted, false, "a play started on A cannot complete on B");
  assert.equal((await ev({ event_id: eid(), profile_id: ID_A, type: "complete", play_id: play })).data.counted, true);
  assert.equal((await ev({ event_id: eid(), profile_id: ID_A, type: "complete", play_id: play })).data.counted, false);
  const m = metrics(ID_A); assert.equal(m.player_interactions, 1); assert.equal(m.completed_plays, 1);
  assert.equal(metrics(ID_B), undefined);
  assert.equal((await ev({ event_id: eid(), profile_id: ID_PLAIN, type: "player", play_id: "plain" + "y".repeat(10) })).data.counted, false, "not currently featured");
  assert.equal(metrics(ID_PLAIN), undefined);
});

await test("events for pending, unknown or unpublished profiles are never counted", async () => {
  assert.equal((await ev({ event_id: eid(), profile_id: ID_PENDING, type: "view", visitor_id: uuid() })).data.counted, false);
  assert.equal((await ev({ event_id: eid(), profile_id: hex(0xff), type: "click" })).data.counted, false);
  assert.equal(metrics(ID_PENDING), undefined);
});

await test("administrator previews and automated clients are excluded", async () => {
  const before = metrics(ID_B)?.views ?? 0;
  assert.equal((await ev({ event_id: eid(), profile_id: ID_B, type: "view", visitor_id: uuid() }, { Authorization: "Bearer " + ADMIN })).data.counted, false);
  assert.equal((await ev({ event_id: eid(), profile_id: ID_B, type: "view", visitor_id: uuid() }, { "User-Agent": "Googlebot/2.1" })).data.counted, false);
  assert.equal((await ev({ event_id: eid(), profile_id: ID_B, type: "view", visitor_id: uuid() }, { "User-Agent": "HeadlessChrome/120" })).data.counted, false);
  assert.equal(metrics(ID_B)?.views ?? 0, before);
  // A bogus bearer token is not an admin: the visitor is still counted.
  assert.equal((await ev({ event_id: eid(), profile_id: ID_B, type: "view", visitor_id: uuid() }, { Authorization: "Bearer not-a-session" })).data.counted, true);
  const imp = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight/impression", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.boztik.com", Authorization: "Bearer " + ADMIN }, body: JSON.stringify({ event_id: eid(), profile_id: ID_B }) }), "/impression", env, {} as never);
  assert.equal((await imp.json() as any).counted, false);
});

await test("owner analytics: scoped to the token's own profile, full zero-filled series, derived only from stored aggregates", async () => {
  const r = await owner(ownerToken("A"), 7);
  assert.equal(r.status, 200);
  const a = r.data.analytics;
  assert.equal(a.range_days, 7); assert.equal(a.series.length, 7);
  assert.equal(a.totals.views, 3); assert.equal(a.totals.link_clicks, 6); assert.equal(a.totals.website_clicks, 2);
  assert.equal(a.totals.player_interactions, 1); assert.equal(a.totals.completed_plays, 1);
  assert.equal(a.sources.find((s: any) => s.source === "search").views, 1);
  assert.equal(a.series.at(-1).views, 3);
  assert.equal(a.series[0].views, 0);
  const b = (await owner(ownerToken("B"), 7)).data.analytics;
  assert.equal(b.totals.views, 1, "B only sees B's views");
  for (const forbidden of ["private@example.com", ID_A, ID_B, "owner_token_hash", "contact_email"]) assert.ok(!r.text.includes(forbidden), "leaked " + forbidden);
});

await test("owner analytics rejects unknown tokens and profile-ID impersonation; unpublished applications get nothing", async () => {
  assert.equal((await owner("Z".repeat(43))).status, 404);
  assert.equal((await owner(ID_A)).status, 404);
  const res = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight/owner/analytics", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.boztik.com" }, body: JSON.stringify({ token: ownerToken("B"), profile_id: ID_A }) }), "/owner/analytics", env, {} as never);
  const impersonation = await res.json() as any;
  assert.equal(impersonation.analytics.totals.views, 1, "a profile_id in the body is ignored");
  assert.equal((await owner(ownerToken("C"))).data.analytics, null, "pending application has no analytics");
});

await test("ranges are clamped to 7/30/90 days", async () => {
  assert.equal(parseRange(7), 7); assert.equal(parseRange("90"), 90); assert.equal(parseRange(1000), 30); assert.equal(parseRange(-1), 30); assert.equal(parseRange("x"), 30);
  assert.equal((await owner(ownerToken("A"), 90)).data.analytics.series.length, 90);
  assert.equal((await owner(ownerToken("A"), 5000)).data.analytics.series.length, 30);
});

await test("admin per-profile analytics requires a session and mirrors the owner numbers", async () => {
  const call = (auth: boolean) => handleSpotlightAdmin(new Request(`https://worker.test/api/admin/spotlight/profile/${ID_A}/analytics?days=7`, { headers: auth ? { Authorization: "Bearer " + ADMIN } : {} }), `profile/${ID_A}/analytics`, env);
  assert.equal((await call(false)).status, 401);
  const ok = await (await call(true)).json() as any;
  assert.equal(ok.analytics.totals.views, 3);
  const list = await (await handleSpotlightAdmin(new Request("https://worker.test/api/admin/spotlight/analytics", { headers: { Authorization: "Bearer " + ADMIN } }), "analytics", env)).json() as any;
  assert.equal(list.profiles.find((p: any) => p.id === ID_A).completed_plays, 1);
});

await test("deleting a profile cascades its analytics rows", async () => {
  sqlite.prepare("DELETE FROM spotlight_profiles WHERE id=?").run(ID_A);
  for (const table of ["spotlight_daily_metrics", "spotlight_engagement_events", "spotlight_source_daily", "spotlight_events", "spotlight_visitors"]) {
    assert.equal((sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE profile_id=?`).get(ID_A) as any).n, 0, table);
  }
});

console.log(`\nspotlight-analytics: ${passed} tests passed`);
