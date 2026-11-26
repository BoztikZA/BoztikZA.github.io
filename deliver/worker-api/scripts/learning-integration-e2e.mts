// Optional browser check of the homepage ↔ Learning Hub integration (static site served locally, real Worker code behind it):
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_PATH=$(npm root -g)/playwright npx tsx scripts/learning-integration-e2e.mts [shotsDir]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { start } from "./learning-devserver.mts";

const shots = process.argv[2] || "";
const SITE = "http://localhost:8080";
const ROOT = join(import.meta.dirname, "../../..");
const servers = start();
const browser = await chromium.launch();
const errors: string[] = [];
let step = 0; const ok = (m: string) => console.log(`  ok  ${String(++step).padStart(2, "0")} ${m}`);
const IGNORE = /\[spotlight-home\]|fonts\.g|ERR_(NAME|INTERNET|CONNECTION|BLOCKED)|Failed to load resource|googletagmanager|googlesyndication|adsbygoogle|doubleclick/;

async function open(viewport: { width: number; height: number }, path: string, opts: { gtag?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route(/googletagmanager|googlesyndication|doubleclick|fonts\.g/, (r: any) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => errors.push(`pageerror ${path}: ${e.message}`));
  page.on("console", (m: any) => { if (m.type() === "error" && !IGNORE.test(m.text())) errors.push(`console ${path}: ${m.text()}`); });
  await page.goto(`${SITE}${path}`, { waitUntil: "load" });
  return page;
}
const shot = async (page: any, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };

try {
  // ------------------------------------------------------------------ homepage: section, cards, nav, footer
  const home = await open({ width: 1440, height: 900 }, "/", { gtag: true });
  const section = home.locator("#learning-hub");
  assert.equal(await section.count(), 1);
  const text = await section.innerText();
  assert.ok(!/coming soon|planned launch|taking shape/i.test(text), "no outdated planned-course wording");
  const courseLinks = await section.locator("a.home-learning__course").evaluateAll((as: any[]) => as.map((a) => a.getAttribute("href")));
  assert.deepEqual(courseLinks, ["/learning/courses/practical-ai-productivity/", "/learning/courses/cybersecurity-digital-safety/", "/learning/courses/data-analysis-spreadsheets/"]);
  assert.equal(await section.locator('a[href="/learning/"]').count(), 1); assert.equal(await section.locator('a[href="/learning/#courses"]').count(), 1);
  // order on the page: Toolkit → Learning → Services
  const order = await home.evaluate(() => ["downloads", "learning-hub", "creative-services"].map((id) => document.getElementById(id)!.getBoundingClientRect().top + scrollY));
  assert.ok(order[0] < order[1] && order[1] < order[2], "Learning sits after Creative Toolkit and before Creative Services");
  ok("homepage Learning section: real course links, no planned wording, correct placement");

  assert.equal(await home.locator('.home-path-card--learn').getAttribute("href"), "/learning/");
  assert.ok(!/coming soon/i.test(await home.locator(".home-path-card--learn").innerText()));
  assert.equal(await home.locator(".home-path-card").count(), 4);
  assert.equal(await home.locator('footer a[href="/learning/"]').count(), 1);
  assert.equal(await home.locator('a[href="#learning-hub"]').count(), 0, "no links left to the old anchor");
  ok("ecosystem card + footer link to /learning/");

  // nav: exactly one Learning link, desktop grouping intact, keyboard reachable
  const navLinks = await home.locator('.nav-links a[href="/learning/"]').count();
  assert.equal(navLinks, 1, "exactly one Learning link in the nav");
  assert.ok(await home.locator(".nav-group__btn", { hasText: "More" }).count() === 1, "More group preserved");
  assert.equal(await home.locator('.nav-links a[href="/learning/"]').innerText(), "Learn");
  await home.locator('.nav-links a[href="/learning/"]').focus(); assert.equal(await home.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute("href")), "/learning/");
  assert.equal(await home.locator('.nav-links a[href="/learning/"]').count(), 1);
  ok("nav: single Learn → /learning/, grouping preserved, focusable");

  // analytics: clicks produce boztik_action events with path-only destinations
  await home.evaluate(() => document.addEventListener("click", (e) => { const a = (e.target as HTMLElement).closest("a"); if (a && a.getAttribute("href")?.startsWith("/learning")) e.preventDefault(); }, false));
  await section.locator('a[data-learning-cta="hub"]').click();
  await section.locator("a.home-learning__course").first().click();
  await home.locator('.nav-links a[href="/learning/"]').click();
  await home.locator(".home-path-card--learn").click();
  const ev = (await home.evaluate(() => Array.from((window as any).dataLayer, (a: any) => Array.from(a)))).filter((a: any[]) => a[0] === "event" && a[1] === "boztik_action").map((a: any[]) => a[2]); // the page\'s own gtag() pushes onto dataLayer
  const learning = ev.filter((e: any) => /^learning_/.test(e.action));
  assert.deepEqual(learning.map((e: any) => `${e.action}|${e.position}`), ["learning_hub|content", "learning_course|content", "learning_hub|nav", "learning_hub|content"]);
  assert.ok(learning.every((e: any) => e.page_key === "homepage" && !/[?#]/.test(e.destination)));
  ok("analytics: CTA, course-preview, nav and card clicks use the existing boztik_action event");
  await home.close();

  // ------------------------------------------------------------------ responsive screenshots + no horizontal scroll
  for (const [name, vp] of [["desktop", { width: 1440, height: 900 }], ["laptop", { width: 1180, height: 760 }], ["tablet", { width: 820, height: 1100 }], ["mobile", { width: 390, height: 844 }], ["small", { width: 340, height: 720 }]] as const) {
    const p = await open(vp, "/");
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } scrollTo(0, 0); });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal scroll at ${name}`);
    await p.locator("#learning-hub").scrollIntoViewIfNeeded(); await p.waitForTimeout(900);
    if (shots) await p.locator("#learning-hub").screenshot({ path: `${shots}/home-learning-${name}.png` });
    if (shots && name === "mobile") await shot(p, "home-mobile-full");
    await p.close();
  }
  ok("homepage fits desktop / laptop / tablet / mobile / 340px without horizontal scroll");

  // mobile menu
  const m = await open({ width: 390, height: 844 }, "/");
  await m.click(".nav-toggle");
  await m.locator('.nav-links a[href="/learning/"]').waitFor({ state: "visible", timeout: 3000 }); await m.waitForTimeout(500);
  await m.keyboard.press("Escape"); assert.equal(await m.locator(".nav-toggle").getAttribute("aria-expanded"), "false");
  ok("mobile menu lists Learn and still closes with Escape");
  await m.close();

  // reduced motion: no transforms/animations on the course cards
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const rp = await rctx.newPage(); await rp.goto(`${SITE}/`);
  const tr = await rp.locator("a.home-learning__course").first().evaluate((el: Element) => getComputedStyle(el).transitionDuration);
  assert.ok(/^0s(, 0s)*$/.test(tr), "reduced motion disables course-card transitions (" + tr + ")"); await rctx.close();
  ok("prefers-reduced-motion respected");

  // ------------------------------------------------------------------ Learning pages: nav/footer connect back, breadcrumbs, canonical, no duplicates
  const hub = await open({ width: 1280, height: 900 }, "/learning/");
  assert.equal(await hub.locator('.nav-links a[href="/learning/"]').count(), 1);
  assert.equal(await hub.locator('.nav-links a[href="/learning/"]').getAttribute("aria-current"), "page");
  for (const h of ["/index.html", "/spotlight/", "/creative-toolkit.html", "/guides.html", "/stores.html"]) assert.ok(await hub.locator(`footer a[href="${h}"]`).count() >= 1, `footer links back to ${h}`);
  assert.equal(await hub.locator(".lh-cat").count(), 8, "all eight categories"); assert.equal(await hub.locator(".lh-cat--soon").count(), 5);
  assert.equal(await hub.locator('link[rel="canonical"]').count(), 1); assert.equal(await hub.locator('meta[name="description"]').count(), 1);
  assert.equal(await hub.locator('link[rel="canonical"]').getAttribute("href"), "https://www.boztik.com/learning/");
  const ld = await hub.locator('script[type="application/ld+json"]').allInnerTexts();
  assert.ok(ld.some((t: string) => t.includes("BreadcrumbList")) && ld.every((t: string) => { JSON.parse(t); return true; }));
  await shot(hub, "learning-home"); ok("/learning/: single nav link (current), footer links back, 8 categories, canonical + valid JSON-LD");
  await hub.close();

  // catalogue visits: the Learning home posts a 'learning' page view; lessons never do
  const posts: string[] = [];
  const pv = await browser.newContext(); await pv.route(/\/api\/public\/(pageview|traffic-source)/, (r: any) => { posts.push(r.request().url() + " " + (r.request().postData() || "")); r.fulfill({ status: 204 }); });
  const pg = await pv.newPage(); await pg.goto(`${SITE}/learning/`); await pg.waitForTimeout(800);
  assert.ok(posts.some((p) => /pageview.*"page":"learning"/.test(p)), "catalogue page view sent: " + posts.join("|"));
  posts.length = 0; await pg.goto(`${SITE}/learning/courses/data-analysis-spreadsheets/`); await pg.waitForTimeout(800);
  assert.ok(posts.some((p) => /pageview.*"page":"learning_course"/.test(p)));
  posts.length = 0; await pg.goto(`${SITE}/learning/resources/spot-and-report-phishing/`); await pg.waitForTimeout(800);
  assert.ok(posts.some((p) => /pageview.*"page":"learning_resource"/.test(p)));
  posts.length = 0; await pg.goto(`${SITE}/learning/dashboard/`); await pg.waitForTimeout(800);
  assert.equal(posts.length, 0, "private learner pages are never counted"); await pv.close();
  ok("analytics: catalogue, course and public resource visits counted; learner pages never");

  // an inner page gets the Learning Hub link exactly once and Guides keeps its own name
  const inner = await open({ width: 1280, height: 900 }, "/services.html");
  assert.equal(await inner.locator('.nav-links a[href="/learning/"]').count(), 1);
  assert.equal(await inner.locator('.nav-links a[href="/learning/"]').innerText(), "Learn");
  assert.equal(await inner.locator('.nav-links a[href$="guides.html"]').innerText(), "Guides");
  ok("inner pages: Learn → /learning/ added once; the guides link is labelled Guides");
  await inner.close();

  // ------------------------------------------------------------------ every internal link/asset on the homepage + learning pages resolves
  const missing: string[] = [];
  for (const file of ["index.html", "learning/index.html", "learning/courses/practical-ai-productivity/index.html", "learning/courses/cybersecurity-digital-safety/index.html", "learning/courses/data-analysis-spreadsheets/index.html"]) {
    const html = readFileSync(join(ROOT, file), "utf8");
    for (const m of html.matchAll(/(?:href|src)="([^"#?]+)[^"]*"/g)) {
      const u = m[1]!; if (/^(https?:|mailto:|data:|\/\/)/.test(u)) continue;
      const rel = u.startsWith("/") ? u.slice(1) : join(file, "..", u);
      const target = join(ROOT, rel); if (!(existsSync(target) || existsSync(join(target, "index.html")))) missing.push(`${file} → ${u}`);
    }
  }
  assert.deepEqual(missing, [], "broken internal links/assets:\n" + missing.join("\n")); ok("no broken internal links or assets on the homepage and public Learning pages");

  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("INTEGRATION E2E PASSED");
} catch (e) { console.error("INTEGRATION E2E FAILED", e, errors); process.exitCode = 1; }
finally { await browser.close(); servers.close(); process.exit(process.exitCode ?? 0); }
