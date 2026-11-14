/**
 * Spotlight media library tests (pure functions; no network, no database).
 * Covers: YouTube/Twitch link parsing, Spotify resource parsing, metadata fetching with graceful degradation,
 * and re-validation of stored (possibly legacy or tampered) rows.
 */
import assert from "node:assert/strict";
import { HttpError } from "../src/types.ts";
import {
  fetchSpotifyMetadata, normalizeSong, normalizeVideo, parseFeaturedVideo, parseSpotifyResource,
  type SpotifyResource,
} from "../src/lib/spotlight-media.ts";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); passed += 1; console.log("  ok  " + name); }
  catch (err) { console.error("FAIL  " + name); throw err; }
}

const YT = "dQw4w9WgXcQ";
const SP = "4cOdK2wGLETKBW3PvgPWqT"; // 22 chars base62
const SP2 = "0VjIjW4GlUZAMYd2vXMi3b";

// ---------------------------------------------------------------------------------------------------------------
await test("YouTube: accepted link shapes all canonicalise", () => {
  const want = { platform: "youtube", id: YT, kind: "video", url: "https://www.youtube.com/watch?v=" + YT };
  for (const link of [
    `https://www.youtube.com/watch?v=${YT}`,
    `https://youtube.com/watch?v=${YT}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?v=${YT}`,
    `https://youtu.be/${YT}`,
    `https://youtu.be/${YT}?si=tracking`,
    `https://www.youtube.com/live/${YT}`,
    `https://www.youtube.com/embed/${YT}`,
    `  https://www.youtube.com/watch?v=${YT}  `,
    `https://WWW.YOUTUBE.COM/watch?v=${YT}`,
  ]) assert.deepEqual(parseFeaturedVideo(link), want, link);
});

await test("YouTube: Shorts are flagged so the player can use a vertical frame", () => {
  assert.deepEqual(parseFeaturedVideo(`https://www.youtube.com/shorts/${YT}`), {
    platform: "youtube", id: YT, kind: "video", url: "https://www.youtube.com/watch?v=" + YT, format: "short",
  });
});

await test("YouTube: hostile or malformed links are rejected", () => {
  for (const link of [
    "", "   ", "not a url", `http://www.youtube.com/watch?v=${YT}`, `ftp://youtube.com/watch?v=${YT}`,
    `https://user:pass@www.youtube.com/watch?v=${YT}`, `https://www.youtube.com:8443/watch?v=${YT}`,
    `https://youtube.com.evil.example/watch?v=${YT}`, `https://evil.example/https://youtube.com/watch?v=${YT}`,
    `https://notyoutube.com/watch?v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`,
    "https://www.youtube.com/watch?v=short", "https://www.youtube.com/watch?v=" + "a".repeat(12),
    "https://www.youtube.com/watch?v=<script>x</script>", "https://www.youtube.com/watch",
    "https://www.youtube.com/playlist?list=PL123", "https://www.youtube.com/@channel",
    `https://www.youtube.com/shorts/${YT}/extra`, "javascript:alert(1)", `https://youtu.be/`,
    "https://www.youtube.com/watch?v=" + YT + "&x=" + "a".repeat(600),
  ]) assert.equal(parseFeaturedVideo(link), null, link);
  for (const nonString of [null, undefined, 42, {}, [], true]) assert.equal(parseFeaturedVideo(nonString), null);
});

await test("Twitch: channels, videos and clips", () => {
  assert.deepEqual(parseFeaturedVideo("https://www.twitch.tv/BoztikZA"), {
    platform: "twitch", id: "boztikza", kind: "channel", url: "https://www.twitch.tv/boztikza",
  });
  assert.deepEqual(parseFeaturedVideo("https://twitch.tv/some_channel/"), {
    platform: "twitch", id: "some_channel", kind: "channel", url: "https://www.twitch.tv/some_channel",
  });
  assert.deepEqual(parseFeaturedVideo("https://www.twitch.tv/videos/1234567890"), {
    platform: "twitch", id: "1234567890", kind: "video", url: "https://www.twitch.tv/videos/1234567890",
  });
  const clip = { platform: "twitch", id: "FunnyClip-AbC123", kind: "clip", url: "https://clips.twitch.tv/FunnyClip-AbC123" };
  assert.deepEqual(parseFeaturedVideo("https://clips.twitch.tv/FunnyClip-AbC123"), clip);
  assert.deepEqual(parseFeaturedVideo("https://www.twitch.tv/clip/FunnyClip-AbC123"), clip);
  assert.deepEqual(parseFeaturedVideo("https://www.twitch.tv/somechannel/clip/FunnyClip-AbC123"), clip);
});

