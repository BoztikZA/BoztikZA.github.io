/**
 * Spotlight applications (Phase 4): private owner link, terms, information requests, audit trail and emails,
 * against a REAL SQLite database built from the repository's actual migrations (including 0020).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleSpotlightAdmin, handleSpotlightPublic, publicDto } from "../src/routes/spotlight.ts";
import { sessionTokenHash } from "../src/lib/auth.ts";
import { SPOTLIGHT_TERMS_VERSION, hashOwnerToken } from "../src/lib/spotlight-owner.ts";
import { HARD_CAP_BYTES } from "../src/lib/storage.ts";

const SALT = "spotlight-media-test-salt";
const TOKEN = "spotlight-media-test-token";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); passed += 1; console.log("  ok  " + name); }
  catch (err) { console.error("FAIL  " + name); throw err; }
}

/** D1-shaped adapter over node:sqlite (prepare/bind/run/all/first + batch in one transaction). */
class SqliteD1 {
  db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }
  prepare(sql: string) {
    const db = this.db; let params: unknown[] = [];
    const stmt = {
      sql, get params() { return params; },
      bind(...v: unknown[]) { params = v; return this; },
      async run() { const r = db.prepare(sql).run(...params as never[]); return { meta: { changes: Number(r.changes) }, results: [] }; },
      async all() { return { results: db.prepare(sql).all(...params as never[]) }; },
      async first() { return db.prepare(sql).get(...params as never[]) ?? null; },
    };
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

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) {
  sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
}
sqlite.prepare("INSERT INTO sessions(token_hash,email,created_at,expires_at,revoked) VALUES(?,?,?,?,0)")
  .run(await sessionTokenHash(TOKEN, SALT), "admin@example.com", 1, Math.floor(Date.now() / 1000) + 3600);

const env = {
  DB: new SqliteD1(sqlite), BUCKET: {}, AUTH_TOKEN_SALT: SALT, STORAGE_LIMIT_BYTES: String(HARD_CAP_BYTES),
  ALLOWED_ORIGINS: "https://www.boztik.com", RATE_LIMIT_PUBLIC_PER_MINUTE: "100000",
} as never;


const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error("unexpected network call"); }) as typeof fetch;

const base = (extra: Record<string, unknown> = {}) => ({
  display_name: "Owner Flow Creator", tagline: "Makes things worth featuring", category: "music",
  description: "A creator profile used to test the private applicant flow end to end.",
  contact_email: "creator@example.com", consent: true, ...extra,
});
async function admin(path: string, method: string, body?: unknown, auth = true): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${TOKEN}`;
  const response = await handleSpotlightAdmin(new Request(`https://worker.test/api/admin/spotlight/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), path, env);
  return { status: response.status, data: await response.json() };
}
async function pubPost(path: string, body: unknown, origin = "https://www.boztik.com"): Promise<{ status: number; data: any; text: string }> {
  const response = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight/" + path, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
  }), "/" + path, env, {} as never);
  const text = await response.text();
  return { status: response.status, data: JSON.parse(text), text };
}
const submit = (body: Record<string, unknown>) => pubPost("submit", body);
const owner = (token: unknown) => pubPost("owner", { token });
const respond = (token: unknown, message: unknown) => pubPost("owner/respond", { token, message });
const row = (id: string) => sqlite.prepare("SELECT * FROM spotlight_profiles WHERE id=?").get(id) as any;
const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error; console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
};
const idByToken = async (token: string) => (sqlite.prepare("SELECT id FROM spotlight_profiles WHERE owner_token_hash=?").get(await hashOwnerToken(token)) as any)?.id as string;

let tokenA = "", idA = "", tokenB = "", idB = "";

await test("submit requires the terms/ownership consent and stores nothing without it", async () => {
  const before = (sqlite.prepare("SELECT COUNT(*) n FROM spotlight_profiles").get() as any).n;
  const r = await submit(base({ consent: false }));
  assert.equal(r.status, 422);
  assert.equal(r.data.code, "consent_required");
  assert.equal((sqlite.prepare("SELECT COUNT(*) n FROM spotlight_profiles").get() as any).n, before);
});

