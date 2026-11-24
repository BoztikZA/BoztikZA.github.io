// Boztik Learning Hub — certificate issuing, download and public verification.
import type { Env } from "../types";
import { HttpError } from "../types";
import { CERT_ID_RE, cleanName, getCourse, newCertificateId, newRowId, nowSec, type Learner } from "./core";
import { renderCertificatePdf } from "./certificate-pdf";

interface CertRow {
  id: string; certificate_id: string; learner_id: string; course_slug: string; attempt_id: string; learner_name: string;
  course_title: string; score_percent: number; practical_percent: number | null; pass_mark: number; issued_at: number;
  public_details: number; revoked_at: number | null; revoked_reason: string | null; download_count: number; verify_count: number;
}

export const siteOrigin = (env: Env): string => (env.LEARNING_SITE_ORIGIN || "https://www.boztik.com").replace(/\/$/, "");
export const verifyUrlFor = (env: Env, certificateId: string): string => `${siteOrigin(env)}/learning/verify/?id=${certificateId}`;

export interface CertificateSummary {
  certificateId: string; courseSlug: string; courseTitle: string; learnerName: string; scorePercent: number;
  practicalPercent: number | null; passMark: number; issuedAt: number; publicDetails: boolean; revoked: boolean; verifyUrl: string;
}
function summary(env: Env, r: CertRow): CertificateSummary {
  return {
    certificateId: r.certificate_id, courseSlug: r.course_slug, courseTitle: r.course_title, learnerName: r.learner_name,
    scorePercent: r.score_percent, practicalPercent: r.practical_percent, passMark: r.pass_mark, issuedAt: r.issued_at,
    publicDetails: r.public_details === 1, revoked: r.revoked_at != null, verifyUrl: verifyUrlFor(env, r.certificate_id),
  };
}

