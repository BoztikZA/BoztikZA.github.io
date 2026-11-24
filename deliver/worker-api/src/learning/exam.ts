// Boztik Learning Hub — server-side assessments.
// Questions, correct answers and option order live ONLY here / in D1. A browser receives question text and the
// shuffled option strings for an in-progress attempt, and later a percentage breakdown — never the answer key.
import type { Env } from "../types";
import { HttpError } from "../types";
import { ATTEMPT_TIME_LIMIT_SEC, MAX_SUBMITTED_ATTEMPTS_PER_DAY, getCourse, newRowId, nowSec, randomCode, type Learner } from "./core";
import { buildPractical, markPractical } from "./practical-data";
import type { CourseRules, ExamQuestion } from "./types";

// Static imports keep the banks inside the Worker bundle (no dynamic import, no public URL).
import * as aiExam from "./exams/practical-ai-productivity";
import * as cyberExam from "./exams/cybersecurity-digital-safety";
import * as dataExam from "./exams/data-analysis-spreadsheets";

const BANKS: Record<string, ExamQuestion[]> = {
  "practical-ai-productivity": aiExam.questions,
  "cybersecurity-digital-safety": cyberExam.questions,
  "data-analysis-spreadsheets": dataExam.questions,
};
export function bankFor(slug: string): ExamQuestion[] {
  const bank = BANKS[slug];
  if (!bank) throw new HttpError(404, "exam_not_found", "This course has no assessment yet.");
  return bank;
}

// ---------------------------------------------------------------------------
// Seeded shuffle (deterministic given the stored seed, so a refresh shows the same order)
// ---------------------------------------------------------------------------
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

interface AttemptRow {
  id: string; learner_id: string; course_slug: string; status: "in_progress" | "submitted" | "expired";
  seed: string; question_order: string; option_orders: string; started_at: number; expires_at: number;
  submitted_at: number | null; written_correct: number | null; written_total: number | null; written_percent: number | null;
  module_breakdown: string | null; practical_seed: string | null; practical_correct: number | null; practical_total: number | null;
  practical_percent: number | null; practical_detail: string | null; passed: number | null;
}

export interface AttemptView {
  attemptId: string;
  courseSlug: string;
  startedAt: number;
  expiresAt: number;
  passMark: number;
  practicalPassMark: number | null;
  questions: { id: string; kind: ExamQuestion["kind"]; prompt: string; options: string[]; multi: boolean }[];
  practical: null | { csv: string; tasks: { id: string; kind: string; prompt: string; hint: string }[] };
}

async function lessonsRemaining(env: Env, learnerId: string, course: CourseRules): Promise<number> {
  const done = await env.DB.prepare("SELECT lesson_id FROM learning_progress WHERE learner_id = ? AND course_slug = ?")
    .bind(learnerId, course.slug).all<{ lesson_id: string }>();
  // Only ids that still exist in the course count (a lesson removed later must not unlock early or block forever).
  const valid = new Set(course.lessonIds);
  const n = (done.results ?? []).filter((r) => valid.has(r.lesson_id)).length;
  return course.lessonIds.length - n;
}

function viewOf(row: AttemptRow, course: CourseRules): AttemptView {
  const bank = new Map(bankFor(course.slug).map((q) => [q.id, q]));
  const order = JSON.parse(row.question_order) as string[];
  const optionOrders = JSON.parse(row.option_orders) as Record<string, number[]>;
  const questions = order.map((id) => {
    const q = bank.get(id)!;
    const perm = optionOrders[id] ?? q.options.map((_, i) => i);
    return { id, kind: q.kind, prompt: q.prompt, options: perm.map((i) => q.options[i]!), multi: q.correct.length > 1 };
  });
  let practical: AttemptView["practical"] = null;
  if (row.practical_seed) {
    const p = buildPractical(row.practical_seed);
    practical = { csv: p.csv, tasks: p.tasks.map((t) => ({ id: t.id, kind: t.kind, prompt: t.prompt, hint: t.hint })) };
  }
  return {
    attemptId: row.id, courseSlug: course.slug, startedAt: row.started_at, expiresAt: row.expires_at,
    passMark: course.passMark, practicalPassMark: course.practicalPassMark, questions, practical,
  };
}

