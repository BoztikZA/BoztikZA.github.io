/**
 * Client-side Spotlight media module (spotlight/media.js): pure functions, no DOM.
 * Verifies the product rules: playable media only in the featured showcase, nothing loaded before a click,
 * URLs rebuilt from validated ids, Twitch parent from the runtime hostname, hostile input rejected.
 */
import assert from "node:assert/strict";
import {
  describeSong, describeVideo, embedUrl, featuredPlayersMarkup, mediaChipsMarkup, mediaLinkCardMarkup, profileMedia,
  spotifyEmbedHeight, thumbMarkup,
} from "../../../spotlight/media.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed += 1; console.log("  ok  " + name); } catch (err) { console.error("FAIL  " + name); throw err; }
}

const YT = "dQw4w9WgXcQ";
const SP = "4cOdK2wGLETKBW3PvgPWqT";
const yt = { platform: "youtube", id: YT, kind: "video", url: "https://evil.example/ignored" };
const ytShort = { ...yt, format: "short" };
const twChannel = { platform: "twitch", id: "boztikza", kind: "channel" };
const twVideo = { platform: "twitch", id: "1234567890", kind: "video" };
const twClip = { platform: "twitch", id: "FunnyClip-AbC123", kind: "clip" };
const album = { type: "album", id: SP, title: "My <b>Album</b>", artwork: "https://i.scdn.co/image/abc", url: "https://evil.example/x" };
const PROVIDER_PLAYERS = /youtube-nocookie\.com|player\.twitch\.tv|clips\.twitch\.tv\/embed|open\.spotify\.com\/embed/;

test("describeVideo rebuilds canonical links from ids and ignores any supplied url", () => {
  assert.equal(describeVideo(yt)?.href, `https://www.youtube.com/watch?v=${YT}`);
  assert.equal(describeVideo(twChannel)?.href, "https://www.twitch.tv/boztikza");
  assert.equal(describeVideo(twVideo)?.href, "https://www.twitch.tv/videos/1234567890");
  assert.equal(describeVideo(twClip)?.href, "https://clips.twitch.tv/FunnyClip-AbC123");
  assert.equal(describeVideo(yt)?.thumb, `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`);
  assert.equal(describeVideo(twChannel)?.thumb, null);
  assert.equal(describeVideo(ytShort)?.short, true);
  assert.equal(describeVideo(ytShort)?.label, "YouTube Short");
});

test("describeVideo rejects malformed, mismatched and hostile values", () => {
  for (const bad of [
    null, undefined, "x", 5, {}, { platform: "youtube", id: "short", kind: "video" },
    { platform: "youtube", id: YT, kind: "channel" }, { platform: "vimeo", id: YT, kind: "video" },
    { platform: "twitch", id: "AB", kind: "channel" }, { platform: "twitch", id: "Upper", kind: "channel" },
    { platform: "twitch", id: "12", kind: "video" }, { platform: "twitch", id: "a b", kind: "clip" },
    { platform: "youtube", id: YT + '"><script>', kind: "video" }, { platform: "youtube", id: 12345678901, kind: "video" },
  ]) assert.equal(describeVideo(bad), null, JSON.stringify(bad));
});

test("describeSong handles every Spotify type, legacy rows and artwork hosts", () => {
  for (const type of ["track", "album", "artist", "playlist"]) {
    const media = describeSong({ type, id: SP, title: "T" });
    assert.equal(media?.href, `https://open.spotify.com/${type}/${SP}`);
    assert.equal(media?.label, "Spotify " + type);
  }
  assert.equal(describeSong({ id: SP, title: "Legacy" })?.type, "track");
  assert.equal(describeSong(album)?.href, `https://open.spotify.com/album/${SP}`, "supplied url ignored");
  assert.equal(describeSong(album)?.thumb, "https://i.scdn.co/image/abc");
  for (const art of ["https://evil.example/a.jpg", "http://i.scdn.co/a", "https://i.scdn.co.evil.example/a", "https://i.scdn.co:99/a", "javascript:alert(1)", 5, null]) {
    assert.equal(describeSong({ ...album, artwork: art })?.thumb, null, String(art));
  }
  for (const bad of [null, {}, { id: "short" }, { type: "episode", id: SP }, { type: "track", id: SP + "x" }, { type: {}, id: SP }]) {
    assert.equal(describeSong(bad), null, JSON.stringify(bad));
  }
  assert.equal(describeSong({ type: "track", id: SP })?.title, "Listen on Spotify");
});

