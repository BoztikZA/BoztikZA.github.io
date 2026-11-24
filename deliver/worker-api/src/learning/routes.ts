// Boztik Learning Hub — learner-facing API. Mounted at /api/learning/* (see src/index.ts).
//   Authentication: the learner's private link token, sent as `Authorization: Bearer <token>`. No cookies.
import type { Env } from "../types";
import { HttpError } from "../types";
import { assertSameSiteOrigin, checkPublicRate, clientIp, error, json, readJson, requireJson, segments, wrap } from "../routes/util";
import {
  createLearner, getCourse, listCourses, nowSec, recoverLearner, requireLearner, throttleCount, type Learner,
} from "./core";
import { getOpenAttempt, getResult, listAttempts, startAttempt, submitAttempt } from "./exam";
import { certificatePdf, claimCertificate, listCertificates, setCertificateConsent, verifyCertificate } from "./certificates";
import { contributionStatus, createContribution, handlePaypalWebhook, publicContributionConfig } from "./paypal";
import { assertCapacityForNewLearner } from "./usage";

const LESSON_ID_RE = /^m\d{2}-l\d{2}$/;

async function enrol(env: Env, learnerId: string, slug: string): Promise<void> {
  const now = nowSec();
  await env.DB.prepare("INSERT OR IGNORE INTO learning_enrolments (learner_id, course_slug, enrolled_at, last_activity_at) VALUES (?, ?, ?, ?)")
    .bind(learnerId, slug, now, now).run();
}

async function courseProgress(env: Env, learner: Learner, slug: string) {
  const course = getCourse(slug);
  const en = await env.DB.prepare("SELECT enrolled_at, last_activity_at, last_lesson_id, completed_at FROM learning_enrolments WHERE learner_id = ? AND course_slug = ?")
    .bind(learner.id, slug).first<{ enrolled_at: number; last_activity_at: number; last_lesson_id: string | null; completed_at: number | null }>();
  if (!en) return { enrolled: false as const, courseSlug: slug };
  const done = await env.DB.prepare("SELECT lesson_id FROM learning_progress WHERE learner_id = ? AND course_slug = ? ORDER BY completed_at")
    .bind(learner.id, slug).all<{ lesson_id: string }>();
  const valid = new Set(course.lessonIds);
  const completed = (done.results ?? []).map((r) => r.lesson_id).filter((id) => valid.has(id));
  const attempts = await listAttempts(env, learner, slug);
  const certs = (await listCertificates(env, learner)).filter((c) => c.courseSlug === slug);
  return {
    enrolled: true as const,
    courseSlug: slug,
    enrolledAt: en.enrolled_at,
    lastActivityAt: en.last_activity_at,
    lastLessonId: en.last_lesson_id && valid.has(en.last_lesson_id) ? en.last_lesson_id : null,
    completedLessons: completed,
    lessonsTotal: course.lessonIds.length,
    percent: Math.round((completed.length / course.lessonIds.length) * 100),
    assessmentUnlocked: completed.length >= course.lessonIds.length,
    passed: en.completed_at != null,
    completedAt: en.completed_at,
    attempts,
    certificates: certs.filter((c) => !c.revoked).map((c) => c.certificateId),
  };
}

