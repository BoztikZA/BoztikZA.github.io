// Boztik Learning Hub — Command Centre API. Mounted at /api/admin/learning/* and protected by the EXISTING admin session
// (Bearer token from /api/auth/login). Learner tokens, recovery codes and their hashes are never selected or returned.
import type { Env } from "../types";
import { HttpError } from "../types";
import { requireSession } from "../lib/auth";
import { error, json, readJson, requireJson, segments, wrap } from "../routes/util";
import { ACTIVE_SESSION_WINDOW_SEC, CERT_ID_RE, PUBLIC_REF_RE, audit, listCourses, nowSec } from "./core";
import { getUsage } from "./usage";
import { paypalConfig } from "./paypal";

/** Plain-language definitions shown next to every number in the Command Centre, so no figure is ambiguous. */
export const DEFINITIONS = {
  learners: "Private learner sessions created (one per person who enrolled). Revoked sessions are not counted.",
  activeSessions: `Learners whose private link was used in the last ${ACTIVE_SESSION_WINDOW_SEC / 60} minutes ("active now").`,
  activeLearners7d: "Learners whose private link was used at least once in the last 7 days.",
  enrolments: "Learner-course pairs. One learner enrolled in two courses counts as two enrolments.",
  started: "Enrolments with at least one lesson completed.",
  lessonsFinished: "Enrolments where every lesson is complete (the assessment is unlocked).",
  attemptsSubmitted: "Assessment attempts that were submitted and marked. Abandoned or expired attempts are excluded.",
  passRate: "Passed attempts divided by submitted attempts. A learner who retakes adds to both sides.",
  coursesPassed: "Enrolments where the learner passed the assessment (a certificate can then be claimed).",
  certificatesIssued: "Certificates claimed by learners after passing. Revoked certificates are counted separately.",
  contributions: "Voluntary PayPal contributions confirmed by a verified webhook. Test (sandbox) payments are listed separately and never counted as income.",
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const clampInt = (v: string | null, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
};

async function one<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T> {
  return (await env.DB.prepare(sql).bind(...binds).first<T>()) as T;
}

async function overview(env: Env) {
  const now = nowSec();
  const d7 = now - 7 * 86400, d30 = now - 30 * 86400;
  const learners = await one<{ total: number; new7: number; new30: number; active_now: number; active7: number; revoked: number }>(env,
    `SELECT SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS total,
            SUM(CASE WHEN revoked_at IS NULL AND created_at >= ?1 THEN 1 ELSE 0 END) AS new7,
            SUM(CASE WHEN revoked_at IS NULL AND created_at >= ?2 THEN 1 ELSE 0 END) AS new30,
            SUM(CASE WHEN revoked_at IS NULL AND last_seen_at >= ?3 THEN 1 ELSE 0 END) AS active_now,
            SUM(CASE WHEN revoked_at IS NULL AND last_seen_at >= ?1 THEN 1 ELSE 0 END) AS active7,
            SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked
       FROM learning_learners`, d7, d30, now - ACTIVE_SESSION_WINDOW_SEC);
  const enrol = await one<{ total: number; passed: number }>(env, "SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS passed FROM learning_enrolments");
  const started = await one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM (SELECT 1 FROM learning_progress GROUP BY learner_id, course_slug)");
  const attempts = await one<{ submitted: number; passed: number; in_progress: number }>(env,
    `SELECT SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted,
            SUM(CASE WHEN status='submitted' AND passed=1 THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress FROM learning_attempts`);
  const certs = await one<{ valid: number; revoked: number; last30: number }>(env,
    `SELECT SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS valid, SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked,
            SUM(CASE WHEN revoked_at IS NULL AND issued_at >= ?1 THEN 1 ELSE 0 END) AS last30 FROM learning_certificates`, d30);
  const contrib = await env.DB.prepare(
    `SELECT paypal_env, status, COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS cents FROM learning_contributions GROUP BY paypal_env, status`,
  ).all<{ paypal_env: string; status: string; n: number; cents: number }>();
  const live = { completed: 0, completedCents: 0, pending: 0, refunded: 0 };
  const sandbox = { completed: 0, completedCents: 0 };
  for (const r of contrib.results ?? []) {
    if (r.paypal_env === "live") {
      if (r.status === "completed") { live.completed = r.n; live.completedCents = r.cents; }
      else if (r.status === "created" || r.status === "approved") live.pending += r.n;
      else if (r.status === "refunded") live.refunded = r.n;
    } else if (r.status === "completed") { sandbox.completed += r.n; sandbox.completedCents += r.cents; }
  }
  const recent = await env.DB.prepare(
    `SELECT * FROM (
       SELECT enrolled_at AS at, 'enrolled' AS kind, course_slug AS course, NULL AS detail FROM learning_enrolments
       UNION ALL SELECT submitted_at, CASE WHEN passed=1 THEN 'passed' ELSE 'attempt_failed' END, course_slug, written_percent || '%' FROM learning_attempts WHERE status='submitted'
       UNION ALL SELECT issued_at, 'certificate_issued', course_slug, certificate_id FROM learning_certificates
     ) ORDER BY at DESC LIMIT 15`,
  ).all<{ at: number; kind: string; course: string; detail: string | null }>();
  const submitted = attempts.submitted ?? 0;
  return {
    learners: { total: learners.total ?? 0, new7d: learners.new7 ?? 0, new30d: learners.new30 ?? 0, activeNow: learners.active_now ?? 0, active7d: learners.active7 ?? 0, revokedSessions: learners.revoked ?? 0 },
    enrolments: { total: enrol.total ?? 0, started: started.n ?? 0, passed: enrol.passed ?? 0 },
    attempts: { submitted, passed: attempts.passed ?? 0, inProgress: attempts.in_progress ?? 0, passRatePercent: submitted ? Math.round(((attempts.passed ?? 0) / submitted) * 100) : null },
    certificates: { valid: certs.valid ?? 0, revoked: certs.revoked ?? 0, issuedLast30d: certs.last30 ?? 0 },
    contributions: { live, sandbox, paypal: { ...(() => { const c = paypalConfig(env); return { enabled: c.enabled, env: c.env, missing: c.missing }; })() } },
    recentActivity: (recent.results ?? []).map((r) => ({ at: r.at, kind: r.kind, course: r.course, detail: r.detail })),
    usage: await getUsage(env),
    definitions: DEFINITIONS,
    generatedAt: now,
  };
}

async function coursesReport(env: Env) {
  const out = [];
  for (const course of listCourses()) {
    const s = course.slug;
    const enrol = await one<{ total: number; passed: number }>(env, "SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS passed FROM learning_enrolments WHERE course_slug = ?", s);
    const lessons = await env.DB.prepare("SELECT lesson_id, COUNT(*) AS n FROM learning_progress WHERE course_slug = ? GROUP BY lesson_id").bind(s).all<{ lesson_id: string; n: number }>();
    const byLesson = new Map((lessons.results ?? []).map((r) => [r.lesson_id, r.n]));
    const learnersWithProgress = await one<{ n: number }>(env, "SELECT COUNT(DISTINCT learner_id) AS n FROM learning_progress WHERE course_slug = ?", s);
    const finished = await one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM (SELECT learner_id FROM learning_progress WHERE course_slug = ? GROUP BY learner_id HAVING COUNT(*) >= ?)", s, course.lessonIds.length);
    const att = await one<{ submitted: number; passed: number; avg: number | null }>(env,
      "SELECT COUNT(*) AS submitted, SUM(CASE WHEN passed=1 THEN 1 ELSE 0 END) AS passed, AVG(written_percent) AS avg FROM learning_attempts WHERE course_slug = ? AND status='submitted'", s);
    const certs = await one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM learning_certificates WHERE course_slug = ? AND revoked_at IS NULL", s);
    // Drop-off: for each module, how many learners completed at least one lesson in it, and the loss vs the previous module.
    const moduleReach = await env.DB.prepare("SELECT substr(lesson_id,1,3) AS module, COUNT(DISTINCT learner_id) AS n FROM learning_progress WHERE course_slug = ? GROUP BY substr(lesson_id,1,3)").bind(s).all<{ module: string; n: number }>();
    const reach = new Map((moduleReach.results ?? []).map((r) => [r.module, r.n]));
    let prev: number | null = null;
    const modules = course.moduleIds.map((m) => {
      const n = reach.get(m) ?? 0;
      const lostPercent = prev && prev > 0 ? Math.round(((prev - n) / prev) * 100) : null;
      prev = n;
      return { module: m, learnersReached: n, lostVsPreviousPercent: lostPercent };
    });
    const worst = modules.filter((m) => m.lostVsPreviousPercent != null && m.lostVsPreviousPercent > 0).sort((x, y) => (y.lostVsPreviousPercent ?? 0) - (x.lostVsPreviousPercent ?? 0))[0] ?? null;
    out.push({
      slug: s, title: course.title, passMark: course.passMark, practicalPassMark: course.practicalPassMark,
      enrolments: enrol.total ?? 0, learnersStarted: learnersWithProgress.n ?? 0, lessonsFinished: finished.n ?? 0, passed: enrol.passed ?? 0,
      attemptsSubmitted: att.submitted ?? 0, attemptsPassed: att.passed ?? 0,
      passRatePercent: att.submitted ? Math.round(((att.passed ?? 0) / att.submitted) * 100) : null,
      averageWrittenPercent: att.avg == null ? null : Math.round(att.avg), certificates: certs.n ?? 0,
      completionRatePercent: enrol.total ? Math.round(((enrol.passed ?? 0) / enrol.total) * 100) : null,
      modules, biggestDropOff: worst,
      lessons: course.lessonIds.map((id) => ({ id, completed: byLesson.get(id) ?? 0 })),
    });
  }
  return out;
}

export async function handleLearningAdmin(request: Request, path: string, env: Env): Promise<Response> {
  return wrap(async () => {
    const admin = await requireSession(request, env);
    const url = new URL(request.url);
    const seg = segments(path);
    const method = request.method;
    const [a, b, c] = seg;

    if (a === "overview" && method === "GET") return json({ ok: true, ...(await overview(env)) });
    if (a === "courses" && method === "GET") return json({ ok: true, courses: await coursesReport(env), definitions: DEFINITIONS });
    if (a === "usage" && method === "GET") return json({ ok: true, usage: await getUsage(env, url.searchParams.get("refresh") === "1") });
    if (a === "audit" && method === "GET") {
      const rows = await env.DB.prepare("SELECT id, at, actor, action, target, detail FROM learning_audit ORDER BY id DESC LIMIT 100").all();
      return json({ ok: true, entries: rows.results ?? [] });
    }

    if (a === "certificates") {
      if (!b && method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
        const status = url.searchParams.get("status");
        const limit = clampInt(url.searchParams.get("limit"), 50, 1, 100);
        const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
        const where: string[] = []; const binds: unknown[] = [];
        if (q) { where.push("(certificate_id LIKE ? ESCAPE '\\' OR learner_name LIKE ? ESCAPE '\\' OR course_title LIKE ? ESCAPE '\\')"); const like = `%${escapeLike(q)}%`; binds.push(like, like, like); }
        if (status === "valid") where.push("revoked_at IS NULL"); else if (status === "revoked") where.push("revoked_at IS NOT NULL");
        const sql = `SELECT certificate_id, learner_name, course_slug, course_title, score_percent, practical_percent, pass_mark, issued_at, public_details, revoked_at, revoked_reason, download_count, verify_count
                       FROM learning_certificates ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY issued_at DESC LIMIT ? OFFSET ?`;
        const rows = await env.DB.prepare(sql).bind(...binds, limit, offset).all();
        const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM learning_certificates ${where.length ? "WHERE " + where.join(" AND ") : ""}`).bind(...binds).first<{ n: number }>();
        return json({ ok: true, total: total?.n ?? 0, limit, offset, certificates: rows.results ?? [] });
      }
      if (b && !c && method === "GET") {
        const id = b.toUpperCase();
        if (!CERT_ID_RE.test(id)) throw new HttpError(404, "certificate_not_found", "Certificate not found.");
        const row = await env.DB.prepare(
          `SELECT certificate_id, learner_name, course_slug, course_title, score_percent, practical_percent, pass_mark, issued_at, public_details, revoked_at, revoked_reason, download_count, verify_count
             FROM learning_certificates WHERE certificate_id = ?`).bind(id).first<Record<string, unknown>>();
        if (!row) throw new HttpError(404, "certificate_not_found", "Certificate not found.");
        return json({ ok: true, certificate: { ...row, status: row.revoked_at ? "revoked" : "valid" } });
      }
      if (b && c === "revoke" && method === "POST") {
        requireJson(request);
        const id = b.toUpperCase();
        if (!CERT_ID_RE.test(id)) throw new HttpError(404, "certificate_not_found", "Certificate not found.");
        const body = await readJson(request, 2048);
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
        if (reason.length < 5) throw new HttpError(400, "reason_required", "Give a reason (at least 5 characters). It is kept in the audit log.");
        const res = await env.DB.prepare("UPDATE learning_certificates SET revoked_at = ?, revoked_reason = ? WHERE certificate_id = ? AND revoked_at IS NULL").bind(nowSec(), reason, id).run();
        if (res.meta?.changes !== 1) throw new HttpError(409, "not_revocable", "Certificate not found or already revoked.");
        await audit(env, admin, "certificate.revoke", id, { reason });
        return json({ ok: true, certificateId: id, status: "revoked" });
      }
    }

    if (a === "learners") {
      if (!b && method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
        const limit = clampInt(url.searchParams.get("limit"), 50, 1, 100);
        const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);
        const like = `%${escapeLike(q)}%`;
        const sql = `SELECT l.public_ref AS ref, l.name, l.email, l.country, l.created_at, l.last_seen_at, l.revoked_at,
                            (SELECT COUNT(*) FROM learning_enrolments e WHERE e.learner_id = l.id) AS enrolments,
                            (SELECT COUNT(*) FROM learning_attempts a WHERE a.learner_id = l.id AND a.status='submitted') AS attempts,
                            (SELECT COUNT(*) FROM learning_certificates c WHERE c.learner_id = l.id AND c.revoked_at IS NULL) AS certificates
                       FROM learning_learners l
                      WHERE (?1 = '' OR l.name LIKE ?2 ESCAPE '\\' OR l.email LIKE ?2 ESCAPE '\\' OR l.public_ref LIKE ?2 ESCAPE '\\')
                      ORDER BY l.last_seen_at DESC LIMIT ?3 OFFSET ?4`;
        const rows = await env.DB.prepare(sql).bind(q, like, limit, offset).all();
        const now = nowSec();
        return json({
          ok: true, limit, offset, activeWindowMinutes: ACTIVE_SESSION_WINDOW_SEC / 60,
          learners: (rows.results ?? []).map((r) => ({ ...r, activeNow: !r.revoked_at && now - (r.last_seen_at as number) < ACTIVE_SESSION_WINDOW_SEC })),
        });
      }
      if (b && (c === "revoke" || c === "restore") && method === "POST") {
        requireJson(request);
        const ref = b.toUpperCase();
        if (!PUBLIC_REF_RE.test(ref)) throw new HttpError(404, "learner_not_found", "Learner not found.");
        const body = await readJson(request, 2048);
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
        if (c === "revoke" && reason.length < 5) throw new HttpError(400, "reason_required", "Give a reason (at least 5 characters). It is kept in the audit log.");
        const res = c === "revoke"
          ? await env.DB.prepare("UPDATE learning_learners SET revoked_at = ? WHERE public_ref = ? AND revoked_at IS NULL").bind(nowSec(), ref).run()
          : await env.DB.prepare("UPDATE learning_learners SET revoked_at = NULL WHERE public_ref = ? AND revoked_at IS NOT NULL").bind(ref).run();
        if (res.meta?.changes !== 1) throw new HttpError(409, "no_change", "Learner not found or already in that state.");
        await audit(env, admin, `learner.${c}`, ref, reason ? { reason } : undefined);
        return json({ ok: true, ref, status: c === "revoke" ? "revoked" : "active" });
      }
    }

    if (a === "contributions" && method === "GET") {
      const rows = await env.DB.prepare("SELECT id, course_slug, amount_cents, currency, paypal_env, status, created_at, completed_at FROM learning_contributions ORDER BY created_at DESC LIMIT 50").all();
      return json({ ok: true, contributions: rows.results ?? [], paypal: (() => { const cfg = paypalConfig(env); return { enabled: cfg.enabled, env: cfg.env, missing: cfg.missing }; })() });
    }

    return error("Not found", 404);
  });
}
