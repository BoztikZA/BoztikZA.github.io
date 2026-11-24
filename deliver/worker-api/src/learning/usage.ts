// Boztik Learning Hub — usage accounting for the SEPARATE 1.5 GiB Learning allocation.
// The Learning Hub stores only D1 rows (no R2 objects: certificate PDFs are rendered on demand). The existing
// 3 GiB delivery allocation (lib/storage.ts) is not read or modified by anything here.
//
// D1 does not expose per-table sizes, so this is an ESTIMATE: stored text bytes + a fixed per-row overhead,
// times an index factor. It errs on the high side so warnings arrive early.
import type { Env } from "../types";
import { HttpError } from "../types";
import { levelFor, type StorageLevel } from "../lib/storage";
import { LEARNING_ALLOCATION_BYTES, nowSec } from "./core";

const ROW_OVERHEAD = 64;
const INDEX_FACTOR = 1.5;
const STALE_AFTER_SEC = 10 * 60;

const TABLES: { name: string; textCols: string[] }[] = [
  { name: "learning_learners", textCols: ["id", "public_ref", "token_hash", "recovery_hash", "name", "email", "country"] },
  { name: "learning_enrolments", textCols: ["learner_id", "course_slug", "last_lesson_id"] },
  { name: "learning_progress", textCols: ["learner_id", "course_slug", "lesson_id"] },
  { name: "learning_attempts", textCols: ["id", "learner_id", "course_slug", "seed", "question_order", "option_orders", "module_breakdown", "practical_seed", "practical_detail"] },
  { name: "learning_certificates", textCols: ["id", "certificate_id", "learner_id", "course_slug", "attempt_id", "learner_name", "course_title", "revoked_reason"] },
  { name: "learning_contributions", textCols: ["id", "learner_id", "course_slug", "paypal_order_id", "status"] },
  { name: "learning_webhook_events", textCols: ["event_id", "event_type"] },
  { name: "learning_audit", textCols: ["actor", "action", "target", "detail"] },
];

export interface LearningUsage {
  allocation_bytes: number;
  used_bytes: number;
  remaining_bytes: number;
  used_percent: number;
  level: StorageLevel;
  full: boolean;
  computed_at: string | null;
  tables: Record<string, { rows: number; bytes: number }>;
  note: string;
}

export async function computeUsage(env: Env): Promise<LearningUsage> {
  const tables: LearningUsage["tables"] = {};
  let total = 0;
  for (const t of TABLES) {
    const sumExpr = t.textCols.map((c) => `COALESCE(LENGTH(${c}),0)`).join("+");
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(${sumExpr}),0) AS b FROM ${t.name}`).first<{ n: number; b: number }>();
    const rows = row?.n ?? 0;
    const bytes = Math.round(((row?.b ?? 0) + rows * ROW_OVERHEAD) * INDEX_FACTOR);
    tables[t.name] = { rows, bytes };
    total += bytes;
  }
  const now = nowSec();
  await env.DB.prepare("INSERT INTO learning_usage (id, bytes_used, breakdown, computed_at) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET bytes_used = ?1, breakdown = ?2, computed_at = ?3")
    .bind(total, JSON.stringify(tables), now).run();
  return shape(total, tables, now);
}

function shape(used: number, tables: LearningUsage["tables"], computedAt: number | null): LearningUsage {
  const percent = (used / LEARNING_ALLOCATION_BYTES) * 100;
  return {
    allocation_bytes: LEARNING_ALLOCATION_BYTES, used_bytes: used, remaining_bytes: Math.max(0, LEARNING_ALLOCATION_BYTES - used),
    used_percent: Math.round(percent * 100) / 100, level: levelFor(percent), full: percent >= 100,
    computed_at: computedAt ? new Date(computedAt * 1000).toISOString() : null, tables,
    note: "Estimate of Learning Hub data in D1 (text size + row overhead + indexes). Separate from the 3 GiB delivery allocation.",
  };
}

/** Cached read; recomputes when older than 10 minutes (or when force=true). */
export async function getUsage(env: Env, force = false): Promise<LearningUsage> {
  const row = await env.DB.prepare("SELECT bytes_used, breakdown, computed_at FROM learning_usage WHERE id = 1").first<{ bytes_used: number; breakdown: string | null; computed_at: number }>();
  if (!force && row && row.computed_at && nowSec() - row.computed_at < STALE_AFTER_SEC && row.breakdown) {
    return shape(row.bytes_used, JSON.parse(row.breakdown), row.computed_at);
  }
  return computeUsage(env);
}

/** New learners are paused only at 100 % of the Learning allocation; existing learners, exams and certificates keep working. */
export async function assertCapacityForNewLearner(env: Env): Promise<void> {
  const u = await getUsage(env);
  if (u.full) throw new HttpError(503, "learning_full", "Boztik Learning is temporarily not accepting new learners. Please try again later.");
}
