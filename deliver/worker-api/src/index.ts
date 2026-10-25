import type { Env } from "./types";
import { handleAdmin } from "./routes/admin";
import { handleAuth } from "./routes/auth";
import { handlePublic } from "./routes/public";
import { handlePromotionAdmin, handlePromotionPublic } from "./routes/promotions";
import { corsHeaders, error, json } from "./routes/util";
import { scheduled as runScheduled } from "./scheduled";

const API = "/api";
/** First-party analytics ingest endpoints (see corsHeaders "ingest"). */
const INGEST_PATHS = new Set([`${API}/public/pageview`, `${API}/public/traffic-source`, `${API}/public/store-click`]);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const scope = INGEST_PATHS.has(path) ? "ingest" : path.startsWith(`${API}/public/`) ? "public" : "admin";

    // CORS preflight: admin/auth answer only for the site's own origins.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env, scope) });
    }

    let response: Response;
    try {
      if (path === `${API}/health` || path === "/health") {
        response = json({ status: "ok", service: "boztik-deliver-api", time: new Date().toISOString() });
      } else if (path.startsWith(`${API}/public/`)) {
        const publicPath = path.slice(`${API}/public/`.length);
        response = publicPath.startsWith("promotions") || publicPath.startsWith("promotion-image")
          ? await handlePromotionPublic(request, publicPath.split("/").filter(Boolean), env)
          : await handlePublic(request, publicPath, env, ctx);
      } else if (path.startsWith(`${API}/auth/`)) {
        response = await handleAuth(request, path.slice(`${API}/auth/`.length), env);
      } else if (path.startsWith(`${API}/admin/`)) {
        const adminPath = path.slice(`${API}/admin/`.length);
        response = adminPath.startsWith("promotions")
          ? await handlePromotionAdmin(request, adminPath.split("/").filter(Boolean).slice(1), env)
          : await handleAdmin(request, adminPath, env, ctx);
      } else {
        response = error("Not found", 404);
      }
    } catch (err) {
      console.error("unhandled", err);
      response = error("Internal server error", 500);
    }
    return finalize(response, request, env, scope);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },
};

/** Adds CORS + security headers. Never overrides what a route already set, and
 *  never falls back to a wildcard for admin/auth responses. */
function finalize(response: Response, request: Request, env: Env, scope: "admin" | "public" | "ingest"): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env, scope))) if (!headers.has(k)) headers.set(k, v);
  if (!headers.has("X-Content-Type-Options")) headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("Referrer-Policy")) headers.set("Referrer-Policy", "no-referrer");
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (!headers.has("Strict-Transport-Security")) headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { runScheduled };
