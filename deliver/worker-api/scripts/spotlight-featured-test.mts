// Regression tests for the Spotlight application -> review -> publish -> feature workflow.
//
// Unlike the other Spotlight tests (which use hand-written in-memory stand-ins that pattern-match SQL), this one runs the
// REAL migrations on a REAL SQLite engine and drives the REAL handlers, so every SQL statement the Worker issues is
// actually executed. That is what lets it catch a statement that silently clears another profile's featured state.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { handleSpotlightAdmin, handleSpotlightPublic } from "../src/routes/spotlight.ts";
import { cleanupSpotlightExpiry } from "../src/lib/cleanup.ts";
import { sessionTokenHash } from "../src/lib/auth.ts";
import { FEATURED_OPEN_ENDED_UNTIL } from "../src/lib/spotlight-featured.ts";

const SALT = "featured-test-salt";
const TOKEN = "featured-test-token";
const TERM = 30 * 24 * 60 * 60;
const REVIEW_TERM = 72 * 60 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);

// ---- minimal D1 adapter over node:sqlite -------------------------------------------------------------------------
class Stmt {
  args: unknown[] = [];
  constructor(readonly db: D1, readonly sql: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first() { return (this.db.raw.prepare(this.sql).get(...(this.args as never[])) as any) ?? null; }
  async all() { return { results: this.db.raw.prepare(this.sql).all(...(this.args as never[])) as any[] }; }
  async run() { const info = this.db.raw.prepare(this.sql).run(...(this.args as never[])); return { meta: { changes: Number(info.changes) } }; }
}
class D1 {
  raw = new DatabaseSync(":memory:");
  prepare(sql: string) { return new Stmt(this, sql); }
  async batch(statements: Stmt[]) {
    const out: unknown[] = [];
    this.raw.exec("BEGIN");
    try {
      for (const s of statements) out.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run());
      this.raw.exec("COMMIT");
    } catch (e) { this.raw.exec("ROLLBACK"); throw e; }
    return out;
  }
}

const db = new D1();
const migrationDir = new URL("../migrations/", import.meta.url);
for (const file of readdirSync(migrationDir).filter(f => f.endsWith(".sql")).sort()) {
  db.raw.exec(readFileSync(new URL(file, migrationDir), "utf8"));
}
db.raw.prepare("INSERT INTO sessions(token_hash,email,created_at,expires_at,revoked) VALUES(?,?,?,?,0)")
  .run(await sessionTokenHash(TOKEN, SALT), "admin@example.com", nowSec(), nowSec() + 3600);

const env = { DB: db, AUTH_TOKEN_SALT: SALT, BUCKET: { delete: async () => {} } } as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;

// ---- helpers ---------------------------------------------------------------------------------------------------
const admin = async (method: string, path: string, body?: unknown) => {
  const response = await handleSpotlightAdmin(new Request("https://worker.test/api/admin/spotlight/" + path, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: body === undefined ? undefined : JSON.stringify(body),
  }), path, env);
  return { status: response.status, body: await response.json() as any };
};
const pub = async (method: string, path: string, body?: unknown, ip = "203.0.113.1") => {
  const response = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight/" + path, {
    method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: body === undefined ? undefined : JSON.stringify(body),
  }), path, env, ctx);
  return { status: response.status, body: await response.json() as any };
};
let ipCounter = 10;
const apply = async (name: string) => {
  const result = await pub("POST", "submit", {
    display_name: name, tagline: `${name} makes great things`, category: "creator", consent: true,
    description: `${name} is an independent creator making photo, video and design work for clients.`,
    website_url: "https://example.com", contact_email: "", social_links: {},
  }, `203.0.113.${ipCounter++}`);
  assert.equal(result.status, 201, `application for ${name} should be accepted: ${JSON.stringify(result.body)}`);
  const id = (db.raw.prepare("SELECT id FROM spotlight_profiles WHERE display_name=?").get(name) as any).id as string;
  const reviewTerm = Number(row(id).review_expires_at) - nowSec();
  assert.ok(reviewTerm > REVIEW_TERM - 30 && reviewTerm <= REVIEW_TERM, `new applications retain a 72h review window (got ${reviewTerm}s)`);
  return id;
};
const row = (id: string) => db.raw.prepare("SELECT * FROM spotlight_profiles WHERE id=?").get(id) as any;
const publicProfiles = async () => (await pub("GET", "")).body.profiles as any[];
const featuredNames = async () => (await publicProfiles()).filter(p => p.featured).map(p => p.display_name);
const directoryNames = async () => (await publicProfiles()).map(p => p.display_name);
const review = (id: string, action: string, extra: Record<string, unknown> = {}) => admin("PATCH", `profile/${id}/review`, { action, ...extra });
const publish = (id: string, extra: Record<string, unknown> = {}) => admin("PATCH", `profile/${id}`, { status: "published", ...extra });
const featureExplicit = (id: string, expected: string | null) => admin("PUT", "featured", { profile_id: id, expected_current_id: expected });