test("embed URLs: YouTube privacy mode, Spotify embed type, Twitch parent from the runtime hostname", () => {
  assert.equal(embedUrl(describeVideo(yt), "www.boztik.com"), `https://www.youtube-nocookie.com/embed/${YT}?rel=0&playsinline=1&autoplay=1`);
  assert.equal(embedUrl(describeSong(album), ""), `https://open.spotify.com/embed/album/${SP}?utm_source=generator&theme=0`);
  assert.equal(embedUrl(describeVideo(twChannel), "www.boztik.com"), "https://player.twitch.tv/?channel=boztikza&parent=www.boztik.com&autoplay=true");
  assert.equal(embedUrl(describeVideo(twChannel), "preview-123.boztikza-github-io.pages.dev"), "https://player.twitch.tv/?channel=boztikza&parent=preview-123.boztikza-github-io.pages.dev&autoplay=true");
  assert.equal(embedUrl(describeVideo(twVideo), "localhost"), "https://player.twitch.tv/?video=v1234567890&parent=localhost&autoplay=true");
  assert.equal(embedUrl(describeVideo(twClip), "www.boztik.com"), "https://clips.twitch.tv/embed?clip=FunnyClip-AbC123&parent=www.boztik.com&autoplay=true");
});

test("Twitch cannot embed without a valid hostname; unsafe hostnames never reach the URL", () => {
  const channel = describeVideo(twChannel);
  for (const host of ["", "bad host", "a.com&parent=evil.com", "evil.com/", "-bad.com", "x".repeat(300), "a.com\n", "<x>"]) {
    assert.equal(embedUrl(channel, host), null, JSON.stringify(host));
  }
  assert.equal(embedUrl(null, "www.boztik.com"), null);
  // YouTube and Spotify do not depend on the hostname.
  assert.ok(embedUrl(describeVideo(yt), ""));
});

test("Spotify compact player only for tracks", () => {
  assert.equal(spotifyEmbedHeight(describeSong({ type: "track", id: SP })), 152);
  for (const type of ["album", "artist", "playlist"]) assert.equal(spotifyEmbedHeight(describeSong({ type, id: SP })), 352, type);
});

const profile = { display_name: 'Ana "Q" <Creator>', video: yt, song: album };

test("directory chips: artwork + label + outbound link, and NEVER a player", () => {
  const html = mediaChipsMarkup(profile);
  assert.ok(!/<iframe/i.test(html) && !PROVIDER_PLAYERS.test(html), "no embed in directory cards");
  assert.ok(html.includes(`href="https://www.youtube.com/watch?v=${YT}"`));
  assert.ok(html.includes(`href="https://open.spotify.com/album/${SP}"`));
  assert.ok(html.includes("YouTube video") && html.includes("Spotify album"));
  assert.ok(html.includes(`https://i.ytimg.com/vi/${YT}/hqdefault.jpg`) && html.includes("https://i.scdn.co/image/abc"));
  assert.ok(html.includes('rel="noopener noreferrer"') && html.includes('target="_blank"'));
  assert.ok(html.includes('referrerpolicy="no-referrer"'), "thumbnails do not leak the page URL");
  assert.equal(mediaChipsMarkup({ display_name: "None" }), "");
});

