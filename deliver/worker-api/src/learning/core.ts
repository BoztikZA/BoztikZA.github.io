// Boztik Learning Hub — shared constants, id helpers, input validation, persistent throttle and learner sessions.
import type { Env } from "../types";
import { HttpError } from "../types";
import { sha256Hex, timingSafeEqual, newSessionTokenRaw } from "../lib/ids";
import { COURSE_RULES } from "./manifest.generated";
import type { CourseRules } from "./types";

export const nowSec = (): number => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
/** Separate Learning allocation: 1.5 GiB (the existing delivery allocation of 3 GiB is untouched). */
export const LEARNING_ALLOCATION_BYTES = 1.5 * 1024 * 1024 * 1024;
/** A learner counts as an "active session" when their private link was used within this window. */
export const ACTIVE_SESSION_WINDOW_SEC = 30 * 60;
export const ATTEMPT_TIME_LIMIT_SEC = 3 * 60 * 60;
/** Submitted attempts allowed per learner per course in any rolling 24 h. Retakes are welcome; this only stops bank-farming. */
export const MAX_SUBMITTED_ATTEMPTS_PER_DAY = 6;
export const MIN_CONTRIBUTION_CENTS = 500;
export const MAX_CONTRIBUTION_CENTS = 50_000;
export const PRESET_CONTRIBUTIONS_CENTS = [500, 1000, 1500, 2000] as const;

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------
export const listCourses = (): CourseRules[] => COURSE_RULES;
export function getCourse(slug: unknown): CourseRules {
  const c = typeof slug === "string" ? COURSE_RULES.find((x) => x.slug === slug) : undefined;
  if (!c) throw new HttpError(404, "course_not_found", "That course does not exist.");
  return c;
}

// ---------------------------------------------------------------------------
// Ids (same unambiguous alphabet as the rest of the Worker)
// ---------------------------------------------------------------------------
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 symbols → unbiased mod on a byte
export function randomCode(length: number): string {
  const v = crypto.getRandomValues(new Uint8Array(length));
  return [...v].map((b) => ALPHABET[b % 32]).join("");
}
export const newRowId = (): string => randomCode(16).toLowerCase();
export const newPublicRef = (): string => `LN-${randomCode(8)}`;
/** Certificate ids: BZL-XXXX-XXXX-XXXX (12 symbols ≈ 60 bits; unguessable enough that enumeration is impractical). */
export const newCertificateId = (): string => `BZL-${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
export const newRecoveryCode = (): string => `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`; // 80 bits
export const CERT_ID_RE = /^BZL-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
export const PUBLIC_REF_RE = /^LN-[2-9A-HJ-NP-Z]{8}$/;

function salt(env: Env): string {
  if (!env.AUTH_TOKEN_SALT) throw new HttpError(503, "learning_unavailable", "The Learning Hub is not configured yet.");
  return env.AUTH_TOKEN_SALT;
}
export const hashLearnerToken = (env: Env, token: string): Promise<string> => sha256Hex(`learn-token:${salt(env)}:${token}`);
export const hashRecoveryCode = (env: Env, code: string): Promise<string> =>
  sha256Hex(`learn-recovery:${salt(env)}:${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}`);

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
// The certificate PDF uses a standard font (WinAnsi), so names are limited to characters it can print.
// Latin letters incl. accents are fine; the error message tells the learner exactly what to do.
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'’-]*$/;
export function cleanName(input: unknown): string {
  if (typeof input !== "string") throw new HttpError(400, "name_required", "Please enter your full name.");
  const name = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new HttpError(400, "name_required", "Please enter your full name.");
  if (name.length > 80) throw new HttpError(400, "name_too_long", "Names can be up to 80 characters.");
  if (!NAME_RE.test(name)) {
    throw new HttpError(400, "name_characters", "Please use letters A–Z (accents are fine), spaces, hyphens, apostrophes and full stops, so your certificate prints correctly.");
  }
  return name;
}
export function cleanEmail(input: unknown): string | null {
  if (input == null || input === "") return null;
  if (typeof input !== "string") throw new HttpError(400, "email_invalid", "That email address does not look right.");
  const e = input.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(e)) throw new HttpError(400, "email_invalid", "That email address does not look right.");
  return e;
}
export function cleanCountry(input: unknown): string | null {
  if (input == null || input === "") return null;
  if (typeof input !== "string") throw new HttpError(400, "country_invalid", "Country should be text.");
  const c = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (c.length > 60 || /[<>\u0000-\u001f]/.test(c)) throw new HttpError(400, "country_invalid", "That country does not look right.");
  return c || null;
}

// ---------------------------------------------------------------------------
// Persistent throttle (reuses the existing auth_throttle table with a "learn:" key prefix, so it holds across isolates)
// ---------------------------------------------------------------------------
export async function throttleCheck(env: Env, key: string, max: number, windowSec: number): Promise<void> {
  const row = await env.DB.prepare("SELECT window_start, failures FROM auth_throttle WHERE key = ?")
    .bind(`learn:${key}`).first<{ window_start: number; failures: number }>();
  if (row && nowSec() - row.window_start < windowSec && row.failures >= max) {
    throw new HttpError(429, "too_many_attempts", "Too many attempts. Please wait a little and try again.", { retry_after: Math.max(1, windowSec - (nowSec() - row.window_start)) });
  }
}
export async function throttleHit(env: Env, key: string, windowSec: number): Promise<void> {
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO auth_throttle (key, window_start, failures) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       failures = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE failures + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END`,
  ).bind(`learn:${key}`, now, windowSec).run();
}
/** Counts the call, then enforces the limit (use for actions where every call should count, e.g. enrolment). */
export async function throttleCount(env: Env, key: string, max: number, windowSec: number): Promise<void> {
  await throttleCheck(env, key, max, windowSec);
  await throttleHit(env, key, windowSec);
}

