/**
 * Real-browser check of Spotlight media (Chromium via Playwright). NOT part of `npm test`/CI: it needs a browser.
 * Run:  node scripts/spotlight-media-browser-test.cjs   (from deliver/worker-api; Playwright must be resolvable)
 *
 * Loads the real /spotlight/ and /spotlight/profile.html pages from this repository against a MOCKED API and
 * stubbed provider hosts (no real network), and verifies:
 *  - before any click: zero requests to YouTube/Twitch/Spotify player origins and zero iframes;
 *  - directory cards and the profile page never contain an iframe;
 *  - clicking play mounts exactly one iframe with the official embed URL, title, allow, referrerpolicy;
 *  - Twitch gets parent=<page hostname>; keyboard activation works and focus lands on the iframe;
 *  - an iframe that never loads shows the "taking a while" hint while the outbound link stays available.
 * It cannot prove the real providers' players accept these attributes: that needs a live-network check.
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const YT = "dQw4w9WgXcQ", SP = "4cOdK2wGLETKBW3PvgPWqT";
const PROVIDER = /youtube-nocookie\.com|player\.twitch\.tv|clips\.twitch\.tv|open\.spotify\.com|i\.ytimg\.com|i\.scdn\.co/;
const IMG_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const profile = (over) => ({
  id: "a".repeat(20), slug: "featured-one", display_name: "Featured One", tagline: "Makes things", description: "A featured creator for the browser test.",
  category: "music", website_url: null, social_links: {}, song: null, video: null, image_url: null, images: [],
  featured: true, featured_until: Math.floor(Date.now() / 1000) + 3600, created_at: 1, ...over,
});
const video = { platform: "youtube", id: YT, kind: "video", url: `https://www.youtube.com/watch?v=${YT}` };
const song = { type: "album", id: SP, title: "Test Album", artwork: "https://i.scdn.co/image/abc", url: `https://open.spotify.com/album/${SP}` };

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x"); let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404).end("nf"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let passed = 0;
async function check(name, fn) { try { await fn(); passed += 1; console.log("  ok  " + name); } catch (e) { console.error("FAIL  " + name); throw e; } }

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  async function openPage(pathname, profiles, { hangEmbeds = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await context.newPage();
    const providerRequests = [];
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.startsWith("https://deliver-api.boztik.com/api/public/spotlight/profile/")) return route.fulfill({ json: { profile: profiles[0] } });
      if (url.startsWith("https://deliver-api.boztik.com/api/public/spotlight")) {
        if (/impression|view|click|event/.test(url)) return route.fulfill({ status: 204, body: "" });
        return route.fulfill({ json: { profiles, next_cursor: null } });
      }
      if (PROVIDER.test(url)) {
        providerRequests.push(url);
        if (/i\.ytimg|i\.scdn/.test(url)) return route.fulfill({ contentType: "image/png", body: IMG_PNG });
        if (hangEmbeds) return; // never answers: simulates a blocked/slow provider
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub player</title>" });
      }
      return route.abort(); // fonts, analytics, anything else
    });
    await page.goto(base + pathname, { waitUntil: "domcontentloaded" });
    return { page, context, providerRequests };
  }

  await check("featured showcase: before any click there are no iframes and no player-origin requests", async () => {
    const { page, context, providerRequests } = await openPage("/spotlight/", [profile({ video, song })]);
    await page.waitForSelector(".sp-media-player");
    await page.waitForTimeout(400);
    assert.equal(await page.locator("iframe").count(), 0);
    const players = providerRequests.filter(u => /youtube-nocookie|player\.twitch|clips\.twitch|open\.spotify/.test(u));
    assert.deepEqual(players, [], "player origins must not be contacted before a click: " + players.join(", "));
    assert.equal(await page.locator(".sp-media-play").count(), 2);
    assert.ok(await page.locator(".sp-media-fallback a[href^='https://www.youtube.com/watch']").count());
    await context.close();
  });

  await check("clicking play mounts one YouTube iframe with the official privacy-enhanced embed and safe attributes", async () => {
    const { page, context } = await openPage("/spotlight/", [profile({ video })]);
    await page.click(".sp-media-player[data-media-platform='youtube'] .sp-media-play");
    const frame = page.locator("iframe.sp-media-frame");
    await frame.waitFor();
    assert.equal(await page.locator("iframe").count(), 1);
    assert.equal(await frame.getAttribute("src"), `https://www.youtube-nocookie.com/embed/${YT}?rel=0&playsinline=1&autoplay=1`);
    assert.equal(await frame.getAttribute("referrerpolicy"), "strict-origin-when-cross-origin");
    assert.ok((await frame.getAttribute("title")).length > 3);
    assert.ok((await frame.getAttribute("allow")).includes("fullscreen"));
    assert.equal(await page.locator(".sp-media-play").count(), 0, "facade is replaced");
    await page.waitForFunction(() => document.querySelector(".sp-media-player")?.dataset.state === "playing");
    await context.close();
  });

  await check("Twitch embed carries parent=<the page's own hostname>", async () => {
    const { page, context } = await openPage("/spotlight/", [profile({ video: { platform: "twitch", id: "boztikza", kind: "channel" } })]);
    await page.click(".sp-media-play");
    const src = await page.locator("iframe.sp-media-frame").getAttribute("src");
    assert.equal(src, "https://player.twitch.tv/?channel=boztikza&parent=127.0.0.1&autoplay=true");
    await context.close();
  });

  await check("Spotify facade loads the matching embed type and height on click", async () => {
    const { page, context } = await openPage("/spotlight/", [profile({ song })]);
    const height = () => page.locator(".sp-media-stage").evaluate(el => el.getBoundingClientRect().height);
    assert.ok(Math.abs(await height() - 152) < 2, "idle facade is a compact card");
    await page.click(".sp-media-play");
    await page.locator("iframe.sp-media-frame").waitFor();
    assert.ok(Math.abs(await height() - 352) < 2, "after click the stage grows to the album player height");
    assert.equal(await page.locator("iframe.sp-media-frame").getAttribute("src"), `https://open.spotify.com/embed/album/${SP}?utm_source=generator&theme=0`);
    await context.close();
  });

  await check("keyboard: Tab to the play button, Enter mounts the player and focus moves into the iframe", async () => {
    const { page, context } = await openPage("/spotlight/", [profile({ video })]);
    await page.waitForSelector(".sp-media-play");
    await page.locator(".sp-media-play").focus();
    await page.keyboard.press("Enter");
    await page.locator("iframe.sp-media-frame").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "IFRAME");
    await context.close();
  });

  await check("a provider that never answers shows a hint and keeps the outbound link available", async () => {
    const { page, context } = await openPage("/spotlight/", [profile({ video })], { hangEmbeds: true });
    await page.click(".sp-media-play");
    await page.waitForFunction(() => document.querySelector(".sp-media-player")?.dataset.state === "slow", null, { timeout: 12000 });
    assert.match(await page.locator(".sp-media-status").innerText(), /taking a while/i);
    assert.ok(await page.locator(".sp-media-fallback a").isVisible());
    await context.close();
  });

  await check("directory cards show artwork + label + outbound link and never an iframe", async () => {
    const other = profile({ featured: false, featured_until: null, id: "b".repeat(20), slug: "plain", display_name: "Plain Card", video, song });
    const { page, context } = await openPage("/spotlight/", [other]);
    await page.waitForSelector(".sp-card");
    assert.equal(await page.locator("iframe").count(), 0);
    assert.equal(await page.locator(".sp-media-player").count(), 0);
    const links = await page.locator(".sp-card-media-link").evaluateAll(els => els.map(e => [e.getAttribute("href"), e.textContent.trim()]));
    assert.deepEqual(links.map(l => l[0]), [`https://www.youtube.com/watch?v=${YT}`, `https://open.spotify.com/album/${SP}`]);
    assert.ok(links[0][1].includes("YouTube video") && links[1][1].includes("Spotify album"));
    assert.ok(await page.locator(".sp-card-media-link img").count() >= 2, "artwork thumbnails render");
    await context.close();
  });

  await check("profile page shows media link cards and never an iframe", async () => {
    const { page, context } = await openPage("/spotlight/profile.html?slug=featured-one", [profile({ video, song })]);
    await page.waitForSelector(".sp-media-link-card");
    assert.equal(await page.locator(".sp-media-link-card").count(), 2);
    assert.equal(await page.locator("iframe").count(), 0);
    const hrefs = await page.locator(".sp-media-link-card a").evaluateAll(els => els.map(e => e.getAttribute("href")));
    assert.deepEqual(hrefs, [`https://open.spotify.com/album/${SP}`, `https://www.youtube.com/watch?v=${YT}`].sort((a, b) => hrefs.indexOf(a) - hrefs.indexOf(b)));
    await context.close();
  });

  await check("narrow phone width: showcase has no horizontal overflow", async () => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.startsWith("https://deliver-api.boztik.com/api/public/spotlight") && !/impression/.test(url)) return route.fulfill({ json: { profiles: [profile({ video, song })], next_cursor: null } });
      if (/i\.ytimg|i\.scdn/.test(url)) return route.fulfill({ contentType: "image/png", body: IMG_PNG });
      return route.abort();
    });
    await page.goto(base + "/spotlight/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".sp-media-player");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, "horizontal overflow px: " + overflow);
    await context.close();
  });

  await browser.close(); server.close();
  console.log(`\nspotlight-media-browser: ${passed} checks passed`);
})().catch(err => { console.error(err); process.exit(1); });
