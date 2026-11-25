// Optional browser check of the Command Centre Learning panel (real dashboard.html + real Worker code, in-memory DB):
//   NODE_PATH=$(npm root -g) PLAYWRIGHT_PATH=$(npm root -g)/playwright npx tsx scripts/learning-admin-e2e.mts [shotsDir]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
import assert from "node:assert/strict";
import { createSession } from "../src/lib/auth.ts";
import { db, env, start } from "./learning-devserver.mts";

const shots = process.argv[2] || "";
const SITE = "http://localhost:8080";
const servers = start();
const now = Math.floor(Date.now() / 1000);
const run = (sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).run();
// Seed: two learners (one active now), progress, a passed attempt, a certificate, a live + a sandbox contribution.
await run("INSERT INTO learning_learners (id,public_ref,token_hash,recovery_hash,name,email,country,created_at,last_seen_at) VALUES ('L1','LN-AAAAAAAA','h1','r1','Thandi Nkosi','thandi@example.test','ZA',?1,?1)", now - 60);
await run("INSERT INTO learning_learners (id,public_ref,token_hash,recovery_hash,name,email,country,created_at,last_seen_at) VALUES ('L2','LN-BBBBBBBB','h2','r2','Sipho Dlamini',NULL,NULL,?1,?2)", now - 86400 * 3, now - 86400 * 2);
const slug = "practical-ai-productivity";
for (const l of ["L1", "L2"]) await run("INSERT INTO learning_enrolments (learner_id,course_slug,enrolled_at,last_activity_at) VALUES (?,?,?,?)", l, slug, now - 1000, now - 500);
await run("INSERT INTO learning_progress (learner_id,course_slug,lesson_id,completed_at) VALUES ('L1',?,'m01-l01',?),('L1',?,'m02-l01',?),('L2',?,'m01-l01',?)", slug, now, slug, now, slug, now);
await run("INSERT INTO learning_attempts (id,learner_id,course_slug,status,seed,question_order,option_orders,started_at,expires_at,submitted_at,written_correct,written_total,written_percent,passed) VALUES ('A1','L1',?1,'submitted','s','[]','{}',?2,?2,?2,27,30,90,1)", slug, now - 300);
await run("INSERT INTO learning_certificates (id,certificate_id,learner_id,course_slug,attempt_id,learner_name,course_title,score_percent,pass_mark,issued_at) VALUES ('C1','BZL-ABCD-2345-EFGH','L1',?1,'A1','Thandi Nkosi','Practical AI & Productivity',90,70,?2)", slug, now - 200);
await run("INSERT INTO learning_contributions (id,amount_cents,paypal_order_id,paypal_env,status,created_at,updated_at,completed_at) VALUES ('P1',1000,'O1','sandbox','completed',?1,?1,?1)", now - 100);
const admin = await createSession(env, "admin@boztik.test");

const browser = await chromium.launch();
const errors: string[] = [];
let step = 0; const ok = (m: string) => console.log(`  ok  ${String(++step).padStart(2, "0")} ${m}`);
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([k, v]: string[]) => localStorage.setItem(k, v), ["boztik-deliver-session-v3", JSON.stringify({ token: admin.token, email: admin.email, expires_at: new Date(admin.expires_at * 1000).toISOString() })]);
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => { if (!/allow-same-origin/.test(e.message)) errors.push(`pageerror: ${e.message}`); }); // the sandboxed preview iframe in the existing dashboard is not part of Learning
  page.on("console", (m: any) => { if (m.type() === "error" && !/fonts\.g|ERR_(NAME|INTERNET|CONNECTION)|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  const shot = async (n: string) => { if (shots) await page.screenshot({ path: `${shots}/${n}.png`, fullPage: true }); };
  await page.goto(`${SITE}/deliver-v3/dashboard.html`);
  await page.click("#tab-learning");
  await page.waitForSelector("#learning-root .cc-kpi");
  const text = await page.locator("#learning-root").innerText();
  assert.ok(/Active now/.test(text) && /last 30 minutes/.test(text), "active-session definition visible");
  assert.ok(/Sandbox \(test\) confirmations: 1/.test(text), "sandbox separated");
  assert.ok(!/\bnull\b|undefined|NaN|object HTML/.test(text), "no stray null/undefined/NaN/object");
  assert.ok(/Private learner sessions created/.test(text), "definitions list rendered");
  await shot("admin-overview"); ok("overview: KPIs, definitions, storage, sandbox separated");

  await page.click('.lm-tab[data-v="courses"]'); await page.waitForSelector("#learning-root .lm-table");
  const ct = await page.locator("#learning-root").innerText();
  assert.ok(/Practical Artificial Intelligence|Practical AI/i.test(ct) && /Drop-off by module/.test(ct) && /M01/.test(ct));
  assert.ok(!/\bnull\b|undefined|NaN/.test(ct)); await shot("admin-courses"); ok("courses: drop-off by module");

  await page.click('.lm-tab[data-v="certificates"]'); await page.waitForSelector("text=BZL-ABCD-2345-EFGH");
  await page.click("#learning-root button:has-text(\"Verify\")"); await page.waitForSelector("text=Written score", { timeout: 5000 }).catch(async (e: Error) => { console.log("DETAIL:", await page.locator("#learning-root").innerText()); throw e; });
  page.once("dialog", (d: any) => d.accept("Issued in error (e2e)"));
  await page.click("button:has-text('Revoke')"); await page.waitForSelector(".lm-pill.bad");
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM learning_audit WHERE action='certificate.revoke'").first<any>()).n, 1);
  await shot("admin-certificates"); ok("certificates: search, verify, revoke + audit");

  await page.click('.lm-tab[data-v="learners"]'); await page.waitForSelector("text=LN-AAAAAAAA");
  const lt = await page.locator("#learning-root").innerText();
  assert.ok(/Active now/.test(lt) && !/h1|r1\b/.test(lt.replace(/LN|thandi|Thandi/g, "")) , "no hashes");
  page.once("dialog", (d: any) => d.accept("Abuse report (e2e)"));
  await page.locator("tr", { hasText: "LN-BBBBBBBB" }).locator("button").click(); await page.waitForSelector("text=Restore");
  await shot("admin-learners"); ok("learner sessions: revoke → restore button");

  await page.click('.lm-tab[data-v="money"]'); await page.waitForSelector("text=Audit log");
  const mt = await page.locator("#learning-root").innerText();
  assert.ok(/Sandbox \(test\)/.test(mt) && /certificate\.revoke/.test(mt) && /learner\.revoke/.test(mt));
  await shot("admin-money"); ok("contributions, storage and audit");

  // Signed-out: no data, no requests with credentials
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`${SITE}/deliver-v3/dashboard.html`);
  assert.equal(await anon.locator("#learning-root .cc-kpi").count(), 0); ok("signed-out sees no Learning data");

  // Mobile
  const mob = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await mob.context().addInitScript(([k, v]: string[]) => localStorage.setItem(k, v), ["boztik-deliver-session-v3", JSON.stringify({ token: admin.token, email: admin.email, expires_at: new Date(admin.expires_at * 1000).toISOString() })]);
  await mob.goto(`${SITE}/deliver-v3/dashboard.html`); await mob.click("#tab-learning"); await mob.waitForSelector("#learning-root .cc-kpi");
  assert.ok(await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal page scroll on mobile"); ok("mobile layout fits");

  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("ADMIN E2E PASSED");
} catch (e) { console.error("ADMIN E2E FAILED", e, errors); process.exitCode = 1; }
finally { await browser.close(); servers.close(); process.exit(process.exitCode ?? 0); }
