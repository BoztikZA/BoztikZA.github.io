import assert from "node:assert/strict";
// @ts-ignore browser ES module, no types
import { adminHeaders, classifySource, clickTarget, newPlayId, parseYouTubeState, trackFeaturedPlayer } from "../../../spotlight/analytics.js";

let passed = 0;
const test = (name: string, fn: () => void) => { try { fn(); passed += 1; console.log("  ok  " + name); } catch (e) { console.error("FAIL  " + name); throw e; } };

test("source buckets: coarse only, never a raw referrer", () => {
  const own = "www.boztik.com";
  assert.equal(classifySource("", own), "direct");
  assert.equal(classifySource("not a url", own), "direct");
  assert.equal(classifySource("https://www.google.com/search?q=x", own), "search");
  assert.equal(classifySource("https://duckduckgo.com/", own), "search");
  assert.equal(classifySource("https://www.instagram.com/", own), "social");
  assert.equal(classifySource("https://t.co/abc", own), "social");
  assert.equal(classifySource("https://www.boztik.com/spotlight/", own), "directory");
  assert.equal(classifySource("https://www.boztik.com/spotlight/index.html", own), "directory");
  assert.equal(classifySource("https://www.boztik.com/pricing.html", own), "other");
  assert.equal(classifySource("https://some-blog.example/post", own), "other");
  assert.equal(classifySource("https://evil.example/?google.com", own), "other", "search host must be the hostname, not text in the URL");
  assert.equal(classifySource("https://google.com.evil.example/", own), "other");
  assert.equal(classifySource("https://www.google.com/", own, "featured"), "featured", "explicit hint wins");
  assert.equal(classifySource("", own, "bogus"), "direct", "unknown hints are ignored");
});

test("click target comes from the markup that rendered the link", () => {
  const el = (cls: string) => ({ closest: (sel: string) => sel === cls ? {} : null });
  assert.equal(clickTarget(el(".sp-rail-site")), "website");
  assert.equal(clickTarget(el(".sp-rail-social")), "social");
  assert.equal(clickTarget(el(".sp-media-link-card")), "media");
  assert.equal(clickTarget(el(".nothing")), "other");
  assert.equal(clickTarget(null), "other");
});

test("only a live administrator session adds an Authorization header", () => {
  const store = (value: unknown) => ({ getItem: () => value === undefined ? null : JSON.stringify(value) });
  assert.deepEqual(adminHeaders(store({ token: "t", expires_at: new Date(Date.now() + 60000).toISOString() })), { Authorization: "Bearer t" });
  assert.deepEqual(adminHeaders(store({ token: "t", expires_at: new Date(Date.now() - 60000).toISOString() })), {});
  assert.deepEqual(adminHeaders(store(undefined)), {});
  assert.deepEqual(adminHeaders({ getItem: () => "{broken" }), {});
  assert.deepEqual(adminHeaders({ getItem: () => { throw new Error("blocked"); } }), {});
});

test("YouTube player state parsing accepts only genuine state reports", () => {
  assert.equal(parseYouTubeState(JSON.stringify({ event: "onStateChange", info: 0 })), 0);
  assert.equal(parseYouTubeState({ event: "infoDelivery", info: { playerState: 1 } }), 1);
  assert.equal(parseYouTubeState(JSON.stringify({ event: "infoDelivery", info: { currentTime: 4 } })), null);
  assert.equal(parseYouTubeState("garbage"), null);
  assert.equal(parseYouTubeState(null), null);
  assert.equal(parseYouTubeState({ event: "onStateChange", info: "0" }), null);
});

function fakeRoot(profileId: string, platform: string) {
  const listeners: Record<string, Function> = {};
  const frameListeners: Record<string, Function> = {};
  const frame = { contentWindow: { postMessage: () => {} }, addEventListener: (n: string, f: Function) => { frameListeners[n] = f; } };
  const root: any = {
    dataset: {},
    querySelector: (s: string) => s === "[data-profile-id]" ? { dataset: { profileId } } : null,
    addEventListener: (n: string, f: Function) => { listeners[n] = f; },
  };
  const play = () => listeners["spotlight:media-play"]({ detail: { platform }, target: { querySelector: () => frame } });
  return { root, play, frame };
}
function fakeWin() {
  const handlers = new Set<Function>();
  return { addEventListener: (_: string, f: Function) => handlers.add(f), removeEventListener: (_: string, f: Function) => handlers.delete(f), emit: (m: unknown) => [...handlers].forEach(h => h(m)), handlers };
}

test("a play press sends exactly one player event with a fresh play id; completion reuses that id", () => {
  const sent: any[] = [];
  const { root, play, frame } = fakeRoot("a".repeat(20), "youtube");
  const win = fakeWin();
  trackFeaturedPlayer(root, { send: (p: string, body: any) => sent.push([p, body]), win });
  play();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].type, "player");
  assert.equal(sent[0][1].profile_id, "a".repeat(20));
  assert.match(sent[0][1].play_id, /^p[a-f0-9]{32}$/);
  // Messages from another window or origin are ignored.
  win.emit({ source: {}, origin: "https://www.youtube-nocookie.com", data: JSON.stringify({ event: "onStateChange", info: 0 }) });
  win.emit({ source: frame.contentWindow, origin: "https://evil.example", data: JSON.stringify({ event: "onStateChange", info: 0 }) });
  win.emit({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data: JSON.stringify({ event: "onStateChange", info: 1 }) });
  assert.equal(sent.length, 1);
  win.emit({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data: JSON.stringify({ event: "onStateChange", info: 0 }) });
  win.emit({ source: frame.contentWindow, origin: "https://www.youtube-nocookie.com", data: JSON.stringify({ event: "onStateChange", info: 0 }) });
  assert.equal(sent.length, 2, "completion is sent once");
  assert.equal(sent[1][1].type, "complete");
  assert.equal(sent[1][1].play_id, sent[0][1].play_id);
  assert.equal(win.handlers.size, 0, "listener removed after completion");
});

test("non-YouTube players report the press only (completion is not exposed by Twitch/Spotify embeds)", () => {
  const sent: any[] = [];
  const { root, play } = fakeRoot("b".repeat(20), "twitch");
  const win = fakeWin();
  trackFeaturedPlayer(root, { send: (p: string, body: any) => sent.push(body), win });
  play();
  assert.equal(sent.length, 1);
  assert.equal(win.handlers.size, 0);
});

test("mounting twice does not double-count; play ids are unique", () => {
  const sent: any[] = [];
  const { root, play } = fakeRoot("c".repeat(20), "spotify");
  trackFeaturedPlayer(root, { send: (_: string, b: any) => sent.push(b), win: fakeWin() });
  trackFeaturedPlayer(root, { send: (_: string, b: any) => sent.push(b), win: fakeWin() });
  play();
  assert.equal(sent.length, 1);
  assert.notEqual(newPlayId(), newPlayId());
});

console.log(`\nspotlight-analytics-client: ${passed} tests passed`);
