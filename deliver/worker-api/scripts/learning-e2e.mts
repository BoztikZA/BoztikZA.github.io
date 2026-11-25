// Optional browser end-to-end check (needs Playwright + Chromium, which are not repo dependencies):
//   npx tsx scripts/learning-e2e.mts [screenshotDir]
// Boots the local preview (real Worker code, in-memory DB) and drives the real pages as a learner would.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
import assert from "node:assert/strict";
import { bankFor } from "../src/learning/exam.ts";
import { COURSE_RULES } from "../src/learning/manifest.generated.ts";
import { db, start } from "./learning-devserver.mts";

const shots = process.argv[2] || "";
const SITE = "http://localhost:8080";
const servers = start();
const browser = await chromium.launch();
const errors: string[] = [];
async function newPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|ERR_(NAME|INTERNET|CONNECTION)|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return page;
}
const shot = async (page: any, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
let step = 0; const ok = (m: string) => console.log(`  ok  ${String(++step).padStart(2, "0")} ${m}`);

try {
  const slug = "practical-ai-productivity";
  const page = await newPage();
  await page.goto(`${SITE}/learning/`); await page.waitForSelector(".lh-card");
  assert.equal(await page.locator("[data-course]").count(), 3);
  assert.equal(await page.locator(".lh-cat--soon").count(), 5);
  assert.ok((await page.locator(".lh-cat--soon .lh-soon").first().innerText()).startsWith("Something exciting is on the way!"));
  assert.ok(await page.locator("nav a", { hasText: "Courses" }).count() > 0, "nav link injected");
  await shot(page, "home-desktop"); ok("home renders 3 courses + 5 coming-soon categories + nav link");

  await page.goto(`${SITE}/learning/courses/${slug}/`);
  assert.match(await page.title(), /Practical Artificial Intelligence/i);
  assert.equal(await page.locator('script[type="application/ld+json"]').count(), 2);
  await shot(page, "course-desktop"); ok("course page + JSON-LD");
  await page.click("#start-btn");
  await page.fill("#e-name", "Thandi Nkosi"); await page.fill("#e-email", "thandi@example.com");
  await page.check("input[name=ack]"); await page.click("button[type=submit]"); await page.waitForSelector(".lh-recovery");
  assert.match(await page.locator(".lh-recovery").innerText(), /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  await shot(page, "enrol-save-link");
  const ack = await page.locator("form input[name=ack]").count(); assert.equal(ack, 0, "form replaced by save-link screen");
  ok("enrolment + private link/recovery screen");
  await page.click("text=I've saved it");
  await page.waitForURL(/learning\/learn\//); await page.waitForSelector(".lh-lesson h1");
  await shot(page, "lesson-desktop");
  const first = await page.locator(".lh-lesson h1").innerText();
  await page.click("text=Mark complete & continue");
  await page.waitForFunction((f) => document.querySelector(".lh-lesson h1")?.textContent !== f, first);
  assert.equal(await page.locator("#toc-list a.done").count(), 1); ok("lesson player completes lesson and advances");

  // knowledge check
  const chk = page.locator(".lh-check-q").first();
  if (await chk.count()) { await chk.locator("input").first().check(); await chk.locator("button").click(); assert.ok((await chk.locator(".lh-feedback").innerText()).length > 0); ok("knowledge check gives feedback"); }

  // finish the rest through the API (same server-side path the UI uses), then reload the player
  const sess = await page.evaluate(() => JSON.parse(localStorage.getItem("bzl.session.v1")!));
  const rules = COURSE_RULES.find((c) => c.slug === slug)!;
  for (const id of rules.lessonIds) await fetch(`http://localhost:8787/api/learning/courses/${slug}/lessons/${id}/complete`, { method: "POST", headers: { Authorization: `Bearer ${sess.token}`, "Content-Type": "application/json", Origin: SITE }, body: "{}" });
  await page.goto(`${SITE}/learning/exam/?c=${slug}`);
  await page.waitForSelector("#begin"); await shot(page, "exam-intro");
  await page.click("#begin"); await page.waitForSelector(".lh-q");
  assert.equal(await page.locator(".lh-q").count(), 30);
  // answer from the server-side shuffle (test-only DB access)
  const row = db.raw.prepare("SELECT * FROM learning_attempts ORDER BY started_at DESC LIMIT 1").get() as any;
  const bank = new Map(bankFor(slug).map((q) => [q.id, q])); const perms = JSON.parse(row.option_orders);
  let wrongLeft = 8; // 22/30 correct = 73% → pass at 70
  for (const id of JSON.parse(row.question_order) as string[]) {
    const q = bank.get(id)!; const perm: number[] = perms[id];
    const idx = perm.map((o, d) => ((q.correct.includes(o)) !== (wrongLeft > 0) ? d : -1)).filter((d) => d >= 0);
    const target = wrongLeft > 0 ? perm.map((o, d) => (q.correct.includes(o) ? -1 : d)).filter((d) => d >= 0) : perm.map((o, d) => (q.correct.includes(o) ? d : -1)).filter((d) => d >= 0);
    void idx; if (wrongLeft > 0) wrongLeft--;
    for (const d of target) await page.locator(`input[name="q-${id}"][value="${d}"]`).check();
  }
  await shot(page, "exam-questions");
  page.once("dialog", (d) => d.accept()); await page.click("text=Submit for marking");
  await page.waitForSelector(".lh-score");
  assert.equal(await page.locator("h1").innerText(), "You passed. Well done.");
  await shot(page, "result-pass"); ok("exam taken in browser, marked server-side, passed at 22/30");
  assert.ok(!(await page.content()).includes('"explain"'));
  assert.ok(!/\bnull\b|undefined|\[object/.test(await page.locator("main").innerText()), "no stray null/undefined text");

  await page.fill("#c-name", "Thandi N. Nkosi"); await page.click("text=Issue my certificate");
  await page.waitForSelector("text=Your certificate is ready");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=Download PDF certificate")]);
  const path = await dl.path(); const bytes = (await import("node:fs")).readFileSync(path!);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); ok("certificate issued and PDF downloaded");
  await page.waitForSelector("#contrib"); await shot(page, "certificate-and-contribution");
  assert.ok((await page.locator("#contrib").innerText()).includes("not switched on yet"), "contribution inert w/o PayPal config");
  const cid = (await page.locator(".lh-dl dd").first().innerText()).trim();

  // verification in a fresh, logged-out browser
  const anon = await newPage();
  await anon.goto(`${SITE}/learning/verify/?id=${cid}`); await anon.waitForSelector(".lh-verify-result");
  assert.ok((await anon.locator(".lh-verify-result").innerText()).includes("Valid certificate"));
  assert.ok(!(await anon.content()).includes("Nkosi"), "name not exposed without consent");
  await anon.fill("#vname", "thandi nkosi"); // printed name differs (N.) → no match, then exact
  await anon.click("text=Check name"); await anon.waitForSelector("text=No match");
  await anon.fill("#vname", "Thandi N. Nkosi"); await anon.click("text=Check name"); await anon.waitForSelector("text=Match: that name");
  await shot(anon, "verify"); ok("public verification: minimal disclosure + name confirmation");

  // private-link resume on a second device + dashboard
  const other = await newPage({ width: 390, height: 800 });
  await other.goto(`${SITE}/learning/resume/#t=${sess.token}`); await other.waitForURL(/dashboard/);
  assert.ok(!other.url().includes("t="), "token removed from the address bar");
  await other.waitForSelector(".lh-card"); assert.ok((await other.content()).includes("Hello, Thandi"));
  await shot(other, "dashboard-mobile"); ok("private link resumes on another device; token stripped from URL");
  await other.goto(`${SITE}/learning/`); await other.waitForSelector(".lh-card");
  const overflow = await other.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, "no horizontal scroll on mobile"); await shot(other, "home-mobile"); ok("mobile home has no horizontal overflow");

  // Data course: practical tasks through the UI
  const dslug = "data-analysis-spreadsheets";
  const d = await newPage();
  await d.goto(`${SITE}/learning/courses/${dslug}/`); await d.click("#start-btn");
  await d.fill("#e-name", "Data Learner"); await d.check("input[name=ack]"); await d.click("button[type=submit]"); await d.waitForSelector(".lh-recovery");
  const ds = await d.evaluate(() => JSON.parse(localStorage.getItem("bzl.session.v1")!));
  for (const id of COURSE_RULES.find((c) => c.slug === dslug)!.lessonIds) await fetch(`http://localhost:8787/api/learning/courses/${dslug}/lessons/${id}/complete`, { method: "POST", headers: { Authorization: `Bearer ${ds.token}`, "Content-Type": "application/json", Origin: SITE }, body: "{}" });
  await d.goto(`${SITE}/learning/exam/?c=${dslug}`); await d.click("#begin"); await d.waitForSelector(".lh-q");
  const drow = db.raw.prepare("SELECT * FROM learning_attempts WHERE course_slug = ? ORDER BY started_at DESC LIMIT 1").get(dslug) as any;
  const dbank = new Map(bankFor(dslug).map((q) => [q.id, q])); const dperms = JSON.parse(drow.option_orders);
  for (const id of JSON.parse(drow.question_order) as string[]) { const q = dbank.get(id)!; for (const dd of (dperms[id] as number[]).map((o, i) => (q.correct.includes(o) ? i : -1)).filter((i) => i >= 0)) await d.locator(`input[name="q-${id}"][value="${dd}"]`).check(); }
  const { buildPractical } = await import("../src/learning/practical-data.ts");
  const ans = buildPractical(drow.practical_seed).answers;
  for (const [k, v] of Object.entries(ans)) await d.fill(`#p-${k}`, String(v));
  assert.ok((await d.locator("text=Download practical data").count()) === 1);
  await shot(d, "exam-practical");
  d.once("dialog", (x) => x.accept()); await d.click("text=Submit for marking"); await d.waitForSelector(".lh-score");
  assert.equal(await d.locator("h1").innerText(), "You passed. Well done.");
  assert.ok((await d.locator("main").innerText()).includes("Task 8: correct")); ok("data course: written + practical passed through the UI");

  assert.deepEqual(errors, []); ok("no console/page errors");
  console.log("\nE2E passed");
} catch (e) { console.error("\nE2E FAILED\n", e, "\nerrors:", errors); process.exitCode = 1; }
finally { await browser.close(); servers.close(); }
process.exit(process.exitCode ?? 0);