await test("Twitch: site pages that look like channel names are rejected", () => {
  for (const reserved of ["directory", "videos", "settings", "downloads", "p", "turbo", "Directory", "SETTINGS"]) {
    assert.equal(parseFeaturedVideo("https://www.twitch.tv/" + reserved), null, reserved);
  }
});

await test("Twitch: malformed links are rejected", () => {
  for (const link of [
    "http://www.twitch.tv/boztik", "https://twitch.tv.evil.example/boztik", "https://www.twitch.tv/",
    "https://www.twitch.tv/ab", "https://www.twitch.tv/" + "a".repeat(26), "https://www.twitch.tv/bad-name",
    "https://www.twitch.tv/videos/abc", "https://www.twitch.tv/videos/12", "https://www.twitch.tv/videos/",
    "https://www.twitch.tv/a/b/c", "https://www.twitch.tv:444/boztik", "https://user@www.twitch.tv/boztik",
    "https://clips.twitch.tv/", "https://clips.twitch.tv/a b", "https://clips.twitch.tv/x",
    "https://www.twitch.tv/clip/", "https://www.twitch.tv/chan/clip/x",
  ]) assert.equal(parseFeaturedVideo(link), null, link);
});

// ---------------------------------------------------------------------------------------------------------------
await test("Spotify: every supported resource type parses to a canonical URL", () => {
  for (const type of ["track", "album", "artist", "playlist"] as const) {
    assert.deepEqual(parseSpotifyResource(`https://open.spotify.com/${type}/${SP}`), {
      type, id: SP, url: `https://open.spotify.com/${type}/${SP}`,
    }, type);
  }
});

await test("Spotify: tracking queries, locale prefixes, embed and legacy user-playlist forms", () => {
  const want = { type: "track", id: SP, url: `https://open.spotify.com/track/${SP}` };
  for (const link of [
    `https://open.spotify.com/track/${SP}?si=abc123&utm_source=copy-link`,
    `https://open.spotify.com/intl-de/track/${SP}`,
    `https://open.spotify.com/intl-pt-br/track/${SP}`,
    `https://open.spotify.com/embed/track/${SP}`,
    `https://open.spotify.com/intl-de/embed/track/${SP}`,
    `https://www.open.spotify.com/track/${SP}`,
    `https://OPEN.SPOTIFY.COM/track/${SP}`,
    `https://open.spotify.com/track/${SP}/`,
  ]) assert.deepEqual(parseSpotifyResource(link), want, link);
  assert.deepEqual(parseSpotifyResource(`https://open.spotify.com/user/someone/playlist/${SP2}`), {
    type: "playlist", id: SP2, url: `https://open.spotify.com/playlist/${SP2}`,
  });
});

await test("Spotify: lookalikes, short links and unsupported types are rejected", () => {
  for (const link of [
    "", "garbage", `http://open.spotify.com/track/${SP}`, `https://spotify.link/abc123`,
    `https://open.spotify.com.evil.example/track/${SP}`, `https://evil.example/open.spotify.com/track/${SP}`,
    `https://spotify.com/track/${SP}`, `https://play.spotify.com/track/${SP}`,
    `https://user:pw@open.spotify.com/track/${SP}`, `https://open.spotify.com:8080/track/${SP}`,
    `https://open.spotify.com/track/${SP.slice(0, 21)}`, `https://open.spotify.com/track/${SP}x`,
    `https://open.spotify.com/track/${"!".repeat(22)}`, `https://open.spotify.com/episode/${SP}`,
    `https://open.spotify.com/show/${SP}`, `https://open.spotify.com/user/someone`, `https://open.spotify.com/`,
    `https://open.spotify.com/track`, `https://open.spotify.com/track/${SP}/extra`,
    `https://open.spotify.com/intl-de/embed/track/${SP}/x`, "javascript:alert(1)",
    `https://open.spotify.com/track/${SP}?x=${"a".repeat(600)}`,
  ]) assert.equal(parseSpotifyResource(link), null, link);
  for (const nonString of [null, undefined, 7, {}, []]) assert.equal(parseSpotifyResource(nonString), null);
});

