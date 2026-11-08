// Regression tests for the Command Centre "Save draft" workflow (admin create / list / edit).
// Drives the real handleSpotlightAdmin() with real session authentication against an in-memory D1 stand-in.
import assert from "node:assert/strict";
import { handleSpotlightAdmin } from "../src/routes/spotlight.ts";
import { sessionTokenHash } from "../src/lib/auth.ts";
import { spotlightProfileSaveRequest } from "../../../deliver-v3/js/spotlight-profile-request.mjs";

const SALT = "test-salt";
const TOKEN = "admin-test-token";

class AdminStatement {
  args: unknown[] = [];
  constructor(readonly db: AdminDb, readonly sql: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  first() { return this.db.first(this.sql, this.args); }
  run() { return this.db.run(this.sql, this.args); }
  all() { return this.db.all(this.sql); }
}

class AdminDb {
  profiles = new Map<string, any>();
  sessions = new Map<string, { email: string; expires_at: number; revoked: number }>();
  failInserts = false;
  prepare(sql: string) { return new AdminStatement(this, sql); }
  async first(sql: string, args: unknown[]) {
    if (sql.includes("FROM sessions WHERE token_hash")) return this.sessions.get(String(args[0])) ?? null;
    if (sql.includes("FROM spotlight_profiles WHERE id=?")) {
      const row = this.profiles.get(String(args[0]));
      return row ? { ...row } : null;
    }
    throw new Error("Unexpected first() SQL: " + sql);
  }
  async run(sql: string, args: unknown[]) {
    if (sql.startsWith("INSERT INTO spotlight_profiles")) {
      if (this.failInserts) throw new Error("D1 unavailable");
      const [id, slug, display_name, tagline, description, category, contact_email, website_url, social_links, song_metadata, created_at, updated_at] = args as any[];
      this.profiles.set(id, {
        id, slug, display_name, tagline, description, category, contact_email, website_url, social_links, song_metadata,
        status: "pending", featured_until: null, image_key: null, created_at, updated_at, published_at: null,
      });
      return { meta: { changes: 1 } };
    }
    throw new Error("Unexpected run() SQL: " + sql);
  }
  async all(sql: string) {
    if (sql.includes("FROM spotlight_profiles ORDER BY CASE status")) {
      return { results: [...this.profiles.values()].sort((a, b) => b.created_at - a.created_at).map(r => ({ ...r })) };
    }
    throw new Error("Unexpected all() SQL: " + sql);
  }
  async batch(statements: AdminStatement[]) {
    return statements.map(statement => {
      if (statement.sql.startsWith("UPDATE spotlight_profiles SET display_name=?")) {
        const [display_name, tagline, description, category, contact_email, website_url, social_links, song_metadata, status, featured_until, updated_at, , , id] = statement.args as any[];
        const row = this.profiles.get(id);
        Object.assign(row, { display_name, tagline, description, category, contact_email, website_url, social_links, song_metadata, status, featured_until, updated_at });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    });
  }
}

async function makeEnv() {
  const db = new AdminDb();
  db.sessions.set(await sessionTokenHash(TOKEN, SALT), { email: "admin@example.com", expires_at: Math.floor(Date.now() / 1000) + 3600, revoked: 0 });
  return { db, env: { DB: db, AUTH_TOKEN_SALT: SALT } as never };
}

const websiteOnly = (overrides: Record<string, unknown> = {}) => ({
  display_name: "Boztik Test Studio",
  tagline: "Photo restoration done properly",
  category: "small-business",
  description: "We restore and enhance old family photographs for clients across South Africa.",
  website_url: "https://www.example.com",
  contact_email: "",
  song_url: "",
  social_links: {},
  ...overrides,
});

function adminRequest(method: string, body?: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("https://worker.test/api/admin/spotlight/profile", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const create = async (env: never, body: unknown, token: string | null = TOKEN) =>
  handleSpotlightAdmin(adminRequest("POST", body, token), "profile", env);

console.log("1. Website-only profile saves (no email, no social links)");
{
  const { db, env } = await makeEnv();
  const response = await create(env, websiteOnly());
  const data = await response.json() as any;
  assert.equal(response.status, 201, `expected 201, got ${response.status}: ${data.error}`);
  assert.equal(data.ok, true);
  assert.ok(data.profile.id);
  assert.equal(data.profile.status, "pending");
  assert.equal(data.profile.contact_email, "");
  assert.equal(data.profile.website_url, "https://www.example.com/");
  assert.equal(db.profiles.size, 1);
}

console.log("2. Profile without any social links saves, whether the field is empty or absent");
{
  const { db, env } = await makeEnv();
  const { social_links: _omit, ...withoutField } = websiteOnly();
  assert.equal((await create(env, websiteOnly({ social_links: {} }))).status, 201);
  assert.equal((await create(env, withoutField)).status, 201);
  assert.equal(db.profiles.size, 2);
}

console.log("3. Profile with a valid email saves and the email is normalised");
{
  const { db, env } = await makeEnv();
  const response = await create(env, websiteOnly({ contact_email: "Hello@Example.com" }));
  assert.equal(response.status, 201);
  assert.equal([...db.profiles.values()][0].contact_email, "hello@example.com");
}

console.log("4. Invalid email returns a clear 422 and saves nothing");
{
  const { db, env } = await makeEnv();
  const response = await create(env, websiteOnly({ contact_email: "not-an-email" }));
  const data = await response.json() as any;
  assert.equal(response.status, 422);
  assert.match(data.error, /email/i);
  assert.equal(db.profiles.size, 0);
}

console.log("5. A description near 5,000 characters saves quickly and intact");
{
  const { db, env } = await makeEnv();
  const description = ("Restoration and enhancement for treasured family photographs. ".repeat(90)).slice(0, 4990).trim();
  assert.ok(description.length >= 4900 && description.length <= 5000);
  const started = Date.now();
  const response = await create(env, websiteOnly({ description }));
  const elapsed = Date.now() - started;
  assert.equal(response.status, 201);
  assert.ok(elapsed < 1000, `save took ${elapsed}ms`);
  assert.equal([...db.profiles.values()][0].description.length, description.length);
  const over = await create(env, websiteOnly({ description: "x".repeat(9000) }));
  assert.equal(over.status, 201);
  assert.equal([...db.profiles.values()][1].description.length, 5000, "descriptions are capped at 5,000 characters");
}

console.log("6. Authentication failures return 401 with a message and save nothing");
{
  const { db, env } = await makeEnv();
  const missing = await create(env, websiteOnly(), null);
  const bad = await create(env, websiteOnly(), "wrong-token");
  for (const response of [missing, bad]) {
    assert.equal(response.status, 401);
    assert.ok(((await response.json()) as any).error, "401 responses carry an error message");
  }
  assert.equal(db.profiles.size, 0);
}

console.log("7. API/database failures return a safe error and save nothing");
{
  const { db, env } = await makeEnv();
  db.failInserts = true;
  const original = console.error;
  console.error = () => {};
  const response = await create(env, websiteOnly());
  console.error = original;
  const data = await response.json() as any;
  assert.equal(response.status, 500);
  assert.equal(data.error, "Internal server error");
  assert.doesNotMatch(JSON.stringify(data), /D1 unavailable/, "internal details are not leaked");
  assert.equal(db.profiles.size, 0);
}

console.log("8. One save creates exactly one record; saving again edits it instead of duplicating");
{
  const { db, env } = await makeEnv();
  const created = await (await create(env, websiteOnly())).json() as any;
  assert.equal(db.profiles.size, 1);
  const again = spotlightProfileSaveRequest(created.profile.id, websiteOnly({ tagline: "An updated tagline here" }));
  assert.equal(again.init.method, "PATCH");
  const edited = await handleSpotlightAdmin(
    adminRequest("PATCH", JSON.parse(again.init.body as string)),
    "profile/" + created.profile.id,
    env,
  );
  assert.equal(edited.status, 200);
  assert.equal(db.profiles.size, 1);
  assert.equal([...db.profiles.values()][0].tagline, "An updated tagline here");
}

console.log("9. Saved profiles appear in the admin list");
{
  const { env } = await makeEnv();
  const created = await (await create(env, websiteOnly())).json() as any;
  const list = await handleSpotlightAdmin(adminRequest("GET", undefined), "", env);
  const data = await list.json() as any;
  assert.equal(list.status, 200);
  assert.deepEqual(data.profiles.map((p: any) => p.id), [created.profile.id]);
  assert.equal(data.profiles[0].status, "pending");
}

console.log("Edit path still accepts a blank email and rejects a bad one");
{
  const { env } = await makeEnv();
  const created = await (await create(env, websiteOnly({ contact_email: "a@example.com" }))).json() as any;
  const blank = await handleSpotlightAdmin(adminRequest("PATCH", { contact_email: "" }), "profile/" + created.profile.id, env);
  assert.equal(blank.status, 200);
  const bad = await handleSpotlightAdmin(adminRequest("PATCH", { contact_email: "nope" }), "profile/" + created.profile.id, env);
  assert.equal(bad.status, 422);
}

console.log("All Spotlight admin save-draft tests passed.");