test("profile link cards: label + outbound link, and NEVER a player", () => {
  for (const media of profileMedia(profile).concat(describeVideo(twChannel)!)) {
    const html = mediaLinkCardMarkup(media);
    assert.ok(!/<iframe/i.test(html) && !PROVIDER_PLAYERS.test(html), media.label);
    assert.ok(html.includes(`href="${media.href}"`) && html.includes(`on ${media.provider}`), media.label);
  }
  assert.equal(mediaLinkCardMarkup(null), "");
  // Twitch has no public thumbnail: it gets branded placeholder art, not a broken image.
  assert.ok(thumbMarkup(describeVideo(twChannel)!).includes("sp-media-thumb-placeholder"));
});

test("featured showcase: click-to-load facades only. Nothing from a provider player origin before a click", () => {
  const html = featuredPlayersMarkup(profile, { hostname: "www.boztik.com" });
  assert.ok(!/<iframe/i.test(html), "no iframe until the visitor presses play");
  assert.ok((html.match(/data-media-play/g) || []).length === 2, "one play button per media item");
  assert.ok(!/<(img|script|link|video|audio|source)[^>]+src="https:\/\/(www\.youtube-nocookie|player\.twitch|clips\.twitch\.tv\/embed|open\.spotify\.com\/embed)/.test(html));
  assert.ok(html.includes(`data-embed-src="https://www.youtube-nocookie.com/embed/${YT}`), "URL staged in data attribute only");
  assert.ok(!/autoplay/i.test(html.replace(/data-embed-src="[^"]*"/g, "")), "no autoplay attribute on markup");
  assert.ok(html.includes("Open on YouTube") && html.includes("Open on Spotify"), "outbound fallback always present");
  assert.ok(html.includes('<button type="button" class="sp-media-play"'), "keyboard-operable <button>");
  assert.ok(html.includes('role="status"'), "load hints are announced");
});

test("featured showcase: Shorts get a vertical frame, Spotify gets the right height, Twitch carries the parent", () => {
  const short = featuredPlayersMarkup({ video: ytShort }, { hostname: "www.boztik.com" });
  assert.ok(short.includes('data-short="1"'));
  assert.ok(featuredPlayersMarkup({ song: { type: "track", id: SP } }).includes("--sp-embed-h:152px"));
  assert.ok(featuredPlayersMarkup({ song: album }).includes("--sp-embed-h:352px"));
  assert.ok(featuredPlayersMarkup({ video: twChannel }, { hostname: "www.boztik.com" }).includes("parent=www.boztik.com"));
});

test("featured showcase: Twitch without a valid hostname degrades to an outbound card, never a broken player", () => {
  const html = featuredPlayersMarkup({ video: twChannel }, { hostname: "" });
  assert.ok(!html.includes("data-media-play") && !PROVIDER_PLAYERS.test(html));
  assert.ok(html.includes('href="https://www.twitch.tv/boztikza"'));
});

test("featured showcase: profiles with no (or invalid) media render nothing", () => {
  assert.equal(featuredPlayersMarkup({}), "");
  assert.equal(featuredPlayersMarkup({ video: { platform: "youtube", id: "bad", kind: "video" }, song: null }), "");
});

test("all profile text is escaped in every markup path", () => {
  const evil = { display_name: '"><img src=x onerror=alert(1)>', video: yt, song: { ...album, title: '"><script>alert(1)</script>' } };
  assert.ok(mediaChipsMarkup(evil).includes("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"), "payload is present but escaped");
  for (const html of [mediaChipsMarkup(evil), featuredPlayersMarkup(evil, { hostname: "www.boztik.com" }), mediaLinkCardMarkup(describeSong(evil.song))]) {
    assert.ok(!/<script>alert|<img src=x onerror/i.test(html), "payload must not appear unescaped");
    assert.ok(!/"><img src=x|"><script>/.test(html), "payload must not break out of an attribute");
  }
});

console.log(`\nspotlight-media-client: ${passed} tests passed`);
