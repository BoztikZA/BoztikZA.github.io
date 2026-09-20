import type { Env } from "../types";
import { AuthError, HttpError } from "../types";
import { rateLimit } from "../lib/auth";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...(extra ?? {}) } });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>, headers?: Record<string, string>): Response {
  return json({ ok: false, error: message, ...(extra ?? {}) }, status, headers);
}

export function allowedOrigins(env: Env): string[] {
  return `${env.ALLOWED_ORIGINS || ""},${env.PUBLIC_ORIGIN || ""}`
    .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
}

export function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return !!origin && allowedOrigins(env).includes(origin);
}

/** Admin/auth routes: only the site's own origins get CORS headers (credentials
 *  are a Bearer header, never a cookie, so there is no CSRF surface either).
 *  Public read routes are world-readable capability URLs and use `*`. */
export function corsHeaders(request: Request, env: Env, scope: "admin" | "public"): Record<string, string> {
  const base = { "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "600" };
  if (scope === "public") return { ...base, "Access-Control-Allow-Origin": "*" };
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).includes(origin)) return { ...base, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  return { Vary: "Origin" };
}

export const clientIp = (req: Request): string => req.headers.get("CF-Connecting-IP") || "unknown";

export function checkPublicRate(req: Request, env: Env, bucket = "pub", multiplier = 1): void {
  const limit = Number(env.RATE_LIMIT_PUBLIC_PER_MINUTE || 120) * multiplier;
  if (limit > 0 && !rateLimit(`${bucket}:${clientIp(req)}`, limit)) {
    throw new HttpError(429, "rate_limited", "Too many requests. Please slow down.");
  }
}

/** Public state-changing endpoints (view/access/pageview) must come from our own
 *  pages when the browser says where it came from. */
export function assertSameSiteOrigin(req: Request, env: Env): void {
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins(env).includes(origin)) throw new HttpError(403, "forbidden_origin", "Origin not allowed.");
}

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > maxBytes) throw new HttpError(413, "body_too_large", "Request body too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "body_too_large", "Request body too large.");
  try {
    const v = JSON.parse(text || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fallthrough */ }
  throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
}

export function requireJson(req: Request): void {
  if (!(req.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
}

export async function wrap(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, 401, { code: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
    if (e instanceof HttpError) {
      const headers = e.status === 429 && typeof e.details?.retry_after === "number" ? { "Retry-After": String(e.details.retry_after) } : undefined;
      return error(e.message, e.status, { code: e.code, ...(e.details ?? {}) }, headers);
    }
    console.error("unhandled error", e); // details stay in logs, never in the response
    return error("Internal server error", 500, { code: "internal_error" });
  }
}

export const segments = (path: string): string[] => path.split("/").filter(Boolean);