export async function startAttempt(env: Env, learner: Learner, slug: string): Promise<AttemptView> {
  const course = getCourse(slug);
  const bank = bankFor(slug);
  const enrol = await env.DB.prepare("SELECT 1 AS x FROM learning_enrolments WHERE learner_id = ? AND course_slug = ?")
    .bind(learner.id, slug).first();
  if (!enrol) throw new HttpError(409, "not_enrolled", "Enrol in this course first.");
  const remaining = await lessonsRemaining(env, learner.id, course);
  if (remaining > 0) {
    throw new HttpError(409, "lessons_incomplete", `Finish the remaining ${remaining} lesson${remaining === 1 ? "" : "s"} to unlock the assessment.`, { remaining });
  }
  const now = nowSec();
  // Resume an open attempt rather than creating a second one.
  const open = await env.DB.prepare("SELECT * FROM learning_attempts WHERE learner_id = ? AND course_slug = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1")
    .bind(learner.id, slug).first<AttemptRow>();
  if (open) {
    if (open.expires_at + 15 * 60 > now) return viewOf(open, course);
    await env.DB.prepare("UPDATE learning_attempts SET status = 'expired' WHERE id = ? AND status = 'in_progress'").bind(open.id).run();
  }
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM learning_attempts WHERE learner_id = ? AND course_slug = ? AND started_at > ? AND status <> 'expired'")
    .bind(learner.id, slug, now - 86400).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_SUBMITTED_ATTEMPTS_PER_DAY) {
    throw new HttpError(429, "attempt_limit", "You have used today's attempts for this course. Review the lessons and try again tomorrow.", { retry_after: 3600 });
  }
  const seed = randomCode(20);
  const rand = mulberry32(fnv1a(seed));
  const order = shuffled(bank.map((q) => q.id), rand);
  const optionOrders: Record<string, number[]> = {};
  for (const q of bank) {
    const idx = q.options.map((_, i) => i);
    optionOrders[q.id] = q.kind === "truefalse" ? idx : shuffled(idx, rand); // True/False keep their natural order
  }
  const practicalSeed = course.practicalPassMark != null ? randomCode(14) : null;
  const id = newRowId();
  await env.DB.prepare(
    `INSERT INTO learning_attempts (id, learner_id, course_slug, status, seed, question_order, option_orders, started_at, expires_at, practical_seed)
     VALUES (?1, ?2, ?3, 'in_progress', ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(id, learner.id, slug, seed, JSON.stringify(order), JSON.stringify(optionOrders), now, now + ATTEMPT_TIME_LIMIT_SEC, practicalSeed).run();
  const row = await env.DB.prepare("SELECT * FROM learning_attempts WHERE id = ?").bind(id).first<AttemptRow>();
  return viewOf(row!, course);
}

export async function getOpenAttempt(env: Env, learner: Learner, attemptId: string): Promise<AttemptView> {
  const row = await ownedAttempt(env, learner, attemptId);
  if (row.status !== "in_progress") throw new HttpError(409, "attempt_closed", "This attempt has already been submitted.");
  if (row.expires_at + 15 * 60 <= nowSec()) throw new HttpError(410, "attempt_expired", "This attempt timed out. Start a new one.");
  return viewOf(row, getCourse(row.course_slug));
}

async function ownedAttempt(env: Env, learner: Learner, attemptId: string): Promise<AttemptRow> {
  if (typeof attemptId !== "string" || !/^[a-z0-9]{16}$/.test(attemptId)) throw new HttpError(404, "attempt_not_found", "Attempt not found.");
  const row = await env.DB.prepare("SELECT * FROM learning_attempts WHERE id = ? AND learner_id = ?").bind(attemptId, learner.id).first<AttemptRow>();
  if (!row) throw new HttpError(404, "attempt_not_found", "Attempt not found.");
  return row;
}

// ---------------------------------------------------------------------------
// Marking
// ---------------------------------------------------------------------------
export interface AttemptResult {
  attemptId: string;
  courseSlug: string;
  passed: boolean;
  written: { correct: number; total: number; percent: number; passMark: number; passed: boolean };
  modules: Record<string, { correct: number; total: number; percent: number }>;
  practical: null | { correct: number; total: number; percent: number; passMark: number; passed: boolean; perTask: Record<string, boolean> };
  submittedAt: number;
  certificateId: string | null;
}

function parseAnswers(raw: unknown, valid: Map<string, number>): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (raw == null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "invalid_answers", "Answers must be an object.");
  for (const [qid, v] of Object.entries(raw as Record<string, unknown>)) {
    const optionCount = valid.get(qid);
    if (optionCount === undefined) throw new HttpError(400, "invalid_answers", "Unknown question in submission.");
    if (!Array.isArray(v) || v.length > optionCount) throw new HttpError(400, "invalid_answers", "Invalid answer format.");
    const picks = new Set<number>();
    for (const n of v) {
      if (!Number.isInteger(n) || (n as number) < 0 || (n as number) >= optionCount) throw new HttpError(400, "invalid_answers", "Invalid answer format.");
      picks.add(n as number);
    }
    out.set(qid, [...picks]);
  }
  return out;
}

export async function submitAttempt(env: Env, learner: Learner, attemptId: string, body: Record<string, unknown>): Promise<AttemptResult> {
  const row = await ownedAttempt(env, learner, attemptId);
  const course = getCourse(row.course_slug);
  if (row.status === "submitted") throw new HttpError(409, "attempt_closed", "This attempt has already been submitted.");
  const now = nowSec();
  if (row.status === "expired" || row.expires_at + 15 * 60 <= now) {
    await env.DB.prepare("UPDATE learning_attempts SET status = 'expired' WHERE id = ? AND status = 'in_progress'").bind(row.id).run();
    throw new HttpError(410, "attempt_expired", "This attempt timed out. Start a new one.");
  }
  const bank = bankFor(course.slug);
  const byId = new Map(bank.map((q) => [q.id, q]));
  const order = JSON.parse(row.question_order) as string[];
  const optionOrders = JSON.parse(row.option_orders) as Record<string, number[]>;
  const optionCounts = new Map(order.map((id) => [id, byId.get(id)!.options.length]));
  const answers = parseAnswers(body.answers, optionCounts);

  const modules: AttemptResult["modules"] = {};
  for (const m of course.moduleIds) modules[m] = { correct: 0, total: 0, percent: 0 };
  let correct = 0;
  for (const id of order) {
    const q = byId.get(id)!;
    const perm = optionOrders[id] ?? q.options.map((_, i) => i);
    const picked = new Set((answers.get(id) ?? []).map((displayed) => perm[displayed]!)); // displayed index → original index
    const want = new Set(q.correct);
    const ok = picked.size === want.size && [...picked].every((i) => want.has(i));
    const m = modules[q.module] ?? (modules[q.module] = { correct: 0, total: 0, percent: 0 });
    m.total++;
    if (ok) { correct++; m.correct++; }
  }
  for (const m of Object.values(modules)) m.percent = m.total ? Math.round((m.correct / m.total) * 100) : 0;
  const total = order.length;
  const writtenPassed = correct * 100 >= course.passMark * total;
  const roundedPct = Math.round((correct / total) * 100);
  const writtenPercent = writtenPassed ? roundedPct : Math.min(roundedPct, course.passMark - 1);

  let practical: AttemptResult["practical"] = null;
  if (course.practicalPassMark != null && row.practical_seed) {
    const submitted = body.practical && typeof body.practical === "object" && !Array.isArray(body.practical) ? (body.practical as Record<string, unknown>) : {};
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(submitted)) {
      if (!/^p\d{1,2}$/.test(k)) continue;
      if (typeof v === "string") clean[k] = v.slice(0, 80);
      else if (typeof v === "number" && Number.isFinite(v)) clean[k] = v;
    }
    const r = markPractical(row.practical_seed, clean);
    const pPassed = r.correct * 100 >= course.practicalPassMark * r.total;
    const pRounded = r.percent;
    practical = {
      correct: r.correct, total: r.total, percent: pPassed ? pRounded : Math.min(pRounded, course.practicalPassMark - 1),
      passMark: course.practicalPassMark, passed: pPassed, perTask: r.perTask,
    };
  }
  const passed = writtenPassed && (practical ? practical.passed : true);

  // Atomic close: only one concurrent submission can flip in_progress → submitted.
  const res = await env.DB.prepare(
    `UPDATE learning_attempts SET status = 'submitted', submitted_at = ?2, written_correct = ?3, written_total = ?4, written_percent = ?5,
       module_breakdown = ?6, practical_correct = ?7, practical_total = ?8, practical_percent = ?9, practical_detail = ?10, passed = ?11
     WHERE id = ?1 AND status = 'in_progress'`,
  ).bind(row.id, now, correct, total, writtenPercent, JSON.stringify(modules),
    practical?.correct ?? null, practical?.total ?? null, practical?.percent ?? null, practical ? JSON.stringify(practical.perTask) : null, passed ? 1 : 0).run();
  if (!res.meta || res.meta.changes !== 1) throw new HttpError(409, "attempt_closed", "This attempt has already been submitted.");

  await env.DB.prepare("UPDATE learning_enrolments SET last_activity_at = ?3, completed_at = CASE WHEN ?4 = 1 AND completed_at IS NULL THEN ?3 ELSE completed_at END WHERE learner_id = ?1 AND course_slug = ?2")
    .bind(learner.id, course.slug, now, passed ? 1 : 0).run();

  return {
    attemptId: row.id, courseSlug: course.slug, passed,
    written: { correct, total, percent: writtenPercent, passMark: course.passMark, passed: writtenPassed },
    modules, practical, submittedAt: now, certificateId: null,
  };
}

export async function getResult(env: Env, learner: Learner, attemptId: string): Promise<AttemptResult> {
  const row = await ownedAttempt(env, learner, attemptId);
  if (row.status !== "submitted") throw new HttpError(409, "attempt_open", "This attempt has not been submitted yet.");
  const course = getCourse(row.course_slug);
  const cert = await env.DB.prepare("SELECT certificate_id FROM learning_certificates WHERE attempt_id = ?").bind(row.id).first<{ certificate_id: string }>();
  const pPassed = course.practicalPassMark != null && row.practical_correct != null && row.practical_total
    ? row.practical_correct * 100 >= course.practicalPassMark * row.practical_total : false;
  return {
    attemptId: row.id, courseSlug: course.slug, passed: row.passed === 1,
    written: {
      correct: row.written_correct ?? 0, total: row.written_total ?? 0, percent: row.written_percent ?? 0, passMark: course.passMark,
      passed: (row.written_correct ?? 0) * 100 >= course.passMark * (row.written_total ?? 1),
    },
    modules: row.module_breakdown ? JSON.parse(row.module_breakdown) : {},
    practical: course.practicalPassMark != null && row.practical_total != null
      ? { correct: row.practical_correct ?? 0, total: row.practical_total, percent: row.practical_percent ?? 0, passMark: course.practicalPassMark, passed: pPassed, perTask: row.practical_detail ? JSON.parse(row.practical_detail) : {} }
      : null,
    submittedAt: row.submitted_at ?? 0, certificateId: cert?.certificate_id ?? null,
  };
}

export async function listAttempts(env: Env, learner: Learner, slug: string): Promise<{ attemptId: string; status: string; startedAt: number; submittedAt: number | null; writtenPercent: number | null; practicalPercent: number | null; passed: boolean | null }[]> {
  getCourse(slug);
  const rows = await env.DB.prepare("SELECT id, status, started_at, submitted_at, written_percent, practical_percent, passed FROM learning_attempts WHERE learner_id = ? AND course_slug = ? AND status <> 'expired' ORDER BY started_at DESC LIMIT 20")
    .bind(learner.id, slug).all<{ id: string; status: string; started_at: number; submitted_at: number | null; written_percent: number | null; practical_percent: number | null; passed: number | null }>();
  return (rows.results ?? []).map((r) => ({
    attemptId: r.id, status: r.status, startedAt: r.started_at, submittedAt: r.submitted_at,
    writtenPercent: r.written_percent, practicalPercent: r.practical_percent, passed: r.passed == null ? null : r.passed === 1,
  }));
}