export async function handleLearning(request: Request, path: string, env: Env): Promise<Response> {
  return wrap(async () => {
    const seg = segments(path);
    const method = request.method;
    const ip = clientIp(request);
    const [a, b, c, d] = seg;

    // ---------------------------------------------------------------- unauthenticated
    if (a === "config" && method === "GET") {
      checkPublicRate(request, env, "learn-cfg");
      return json({
        ok: true,
        contributions: publicContributionConfig(env),
        courses: listCourses().map((x) => ({ slug: x.slug, title: x.title, category: x.category, passMark: x.passMark, practicalPassMark: x.practicalPassMark, questionCount: x.questionCount, lessonCount: x.lessonIds.length })),
      });
    }

    if (a === "paypal" && b === "webhook" && method === "POST") {
      checkPublicRate(request, env, "learn-pp", 2);
      await handlePaypalWebhook(env, request);
      return json({ ok: true });
    }

    if (a === "verify" && method === "GET" && b) {
      checkPublicRate(request, env, "learn-verify", 0.5);
      return json({ ok: true, ...(await verifyCertificate(env, b)) });
    }
    if (a === "verify" && !b && method === "POST") {
      assertSameSiteOrigin(request, env); requireJson(request);
      checkPublicRate(request, env, "learn-verify", 0.5);
      const body = await readJson(request, 2048);
      return json({ ok: true, ...(await verifyCertificate(env, body.id, body.name)) });
    }

    if (a === "enrol" && !b && method === "POST") {
      assertSameSiteOrigin(request, env); requireJson(request);
      checkPublicRate(request, env, "learn-enrol", 0.25);
      await throttleCount(env, `enrol:${ip}`, 12, 60 * 60);
      const body = await readJson(request, 4096);
      const course = getCourse(body.courseSlug);
      await assertCapacityForNewLearner(env);
      const created = await createLearner(env, body);
      await enrol(env, created.id, course.slug);
      const { id: _internalId, ...publicPart } = created; // the internal row id is never sent to the browser
      return json({ ok: true, ...publicPart, courseSlug: course.slug }, 201);
    }

    if (a === "recover" && !b && method === "POST") {
      assertSameSiteOrigin(request, env); requireJson(request);
      checkPublicRate(request, env, "learn-recover", 0.25);
      const body = await readJson(request, 1024);
      return json({ ok: true, ...(await recoverLearner(env, ip, body.ref, body.code)) });
    }

    // ---------------------------------------------------------------- authenticated learner
    if (!a) return error("Not found", 404);
    checkPublicRate(request, env, "learn-api", 2);
    const learner = await requireLearner(request, env, ip);
    const mutating = method !== "GET" && method !== "HEAD";
    if (mutating) assertSameSiteOrigin(request, env);

    if (a === "me" && !b && method === "GET") {
      const rows = await env.DB.prepare("SELECT course_slug FROM learning_enrolments WHERE learner_id = ? ORDER BY enrolled_at").bind(learner.id).all<{ course_slug: string }>();
      const courses = [];
      for (const r of rows.results ?? []) courses.push(await courseProgress(env, learner, r.course_slug));
      return json({
        ok: true,
        learner: { ref: learner.public_ref, name: learner.name, email: learner.email, country: learner.country, createdAt: learner.created_at },
        courses,
        certificates: await listCertificates(env, learner),
      });
    }

    if (a === "me" && !b && method === "DELETE") {
      requireJson(request);
      const body = await readJson(request, 512);
      if (body.confirm !== true) throw new HttpError(400, "confirmation_required", "Send {\"confirm\": true} to delete your session and data.");
      const alsoCerts = body.alsoDeleteCertificates === true;
      await env.DB.batch([
        env.DB.prepare("DELETE FROM learning_progress WHERE learner_id = ?").bind(learner.id),
        env.DB.prepare("DELETE FROM learning_enrolments WHERE learner_id = ?").bind(learner.id),
        env.DB.prepare("DELETE FROM learning_attempts WHERE learner_id = ?").bind(learner.id),
        env.DB.prepare("UPDATE learning_contributions SET learner_id = NULL WHERE learner_id = ?").bind(learner.id),
        alsoCerts
          ? env.DB.prepare("DELETE FROM learning_certificates WHERE learner_id = ?").bind(learner.id)
          // Kept certificates stay verifiable by ID; make sure they stop exposing the name publicly.
          : env.DB.prepare("UPDATE learning_certificates SET public_details = 0 WHERE learner_id = ?").bind(learner.id),
        env.DB.prepare("DELETE FROM learning_learners WHERE id = ?").bind(learner.id),
      ]);
      return json({ ok: true, deleted: true, certificatesDeleted: alsoCerts });
    }

    if (a === "courses" && b) {
      const course = getCourse(b);
      if (!c && method === "GET") return json({ ok: true, ...(await courseProgress(env, learner, course.slug)) });
      if (c === "enrol" && !d && method === "POST") {
        await enrol(env, learner.id, course.slug);
        return json({ ok: true, ...(await courseProgress(env, learner, course.slug)) });
      }
      if (c === "lessons" && d && method === "POST") {
        const action = seg[4];
        if (!LESSON_ID_RE.test(d) || !course.lessonIds.includes(d)) throw new HttpError(404, "lesson_not_found", "Lesson not found.");
        const now = nowSec();
        const en = await env.DB.prepare("SELECT 1 AS x FROM learning_enrolments WHERE learner_id = ? AND course_slug = ?").bind(learner.id, course.slug).first();
        if (!en) throw new HttpError(409, "not_enrolled", "Enrol in this course first.");
        if (action === "complete") {
          await env.DB.batch([
            env.DB.prepare("INSERT OR IGNORE INTO learning_progress (learner_id, course_slug, lesson_id, completed_at) VALUES (?, ?, ?, ?)").bind(learner.id, course.slug, d, now),
            env.DB.prepare("UPDATE learning_enrolments SET last_activity_at = ?3, last_lesson_id = ?4 WHERE learner_id = ?1 AND course_slug = ?2").bind(learner.id, course.slug, now, d),
          ]);
        } else if (action === "visit") {
          await env.DB.prepare("UPDATE learning_enrolments SET last_activity_at = ?3, last_lesson_id = ?4 WHERE learner_id = ?1 AND course_slug = ?2").bind(learner.id, course.slug, now, d).run();
        } else throw new HttpError(404, "not_found", "Not found.");
        return json({ ok: true, ...(await courseProgress(env, learner, course.slug)) });
      }
      if (c === "attempts" && !d && method === "POST") {
        return json({ ok: true, attempt: await startAttempt(env, learner, course.slug) });
      }
    }

    if (a === "attempts" && b) {
      if (!c && method === "GET") return json({ ok: true, attempt: await getOpenAttempt(env, learner, b) });
      if (c === "submit" && method === "POST") {
        requireJson(request);
        const body = await readJson(request, 64 * 1024);
        return json({ ok: true, result: await submitAttempt(env, learner, b, body) });
      }
      if (c === "result" && method === "GET") return json({ ok: true, result: await getResult(env, learner, b) });
      if (c === "certificate" && method === "POST") {
        requireJson(request);
        const body = await readJson(request, 2048);
        return json({ ok: true, certificate: await claimCertificate(env, learner, b, body) }, 201);
      }
    }

    if (a === "certificates") {
      if (!b && method === "GET") return json({ ok: true, certificates: await listCertificates(env, learner) });
      if (b && c === "pdf" && method === "GET") {
        const { bytes, filename } = await certificatePdf(env, learner, b);
        return new Response(bytes, { status: 200, headers: {
          "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        } });
      }
      if (b && !c && method === "PATCH") {
        requireJson(request);
        const body = await readJson(request, 512);
        return json({ ok: true, certificate: await setCertificateConsent(env, learner, b, body.publicDetails) });
      }
    }

    if (a === "contributions") {
      if (!b && method === "POST") {
        requireJson(request);
        const body = await readJson(request, 1024);
        return json({ ok: true, ...(await createContribution(env, learner, body)) }, 201);
      }
      if (b && method === "GET") return json({ ok: true, ...(await contributionStatus(env, learner, b)) });
    }

    return error("Not found", 404);
  });
}