// ---- setup: one live, featured creator -------------------------------------------------------------------------
console.log("Setup. Alpha is approved, published and featured (via the legacy PATCH featured:true path)");
const alpha = await apply("Alpha Studio");
assert.equal((await review(alpha, "approve")).status, 200);
assert.equal((await publish(alpha, { featured: true })).status, 200);
assert.deepEqual(await featuredNames(), ["Alpha Studio"]);
assert.equal(row(alpha).featured_until, FEATURED_OPEN_ENDED_UNTIL, "the main featured placement is open-ended (no 24h timer)");
assert.equal(row(alpha).listing_expires_at, null, "the open-ended featured creator is exempt from the 30-day listing term");
assert.equal((await publicProfiles())[0].featured_open_ended, true);

console.log("Scenario 1. A new application is submitted, then reviewed: the featured creator stays");
const bravo = await apply("Bravo Media");
assert.deepEqual(await featuredNames(), ["Alpha Studio"], "submitting an application must not change the featured creator");
assert.equal((await review(bravo, "mark_read")).status, 200);
assert.deepEqual(await featuredNames(), ["Alpha Studio"], "opening/reading an application must not change the featured creator");
assert.equal((await review(bravo, "start_review")).status, 200);
assert.deepEqual(await featuredNames(), ["Alpha Studio"], "starting a review must not change the featured creator");
assert.equal((await review(bravo, "request_info", { note: "Please send a link to your portfolio." })).status, 200);
assert.deepEqual(await featuredNames(), ["Alpha Studio"], "requesting information must not change the featured creator");
const edit = await admin("PATCH", `profile/${bravo}`, { tagline: "Bravo Media makes even better things" });
assert.equal(edit.status, 200, JSON.stringify(edit.body));
assert.deepEqual(await featuredNames(), ["Alpha Studio"], "editing an application must not change the featured creator");
assert.equal(row(alpha).featured_until, FEATURED_OPEN_ENDED_UNTIL);

console.log("Scenario 2. Approving a new creator makes them eligible, but does not feature them");
assert.equal((await review(bravo, "approve")).status, 200);
assert.equal(row(bravo).application_status, "approved");
const bravoReviewTerm = Number(row(bravo).review_expires_at) - nowSec();
assert.ok(bravoReviewTerm > REVIEW_TERM - 30 && bravoReviewTerm <= REVIEW_TERM, `approved applications retain a 72h publish window (got ${bravoReviewTerm}s)`);
assert.equal(row(bravo).featured_until, null, "approval must never promote a creator to the featured slot");
assert.deepEqual(await featuredNames(), ["Alpha Studio"], "approving must not change the featured creator");
assert.equal((await directoryNames()).includes("Bravo Media"), false, "an approved-but-unpublished creator is not public yet");
assert.equal((await publish(bravo)).status, 200);
assert.deepEqual(await featuredNames(), ["Alpha Studio"], "publishing a creator to the directory must not change the featured creator");
const afterPublish = await publicProfiles();
assert.ok(afterPublish.some(p => p.display_name === "Bravo Media" && p.featured === false), "Bravo is now in the community directory, not featured");
const bravoTerm = Number(row(bravo).listing_expires_at) - nowSec();
assert.ok(bravoTerm > TERM - 30 && bravoTerm <= TERM, `a newly published listing receives 30 days (got ${bravoTerm}s)`);
const automaticImpression = await pub("POST", "impression", {
  event_id: "rotation-impression-0001", profile_id: bravo, placement: "rotation",
}, "203.0.113.80");
assert.equal(automaticImpression.status, 200);
assert.equal(automaticImpression.body.counted, true, "automatic homepage rotation impressions count for published non-featured profiles");
const manualImpression = await pub("POST", "impression", {
  event_id: "manual-impression-0001", profile_id: bravo,
}, "203.0.113.81");
assert.equal(manualImpression.body.counted, false, "manual featured impressions still require an explicitly featured profile");

