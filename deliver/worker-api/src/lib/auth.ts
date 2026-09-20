import type { Env } from "../types";
import { AuthError, HttpError } from "../types";
import { bytesToHex, hexToBytes, newSessionTokenRaw, sha256Hex, timingSafeEqual } from "./ids";

const nowSec = () => Math.floor(Date.now() / 1000);

/** Workers cap WebCrypto PBKDF2 at 100k iterations. */
export const MAX_PBKDF2_ITERATIONS = 100_000;
const MIN_PBKDF2_ITERATIONS = 10_000;

/** Verifies a password against `pbkdf2$<iterations>$<saltHex>$<dkHex>`
 *  (PBKDF2-HMAC-SHA256). Always performs the derivation when the hash is
 *  well-formed and compares in constant time. */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = (encodedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    console.error("ADMIN_PASSWORD_HASH is missing or malformed (expected pbkdf2$iterations$saltHex$hashHex)");
    return false;
  }
  const iterations = Number(parts[1]);
  const saltHex = parts[2] ?? "";
  const expected = parts[3] ?? "";
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
    console.error(`ADMIN_PASSWORD_HASH iterations must be ${MIN_PBKDF2_ITERATIONS}-${MAX_PBKDF2_ITERATIONS} (Workers limit). Regenerate with scripts/hash-password.mjs`);
    return false;
  }
  if (!/^[0-9a-f]+$/i.test(saltHex) || saltHex.length % 2 !== 0 || !/^[0-9a-f]{64}$/i.test(expected)) {
    console.error("ADMIN_PASSWORD_HASH salt/digest is not valid hex");
    return false;
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations },
    key,
    256,
  );
  return timingSafeEqual(bytesToHex(new Uint8Array(bits)), expected.toLowerCase());
}

/** A well-formed hash whose password nobody knows; used so that a wrong
 *  username costs the same PBKDF2 time as a wrong password. */
const DECOY_HASH = `pbkdf2$100000$${"00".repeat(16)}$${"00".repeat(32)}`;

export function requireSecrets(env: Env): void {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH || !env.AUTH_TOKEN_SALT || env.AUTH_TOKEN_SALT.length < 32) {
    console.error("Missing/weak secrets: ADMIN_USERNAME, ADMIN_PASSWORD_HASH and AUTH_TOKEN_SALT (>=32 chars) are required");
    throw new HttpError(503, "not_configured", "The Deliver API is not fully configured.");
  }
}

export async function authenticate(env: Env, username: string, password: string): Promise<boolean> {
  requireSecrets(env);
  const userOk = timingSafeEqual(username, env.ADMIN_USERNAME);
  const passOk = await verifyPassword(password, userOk ? env.ADMIN_PASSWORD_HASH : DECOY_HASH);
  return userOk && passOk;
}

export const sessionTokenHash = (token: string, salt: string): Promise<string> => sha256Hex(`session:${salt}:${token}`);

export async function createSession(env: Env, email: string): Promise<{ token: string; email: string; expires_at: number }> {
  const raw = newSessionTokenRaw();
  const hash = await sessionTokenHash(raw, env.AUTH_TOKEN_SALT);
  const hours = Math.min(72, Math.max(1, Number(env.SESSION_HOURS || 12)));
  const created = nowSec();
  const expiresAt = created + hours * 3600;
  await env.DB.batch([
    // Housekeeping: drop dead sessions and cap concurrent sessions at 10.
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ? OR revoked = 1").bind(created),
    env.DB.prepare(
      `DELETE FROM sessions WHERE token_hash IN (
         SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT -1 OFFSET 8)`,
    ),
    env.DB.prepare("INSERT INTO sessions (token_hash, email, created_at, expires_at, revoked) VALUES (?, ?, ?, ?, 0)")
      .bind(hash, email, created, expiresAt),
  ]);
  return { token: raw, email, expires_at: expiresAt };
}

export function bearerToken(request: Request): string {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/** Returns the verified admin email or throws AuthError. */
export async function requireSession(request: Request, env: Env): Promise<string> {
  const email = await optionalSession(request, env);
  if (!email) throw new AuthError("Authentication required");
  return email;
}

/** Like requireSession but returns null instead of throwing (used by the public
 *  view endpoint to honour an admin's `preview` flag). */
export async function optionalSession(request: Request, env: Env): Promise<string | null> {
  const token = bearerToken(request);
  if (!token || token.length > 128 || !env.AUTH_TOKEN_SALT) return null;
  const hash = await sessionTokenHash(token, env.AUTH_TOKEN_SALT);
  const row = await env.DB.prepare("SELECT email, expires_at, revoked FROM sessions WHERE token_hash = ? LIMIT 1")
    .bind(hash)
    .first<{ email: string; expires_at: number; revoked: number }>();
  if (!row || row.revoked !== 0 || row.expires_at <= nowSec()) return null;
  return row.email;
}

export async function revokeSession(request: Request, env: Env): Promise<void> {
  const token = bearerToken(request);
  if (!token || !env.AUTH_TOKEN_SALT) return;
  const hash = await sessionTokenHash(token, env.AUTH_TOKEN_SALT);
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
}

// ---------------------------------------------------------------------------
// Persistent failed-login throttle (D1, so it holds across isolates).
// ---------------------------------------------------------------------------
const THROTTLE_WINDOW = 15 * 60;

export async function assertLoginAllowed(env: Env, ip: string): Promise<void> {
  const max = Math.max(1, Number(env.LOGIN_MAX_FAILURES || 8));
  const row = await env.DB.prepare("SELECT window_start, failures FROM auth_throttle WHERE key = ?")
    .bind(`ip:${ip}`)
    .first<{ window_start: number; failures: number }>();
  if (row && nowSec() - row.window_start < THROTTLE_WINDOW && row.failures >= max) {
    const retry = Math.max(1, THROTTLE_WINDOW - (nowSec() - row.window_start));
    throw new HttpError(429, "too_many_attempts", "Too many failed sign-in attempts. Try again later.", { retry_after: retry });
  }
}

export async function recordLoginFailure(env: Env, ip: string): Promise<void> {
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO auth_throttle (key, window_start, failures) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       failures = CASE WHEN ?2 - window_start >= ${THROTTLE_WINDOW} THEN 1 ELSE failures + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ${THROTTLE_WINDOW} THEN ?2 ELSE window_start END`,
  ).bind(`ip:${ip}`, now).run();
}

export async function clearLoginFailures(env: Env, ip: string): Promise<void> {
  await env.DB.prepare("DELETE FROM auth_throttle WHERE key = ?").bind(`ip:${ip}`).run();
}

// ---------------------------------------------------------------------------
// Best-effort per-isolate limiter for PUBLIC routes only (abuse damping — never
// a security boundary; the storage cap and auth do not depend on it).
// ---------------------------------------------------------------------------
interface Bucket { windowStart: number; count: number }
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

export function rateLimit(key: string, limitPerMinute: number): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.windowStart + WINDOW_MS < now) {
    b = { windowStart: now, count: 0 };
    buckets.set(key, b);
  }
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) if (v.windowStart + WINDOW_MS < now) buckets.delete(k);
  }
  b.count += 1;
  return b.count <= limitPerMinute;
}