// ---------------------------------------------------------------------------
// Learner sessions
// ---------------------------------------------------------------------------
export interface Learner {
  id: string;
  public_ref: string;
  name: string;
  email: string | null;
  country: string | null;
  created_at: number;
  last_seen_at: number;
}

const BAD_TOKEN_WINDOW = 15 * 60;
const BAD_TOKEN_MAX = 20;

export function learnerTokenFrom(request: Request): string {
  const h = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+([A-Za-z0-9]{40,64})$/.exec(h.trim());
  return m ? m[1]! : "";
}

/** Resolves the private link token to a learner. Unknown tokens are counted per IP so the token space cannot be probed. */
export async function requireLearner(request: Request, env: Env, ip: string): Promise<Learner> {
  await throttleCheck(env, `badtoken:${ip}`, BAD_TOKEN_MAX, BAD_TOKEN_WINDOW);
  const token = learnerTokenFrom(request);
  const fail = async (): Promise<never> => {
    await throttleHit(env, `badtoken:${ip}`, BAD_TOKEN_WINDOW);
    throw new HttpError(401, "invalid_session", "This private link is not valid. If you have your recovery code, use it to get back in.");
  };
  if (!token) return fail();
  const hash = await hashLearnerToken(env, token);
  const row = await env.DB.prepare(
    "SELECT id, public_ref, name, email, country, created_at, last_seen_at, token_hash, revoked_at FROM learning_learners WHERE token_hash = ?",
  ).bind(hash).first<Learner & { token_hash: string; revoked_at: number | null }>();
  if (!row || !timingSafeEqual(row.token_hash, hash) || row.revoked_at) return fail();
  const now = nowSec();
  if (now - row.last_seen_at >= 60) {
    // At most one write a minute per learner. "last_seen_at" drives the Command Centre "active session" definition.
    await env.DB.prepare("UPDATE learning_learners SET last_seen_at = ? WHERE id = ?").bind(now, row.id).run();
    row.last_seen_at = now;
  }
  const { token_hash: _h, revoked_at: _r, ...learner } = row;
  return learner;
}

export interface NewLearnerInput { name?: unknown; email?: unknown; country?: unknown }
export interface CreatedLearner { id: string; token: string; ref: string; recoveryCode: string; name: string }

export async function createLearner(env: Env, input: NewLearnerInput): Promise<CreatedLearner> {
  const name = cleanName(input.name);
  const email = cleanEmail(input.email);
  const country = cleanCountry(input.country);
  const token = newSessionTokenRaw();
  const recoveryCode = newRecoveryCode();
  const now = nowSec();
  // public_ref is random; the UNIQUE index makes a (vanishingly rare) collision fail loudly rather than overwrite.
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = newPublicRef();
    const id = newRowId();
    try {
      await env.DB.prepare(
        `INSERT INTO learning_learners (id, public_ref, token_hash, recovery_hash, name, email, country, created_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
      ).bind(id, ref, await hashLearnerToken(env, token), await hashRecoveryCode(env, recoveryCode), name, email, country, now).run();
      return { id, token, ref, recoveryCode, name };
    } catch (e) {
      if (attempt === 2 || !/UNIQUE/i.test(String((e as Error).message))) throw e;
    }
  }
  throw new HttpError(500, "internal_error", "Could not create the session.");
}

/** Lost link? ref + recovery code issues a NEW private link and invalidates the old one. Heavily rate-limited. */
export async function recoverLearner(env: Env, ip: string, ref: unknown, code: unknown): Promise<{ token: string; ref: string; name: string }> {
  const refStr = typeof ref === "string" ? ref.trim().toUpperCase() : "";
  const codeStr = typeof code === "string" ? code.trim() : "";
  await throttleCheck(env, `recover:ip:${ip}`, 8, 60 * 60);
  if (PUBLIC_REF_RE.test(refStr)) await throttleCheck(env, `recover:ref:${refStr}`, 6, 60 * 60);
  const generic = async (): Promise<never> => {
    await throttleHit(env, `recover:ip:${ip}`, 60 * 60);
    if (PUBLIC_REF_RE.test(refStr)) await throttleHit(env, `recover:ref:${refStr}`, 60 * 60);
    throw new HttpError(400, "recovery_failed", "That reference and recovery code do not match. Check them and try again.");
  };
  if (!PUBLIC_REF_RE.test(refStr) || codeStr.length < 16 || codeStr.length > 32) return generic();
  const row = await env.DB.prepare("SELECT id, name, recovery_hash, revoked_at FROM learning_learners WHERE public_ref = ?")
    .bind(refStr).first<{ id: string; name: string; recovery_hash: string; revoked_at: number | null }>();
  const given = await hashRecoveryCode(env, codeStr);
  if (!row || row.revoked_at || !timingSafeEqual(row.recovery_hash, given)) return generic();
  const token = newSessionTokenRaw();
  await env.DB.prepare("UPDATE learning_learners SET token_hash = ?, last_seen_at = ? WHERE id = ?")
    .bind(await hashLearnerToken(env, token), nowSec(), row.id).run();
  return { token, ref: refStr, name: row.name };
}

export async function audit(env: Env, actor: string, action: string, target: string | null, detail?: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO learning_audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(nowSec(), actor, action, target, detail === undefined ? null : JSON.stringify(detail).slice(0, 1000)).run();
}
