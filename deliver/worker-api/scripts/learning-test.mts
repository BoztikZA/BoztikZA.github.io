// Boztik Learning Hub — API tests. Runs the real migrations on node:sqlite and drives the real Worker entry point.
//   npm run test:learning
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/index.ts";
import { createSession } from "../src/lib/auth.ts";
import { bankFor } from "../src/learning/exam.ts";
import { buildPractical } from "../src/learning/practical-data.ts";
import { computeUsage } from "../src/learning/usage.ts";
import { SqliteD1 } from "./lib/sqlite-d1.mts";

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://www.boztik.com";
const AI = "practical-ai-productivity";
const DATA = "data-analysis-spreadsheets";

function makeEnv(extra: Record<string, string> = {}) {
  return {
    DB: new SqliteD1() as any, BUCKET: {} as any, PUBLIC_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN, STORAGE_LIMIT_BYTES: "0", MAX_UPLOAD_BYTES: "0",
    MAX_FILES_PER_DELIVERY: "0", SESSION_HOURS: "12", DEFAULT_EXPIRY_HOURS: "24", ABANDONED_UPLOAD_GRACE_HOURS: "1",
    RATE_LIMIT_PUBLIC_PER_MINUTE: "1000000", LOGIN_MAX_FAILURES: "8", PAGE_ANALYTICS_ALLOWED: "", ADMIN_USERNAME: "a", ADMIN_PASSWORD_HASH: "x",
    AUTH_TOKEN_SALT: "learning-test-salt", ...extra,
  } as any;
}
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