// ---------------------------------------------------------------------------------------------------------------
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const trackResource: SpotifyResource = { type: "track", id: SP, url: `https://open.spotify.com/track/${SP}` };
const albumResource: SpotifyResource = { type: "album", id: SP2, url: `https://open.spotify.com/album/${SP2}` };

await test("Spotify metadata: oEmbed success returns title and allow-listed artwork", async () => {
  let requested = "";
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return jsonResponse({ provider_name: "Spotify", title: "  Song Name  ", thumbnail_url: "https://image-cdn-ak.spotifycdn.com/image/abc" });
  }) as typeof fetch;
  const media = await fetchSpotifyMetadata(trackResource, fetchImpl);
  assert.equal(requested, "https://open.spotify.com/oembed?url=" + encodeURIComponent(trackResource.url));
  assert.deepEqual(media, { ...trackResource, title: "Song Name", artwork: "https://image-cdn-ak.spotifycdn.com/image/abc" });
  assert.equal("verified" in media, false);
});

await test("Spotify metadata: artwork from an unexpected host is dropped, title kept", async () => {
  for (const thumb of ["https://evil.example/a.jpg", "http://i.scdn.co/image/abc", "https://i.scdn.co.evil.example/x", "https://i.scdn.co:444/x", "javascript:alert(1)", 5, null]) {
    const media = await fetchSpotifyMetadata(albumResource, (async () => jsonResponse({ provider_name: "Spotify", title: "Album", thumbnail_url: thumb })) as typeof fetch);
    assert.equal(media.artwork, null, String(thumb));
    assert.equal(media.title, "Album");
  }
  const ok = await fetchSpotifyMetadata(albumResource, (async () => jsonResponse({ provider_name: "Spotify", title: "Album", thumbnail_url: "https://i.scdn.co/image/abc" })) as typeof fetch);
  assert.equal(ok.artwork, "https://i.scdn.co/image/abc");
});

await test("Spotify metadata: titles are trimmed and capped at 200 characters", async () => {
  const media = await fetchSpotifyMetadata(trackResource, (async () => jsonResponse({ provider_name: "Spotify", title: "x".repeat(500) })) as typeof fetch);
  assert.equal(media.title.length, 200);
});

await test("Spotify metadata: 404 / 400 / 403 reject with a clear 422", async () => {
  for (const status of [400, 401, 403, 404]) {
    await assert.rejects(
      () => fetchSpotifyMetadata(trackResource, (async () => new Response("nope", { status })) as typeof fetch),
      (err: unknown) => err instanceof HttpError && err.status === 422 && err.code === "spotify_unavailable",
      String(status),
    );
  }
});

await test("Spotify metadata: a non-Spotify or untitled answer rejects with spotify_invalid_link", async () => {
  for (const body of [{ provider_name: "Other", title: "x" }, { provider_name: "Spotify" }, { provider_name: "Spotify", title: "   " }, { provider_name: "Spotify", title: 5 }]) {
    await assert.rejects(
      () => fetchSpotifyMetadata(trackResource, (async () => jsonResponse(body)) as typeof fetch),
      (err: unknown) => err instanceof HttpError && err.status === 422 && err.code === "spotify_invalid_link",
      JSON.stringify(body),
    );
  }
});

