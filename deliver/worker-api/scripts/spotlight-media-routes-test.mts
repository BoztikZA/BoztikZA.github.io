/**
 * Spotlight media: route-level tests against a REAL SQLite database built from the repository's actual migrations.
 *
 * Proves the safety contract for featured media:
 *  - pending / declined / archived profiles never expose song or video through any public response;
 *  - moderators (admin endpoints) can still review pending media;
 *  - every public value is re-validated, so a tampered or legacy row cannot leak an unvalidated URL;
 *  - invalid links are rejected before anything is stored; a Spotify outage never blocks an application;
 *  - existing media survives unrelated edits and can be cleared deliberately.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleSpotlightAdmin, handleSpotlightPublic, publicDto } from "../src/routes/spotlight.ts";
import { sessionTokenHash } from "../src/lib/auth.ts";
import { HARD_CAP_BYTES } from "../src/lib/storage.ts";

const SALT = "spotlight-media-test-salt";
const TOKEN = "spotlight-media-test-token";
const YT = "dQw4w9WgXcQ";
const SP_ALBUM = "0VjIjW4GlUZAMYd2vXMi3b";
const SP_TRACK = "4cOdK2wGLETKBW3PvgPWqT";

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

// --- Spotify oEmbed stub ---------------------------------------------------------------------------------------
type Stub = "ok" | "outage" | "not_found";
let spotify: Stub = "ok";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (!url.startsWith("https://open.spotify.com/oembed")) throw new Error("unexpected network call: " + url);
  if (spotify === "outage") throw new TypeError("network down");
  if (spotify === "not_found") return new Response("", { status: 404 });
  return new Response(JSON.stringify({ provider_name: "Spotify", title: "Stub Title", thumbnail_url: "https://i.scdn.co/image/stub" }), { status: 200 });
}) as typeof fetch;

// --- helpers ---------------------------------------------------------------------------------------------------
const profileBody = (extra: Record<string, unknown> = {}) => ({
  display_name: "Media Test Creator", tagline: "Music and video creator", category: "music",
  description: "A creator profile used to test featured media handling end to end.", ...extra,
});
async function admin(path: string, method: string, body?: unknown): Promise<{ status: number; data: any }> {
  const response = await handleSpotlightAdmin(new Request(`https://worker.test/api/admin/spotlight/${path}`, {
    method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), path, env);
  return { status: response.status, data: await response.json() };
}
async function pub(path: string): Promise<{ status: number; data: any }> {
  const response = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight/" + path), path, env, {} as never);
  return { status: response.status, data: await response.json() };
}
async function submit(body: Record<string, unknown>): Promise<{ status: number; data: any; text: string }> {
  const response = await handleSpotlightPublic(new Request("https://worker.test/api/public/spotlight/submit", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.boztik.com" }, body: JSON.stringify(body),
  }), "/submit", env, {} as never);
  const text = await response.text();
  return { status: response.status, data: JSON.parse(text), text };
}
const publicList = async () => (await pub("")).data.profiles as any[];
const count = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM spotlight_profiles").get() as any).n);
const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error; console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
};

// ---------------------------------------------------------------------------------------------------------------
let pendingId = "", pendingSlug = "";

await test("admin create stores a Spotify album and a YouTube Short, visible to moderators only", async () => {
  const created = await admin("profile", "POST", profileBody({
    song_url: `https://open.spotify.com/album/${SP_ALBUM}?si=abc`, video_url: `https://www.youtube.com/shorts/${YT}`,
  }));
  assert.equal(created.status, 201);
  const p = created.data.profile;
  pendingId = p.id; pendingSlug = p.slug;
  assert.equal(p.status, "pending");
  assert.deepEqual(p.song, { type: "album", id: SP_ALBUM, url: `https://open.spotify.com/album/${SP_ALBUM}`, title: "Stub Title", artwork: "https://i.scdn.co/image/stub" });
  assert.deepEqual(p.video, { platform: "youtube", id: YT, kind: "video", url: `https://www.youtube.com/watch?v=${YT}`, format: "short" });
});

await test("a pending profile's media is not exposed by any public endpoint", async () => {
  const profile = await pub("profile/" + pendingSlug);
  assert.equal(profile.status, 404);
  assert.ok(!JSON.stringify(profile.data).includes(YT) && !JSON.stringify(profile.data).includes(SP_ALBUM));
  const listed = await publicList();
  assert.ok(!listed.some(p => p.id === pendingId));
  assert.ok(!JSON.stringify(listed).includes(YT) && !JSON.stringify(listed).includes(SP_ALBUM));
  const share = await handleSpotlightPublic(new Request("https://worker.test/x"), "share/" + pendingSlug, env, {} as never);
  assert.equal(share.status, 404);
});

await test("moderators can still review pending media through the admin list", async () => {
  const listed = await admin("", "GET");
  const p = listed.data.profiles.find((x: any) => x.id === pendingId);
  assert.equal(p.status, "pending");
  assert.equal(p.song.type, "album");
  assert.equal(p.video.id, YT);
});

await test("publishing exposes validated media publicly (and strips the moderator-only flag)", async () => {
  const published = await admin("profile/" + pendingId, "PATCH", { status: "published" });
  assert.equal(published.status, 200);
  const profile = (await pub("profile/" + pendingSlug)).data.profile;
  assert.equal(profile.song.type, "album");
  assert.equal(profile.song.title, "Stub Title");
  assert.equal("verified" in profile.song, false);
  assert.equal(profile.video.platform, "youtube");
  assert.equal(profile.video.format, "short");
  const fromList = (await publicList()).find(p => p.id === pendingId);
  assert.deepEqual(fromList.video, profile.video);
  assert.deepEqual(fromList.song, profile.song);
});

await test("the featured profile carries its media in the public response", async () => {
  const featured = await admin("profile/" + pendingId, "PATCH", { featured: true });
  assert.equal(featured.status, 200);
  const first = (await publicList())[0];
  assert.equal(first.id, pendingId);
  assert.equal(first.featured, true);
  assert.equal(first.video.id, YT);
  assert.equal(first.song.id, SP_ALBUM);
});

await test("tampered database rows cannot leak an unvalidated URL or artwork host", async () => {
  sqlite.prepare("UPDATE spotlight_profiles SET video_metadata=?, song_metadata=? WHERE id=?").run(
    JSON.stringify({ platform: "youtube", id: "aaaaaaaaaaa", kind: "video", url: "https://evil.example/phish" }),
    JSON.stringify({ type: "album", id: SP_ALBUM, url: "https://evil.example/song", title: "T", artwork: "https://evil.example/a.jpg" }),
    pendingId,
  );
  const profile = (await pub("profile/" + pendingSlug)).data.profile;
  assert.equal(profile.video, null);
  assert.equal(profile.song.url, `https://open.spotify.com/album/${SP_ALBUM}`);
  assert.equal(profile.song.artwork, null);
  assert.ok(!JSON.stringify(profile).includes("evil.example"));
  sqlite.prepare("UPDATE spotlight_profiles SET video_metadata='{not json', song_metadata='[]' WHERE id=?").run(pendingId);
  const broken = await pub("profile/" + pendingSlug);
  assert.equal(broken.status, 200, "corrupt JSON must not break the profile endpoint");
  assert.equal(broken.data.profile.video, null);
  assert.equal(broken.data.profile.song, null);
});

await test("legacy PR #55 rows (track-only, no type) still read as tracks", async () => {
  sqlite.prepare("UPDATE spotlight_profiles SET video_metadata=NULL, song_metadata=? WHERE id=?").run(
    JSON.stringify({ id: SP_TRACK, url: `https://open.spotify.com/track/${SP_TRACK}`, title: "Legacy", artwork: "https://i.scdn.co/image/legacy" }), pendingId);
  const song = (await pub("profile/" + pendingSlug)).data.profile.song;
  assert.deepEqual(song, { type: "track", id: SP_TRACK, url: `https://open.spotify.com/track/${SP_TRACK}`, title: "Legacy", artwork: "https://i.scdn.co/image/legacy" });
});

await test("unrelated edits keep existing media; an empty value clears it deliberately", async () => {
  const keep = await admin("profile/" + pendingId, "PATCH", { tagline: "Updated tagline for media test" });
  assert.equal(keep.data.profile.song.id, SP_TRACK);
  const addVideo = await admin("profile/" + pendingId, "PATCH", { video_url: "https://www.twitch.tv/BoztikZA" });
  assert.deepEqual(addVideo.data.profile.video, { platform: "twitch", id: "boztikza", kind: "channel", url: "https://www.twitch.tv/boztikza" });
  assert.equal(addVideo.data.profile.song.id, SP_TRACK);
  const clearSong = await admin("profile/" + pendingId, "PATCH", { song_url: "" });
  assert.equal(clearSong.data.profile.song, null);
  assert.equal(clearSong.data.profile.video.id, "boztikza");
  const clearVideo = await admin("profile/" + pendingId, "PATCH", { video_url: "" });
  assert.equal(clearVideo.data.profile.video, null);
});

await test("unpublishing hides media again immediately", async () => {
  await admin("profile/" + pendingId, "PATCH", { video_url: `https://youtu.be/${YT}`, song_url: `https://open.spotify.com/track/${SP_TRACK}` });
  assert.equal((await pub("profile/" + pendingSlug)).data.profile.video.id, YT);
  await admin("profile/" + pendingId, "PATCH", { status: "pending" });
  assert.equal((await pub("profile/" + pendingSlug)).status, 404);
  assert.ok(!JSON.stringify(await publicList()).includes(YT));
  await admin("profile/" + pendingId, "PATCH", { status: "archived" });
  assert.equal((await pub("profile/" + pendingSlug)).status, 404);
});

await test("invalid links are rejected with a clear 422 and nothing is stored", async () => {
  const before = count();
  const badSong = await admin("profile", "POST", profileBody({ song_url: `https://open.spotify.com/episode/${SP_TRACK}` }));
  assert.equal(badSong.status, 422); assert.equal(badSong.data.code, "invalid_spotify_link");
  const lookalike = await admin("profile", "POST", profileBody({ song_url: `https://open.spotify.com.evil.example/track/${SP_TRACK}` }));
  assert.equal(lookalike.status, 422); assert.equal(lookalike.data.code, "invalid_spotify_link");
  const badVideo = await admin("profile", "POST", profileBody({ video_url: "https://vimeo.com/12345" }));
  assert.equal(badVideo.status, 422); assert.equal(badVideo.data.code, "invalid_featured_video");
  const reserved = await admin("profile", "POST", profileBody({ video_url: "https://www.twitch.tv/directory" }));
  assert.equal(reserved.status, 422); assert.equal(reserved.data.code, "invalid_featured_video");
  assert.equal(count(), before);
});

await test("a Spotify 404 rejects the submission; nothing is stored", async () => {
  spotify = "not_found";
  const before = count();
  const rejected = await admin("profile", "POST", profileBody({ song_url: `https://open.spotify.com/track/${SP_TRACK}` }));
  assert.equal(rejected.status, 422); assert.equal(rejected.data.code, "spotify_unavailable");
  assert.equal(count(), before);
  spotify = "ok";
});

let outageSlug = "";
await test("a Spotify outage degrades to an unverified link: moderators see the flag, the public never does", async () => {
  spotify = "outage";
  const created = await admin("profile", "POST", profileBody({ display_name: "Outage Creator", song_url: `https://open.spotify.com/playlist/${SP_ALBUM}` }));
  spotify = "ok";
  assert.equal(created.status, 201);
  assert.equal(created.data.profile.song.verified, false);
  assert.equal(created.data.profile.song.title, "Spotify playlist");
  assert.equal(created.data.profile.song.artwork, null);
  outageSlug = created.data.profile.slug;
  await admin("profile/" + created.data.profile.id, "PATCH", { status: "published" });
  const song = (await pub("profile/" + outageSlug)).data.profile.song;
  assert.equal(song.type, "playlist");
  assert.equal("verified" in song, false);
});

await test("public submission stores media on a pending application and returns none of it", async () => {
  const before = count();
  const res = await quietly(() => submit({
    display_name: "Public Applicant", tagline: "A public applicant tagline", category: "twitch", contact_email: "applicant@example.com",
    description: "I stream games and want to be considered for the Spotlight showcase.", consent: true,
    song_url: `https://open.spotify.com/artist/${SP_ALBUM}`, video_url: "https://www.twitch.tv/publicapplicant",
  }));
  assert.equal(res.status, 201);
  assert.equal(count(), before + 1);
  assert.ok(!res.text.includes("publicapplicant") && !res.text.includes(SP_ALBUM), "submit response must not echo media");
  const row = sqlite.prepare("SELECT * FROM spotlight_profiles WHERE display_name='Public Applicant'").get() as any;
  assert.equal(row.status, "pending");
  assert.equal(row.application_status, "new");
  assert.equal(JSON.parse(row.song_metadata).type, "artist");
  assert.equal(JSON.parse(row.video_metadata).id, "publicapplicant");
  assert.equal((await pub("profile/" + row.slug)).status, 404);
  assert.ok(!JSON.stringify(await publicList()).includes("publicapplicant"));
});

await test("public submission with an invalid link is rejected before anything is stored", async () => {
  const before = count();
  for (const extra of [{ song_url: `https://open.spotify.com/show/${SP_ALBUM}` }, { video_url: "https://example.com/video" }, { video_url: "javascript:alert(1)" }]) {
    const res = await quietly(() => submit({
      display_name: "Bad Link Applicant", tagline: "A bad link applicant", category: "music", contact_email: "bad@example.com",
      description: "This application has an invalid media link and must be rejected.", consent: true, ...extra,
    }));
    assert.equal(res.status, 422, JSON.stringify(extra));
  }
  assert.equal(count(), before);
});

await test("public submission still succeeds when Spotify is down", async () => {
  spotify = "outage";
  const res = await quietly(() => submit({
    display_name: "Resilient Applicant", tagline: "Spotify was down today", category: "music", contact_email: "resilient@example.com",
    description: "Spotify could not be reached while this application was submitted.", consent: true,
    song_url: `https://open.spotify.com/track/${SP_TRACK}`,
  }));
  spotify = "ok";
  assert.equal(res.status, 201);
  const row = sqlite.prepare("SELECT song_metadata FROM spotlight_profiles WHERE display_name='Resilient Applicant'").get() as any;
  assert.equal(JSON.parse(row.song_metadata).verified, false);
});

await test("DTO layer: media is withheld for every non-published status even if a route forgets the SQL filter", () => {
  const row = (status: string) => ({
    id: "a".repeat(20), slug: "dto-test", display_name: "DTO", tagline: "t", description: "d", category: "music", status,
    song_metadata: JSON.stringify({ type: "track", id: SP_TRACK, title: "T", artwork: null, verified: false }),
    video_metadata: JSON.stringify({ platform: "youtube", id: YT, kind: "video", url: `https://www.youtube.com/watch?v=${YT}` }),
    social_links: "{}", featured_until: null, created_at: 1,
  });
  for (const status of ["pending", "archived", "declined", "expired", "anything-else"]) {
    const dto = publicDto(row(status));
    assert.equal(dto.song, null, status); assert.equal(dto.video, null, status);
    assert.ok(!JSON.stringify(dto).includes(YT) && !JSON.stringify(dto).includes(SP_TRACK), status);
    const moderator = publicDto(row(status), [], { moderator: true });
    assert.equal(moderator.video?.id, YT, status); assert.equal(moderator.song?.verified, false, status);
  }
  const published = publicDto(row("published"));
  assert.equal(published.video?.id, YT);
  assert.equal("verified" in (published.song || {}), false);
});

globalThis.fetch = realFetch;
console.log(`\nspotlight-media-routes: ${passed} tests passed`);
