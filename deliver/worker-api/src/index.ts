import type { Env } from "./types";
import { handleAdmin } from "./routes/admin";
import { handleAuth } from "./routes/auth";
import { handlePublic } from "./routes/public";
import { corsHeaders, error, json } from "./routes/util";
import { scheduled as runScheduled } from "./scheduled";

const API = "/api";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const scope = path.startsWith(`${API}/public/`) ? "public" : "admin";

    // CORS preflight: admin/auth answer only for the site's own origins.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env, scope) });
    }

    let response: Response;
    try {
      if (path === `${API}/health` || path === "/health") {
        response = json({ status: "ok", service: "boztik-deliver-api", time: new Date().toISOString() });
      } else if (path.startsWith(`${API}/public/`)) {
        response = await handlePublic(request, path.slice(`${API}/public/`.length), env);
      } else if (path.startsWith(`${API}/auth/`)) {
        response = await handleAuth(request, path.slice(`${API}/auth/`.length), env);
      } else if (path.startsWith(`${API}/admin/`)) {
        response = await handleAdmin(request, path.slice(`${API}/admin/`.length), env);
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
function finalize(response: Response, request: Request, env: Env, scope: "admin" | "public"): Response {
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
