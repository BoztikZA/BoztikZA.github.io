import type { DeliveryFileRow, DeliveryRow, Env, PublicDelivery } from "../types";
import { AccessAuthError } from "../types";
import * as db from "../lib/db";
import { presignGetUrl, getObjectBody } from "../lib/r2";
import { requireAccessIdentity } from "../lib/access";

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

function toPublicDelivery(delivery: DeliveryRow, files: DeliveryFileRow[]): PublicDelivery {
  let redditSource: Record<string, unknown> | null = null;
  if (delivery.reddit_source) {
    try {
      redditSource = JSON.parse(delivery.reddit_source);
    } catch {
      redditSource = null;
    }
  }

  return {
    id: delivery.id,
    project_name: delivery.project_name,
    client_name: delivery.client_name,
    notes: delivery.notes,
    created_at: delivery.created_at,
    expires_at: delivery.expires_at,
    support_enabled: Boolean(delivery.support_enabled) && !delivery.is_photoshop_battles,
    is_photoshop_battles: Boolean(delivery.is_photoshop_battles),
    reddit_source: redditSource,
    delivery_files: files.map((f) => ({
      id: f.id,
      delivery_id: f.delivery_id,
      // Repurposed, not a literal path — see the PublicDelivery doc
      // comment in types.ts for why this is safe.
      file_path: f.id,
      file_name: f.file_name,
      file_size: f.file_size,
      file_type: null,
      available: f.removed_at === null,
    })),
    // NOTE: source and source_meta are deliberately absent. source_meta
    // carries the PhotoshopBattles direct_token — leaking it would let
    // anyone mint their own stable image URLs for any delivery.
  };
}

export async function getPublicDelivery(env: Env, id: string): Promise<Response> {
  const delivery = await db.getDelivery(env, id);
  if (!delivery) return json({ error: "not_found" }, { status: 404 });
  const files = await db.getDeliveryFiles(env, id);
  return json(toPublicDelivery(delivery, files));
}

export async function getFileAccess(
  env: Env,
  request: Request,
  deliveryId: string,
  fileId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const intent = url.searchParams.get("intent") === "preview" ? "preview" : "download";

  const delivery = await db.getDelivery(env, deliveryId);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!delivery || delivery.expires_at <= nowSec) {
    return json({ error: "expired" }, { status: 410 });
  }

  const file = await db.getDeliveryFile(env, deliveryId, fileId);
  if (!file || file.removed_at !== null) {
    return json({ error: "file_unavailable" }, { status: 410 });
  }

  // Hardened per Phase 3 decision #3: preview is no longer a URL
  // convention. An admin preview must carry a valid Access session —
  // `?intent=preview` with no valid Access JWT is just a download request
  // as far as this endpoint is concerned (still works, still counted).
  let isAuthenticatedPreview = false;
  if (intent === "preview") {
    try {
      await requireAccessIdentity(request, env);
      isAuthenticatedPreview = true;
    } catch (err) {
      if (!(err instanceof AccessAuthError)) throw err;
      isAuthenticatedPreview = false;
    }
  }

  const ttl = isAuthenticatedPreview
    ? Number(env.PREVIEW_URL_TTL_SECONDS)
    : Number(env.DOWNLOAD_URL_TTL_SECONDS);
  const signedUrl = await presignGetUrl(env, file.r2_key, ttl);

  return json({
    url: signedUrl,
    expiresInSeconds: ttl,
    countsAsPublicAccess: !isAuthenticatedPreview,
  });
}

export async function postView(env: Env, id: string): Promise<Response> {
  await db.recordView(env, id);
  return json({ ok: true });
}

export async function postDownload(env: Env, id: string): Promise<Response> {
  await db.recordDownload(env, id);
  return json({ ok: true });
}