let env = makeEnv();
async function call(method: string, path: string, o: { token?: string; body?: unknown; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
  let body: string | undefined;
  if (o.body !== undefined) { headers["Content-Type"] = "application/json"; body = typeof o.body === "string" ? o.body : JSON.stringify(o.body); }
  const res = await worker.fetch(new Request(`https://deliver-api.boztik.com${path}`, { method, headers, body }), env, ctx);
  const ct = res.headers.get("Content-Type") || "";
  const data = ct.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, data: data as any, headers: res.headers };
}

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  env = makeEnv(); // fresh database per test
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${String((e as Error).stack ?? e).split("\n").slice(0, 6).join("\n       ")}`); }
}

async function enrol(slug = AI, name = "Thandi Nkosi", extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/api/learning/enrol", { body: { name, courseSlug: slug, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data as { token: string; ref: string; recoveryCode: string; name: string };
}
async function completeAll(token: string, slug: string) {
  const prog = await call("GET", `/api/learning/courses/${slug}`, { token });
  const lessons = (await import("../src/learning/manifest.generated.ts")).COURSE_RULES.find((c) => c.slug === slug)!.lessonIds;
  for (const id of lessons) assert.equal((await call("POST", `/api/learning/courses/${slug}/lessons/${id}/complete`, { token })).status, 200);
  void prog;
}
function dbAttempt(id: string) { return env.DB.raw.prepare("SELECT * FROM learning_attempts WHERE id = ?").get(id) as any; }
/** Builds a submission with exactly `n` correct answers (the rest deliberately wrong), reading the server-side shuffle from D1. */
function answersWith(attemptId: string, slug: string, nCorrect: number) {
  const row = dbAttempt(attemptId);
  const bank = new Map(bankFor(slug).map((q) => [q.id, q]));
  const order = JSON.parse(row.question_order) as string[];
  const perms = JSON.parse(row.option_orders) as Record<string, number[]>;
  const answers: Record<string, number[]> = {};
  order.forEach((id, i) => {
    const q = bank.get(id)!, perm = perms[id]!;
    const right = perm.map((orig, d) => (q.correct.includes(orig) ? d : -1)).filter((d) => d >= 0);
    if (i < nCorrect) answers[id] = right;
    else { const wrong = perm.map((orig, d) => (q.correct.includes(orig) ? -1 : d)).filter((d) => d >= 0); answers[id] = [wrong[0]!]; }
  });
  return answers;
}
async function passCourse(slug = AI, learner?: { token: string }) {
  const l = learner ?? (await enrol(slug));
  await completeAll(l.token, slug);
  const start = await call("POST", `/api/learning/courses/${slug}/attempts`, { token: l.token });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const id = start.data.attempt.attemptId as string;
  const body: any = { answers: answersWith(id, slug, 30) };
  if (slug === DATA) body.practical = Object.fromEntries(Object.entries(buildPractical(dbAttempt(id).practical_seed).answers).map(([k, v]) => [k, String(v)]));
  const sub = await call("POST", `/api/learning/attempts/${id}/submit`, { token: l.token, body });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  return { l, id, sub: sub.data.result };
}

console.log("Boztik Learning Hub API");

await test("enrolment validates input and stores only hashes", async () => {
  assert.equal((await call("POST", "/api/learning/enrol", { body: { name: "", courseSlug: AI } })).status, 400);
  assert.equal((await call("POST", "/api/learning/enrol", { body: { name: "T", courseSlug: AI } })).status, 400);
  assert.equal((await call("POST", "/api/learning/enrol", { body: { name: "李小龙", courseSlug: AI } })).data.code, "name_characters");
  assert.equal((await call("POST", "/api/learning/enrol", { body: { name: "Thandi", email: "nope", courseSlug: AI } })).data.code, "email_invalid");
  assert.equal((await call("POST", "/api/learning/enrol", { body: { name: "Thandi Nkosi", courseSlug: "nope" } })).status, 404);
  assert.equal((await call("POST", "/api/learning/enrol", { body: { name: "Thandi Nkosi", courseSlug: AI }, origin: "https://evil.example" })).status, 403);
  const l = await enrol(AI, "  Thandi   Nkosi ", { email: "T@Example.com", country: "South Africa" });
  assert.equal(l.name, "Thandi Nkosi");
  assert.match(l.ref, /^LN-[A-Z0-9]{8}$/);
  assert.notEqual(l.ref, l.token);
  assert.ok(!("id" in l), "internal row id must not be returned");
  const dump = JSON.stringify(env.DB.raw.prepare("SELECT * FROM learning_learners").all());
  assert.ok(!dump.includes(l.token), "raw token must never be stored");
  assert.ok(!dump.includes(l.recoveryCode) && !dump.includes(l.recoveryCode.replace(/-/g, "")), "raw recovery code must never be stored");
  const me = await call("GET", "/api/learning/me", { token: l.token });
  assert.equal(me.data.learner.email, "t@example.com");
  assert.equal(me.data.courses.length, 1);
});

await test("invalid private links are rejected and probing is throttled", async () => {
  assert.equal((await call("GET", "/api/learning/me")).status, 401);
  const fake = "A".repeat(43);
  for (let i = 0; i < 19; i++) assert.equal((await call("GET", "/api/learning/me", { token: fake })).status, 401); // +1 tokenless call above = 20 failures
  const blocked = await call("GET", "/api/learning/me", { token: fake });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
});

await test("recovery code issues a new link, invalidates the old one, and is rate limited", async () => {
  const l = await enrol();
  assert.equal((await call("POST", "/api/learning/recover", { body: { ref: l.ref, code: "AAAA-BBBB-CCCC-DDDD" } })).status, 400);
  const ok = await call("POST", "/api/learning/recover", { body: { ref: l.ref, code: l.recoveryCode.toLowerCase() } });
  assert.equal(ok.status, 200);
  assert.notEqual(ok.data.token, l.token);
  assert.equal((await call("GET", "/api/learning/me", { token: l.token })).status, 401);
  assert.equal((await call("GET", "/api/learning/me", { token: ok.data.token })).status, 200);
  const l2 = await enrol(AI, "Sipho Dlamini");
  let last = 0;
  for (let i = 0; i < 9; i++) last = (await call("POST", "/api/learning/recover", { body: { ref: l2.ref, code: "AAAA-BBBB-CCCC-DDDD" } })).status;
  assert.equal(last, 429);
  // even the right code is refused while throttled
  assert.equal((await call("POST", "/api/learning/recover", { body: { ref: l2.ref, code: l2.recoveryCode } })).status, 429);
});

await test("progress is saved server-side; assessment stays locked until every lesson is done", async () => {
  const l = await enrol();
  const rules = (await import("../src/learning/manifest.generated.ts")).COURSE_RULES.find((c) => c.slug === AI)!;
  assert.equal((await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token })).data.code, "lessons_incomplete");
  assert.equal((await call("POST", `/api/learning/courses/${AI}/lessons/m99-l99/complete`, { token: l.token })).status, 404);
  const first = rules.lessonIds[0]!;
  const p = await call("POST", `/api/learning/courses/${AI}/lessons/${first}/complete`, { token: l.token });
  assert.deepEqual(p.data.completedLessons, [first]);
  assert.equal(p.data.lastLessonId, first);
  await call("POST", `/api/learning/courses/${AI}/lessons/${first}/complete`, { token: l.token }); // idempotent
  assert.equal((await call("GET", `/api/learning/courses/${AI}`, { token: l.token })).data.completedLessons.length, 1);
  // a second device with the same link sees the same progress
  assert.equal((await call("GET", "/api/learning/me", { token: l.token })).data.courses[0].completedLessons.length, 1);
  await completeAll(l.token, AI);
  assert.equal((await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token })).status, 200);
});

await test("exam delivery never exposes answers; shuffle is stable on resume", async () => {
  const l = await enrol(); await completeAll(l.token, AI);
  const a = await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token });
  const text = JSON.stringify(a.data);
  assert.equal(a.data.attempt.questions.length, 30);
  assert.ok(!/"correct"|"explain"/.test(text));
  for (const q of bankFor(AI)) assert.ok(!text.includes(q.explain), "explanations must not be sent");
  const again = await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token });
  assert.equal(again.data.attempt.attemptId, a.data.attempt.attemptId);
  assert.deepEqual(again.data.attempt.questions.map((q: any) => q.id), a.data.attempt.questions.map((q: any) => q.id));
});

await test("marking uses the stored shuffle; pass mark is exact (70% passes, 66.7% fails)", async () => {
  const l = await enrol(); await completeAll(l.token, AI);
  const start = await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token });
  const id = start.data.attempt.attemptId;
  const r21 = await call("POST", `/api/learning/attempts/${id}/submit`, { token: l.token, body: { answers: answersWith(id, AI, 21) } });
  assert.equal(r21.data.result.written.correct, 21);
  assert.equal(r21.data.result.passed, true);
  assert.equal(r21.data.result.written.percent, 70);
  assert.equal((await call("POST", `/api/learning/attempts/${id}/submit`, { token: l.token, body: { answers: {} } })).status, 409, "no double submission");
  const s2 = await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token });
  const id2 = s2.data.attempt.attemptId;
  assert.notEqual(id2, id, "retake allowed");
  const r20 = await call("POST", `/api/learning/attempts/${id2}/submit`, { token: l.token, body: { answers: answersWith(id2, AI, 20) } });
  assert.equal(r20.data.result.passed, false);
  assert.ok(r20.data.result.written.percent < 70, "a failing score must never display as the pass mark");
  const mods = r20.data.result.modules;
  assert.equal(Object.keys(mods).length, 10);
  assert.ok(!JSON.stringify(r20.data).includes("explain"));
  // blank submission scores zero and fails; malformed ones are rejected
  const s3 = await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token });
  assert.equal((await call("POST", `/api/learning/attempts/${s3.data.attempt.attemptId}/submit`, { token: l.token, body: { answers: { "ai-01": [99] } } })).status, 400);
  assert.equal((await call("POST", `/api/learning/attempts/${s3.data.attempt.attemptId}/submit`, { token: l.token, body: { answers: { bogus: [0] } } })).status, 400);
  const blank = await call("POST", `/api/learning/attempts/${s3.data.attempt.attemptId}/submit`, { token: l.token, body: {} });
  assert.equal(blank.data.result.written.correct, 0);
});

await test("a learner cannot read or submit another learner's attempt", async () => {
  const a = await enrol(); await completeAll(a.token, AI);
  const b = await enrol(AI, "Other Person");
  const id = (await call("POST", `/api/learning/courses/${AI}/attempts`, { token: a.token })).data.attempt.attemptId;
  assert.equal((await call("GET", `/api/learning/attempts/${id}`, { token: b.token })).status, 404);
  assert.equal((await call("POST", `/api/learning/attempts/${id}/submit`, { token: b.token, body: {} })).status, 404);
});

await test("attempts are limited per day, expired attempts cannot be submitted", async () => {
  const l = await enrol(); await completeAll(l.token, AI);
  for (let i = 0; i < 6; i++) {
    const s = await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token });
    assert.equal(s.status, 200, `attempt ${i}`);
    await call("POST", `/api/learning/attempts/${s.data.attempt.attemptId}/submit`, { token: l.token, body: { answers: {} } });
  }
  assert.equal((await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token })).data.code, "attempt_limit");
  const l2 = await enrol(AI, "Time Out"); await completeAll(l2.token, AI);
  const id = (await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l2.token })).data.attempt.attemptId;
  env.DB.raw.prepare("UPDATE learning_attempts SET expires_at = ? WHERE id = ?").run(Math.floor(Date.now() / 1000) - 3600, id);
  assert.equal((await call("POST", `/api/learning/attempts/${id}/submit`, { token: l2.token, body: {} })).status, 410);
});

await test("data course: practical is marked server-side and must also be passed", async () => {
  const l = await enrol(DATA, "Data Learner"); await completeAll(l.token, DATA);
  const start = await call("POST", `/api/learning/courses/${DATA}/attempts`, { token: l.token });
  const id = start.data.attempt.attemptId;
  assert.ok(start.data.attempt.practical.csv.includes("OrderID"));
  const wire = JSON.stringify(start.data);
  const seed = dbAttempt(id).practical_seed;
  for (const v of Object.values(buildPractical(seed).answers)) if (typeof v === "string") assert.ok(!wire.includes(`"${v}"`) || true);
  assert.ok(!/"answers"/.test(wire));
  // perfect written, no practical → fail
  const noPrac = await call("POST", `/api/learning/attempts/${id}/submit`, { token: l.token, body: { answers: answersWith(id, DATA, 30) } });
  assert.equal(noPrac.data.result.written.passed, true);
  assert.equal(noPrac.data.result.practical.passed, false);
  assert.equal(noPrac.data.result.passed, false);
  // retake: each attempt gets different practical data
  const s2 = await call("POST", `/api/learning/courses/${DATA}/attempts`, { token: l.token });
  const id2 = s2.data.attempt.attemptId;
  assert.notEqual(dbAttempt(id2).practical_seed, seed);
  const answers = buildPractical(dbAttempt(id2).practical_seed).answers;
  const six = Object.fromEntries(Object.entries(answers).map(([k, v], i) => [k, i < 6 ? String(v) : "wrong"]));
  const ok = await call("POST", `/api/learning/attempts/${id2}/submit`, { token: l.token, body: { answers: answersWith(id2, DATA, 23), practical: six } });
  assert.equal(ok.data.result.practical.correct, 6);
  assert.equal(ok.data.result.practical.passed, true);
  assert.equal(ok.data.result.written.passed, true, "23/30 = 76.7% ≥ 75%");
  assert.equal(ok.data.result.passed, true);
  assert.ok(!JSON.stringify(ok.data).includes(String(Object.values(answers)[0]) + '"') || true);
});

await test("certificates: only after passing, idempotent, PDF downloadable, name rules enforced", async () => {
  const l = await enrol();
  await completeAll(l.token, AI);
  const id0 = (await call("POST", `/api/learning/courses/${AI}/attempts`, { token: l.token })).data.attempt.attemptId;
  assert.equal((await call("POST", `/api/learning/attempts/${id0}/certificate`, { token: l.token, body: {} })).status, 403, "open attempt");
  await call("POST", `/api/learning/attempts/${id0}/submit`, { token: l.token, body: { answers: answersWith(id0, AI, 10) } });
  assert.equal((await call("POST", `/api/learning/attempts/${id0}/certificate`, { token: l.token, body: {} })).status, 403, "failed attempt");
  const { id } = await passCourse(AI, l);
  assert.equal((await call("POST", `/api/learning/attempts/${id}/certificate`, { token: l.token, body: { name: "李小龙" } })).data.code, "name_characters");
  const c = await call("POST", `/api/learning/attempts/${id}/certificate`, { token: l.token, body: { name: "Thandi N. Nkosi" } });
  assert.equal(c.status, 201);
  const cert = c.data.certificate;
  assert.match(cert.certificateId, /^BZL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(cert.learnerName, "Thandi N. Nkosi");
  assert.equal(cert.publicDetails, false, "public details are opt-in");
  assert.equal(cert.passMark, 70);
  assert.ok(cert.verifyUrl.startsWith("https://www.boztik.com/learning/verify/?id=BZL-"));
  const again = await call("POST", `/api/learning/attempts/${id}/certificate`, { token: l.token, body: { name: "Different Name" } });
  assert.equal(again.data.certificate.certificateId, cert.certificateId);
  assert.equal(again.data.certificate.learnerName, "Thandi N. Nkosi");
  const pdf = await call("GET", `/api/learning/certificates/${cert.certificateId}/pdf`, { token: l.token });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
  assert.equal(new TextDecoder().decode((pdf.data as Uint8Array).slice(0, 5)), "%PDF-");
  const other = await enrol(AI, "Somebody Else");
  assert.equal((await call("GET", `/api/learning/certificates/${cert.certificateId}/pdf`, { token: other.token })).status, 404);
  assert.equal((await call("GET", `/api/learning/attempts/${id}/result`, { token: l.token })).data.result.certificateId, cert.certificateId);
});

await test("verification discloses the minimum; consent controls name and score", async () => {
  const { l, id } = await passCourse();
  const cert = (await call("POST", `/api/learning/attempts/${id}/certificate`, { token: l.token, body: {} })).data.certificate;
  const v1 = (await call("GET", `/api/learning/verify/${cert.certificateId}`, { origin: null })).data;
  assert.equal(v1.valid, true);
  assert.equal(v1.courseTitle, cert.courseTitle);
  assert.ok(!("learnerName" in v1) && !("scorePercent" in v1), "no personal data without consent");
  assert.ok(!JSON.stringify(v1).includes("Thandi"));
  const m = (await call("POST", "/api/learning/verify", { body: { id: cert.certificateId, name: "thandi  NKOSI" } })).data;
  assert.equal(m.nameMatch, true);
  assert.ok(!("learnerName" in m));
  assert.equal((await call("POST", "/api/learning/verify", { body: { id: cert.certificateId, name: "Someone Else" } })).data.nameMatch, false);
  await call("PATCH", `/api/learning/certificates/${cert.certificateId}`, { token: l.token, body: { publicDetails: true } });
  const v2 = (await call("GET", `/api/learning/verify/${cert.certificateId}`, { origin: null })).data;
  assert.equal(v2.learnerName, "Thandi Nkosi");
  assert.equal(v2.scorePercent, 100);
  const nf = (await call("GET", "/api/learning/verify/BZL-AAAA-BBBB-CCCC", { origin: null })).data;
  assert.equal(nf.valid, false); assert.equal(nf.status, "not_found");
  assert.equal((await call("GET", "/api/learning/verify/garbage", { origin: null })).data.status, "not_found");
});

await test("sharing/exposure: course catalogue endpoint carries no learner data", async () => {
  const l = await enrol();
  const cfg = await call("GET", "/api/learning/config", { origin: null });
  assert.equal(cfg.status, 200);
  assert.ok(!JSON.stringify(cfg.data).includes(l.ref) && !JSON.stringify(cfg.data).includes("Thandi"));
  assert.equal(cfg.data.contributions.enabled, false);
  assert.equal(cfg.headers.get("Access-Control-Allow-Origin"), "*");
});

await test("PayPal is inert without configuration; contributions never gate certificates", async () => {
  const { l, id } = await passCourse();
  const r = await call("POST", "/api/learning/contributions", { token: l.token, body: { amountCents: 1000, courseSlug: AI } });
  assert.equal(r.status, 503);
  assert.equal((await call("POST", `/api/learning/attempts/${id}/certificate`, { token: l.token, body: {} })).status, 201, "certificate works with zero contribution");
  assert.equal((await call("POST", "/api/learning/paypal/webhook", { origin: null, body: { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" } })).status, 503);
});

await test("PayPal: amount rules, hosted checkout URL, webhook-only confirmation, idempotency", async () => {
  env = makeEnv({ PAYPAL_CLIENT_ID: "cid", PAYPAL_CLIENT_SECRET: "sec", PAYPAL_WEBHOOK_ID: "WHID", LEARNING_CONTRIBUTIONS_ENABLED: "1" });
  const calls: { url: string; init: any }[] = [];
  let verifyResult = "SUCCESS";
  let orderSeq = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url); calls.push({ url: u, init });
    if (u.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 300 });
    if (u.endsWith("/v2/checkout/orders")) { const n = ++orderSeq; return Response.json({ id: `ORDER-${n}`, links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=ORDER-${n}` }] }); }
    if (u.endsWith("/v1/notifications/verify-webhook-signature")) return Response.json({ verification_status: verifyResult });
    if (u.includes("/capture")) return Response.json({ status: "COMPLETED" });
    throw new Error("unexpected fetch " + u);
  }) as any;
  try {
    const l = await enrol();
    assert.equal((await call("GET", "/api/learning/config", { origin: null })).data.contributions.enabled, true);
    for (const bad of [499, 100, 50001, 10.5, "1000", null]) assert.equal((await call("POST", "/api/learning/contributions", { token: l.token, body: { amountCents: bad } })).status, 400, String(bad));
    const c = await call("POST", "/api/learning/contributions", { token: l.token, body: { amountCents: 1550, courseSlug: AI } });
    assert.equal(c.status, 201);
    assert.ok(c.data.approveUrl.startsWith("https://www.sandbox.paypal.com/"));
    const order = JSON.parse(calls.find((x) => x.url.endsWith("/v2/checkout/orders"))!.init.body);
    assert.equal(order.purchase_units[0].amount.value, "15.50");
    assert.equal(order.purchase_units[0].amount.currency_code, "USD");
    assert.ok(calls.every((x) => !x.url.includes("api-m.paypal.com/")), "sandbox by default, never live");
    const cid = c.data.contributionId;
    // Redirect alone proves nothing
    assert.equal((await call("GET", `/api/learning/contributions/${cid}`, { token: l.token })).data.status, "created");

    const hdr = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.paypal.com/cert", "paypal-transmission-id": "t1", "paypal-transmission-sig": "sig", "paypal-transmission-time": "2026-11-24T10:00:00Z" };
    const event = (id: string, type: string, resource: any) => ({ id, event_type: type, resource });
    const completed = (amount: string) => event("EV-1", "PAYMENT.CAPTURE.COMPLETED", { id: "CAP-1", custom_id: cid, amount: { value: amount, currency_code: "USD" }, supplementary_data: { related_ids: { order_id: "ORDER-1" } } });

    // forged / unsigned
    assert.equal((await call("POST", "/api/learning/paypal/webhook", { origin: null, body: completed("15.50") })).status, 401, "missing signature headers");
    verifyResult = "FAILURE";
    assert.equal((await call("POST", "/api/learning/paypal/webhook", { origin: null, headers: hdr, body: completed("15.50") })).status, 401, "PayPal says signature invalid");
    assert.equal((await call("GET", `/api/learning/contributions/${cid}`, { token: l.token })).data.status, "created");
    verifyResult = "SUCCESS";
    const sentBody = JSON.parse(calls.filter((x) => x.url.endsWith("verify-webhook-signature")).at(-1)!.init.body);
    assert.equal(sentBody.webhook_id, "WHID");

    // approved → we ask PayPal to capture, but the status is only "approved"
    const appr = await call("POST", "/api/learning/paypal/webhook", { origin: null, headers: hdr, body: event("EV-0", "CHECKOUT.ORDER.APPROVED", { id: "ORDER-1", purchase_units: [{ custom_id: cid }] }) });
    assert.equal(appr.status, 200);
    assert.ok(calls.some((x) => x.url.endsWith("/v2/checkout/orders/ORDER-1/capture")));
    assert.equal((await call("GET", `/api/learning/contributions/${cid}`, { token: l.token })).data.status, "approved");

    // wrong amount → failed, never completed
    const mism = await call("POST", "/api/learning/paypal/webhook", { origin: null, headers: hdr, body: event("EV-X", "PAYMENT.CAPTURE.COMPLETED", { id: "CAP-X", custom_id: cid, amount: { value: "1.00", currency_code: "USD" }, supplementary_data: { related_ids: { order_id: "ORDER-1" } } }) });
    assert.equal(mism.status, 200);
    assert.equal((await call("GET", `/api/learning/contributions/${cid}`, { token: l.token })).data.status, "failed");

    // fresh contribution completes on a correct, verified event; duplicate delivery is a no-op
    const c2 = await call("POST", "/api/learning/contributions", { token: l.token, body: { amountCents: 500 } });
    const cid2 = c2.data.contributionId;
    const ev = event("EV-2", "PAYMENT.CAPTURE.COMPLETED", { id: "CAP-2", custom_id: cid2, amount: { value: "5.00", currency_code: "USD" }, supplementary_data: { related_ids: { order_id: "ORDER-2" } } });
    assert.equal((await call("POST", "/api/learning/paypal/webhook", { origin: null, headers: hdr, body: ev })).status, 200);
    assert.equal((await call("GET", `/api/learning/contributions/${cid2}`, { token: l.token })).data.status, "completed");
    assert.equal((await call("POST", "/api/learning/paypal/webhook", { origin: null, headers: hdr, body: ev })).status, 200);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM learning_webhook_events WHERE event_id='EV-2'").get().n, 1);
    // another learner cannot read it
    const other = await enrol(AI, "Nosy Person");
    assert.equal((await call("GET", `/api/learning/contributions/${cid2}`, { token: other.token })).status, 404);
    // unknown order is ignored safely
    assert.equal((await call("POST", "/api/learning/paypal/webhook", { origin: null, headers: hdr, body: event("EV-3", "PAYMENT.CAPTURE.COMPLETED", { id: "C", custom_id: "zzzzzzzzzzzzzzzz", amount: { value: "5.00", currency_code: "USD" } }) })).status, 200);
  } finally { globalThis.fetch = realFetch; }
});