/** Issues the certificate for a PASSED attempt that belongs to this learner. Idempotent per attempt. Never requires payment. */
export async function claimCertificate(env: Env, learner: Learner, attemptId: unknown, body: { name?: unknown; publicDetails?: unknown }): Promise<CertificateSummary> {
  if (typeof attemptId !== "string" || !/^[a-z0-9]{16}$/.test(attemptId)) throw new HttpError(404, "attempt_not_found", "Attempt not found.");
  const attempt = await env.DB.prepare("SELECT id, course_slug, status, passed, written_percent, practical_percent FROM learning_attempts WHERE id = ? AND learner_id = ?")
    .bind(attemptId, learner.id).first<{ id: string; course_slug: string; status: string; passed: number | null; written_percent: number | null; practical_percent: number | null }>();
  if (!attempt) throw new HttpError(404, "attempt_not_found", "Attempt not found.");
  if (attempt.status !== "submitted" || attempt.passed !== 1) throw new HttpError(403, "not_passed", "A certificate is issued only when the assessment has been passed.");
  const existing = await env.DB.prepare("SELECT * FROM learning_certificates WHERE attempt_id = ?").bind(attempt.id).first<CertRow>();
  if (existing) return summary(env, existing);

  const course = getCourse(attempt.course_slug);
  const name = body.name === undefined || body.name === "" ? cleanName(learner.name) : cleanName(body.name);
  const consent = body.publicDetails === true ? 1 : 0; // opt-in only
  const now = nowSec();
  for (let i = 0; i < 3; i++) {
    const certificateId = newCertificateId();
    try {
      await env.DB.prepare(
        `INSERT INTO learning_certificates (id, certificate_id, learner_id, course_slug, attempt_id, learner_name, course_title, score_percent, practical_percent, pass_mark, issued_at, public_details)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      ).bind(newRowId(), certificateId, learner.id, course.slug, attempt.id, name, course.title, attempt.written_percent ?? 0, attempt.practical_percent, course.passMark, now, consent).run();
      break;
    } catch (e) {
      // Concurrent claim for the same attempt → return the winner; id collision → retry.
      const again = await env.DB.prepare("SELECT * FROM learning_certificates WHERE attempt_id = ?").bind(attempt.id).first<CertRow>();
      if (again) return summary(env, again);
      if (i === 2 || !/UNIQUE/i.test(String((e as Error).message))) throw e;
    }
  }
  const row = await env.DB.prepare("SELECT * FROM learning_certificates WHERE attempt_id = ?").bind(attempt.id).first<CertRow>();
  return summary(env, row!);
}

export async function listCertificates(env: Env, learner: Learner): Promise<CertificateSummary[]> {
  const rows = await env.DB.prepare("SELECT * FROM learning_certificates WHERE learner_id = ? ORDER BY issued_at DESC").bind(learner.id).all<CertRow>();
  return (rows.results ?? []).map((r) => summary(env, r));
}

async function ownedCertificate(env: Env, learner: Learner, certificateId: string): Promise<CertRow> {
  if (!CERT_ID_RE.test(certificateId)) throw new HttpError(404, "certificate_not_found", "Certificate not found.");
  const row = await env.DB.prepare("SELECT * FROM learning_certificates WHERE certificate_id = ? AND learner_id = ?").bind(certificateId, learner.id).first<CertRow>();
  if (!row) throw new HttpError(404, "certificate_not_found", "Certificate not found.");
  return row;
}

export async function setCertificateConsent(env: Env, learner: Learner, certificateId: string, publicDetails: unknown): Promise<CertificateSummary> {
  const row = await ownedCertificate(env, learner, certificateId);
  if (typeof publicDetails !== "boolean") throw new HttpError(400, "invalid_body", "publicDetails must be true or false.");
  await env.DB.prepare("UPDATE learning_certificates SET public_details = ? WHERE id = ?").bind(publicDetails ? 1 : 0, row.id).run();
  return summary(env, { ...row, public_details: publicDetails ? 1 : 0 });
}

export async function certificatePdf(env: Env, learner: Learner, certificateId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const row = await ownedCertificate(env, learner, certificateId);
  if (row.revoked_at) throw new HttpError(410, "certificate_revoked", "This certificate has been revoked.");
  const course = getCourse(row.course_slug);
  const bytes = await renderCertificatePdf({
    certificateId: row.certificate_id, learnerName: row.learner_name, courseTitle: row.course_title, issuedAt: row.issued_at,
    scorePercent: row.score_percent, passMark: row.pass_mark, practicalPercent: row.practical_percent, practicalPassMark: course.practicalPassMark,
    verifyUrl: verifyUrlFor(env, row.certificate_id),
  });
  await env.DB.prepare("UPDATE learning_certificates SET download_count = download_count + 1 WHERE id = ?").bind(row.id).run();
  return { bytes, filename: `Boztik-Learning-Certificate-${row.certificate_id}.pdf` };
}

// ---------------------------------------------------------------------------
// Public verification — minimal disclosure.
//   Always:        validity, course title, completion date.
//   With consent:  learner name and score (the learner ticks "show my details" — default is OFF).
//   Without it:    a verifier who already holds the certificate can type the printed name to CONFIRM it matches;
//                  the page never reveals a name it was not given.
// ---------------------------------------------------------------------------
const normName = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

export interface Verification {
  valid: boolean;
  status: "valid" | "revoked" | "not_found";
  certificateId: string;
  courseTitle?: string;
  completedOn?: number;
  passMark?: number;
  learnerName?: string;
  scorePercent?: number;
  detailsShared?: boolean;
  nameMatch?: boolean;
}

export async function verifyCertificate(env: Env, id: unknown, claimedName?: unknown): Promise<Verification> {
  const certificateId = typeof id === "string" ? id.trim().toUpperCase() : "";
  if (!CERT_ID_RE.test(certificateId)) return { valid: false, status: "not_found", certificateId: certificateId.slice(0, 20) };
  const row = await env.DB.prepare("SELECT * FROM learning_certificates WHERE certificate_id = ?").bind(certificateId).first<CertRow>();
  if (!row) return { valid: false, status: "not_found", certificateId };
  await env.DB.prepare("UPDATE learning_certificates SET verify_count = verify_count + 1 WHERE id = ?").bind(row.id).run();
  const revoked = row.revoked_at != null;
  const out: Verification = {
    valid: !revoked, status: revoked ? "revoked" : "valid", certificateId, courseTitle: row.course_title, completedOn: row.issued_at,
    passMark: row.pass_mark, detailsShared: row.public_details === 1,
  };
  if (revoked) return { valid: false, status: "revoked", certificateId, courseTitle: row.course_title, detailsShared: false };
  if (row.public_details === 1) { out.learnerName = row.learner_name; out.scorePercent = row.score_percent; }
  else if (typeof claimedName === "string" && claimedName.trim()) out.nameMatch = normName(claimedName) !== "" && normName(claimedName) === normName(row.learner_name);
  return out;
}