/**
 * Stable, long-lived direct-image stream for Reddit embeds. Deliberately
 * NOT a presigned URL — Reddit needs a URL that keeps working indefinitely,
 * not one pinned to a signature timestamp, matching how the existing
 * (misplaced-path) photoshop-battles-image function behaves today.
 *
 * Validated against source_meta.direct_token — the exact field name
 * dashboard.js already generates client-side today
 * (`crypto.randomUUID().replace(/-/g, "")`) when creating a PhotoshopBattles
 * delivery, confirmed directly from the existing code during Phase 3
 * (not a guess, unlike Phase 1's initial placeholder naming for this).
 */
export async function getRedditEmbed(
  env: Env,
  request: Request,
  deliveryId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response("Not found", { status: 404 });

  const delivery = await db.getDelivery(env, deliveryId);
  if (!delivery || !delivery.is_photoshop_battles) {
    return new Response("Not found", { status: 404 });
  }

  let meta: { direct_token?: string } = {};
  try {
    meta = delivery.source_meta ? JSON.parse(delivery.source_meta) : {};
  } catch {
    // fall through to token mismatch below
  }
  if (!meta.direct_token || meta.direct_token !== token) {
    return new Response("Not found", { status: 404 });
  }

  const files = await db.getDeliveryFiles(env, deliveryId);
  const file = files.find((f) => f.removed_at === null);
  if (!file) return new Response("Gone", { status: 410 });

  const obj = await getObjectBody(env, file.r2_key);
  if (!obj) return new Response("Gone", { status: 410 });

  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

const REDDIT_METADATA_ALLOWED_ORIGINS = [
  "https://boztikza.github.io",
  "https://boztik.com",
  "https://www.boztik.com",
];

export async function getRedditMetadata(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const corsHeaders: Record<string, string> =
    origin && REDDIT_METADATA_ALLOWED_ORIGINS.includes(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {};

  const url = new URL(request.url);
  const redditUrl = url.searchParams.get("url");
  if (!redditUrl) {
    return json({ error: "missing_url" }, { status: 400, headers: corsHeaders });
  }

  let parsed: URL;
  try {
    parsed = new URL(redditUrl);
  } catch {
    return json({ error: "invalid_url" }, { status: 400, headers: corsHeaders });
  }
  if (!/(^|\.)reddit\.com$/i.test(parsed.hostname)) {
    return json({ error: "unsupported_host" }, { status: 400, headers: corsHeaders });
  }

  const oembedUrl = `https://www.reddit.com/oembed?url=${encodeURIComponent(redditUrl)}`;
  const res = await fetch(oembedUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    return json({ error: "reddit_fetch_failed" }, { status: 502, headers: corsHeaders });
  }

  // Reshaped to match what deliver-v2/js/api.js's fetchRedditMetadata()
  // contract expects (title/subreddit/author/canonicalUrl/redditUrl) —
  // Reddit's raw oEmbed response (author_name, title, html, ...) doesn't
  // carry a subreddit field at all, so it's extracted from the URL path
  // instead. NOTE: the original Supabase reddit-metadata function's exact
  // body wasn't fully captured during inspection (Phase 1 only confirmed
  // its CORS handling) — this is a reasonable-equivalent reimplementation
  // built against the *consumer* contract, not a confirmed byte-for-byte
  // port. Flagged for your review, same as the PhotoshopBattles token.
  const oembed = (await res.json()) as { title?: string; author_name?: string };
  const subredditMatch = parsed.pathname.match(/\/r\/([^/]+)/i);
  const subreddit = subredditMatch ? subredditMatch[1] : null;
  const author = oembed.author_name ? oembed.author_name.replace(/^u\//i, "") : null;

  if (!oembed.title) {
    return json({ error: "no_title" }, { status: 502, headers: corsHeaders });
  }

  return json(
    {
      title: oembed.title,
      subreddit,
      author,
      canonicalUrl: redditUrl,
      redditUrl,
    },
    { headers: corsHeaders },
  );
}