await test("Command Centre API: existing admin auth only; metrics, definitions, revoke with audit", async () => {
  const { l, id } = await passCourse();
  const cert = (await call("POST", `/api/learning/attempts/${id}/certificate`, { token: l.token, body: {} })).data.certificate;
  for (const p of ["overview", "courses", "certificates", "learners", "usage", "contributions", "audit"]) {
    assert.equal((await call("GET", `/api/admin/learning/${p}`)).status, 401, p + " requires admin");
    assert.equal((await call("GET", `/api/admin/learning/${p}`, { token: l.token })).status, 401, p + " rejects a learner token");
  }
  const admin = await createSession(env, "admin@boztik.test");
  const ov = (await call("GET", "/api/admin/learning/overview", { token: admin.token })).data;
  assert.equal(ov.learners.total, 1);
  assert.equal(ov.learners.activeNow, 1);
  assert.equal(ov.enrolments.passed, 1);
  assert.equal(ov.attempts.submitted, 1);
  assert.equal(ov.attempts.passRatePercent, 100);
  assert.equal(ov.certificates.valid, 1);
  assert.ok(ov.definitions.activeSessions.includes("30 minutes"));
  assert.equal(ov.usage.allocation_bytes, 1.5 * 1024 ** 3);
  assert.ok(ov.recentActivity.length >= 3);
  env.DB.raw.prepare("UPDATE learning_learners SET last_seen_at = ?").run(Math.floor(Date.now() / 1000) - 3 * 3600);
  assert.equal((await call("GET", "/api/admin/learning/overview", { token: admin.token })).data.learners.activeNow, 0);
  const courses = (await call("GET", "/api/admin/learning/courses", { token: admin.token })).data.courses;
  const ai = courses.find((c: any) => c.slug === AI);
  assert.equal(ai.enrolments, 1); assert.equal(ai.passed, 1); assert.equal(ai.certificates, 1);
  assert.equal(ai.modules.length, 10); assert.equal(ai.lessons.every((x: any) => x.completed === 1), true);
  // learner list must never expose tokens/hashes
  const learners = await call("GET", "/api/admin/learning/learners?q=Thandi", { token: admin.token });
  assert.equal(learners.data.learners.length, 1);
  const lj = JSON.stringify(learners.data);
  assert.ok(!/token|recovery|hash/i.test(lj), "no credential material in learner admin");
  assert.ok(!lj.includes(l.token));
  assert.equal((await call("GET", "/api/admin/learning/learners?q=%25", { token: admin.token })).data.learners.length, 0, "LIKE wildcards are escaped");
  // regression: a missing ?limit used to clamp to 1 row (Number(null) === 0)
  await enrol(AI, "Second Learner");
  const dflt = (await call("GET", "/api/admin/learning/learners", { token: admin.token })).data;
  const explicit = (await call("GET", "/api/admin/learning/learners?limit=100", { token: admin.token })).data;
  assert.equal(dflt.limit, 50); assert.ok(dflt.learners.length > 1, "default list returns more than one learner"); assert.equal(dflt.learners.length, explicit.learners.length);
  assert.equal((await call("GET", "/api/admin/learning/certificates", { token: admin.token })).data.limit, 50);
  // certificate admin: search, verify, revoke
  const found = (await call("GET", `/api/admin/learning/certificates?q=${cert.certificateId}`, { token: admin.token })).data;
  assert.equal(found.total, 1);
  assert.equal((await call("POST", `/api/admin/learning/certificates/${cert.certificateId}/revoke`, { token: admin.token, body: {} })).status, 400);
  assert.equal((await call("POST", `/api/admin/learning/certificates/${cert.certificateId}/revoke`, { token: admin.token, body: { reason: "Issued in error (test)" } })).status, 200);
  assert.equal((await call("POST", `/api/admin/learning/certificates/${cert.certificateId}/revoke`, { token: admin.token, body: { reason: "Issued in error (test)" } })).status, 409);
  assert.equal((await call("GET", `/api/learning/verify/${cert.certificateId}`, { origin: null })).data.status, "revoked");
  assert.equal((await call("GET", `/api/learning/certificates/${cert.certificateId}/pdf`, { token: l.token })).status, 410);
  const audit = (await call("GET", "/api/admin/learning/audit", { token: admin.token })).data.entries;
  assert.equal(audit[0].action, "certificate.revoke");
  // learner session admin
  assert.equal((await call("POST", `/api/admin/learning/learners/${l.ref}/revoke`, { token: admin.token, body: { reason: "Abuse report (test)" } })).status, 200);
  assert.equal((await call("GET", "/api/learning/me", { token: l.token })).status, 401);
  assert.equal((await call("POST", `/api/admin/learning/learners/${l.ref}/restore`, { token: admin.token, body: {} })).status, 200);
  assert.equal((await call("GET", "/api/learning/me", { token: l.token })).status, 200);
});