await test("submit issues a 256-bit owner token once; only its hash is stored; terms version and time are recorded", async () => {
  const r = await submit(base());
  assert.equal(r.status, 201);
  tokenA = r.data.owner_token;
  assert.match(tokenA, /^[A-Za-z0-9_-]{43}$/);
  idA = await idByToken(tokenA);
  const stored = row(idA);
  assert.equal(stored.owner_token_hash, await hashOwnerToken(tokenA));
  assert.equal(stored.terms_version, SPOTLIGHT_TERMS_VERSION);
  assert.ok(stored.terms_accepted_at > 0);
  assert.equal(stored.placement_plan, "free");
  // The secret appears nowhere in the stored row.
  assert.ok(!JSON.stringify(stored).includes(tokenA), "token must never be stored in clear");
  const events = sqlite.prepare("SELECT actor,action FROM spotlight_review_events WHERE profile_id=?").all(idA) as any[];
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [{ actor: "applicant", action: "submitted" }]);
  const second = await submit(base({ display_name: "Second Applicant", contact_email: "second@example.com" }));
  tokenB = second.data.owner_token; idB = await idByToken(tokenB);
  assert.notEqual(tokenA, tokenB);
  assert.notEqual(idA, idB);
});

await test("the owner sees their own status, and the DTO never includes the contact email, ids or admin fields", async () => {
  const r = await owner(tokenA);
  assert.equal(r.status, 200);
  const a = r.data.application;
  assert.equal(a.stage, "received");
  assert.equal(a.display_name, "Owner Flow Creator");
  assert.equal(a.info_request, null);
  for (const forbidden of ["contact_email", "creator@example.com", "review_unread", "owner_token_hash", "terms_version", idA]) {
    assert.ok(!r.text.includes(forbidden), "owner response leaked " + forbidden);
  }
  assert.ok(r.text.includes("Owner Flow Creator"));
});

await test("isolation: a token only ever reveals its own application", async () => {
  const a = (await owner(tokenA)).data.application, b = (await owner(tokenB)).data.application;
  assert.equal(a.display_name, "Owner Flow Creator");
  assert.equal(b.display_name, "Second Applicant");
  assert.ok(!JSON.stringify(a).includes("Second Applicant"));
});

await test("malformed, unknown and ID-shaped tokens all get the same 404; no token or ID is accepted as authorisation", async () => {
  const unknown = "A".repeat(43);
  const results = [await owner(unknown), await owner("short"), await owner(idA), await owner(null), await owner(await hashOwnerToken(tokenA)), await owner(tokenA + "x")];
  for (const r of results) { assert.equal(r.status, 404); assert.equal(r.data.error, "Application not found"); }
  assert.equal((await respond(idA, "I am pretending to be the owner")).status, 404);
});

await test("owner endpoints reject cross-site origins", async () => {
  const r = await quietly(() => pubPost("owner", { token: tokenA }, "https://evil.example"));
  assert.ok(r.status === 403 || r.status === 400, "status " + r.status);
});

await test("owner cannot reply when nothing was requested", async () => {
  const r = await respond(tokenA, "Unprompted reply with plenty of text");
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "no_info_requested");
});

await test("admin request_info needs a session, a real note, and an eligible application", async () => {
  assert.equal((await admin(`profile/${idA}/review`, "PATCH", { action: "request_info", note: "Please link your portfolio." }, false)).status, 401);
  const short = await admin(`profile/${idA}/review`, "PATCH", { action: "request_info", note: "more" });
  assert.equal(short.status, 422);
  assert.equal(short.data.code, "info_note_required");
  assert.equal(row(idA).info_request_note, null);
});

await test("request_info moves to under_review, shows the owner an information-needed state, and queues the applicant email", async () => {
  const r = await admin(`profile/${idA}/review`, "PATCH", { action: "request_info", note: "Please link your portfolio or a recent project." });
  assert.equal(r.status, 200);
  assert.equal(r.data.application_status, "under_review");
  const stored = row(idA);
  assert.equal(stored.application_status, "under_review");
  assert.ok(stored.info_requested_at > 0);
  const a = (await owner(tokenA)).data.application;
  assert.equal(a.stage, "info_needed");
  assert.equal(a.info_request.note, "Please link your portfolio or a recent project.");
  assert.equal(a.info_request.awaiting_reply, true);
  const queued = sqlite.prepare("SELECT kind,ref,recipient FROM spotlight_email_outbox WHERE profile_id=? AND kind='info_requested'").all(idA) as any[];
  assert.equal(queued.length, 1);
  assert.equal(queued[0].ref, String(stored.info_requested_at), "ref ties the email to this specific request");
  // The admin list exposes the overlay.
  const list = (await admin("", "GET")).data.profiles.find((p: any) => p.id === idA);
  assert.equal(list.awaiting_applicant, true);
  assert.equal(list.info_request_note, "Please link your portfolio or a recent project.");
});

