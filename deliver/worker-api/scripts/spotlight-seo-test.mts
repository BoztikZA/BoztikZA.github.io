/** Static SEO guard for Spotlight: only the directory and the application form are indexable; private/per-profile pages are not. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const robots = (html: string) => /<meta name="robots" content="([^"]+)"/.exec(html)?.[1] ?? "";
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log("  ok  " + name); };

test("directory is indexable and has a canonical URL", () => {
  const html = read("spotlight/index.html");
  assert.match(robots(html), /^index/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.boztik\.com\/spotlight\/">/);
});
test("individual profile pages stay noindex (decision: revisit after the AdSense review)", () => {
  assert.match(robots(read("spotlight/profile.html")), /noindex/);
});
test("the private applicant status page is noindex,nofollow, sends no referrer, and is not in the sitemap", () => {
  const html = read("spotlight/status/index.html");
  assert.match(robots(html), /noindex/); assert.match(robots(html), /nofollow/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(read("sitemap.xml"), /spotlight\/status/);
});
test("sitemap lists no individual profile URLs and no private surfaces", () => {
  const sitemap = read("sitemap.xml");
  assert.doesNotMatch(sitemap, /profile\.html|slug=|deliver-v3|#t=/);
  assert.match(sitemap, /<loc>https:\/\/www\.boztik\.com\/spotlight\/<\/loc>/);
});
test("structured data on the directory contains only facts that are on the page (no invented ratings, offers or people)", () => {
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(read("spotlight/index.html"))![1]!);
  assert.equal(ld["@type"], "CollectionPage");
  for (const forbidden of ["aggregateRating", "review", "offers", "price", "author", "itemListElement"]) assert.equal(ld[forbidden], undefined, forbidden);
});
test("existing robots.txt rules for the private delivery system are preserved", () => {
  const txt = read("robots.txt");
  assert.match(txt, /Disallow: \/deliver\//);
  assert.match(txt, /User-agent: AdsBot-Google\nDisallow: \/deliver-v3\/dashboard\.html/);
});
console.log(`\nspotlight-seo: ${passed} tests passed`);
