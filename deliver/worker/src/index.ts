import type { Env } from "./types";
import * as pub from "./routes/public";
import * as admin from "./routes/admin";
import { withAdmin } from "./routes/admin";
import { handleScheduled } from "./scheduled";

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (origin === env.PUBLIC_ORIGIN) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cf-Access-Jwt-Assertion",
      "Access-Control-Max-Age": "86400",
    };
  }
  return {};
}

function withCors(response: Response, cors: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const response = await route(request, env, url);
      return withCors(response, cors);
    } catch (err) {
      console.error("Unhandled error:", err);
      return withCors(
        new Response(JSON.stringify({ error: "internal_error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
        cors,
      );
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },
};

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const segments = path.split("/").filter(Boolean);

  // /api/d/:id ...
  if (segments[0] === "api" && segments[1] === "d" && segments[2]) {
    const id = segments[2];

    if (segments.length === 3 && method === "GET") {
      return pub.getPublicDelivery(env, id);
    }
    if (segments.length === 6 && segments[3] === "files" && segments[5] === "access" && method === "POST") {
      return pub.getFileAccess(env, request, id, segments[4]!);
    }
    if (segments.length === 4 && segments[3] === "view" && method === "POST") {
      return pub.postView(env, id);
    }
    if (segments.length === 4 && segments[3] === "download" && method === "POST") {
      return pub.postDownload(env, id);
    }
    if (segments.length === 4 && segments[3] === "reddit-embed" && method === "GET") {
      return pub.getRedditEmbed(env, request, id);
    }
  }

  if (path === "/api/reddit-metadata" && method === "GET") {
    return pub.getRedditMetadata(request);
  }

  // /admin/... — every branch goes through withAdmin, independent of
  // whatever Access already did at the edge.
  if (segments[0] === "admin") {
    if (segments.length === 2 && segments[1] === "deliveries" && method === "GET") {
      return withAdmin(request, env, () => admin.listDeliveriesHandler(env));
    }
    if (segments.length === 3 && segments[1] === "uploads" && segments[2] === "init" && method === "POST") {
      return withAdmin(request, env, () => admin.initUploadHandler(env, request));
    }
    if (segments.length === 3 && segments[1] === "uploads" && segments[2] === "finalize" && method === "POST") {
      return withAdmin(request, env, () => admin.finalizeUploadHandler(env, request));
    }
    if (segments.length === 3 && segments[1] === "deliveries" && segments[2] && method === "PATCH") {
      const id = segments[2];
      return withAdmin(request, env, () => admin.updateDeliveryHandler(env, request, id));
    }
    if (segments.length === 4 && segments[1] === "deliveries" && segments[3] === "duplicate" && method === "POST") {
      const id = segments[2]!;
      return withAdmin(request, env, () => admin.duplicateDeliveryHandler(env, id));
    }
    if (
      segments.length === 4 &&
      segments[1] === "deliveries" &&
      segments[3] === "delete-files" &&
      method === "POST"
    ) {
      const id = segments[2]!;
      return withAdmin(request, env, () => admin.deleteFilesHandler(env, id));
    }
  }

  return notFound();
}
