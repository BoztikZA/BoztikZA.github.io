// Tests for the optional post-completion support panel helpers (learning/js/support.js) and the static guarantees around it.
//   npm run test:learning-support
// The Worker-side PayPal Orders / webhook behaviour and "certificates never need a contribution" are covered in learning-test.mts.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../..");
const sup = await import(pathToFileURL(join(ROOT, "learning/js/support.js")).href);
const { REDIRECT_LIMITS, SUPPORT_TIERS, PAYPAL_ME_BASE, buildPayPalMeUrl, parseAmount, isBoztikPayPalMeUrl, dismissKey, formatUsd } = sup;

const CONFIRMED = "https://paypal.me/angry5p1c3";
let failed = 0, passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}
console.log("\nBoztik Learning support panel");

await test("destination is the confirmed PayPal.Me address, never paypal.me/boztik", () => {
  assert.equal(PAYPAL_ME_BASE, CONFIRMED);
  for (const c of [100, 200, 999, 1234, 50_000]) {
    const u = buildPayPalMeUrl(c);
    assert.ok(u.startsWith(`${CONFIRMED}/`), u);
    assert.ok(!/paypal\.me\/boztik/i.test(u));
    assert.ok(isBoztikPayPalMeUrl(u), u);
  }
});

await test("preset tiers are $2 / $5 / $10 / $20 and each builds the exact amount-specific URL", () => {
  assert.deepEqual(SUPPORT_TIERS.map((t: any) => t.cents), [200, 500, 1000, 2000]);
  assert.deepEqual(SUPPORT_TIERS.map((t: any) => t.label), ["Small contribution", "Supporter", "Learning advocate", "Generous supporter"]);
  assert.deepEqual(SUPPORT_TIERS.map((t: any) => buildPayPalMeUrl(t.cents)), [`${CONFIRMED}/2USD`, `${CONFIRMED}/5USD`, `${CONFIRMED}/10USD`, `${CONFIRMED}/20USD`]);
  assert.ok(SUPPORT_TIERS.every((t: any) => t.cents >= REDIRECT_LIMITS.minCents && t.cents <= REDIRECT_LIMITS.maxCents));
});

await test("valid custom amounts parse exactly (no floating-point drift) and build correct URLs", () => {
  const cases: Array<[string, number, string]> = [
    ["7", 700, "7USD"], ["7.5", 750, "7.50USD"], ["19.99", 1999, "19.99USD"], ["  12.05 ", 1205, "12.05USD"],
    ["1", 100, "1USD"], ["0.10".replace("0.10", "1.10"), 110, "1.10USD"], ["500", 50_000, "500USD"], ["0033", 3300, "33USD"],
  ];
  for (const [input, cents, tail] of cases) {
    const r = parseAmount(input, REDIRECT_LIMITS);
    assert.deepEqual(r, { ok: true, cents }, input);
    assert.equal(buildPayPalMeUrl(cents), `${CONFIRMED}/${tail}`, input);
  }
});

await test("invalid custom amounts are rejected with a message (zero, negative, junk, too many decimals, too large)", () => {
  const bad = ["", "   ", "0", "0.00", "-5", "+5", "abc", "1e3", "5.123", "5.", ".5", "1,000", "1 000", "$5", "5 USD", "５", "0x10",
    "500.01", "501", "999999", "1000000", "99999999999", "NaN", "Infinity", "5;6", "5/../../evil", "https://evil.example", "5%2f", "<script>"];
  for (const input of bad) {
    const r = parseAmount(input, REDIRECT_LIMITS);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.ok(typeof r.message === "string" && r.message.length > 5, JSON.stringify(input));
  }
  assert.equal(parseAmount("0.50", REDIRECT_LIMITS).ok, false, "below the $1 minimum");
  assert.equal(parseAmount(undefined as any, REDIRECT_LIMITS).ok, false);
  assert.equal(parseAmount(5 as any, REDIRECT_LIMITS).ok, false, "only learner-typed strings are accepted");
  assert.match(parseAmount("0", REDIRECT_LIMITS).message, /greater than zero/);
});

await test("server-verified limits ($5–$500) are respected by the same parser", () => {
  const api = { minCents: 500, maxCents: 50_000 };
  assert.equal(parseAmount("4.99", api).ok, false);
  assert.equal(parseAmount("5", api).ok, true);
  assert.equal(parseAmount("500", api).ok, true);
  assert.equal(parseAmount("500.01", api).ok, false);
});

await test("URL builder refuses anything but a whole, in-range number of cents", () => {
  for (const bad of [NaN, Infinity, -1, 0, 99, 50_001, 1.5, "500", null, undefined, {}, [], 2 ** 60]) {
    assert.throws(() => buildPayPalMeUrl(bad as any), RangeError, String(bad));
  }
});

await test("fuzz: every accepted amount produces only the confirmed destination plus digits", () => {
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 2000; i++) {
    const cents = REDIRECT_LIMITS.minCents + Math.floor(rnd() * (REDIRECT_LIMITS.maxCents - REDIRECT_LIMITS.minCents + 1));
    const u = buildPayPalMeUrl(cents);
    assert.match(u, /^https:\/\/paypal\.me\/angry5p1c3\/\d{1,3}(?:\.\d{2})?USD$/);
    assert.ok(isBoztikPayPalMeUrl(u));
    const typed = `${Math.floor(cents / 100)}${cents % 100 ? "." + String(cents % 100).padStart(2, "0") : ""}`;
    assert.deepEqual(parseAmount(typed, REDIRECT_LIMITS), { ok: true, cents }, typed);
  }
});