await test("Spotify metadata: outages degrade to an unverified link instead of blocking the application", async () => {
  const expected = { ...trackResource, title: "Spotify track", artwork: null, verified: false };
  assert.deepEqual(await fetchSpotifyMetadata(trackResource, (async () => { throw new TypeError("network down"); }) as typeof fetch), expected);
  assert.deepEqual(await fetchSpotifyMetadata(trackResource, (async () => { throw new DOMException("timeout", "TimeoutError"); }) as typeof fetch), expected);
  for (const status of [429, 500, 502, 503]) {
    assert.deepEqual(await fetchSpotifyMetadata(trackResource, (async () => new Response("", { status })) as typeof fetch), expected, String(status));
  }
  assert.deepEqual(await fetchSpotifyMetadata(trackResource, (async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch), expected);
  assert.equal((await fetchSpotifyMetadata(albumResource, (async () => { throw new Error("x"); }) as typeof fetch)).title, "Spotify album");
});

// ---------------------------------------------------------------------------------------------------------------
await test("normalizeSong: legacy track-only rows (no type) still read as tracks", () => {
  const legacy = JSON.stringify({ id: SP, url: `https://open.spotify.com/track/${SP}`, title: "Old Song", artwork: "https://i.scdn.co/image/abc" });
  assert.deepEqual(normalizeSong(legacy), { type: "track", id: SP, url: `https://open.spotify.com/track/${SP}`, title: "Old Song", artwork: "https://i.scdn.co/image/abc" });
});

await test("normalizeSong: rebuilds the URL from type + id and never trusts the stored URL", () => {
  const tampered = JSON.stringify({ type: "album", id: SP2, url: "https://evil.example/phish", title: "Album" });
  const media = normalizeSong(tampered);
  assert.equal(media?.url, `https://open.spotify.com/album/${SP2}`);
});

await test("normalizeSong: drops unsafe artwork, fills a default title, keeps the unverified flag", () => {
  const media = normalizeSong({ type: "playlist", id: SP, title: "", artwork: "https://evil.example/a.jpg", verified: false });
  assert.deepEqual(media, { type: "playlist", id: SP, url: `https://open.spotify.com/playlist/${SP}`, title: "Spotify playlist", artwork: null, verified: false });
});

await test("normalizeSong: junk, wrong types and missing ids return null instead of throwing", () => {
  for (const junk of [null, undefined, "", "   ", "{not json", "[]", "null", "5", [], 5, true,
    JSON.stringify({ type: "episode", id: SP }), JSON.stringify({ type: "track", id: "short" }),
    JSON.stringify({ type: "track" }), JSON.stringify({ id: 5 }), JSON.stringify({ type: {}, id: SP }),
  ]) assert.equal(normalizeSong(junk as unknown), null, JSON.stringify(junk));
});

await test("normalizeVideo: round-trips parsed values, including the Shorts flag", () => {
  const yt = parseFeaturedVideo(`https://youtu.be/${YT}`)!;
  assert.deepEqual(normalizeVideo(JSON.stringify(yt)), yt);
  const short = parseFeaturedVideo(`https://www.youtube.com/shorts/${YT}`)!;
  assert.deepEqual(normalizeVideo(JSON.stringify(short)), short);
  const tw = parseFeaturedVideo("https://www.twitch.tv/boztikza")!;
  assert.deepEqual(normalizeVideo(tw), tw);
});

await test("normalizeVideo: rejects tampered rows (mismatched id/platform, bad URL, junk)", () => {
  const base = { platform: "youtube", id: YT, kind: "video", url: `https://www.youtube.com/watch?v=${YT}` };
  assert.deepEqual(normalizeVideo(base), base);
  for (const bad of [
    { ...base, id: "aaaaaaaaaaa" },
    { ...base, platform: "twitch" },
    { ...base, url: "https://evil.example/watch?v=" + YT },
    { ...base, url: `http://www.youtube.com/watch?v=${YT}` },
    { ...base, url: 5 },
    { platform: "twitch", id: "directory", kind: "channel", url: "https://www.twitch.tv/directory" },
    null, undefined, "", "{bad", "[]", 7,
  ]) assert.equal(normalizeVideo(bad as unknown), null, JSON.stringify(bad));
});

await test("normalizeVideo: the Shorts flag is only honoured on YouTube", () => {
  const tw = { platform: "twitch", id: "boztikza", kind: "channel", url: "https://www.twitch.tv/boztikza", format: "short" };
  assert.equal(normalizeVideo(tw)?.format, undefined);
});

console.log(`\nspotlight-media: ${passed} tests passed`);