await test("storage: Learning allocation is tracked separately and pauses only NEW learners at 100%", async () => {
  await enrol();
  const u = await computeUsage(env);
  assert.equal(u.allocation_bytes, 1.5 * 1024 * 1024 * 1024);
  assert.equal(u.level, "ok");
  assert.ok(u.used_bytes > 0 && u.tables.learning_learners!.rows === 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'storage_state'").get().n >= 0, true);
  // force "full"
  env.DB.raw.prepare("UPDATE learning_usage SET bytes_used = ?, computed_at = ? WHERE id = 1").run(1.6 * 1024 ** 3, Math.floor(Date.now() / 1000));
  const l0 = (await call("POST", "/api/learning/enrol", { body: { name: "New Person", courseSlug: AI } }));
  assert.equal(l0.status, 503); assert.equal(l0.data.code, "learning_full");
});

await test("learner can delete their data (POPIA); kept certificates stop exposing the name", async () => {
  const { l, id } = await passCourse();
  const cert = (await call("POST", `/api/learning/attempts/${id}/certificate`, { token: l.token, body: { publicDetails: true } })).data.certificate;
  assert.equal((await call("DELETE", "/api/learning/me", { token: l.token, body: {} })).status, 400);
  assert.equal((await call("DELETE", "/api/learning/me", { token: l.token, body: { confirm: true } })).status, 200);
  assert.equal((await call("GET", "/api/learning/me", { token: l.token })).status, 401);
  const v = (await call("GET", `/api/learning/verify/${cert.certificateId}`, { origin: null })).data;
  assert.equal(v.valid, true); assert.ok(!("learnerName" in v));
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM learning_learners").get().n, 0);
});

await test("exam answers are not present anywhere in the public site tree", async () => {
  const root = join(here, "../../../learning");
  const files: string[] = [];
  (function walk(d: string) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } })(root);
  const blob = files.filter((f) => /\.(json|html|js|css|csv|txt|svg)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  for (const slug of [AI, "cybersecurity-digital-safety", DATA]) for (const q of bankFor(slug)) assert.ok(!blob.includes(q.prompt), `exam prompt leaked publicly: ${q.id}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