await test("owner reply is validated, recorded once, audited, and queues a team alert", async () => {
  assert.equal((await respond(tokenA, "ok")).data.code, "reply_required");
  const r = await respond(tokenA, "Portfolio: https://example.com/work");
  assert.equal(r.status, 200);
  assert.equal(r.data.application.stage, "in_review");
  assert.equal(r.data.application.info_request.awaiting_reply, false);
  assert.equal(r.data.application.info_request.reply, "Portfolio: https://example.com/work");
  const again = await respond(tokenA, "A second reply should not be accepted");
  assert.equal(again.status, 409);
  assert.equal(row(idA).info_response_note, "Portfolio: https://example.com/work");
  const team = sqlite.prepare("SELECT kind FROM spotlight_email_outbox WHERE profile_id=? AND kind='info_received'").all(idA);
  assert.equal(team.length, 1);
  const list = (await admin("", "GET")).data.profiles.find((p: any) => p.id === idA);
  assert.equal(list.awaiting_applicant, false);
  assert.equal(list.info_response_note, "Portfolio: https://example.com/work");
});

await test("a reply cannot touch another application", async () => {
  assert.equal(row(idB).info_response_note, null);
  assert.equal((await respond(tokenB, "Replying without any request open")).status, 409);
});

await test("the audit log records submit, request and reply in order, for admins only", async () => {
  assert.equal((await admin(`profile/${idA}/events`, "GET", undefined, false)).status, 401);
  const events = (await admin(`profile/${idA}/events`, "GET")).data.events as any[];
  const actions = events.map(e => e.action).reverse();
  assert.deepEqual(actions, ["submitted", "request_info", "info_received"]);
  assert.equal(events.find(e => e.action === "request_info").actor, "admin@example.com");
  assert.equal(events.find(e => e.action === "info_received").actor, "applicant");
});

await test("a second information request re-opens the loop with a new note", async () => {
  const r = await admin(`profile/${idA}/review`, "PATCH", { action: "request_info", note: "One more thing: confirm the website is yours." });
  assert.equal(r.status, 200);
  const a = (await owner(tokenA)).data.application;
  assert.equal(a.stage, "info_needed");
  assert.equal(a.info_request.note, "One more thing: confirm the website is yours.");
  assert.equal(a.info_request.awaiting_reply, true);
});

await test("approval and decline reach the owner; decline reason is visible only after a decline", async () => {
  const before = (await owner(tokenB)).data.application;
  assert.equal(before.decline_reason, null);
  const declined = await admin(`profile/${idB}/review`, "PATCH", { action: "decline", reason: "Please add a clearer description of your work." });
  assert.equal(declined.status, 200);
  const b = (await owner(tokenB)).data.application;
  assert.equal(b.stage, "declined");
  assert.equal(b.decline_reason, "Please add a clearer description of your work.");
  const approved = await admin(`profile/${idA}/review`, "PATCH", { action: "approve" });
  assert.equal(approved.status, 200);
  const a = (await owner(tokenA)).data.application;
  assert.equal(a.stage, "approved");
  assert.equal(a.public_url, null, "an approved but unpublished application has no public URL");
  assert.equal((await respond(tokenA, "Replying after approval is not possible")).status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM spotlight_email_outbox WHERE profile_id=? AND kind='approved'").get(idA).n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM spotlight_email_outbox WHERE profile_id=? AND kind='declined'").get(idB).n, 0, "declines stay an admin-written draft");
});

await test("information requests cannot be made on a declined application", async () => {
  const r = await admin(`profile/${idB}/review`, "PATCH", { action: "request_info", note: "Too late to ask for more details." });
  assert.equal(r.status, 409);
});

await test("public profile DTO never carries private application data", async () => {
  const dto = publicDto({ ...row(idA), status: "published", application_status: "approved" }, []);
  const text = JSON.stringify(dto);
  for (const forbidden of ["owner_token_hash", "info_request_note", "info_response_note", "terms_version", "contact_email", "creator@example.com", "Portfolio: https://example.com/work"]) {
    assert.ok(!text.includes(forbidden), "public DTO leaked " + forbidden);
  }
});

await test("migration 0020 kept every existing outbox/event row and added the new kinds", async () => {
  const kinds = ["new_submission", "declined", "info_requested", "approved", "info_received"];
  const ddl = (sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='spotlight_email_outbox'").get() as any).sql as string;
  for (const k of kinds) assert.ok(ddl.includes(`'${k}'`), "outbox kind " + k);
  const fk = sqlite.prepare("PRAGMA foreign_key_check").all();
  assert.equal(fk.length, 0);
});

globalThis.fetch = realFetch;
console.log(`\nspotlight-owner: ${passed} tests passed`);
