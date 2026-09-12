import type { Env } from "../types";
import { AccessAuthError } from "../types";

interface AccessJwtPayload {
  aud: string | string[];
  email?: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  [key: string]: unknown;
}

// Module-scope cache: Workers reuse an isolate across requests, so this
// avoids re-fetching Access's JWKS on every single admin request. A fresh
// isolate (cold start) just re-fetches once.
let cachedJwks: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(b64url: string): string {
  return new TextDecoder().decode(base64UrlToBytes(b64url));
}

function getCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  const now = Date.now();
  if (cachedJwks && now - cachedJwks.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedJwks.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) {
    throw new AccessAuthError(`Failed to fetch Access JWKS (${res.status})`);
  }
  const data = (await res.json()) as { keys: Jwk[] };
  cachedJwks = { keys: data.keys, fetchedAt: now };
  return data.keys;
}

async function importJwk(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/**
 * Verifies a Cloudflare Access JWT end-to-end and returns the authenticated
 * email on success. Throws AccessAuthError on anything wrong — missing
 * assertion, malformed token, bad signature, expiry, wrong audience, or an
 * email that isn't ADMIN_EMAIL.
 *
 * This is called independently by every /admin/* handler (see
 * routes/admin.ts's `withAdmin` wrapper) and by the reddit-embed route's
 * optional preview check. It never assumes Access already screened the
 * request just because it reached this Worker — see Phase 2 §6.
 */
export async function requireAccessIdentity(request: Request, env: Env): Promise<string> {
  const assertion =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    getCookie(request.headers.get("Cookie"), "CF_Authorization");

  if (!assertion) {
    throw new AccessAuthError("Missing Access assertion");
  }

  const parts = assertion.split(".");
  if (parts.length !== 3) {
    throw new AccessAuthError("Malformed JWT");
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { kid?: string };
  let payload: AccessJwtPayload;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    throw new AccessAuthError("Unparseable JWT");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    throw new AccessAuthError("Token expired");
  }

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) {
    throw new AccessAuthError("Audience mismatch");
  }

  if (!header.kid) {
    throw new AccessAuthError("Token missing key id");
  }

  const jwks = await getJwks(env.ACCESS_TEAM_DOMAIN);
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Could be legitimate key rotation — refetch once, bypassing cache,
    // before giving up.
    cachedJwks = null;
    const refreshed = await getJwks(env.ACCESS_TEAM_DOMAIN);
    const retried = refreshed.find((k) => k.kid === header.kid);
    if (!retried) throw new AccessAuthError("Unknown signing key");
  }
  const signingKey = jwk ?? (await getJwks(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!signingKey) {
    throw new AccessAuthError("Unknown signing key");
  }

  const key = await importJwk(signingKey);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(signatureB64);

  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData);
  if (!valid) {
    throw new AccessAuthError("Invalid signature");
  }

  if (!payload.email || payload.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
    throw new AccessAuthError("Email does not match configured admin");
  }

  return payload.email;
}