console.log("Scenario 3. Explicitly featuring another creator replaces the previous one, who stays in the directory");
assert.equal((await featureExplicit(bravo, null)).status, 409, "a stale screen (expects no featured creator) cannot replace the current one");
assert.deepEqual(await featuredNames(), ["Alpha Studio"], "a rejected stale request changes nothing");
assert.equal((await admin("PUT", "featured", { profile_id: bravo })).status, 422, "the caller must state which creator is being replaced");
const switched = await featureExplicit(bravo, alpha);
assert.equal(switched.status, 200, JSON.stringify(switched.body));
assert.equal(switched.body.replaced_id, alpha);
assert.deepEqual(await featuredNames(), ["Bravo Media"]);
assert.equal(row(bravo).featured_until, FEATURED_OPEN_ENDED_UNTIL);
assert.equal(row(bravo).listing_expires_at, null);
assert.equal(row(alpha).featured_until, null);
assert.equal(row(alpha).status, "published", "the previous featured creator is not unpublished");
assert.ok((await directoryNames()).includes("Alpha Studio"), "the previous featured creator stays in the community directory");
const alphaTerm = Number(row(alpha).listing_expires_at) - nowSec();
assert.ok(alphaTerm > TERM - 30 && alphaTerm <= TERM, `the previous creator gets a fresh 30-day term (got ${alphaTerm}s)`);
assert.equal((await featureExplicit(bravo, bravo)).status, 200, "re-confirming the current featured creator is allowed and idempotent");
assert.deepEqual(await featuredNames(), ["Bravo Media"]);

console.log("Scenario 4. Declined and pending applications are private and change nothing");
const charlie = await apply("Charlie Audio");
const delta = await apply("Delta Games");
assert.equal((await review(charlie, "decline", { reason: "Not a fit for Spotlight right now." })).status, 200);
assert.equal(row(charlie).application_status, "declined");
assert.deepEqual(await featuredNames(), ["Bravo Media"], "declining must not change the featured creator");
const names = await directoryNames();
assert.equal(names.includes("Charlie Audio"), false, "a declined application is never public");
assert.equal(names.includes("Delta Games"), false, "a pending application is never public");
assert.ok(names.includes("Alpha Studio") && names.includes("Bravo Media"));
assert.equal((await featureExplicit(charlie, bravo)).status, 422, "a declined profile cannot be featured");
assert.equal((await featureExplicit(delta, bravo)).status, 422, "a pending profile cannot be featured");
assert.deepEqual(await featuredNames(), ["Bravo Media"]);

console.log("No duplicate or lost records");
assert.equal((db.raw.prepare("SELECT COUNT(*) c FROM spotlight_profiles").get() as any).c, 4);
assert.equal((db.raw.prepare("SELECT COUNT(DISTINCT slug) c FROM spotlight_profiles").get() as any).c, 4);
const events = (db.raw.prepare("SELECT action FROM spotlight_review_events WHERE profile_id=?").all(bravo) as any[]).map(e => e.action);
assert.ok(["submitted", "mark_read", "start_review", "request_info", "approve"].every(a => events.includes(a)), "application history is intact");

console.log("Legacy PATCH featured:true behaves the same: it replaces the previous creator and nothing else changes");
assert.equal((await publish(alpha, { featured: true })).status, 200);
assert.deepEqual(await featuredNames(), ["Alpha Studio"]);
assert.equal(row(bravo).status, "published");
assert.ok(Number(row(bravo).listing_expires_at) > nowSec(), "the creator who stepped down is still in the directory with a fresh term");
assert.equal((await publish(bravo)).status, 200, "re-saving a non-featured creator does not disturb the featured one");
assert.deepEqual(await featuredNames(), ["Alpha Studio"]);

console.log("Removing a legacy time-limited feature gives the creator a fresh 30-day directory term");
db.raw.prepare("UPDATE spotlight_profiles SET featured_until=?,listing_expires_at=? WHERE id=?").run(nowSec() + 3600, nowSec() + 3600, alpha);
assert.equal((await admin("PATCH", `profile/${alpha}`, { featured: false })).status, 200);
assert.deepEqual(await featuredNames(), []);
assert.ok((await directoryNames()).includes("Alpha Studio"));
assert.ok(Number(row(alpha).listing_expires_at) > nowSec(), "a creator whose feature was removed gets a fresh listing term");

console.log("Unpublishing the featured creator removes only them");
assert.equal((await featureExplicit(bravo, null)).status, 200);
assert.equal((await admin("PATCH", `profile/${bravo}`, { status: "archived" })).status, 200);
assert.deepEqual(await featuredNames(), []);
assert.equal(row(bravo).featured_until, null);
assert.ok((await directoryNames()).includes("Alpha Studio"));

console.log("The expiry sweep never expires the open-ended featured creator, but still expires ordinary listings after their 30-day term");
assert.equal((await publish(bravo)).status, 200);
assert.equal((await featureExplicit(bravo, null)).status, 200);
db.raw.prepare("UPDATE spotlight_profiles SET listing_expires_at=? WHERE id=?").run(nowSec() - 10, alpha);
db.raw.prepare("UPDATE spotlight_profiles SET listing_expires_at=? WHERE id=?").run(nowSec() - 10, bravo); // defence in depth: not producible through the API
const report = await cleanupSpotlightExpiry(env);
assert.equal(row(alpha).status, "archived", "an ordinary expired listing is still swept");
assert.equal(row(bravo).status, "published", "the open-ended featured creator is not swept");
assert.equal(report.expired, 1);

console.log("All Spotlight featured-workflow tests passed.");