await test("destination guard rejects other users, hosts, schemes, credentials, queries and look-alikes", () => {
  assert.ok(isBoztikPayPalMeUrl(CONFIRMED));
  assert.ok(isBoztikPayPalMeUrl(`${CONFIRMED}/10USD`));
  for (const bad of ["https://paypal.me/boztik", "https://paypal.me/boztik/5USD", "http://paypal.me/angry5p1c3/5USD", "https://paypal.me.evil.com/angry5p1c3",
    "https://evil.com/paypal.me/angry5p1c3", "https://user:pw@paypal.me/angry5p1c3", `${CONFIRMED}/5USD?x=1`, `${CONFIRMED}/5USD#x`, `${CONFIRMED}/5EUR`,
    `${CONFIRMED}/5USD/extra`, `${CONFIRMED}x/5USD`, "https://www.paypal.me/angry5p1c3", "javascript:alert(1)", "", "not a url", `${CONFIRMED}/../boztik`]) {
    assert.equal(isBoztikPayPalMeUrl(bad), false, bad);
  }
});

await test("'Maybe later' is remembered per course: the three launch courses never share dismissal state", () => {
  const catalogue = JSON.parse(readFileSync(join(ROOT, "learning/data/courses.json"), "utf8")).courses as Array<{ slug: string; status?: string }>;
  const launch = ["practical-ai-productivity", "cybersecurity-digital-safety", "data-analysis-spreadsheets"];
  for (const slug of launch) assert.ok(catalogue.some((c) => c.slug === slug), `catalogue lists ${slug}`);
  const keys = launch.map(dismissKey);
  assert.equal(new Set(keys).size, 3);
  assert.deepEqual(keys, launch.map((s) => `bzl.support.dismissed.${s}`));
  assert.equal(dismissKey("../x\n'\""), "bzl.support.dismissed.x");
  assert.equal(dismissKey(""), "bzl.support.dismissed.unknown");
  assert.equal(dismissKey(undefined as any), "bzl.support.dismissed.unknown");
  for (const slug of launch) {
    const course = JSON.parse(readFileSync(join(ROOT, `learning/courses/${slug}/course.json`), "utf8"));
    assert.equal(course.slug, slug, "exam.js keys the panel off course.slug, which must match the catalogue slug");
  }
});

await test("formatUsd shows whole dollars without decimals and cents with two", () => {
  assert.equal(formatUsd(200), "$2"); assert.equal(formatUsd(1999), "$19.99"); assert.equal(formatUsd(1205), "$12.05"); assert.equal(formatUsd(50_000), "$500");
});

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

await test("Support page and Learning code use the confirmed PayPal address; paypal.me/boztik exists nowhere in the site", () => {
  const support = read("support.html");
  const hrefs = [...support.matchAll(/href="(https:\/\/paypal\.me\/[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [CONFIRMED]);
  const skip = new Set(["node_modules", ".git", "dist"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(html|js|mjs|ts|mts|css|json|md|xml)$/.test(name)) continue;
      if (/paypal\.me\/boztik/i.test(readFileSync(p, "utf8")) && !p.endsWith("learning-support-test.mts")) offenders.push(p.slice(ROOT.length + 1));
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, []);
});

await test("certificate and result flow do not depend on the support panel", () => {
  const exam = read("learning/js/exam.js");
  assert.ok(existsSync(join(ROOT, "learning/js/support.js")));
  // The panel is only appended after a certificate already exists and is never awaited by any claim/download handler.
  assert.equal([...exam.matchAll(/\bcontribution\(/g)].length, 2, "one definition and one call");
  const claim = exam.slice(exam.indexOf("function renderClaim"), exam.indexOf("async function showCertificate"));
  assert.ok(!/contrib|support|dismiss/i.test(claim), "claim form never reads support state");
  const cert = exam.slice(exam.indexOf("async function showCertificate"), exam.indexOf("// ---------------------------------------------------------------- optional support"));
  assert.ok(/contribution\(el\.parentElement, course\?\.slug \|\| slug\);\s*\}\s*$/.test(cert.trimEnd() + "\n"), "called last, fire-and-forget, with the resolved course slug");
  assert.ok(!/await\s+contribution\(/.test(exam), "never awaited, so it cannot delay or block the certificate");
});

await test("panel copy states it is optional, free and non-gating; offers 'Maybe later'; no secrets in the browser", () => {
  const exam = read("learning/js/exam.js");
  for (const needle of ["Help keep learning open to everyone.", "Maybe later", "All courses, assessments and certificates remain free", "entirely optional", "cannot see whether it was completed"]) {
    assert.ok(exam.includes(needle), needle);
  }
  const files = ["learning/js/exam.js", "learning/js/support.js", "learning/js/config.js", "learning/js/core.js"].map(read).join("\n");
  assert.ok(!/client_secret|PAYPAL_CLIENT_SECRET|PAYPAL_CLIENT_ID|PAYPAL_WEBHOOK_ID|api-m\.(sandbox\.)?paypal\.com/i.test(files), "no PayPal credentials in browser code");
  assert.ok(!/innerHTML/.test(read("learning/js/support.js")) && !/innerHTML\s*=/.test(exam.slice(exam.indexOf("optional support"))), "panel builds DOM with textContent only");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
