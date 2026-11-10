import type { Env } from "../types";
import { HttpError } from "../types";
import { requireSession } from "../lib/auth";
import { localDay } from "../lib/db";
import { enqueueSpotlightEmail, processSpotlightEmailOutbox } from "../lib/spotlight-email";
import { readImageDimensions } from "../lib/spotlight-image";
import { reserveUpload, claimUpload, commitUpload, getPendingUpload, holdStoredUploadReservation, releaseReservation, releaseStoredPending, markUncertain, reconcileStorage } from "../lib/storage";
import { assertSameSiteOrigin, checkPublicRate, error, json, readJson, requireJson, segments, wrap } from "./util";

const CATEGORIES = new Set(["small-business","youtube","twitch","gaming","photography","design","music","creator","freelance","other"]);
const SPOTLIGHT_TERM_SECONDS = 72 * 60 * 60;
const ID = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const now = () => Math.floor(Date.now() / 1000);
const day = (env: Env) => localDay(env);
const clean = (v: unknown, max: number) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
const cleanDescription = (v: unknown) => typeof v === "string"
  ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000)
  : "";

const SOCIAL_HOSTS: Record<string, string[]> = {
  youtube: ["youtube.com", "youtu.be"],
  twitch: ["twitch.tv"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.watch"],
  linkedin: ["linkedin.com", "lnkd.in"],
  x: ["x.com", "twitter.com"],
  spotify: ["spotify.com", "spotify.link"],
  pinterest: ["pinterest.com", "pin.it"],
};

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (value.trim().length > 500) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    return u.toString();
  }
  catch { return null; }
}

function safeWebsiteUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  return safeUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : "https://" + text.replace(/^\/+/, ""));
}

function isAllowedPlatformHost(hostname: string, roots: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return roots.some(root => host === root || host.endsWith("." + root));
}

export function safeSocialUrl(platform: string, value: unknown): string | null {
  const url = safeUrl(value);
  if (!url || !Object.prototype.hasOwnProperty.call(SOCIAL_HOSTS, platform)) return null;
  const roots = SOCIAL_HOSTS[platform];
  if (!roots) return null;
  const parsed = new URL(url);
  return isAllowedPlatformHost(parsed.hostname, roots) ? url : null;
}

function checkedSocialLinks(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(422, "invalid_social_links", "Social links must be an object.");
  }
  const links: Record<string, string> = {};
  for (const [platform, link] of Object.entries(value)) {
    const url = safeSocialUrl(platform, link);
    if (!url) throw new HttpError(422, "invalid_social_url", `Use a valid HTTPS ${platform} link.`);
    links[platform] = url;
  }
  return links;
}

function parseSocialLinks(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value || "{}") : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function publicSocialLinks(value: unknown): Record<string, string> {
  const links: Record<string, string> = {};
  for (const [platform, link] of Object.entries(parseSocialLinks(value))) {
    const url = safeSocialUrl(platform, link);
    if (url) links[platform] = url;
  }
  return links;
}

function invalidSocialLinkKeys(value: unknown): string[] {
  return Object.entries(parseSocialLinks(value))
    .filter(([platform, link]) => !safeSocialUrl(platform, link))
    .map(([platform]) => platform);
}

interface SpotlightCursor {
  featured: 0 | 1;
  publishedAt: number;
  id: string;
  asOf: number;
}

function encodeCursor(cursor: SpotlightCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(value: string | null): SpotlightCursor | null {
  if (!value) return null;
  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
    if ((decoded.featured !== 0 && decoded.featured !== 1)
      || !Number.isInteger(decoded.publishedAt)
      || !Number.isInteger(decoded.asOf)
      || typeof decoded.id !== "string"
      || !/^[a-f0-9]{20}$/i.test(decoded.id)) throw new Error();
    return decoded as SpotlightCursor;
  } catch {
    throw new HttpError(400, "invalid_cursor", "The directory page cursor is invalid. Refresh and try again.");
  }
}

const SUBMISSION_WINDOW_SECONDS = 60 * 60;
const SUBMISSION_LIMIT_PER_WINDOW = 5;

export async function checkSpotlightSubmissionRate(request: Request, env: Env): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`spotlight-submit:${env.AUTH_TOKEN_SALT || ""}:${ip}`),
  );
  const visitorKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const timestamp = now();
  const row = await env.DB.prepare(
    `INSERT INTO spotlight_submission_limits (visitor_key, window_start, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(visitor_key) DO UPDATE SET
       request_count = CASE WHEN ? - window_start >= ? THEN 1 ELSE request_count + 1 END,
       window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END
     RETURNING request_count, window_start`,
  ).bind(visitorKey, timestamp, timestamp, SUBMISSION_WINDOW_SECONDS, timestamp, SUBMISSION_WINDOW_SECONDS, timestamp)
    .first<{ request_count: number; window_start: number }>();
  if (!row) throw new HttpError(503, "submission_rate_unavailable", "Submissions are temporarily unavailable. Please try again later.");
  if (row.request_count > SUBMISSION_LIMIT_PER_WINDOW) {
    throw new HttpError(429, "rate_limited", "Too many submissions from this connection. Please try again later.", {
      retry_after: Math.max(1, row.window_start + SUBMISSION_WINDOW_SECONDS - timestamp),
    });
  }
}
function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "profile";
}
function spotifyTrack(value: unknown): { id: string; url: string } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || !["open.spotify.com", "www.open.spotify.com"].includes(u.hostname)) return null;
    const match = u.pathname.match(/^\/track\/([A-Za-z0-9]{22})\/?$/);
    const trackId = match?.[1];
    return trackId ? { id: trackId, url: "https://open.spotify.com/track/" + trackId } : null;
  } catch { return null; }
}
async function spotifyMetadata(track: { id: string; url: string }): Promise<{ id: string; url: string; title: string; artwork: string | null }> {
  const response = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(track.url), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new HttpError(422, "spotify_unavailable", "Spotify could not retrieve that track. Check the song link and try again.");
  const data = await response.json() as { title?: unknown; thumbnail_url?: unknown; provider_name?: unknown };
  if (data.provider_name !== "Spotify" || typeof data.title !== "string") throw new HttpError(422, "spotify_invalid_track", "Please provide a public Spotify track link, not an artist or playlist link.");
  const artwork = typeof data.thumbnail_url === "string" && data.thumbnail_url.startsWith("https://") ? data.thumbnail_url : null;
  return { ...track, title: data.title.slice(0, 200), artwork };
}

function publicImageUrl(profileId: string, position?: number): string {
  return "https://deliver-api.boztik.com/api/public/spotlight/image/" + profileId
    + (position === undefined ? "" : "/" + position);
}

async function spotlightGalleryByProfile(env: Env, profileIds: string[]): Promise<Map<string, any[]>> {
  const gallery = new Map<string, any[]>();
  if (!profileIds.length) return gallery;
  const placeholders = profileIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT profile_id,position,image_key,image_size,image_content_type
       FROM spotlight_gallery_images
      WHERE profile_id IN (${placeholders})
      ORDER BY profile_id,position`,
  ).bind(...profileIds).all<any>();
  for (const row of rows.results || []) {
    const items = gallery.get(row.profile_id) || [];
    items.push(row);
    gallery.set(row.profile_id, items);
  }
  return gallery;
}

function featuredVideo(value: unknown): { platform: "youtube" | "twitch"; id: string; kind: "video" | "channel" | "clip"; url: string } | null {
  if (typeof value !== "string" || !value.trim() || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
      let id = "";
      if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
      else if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      else if (/^\/(shorts|live|embed)\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split("/")[2] || "";
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      return { platform: "youtube", id, kind: "video", url: "https://www.youtube.com/watch?v=" + id };
    }
    if (host === "twitch.tv" || host === "clips.twitch.tv") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (host === "clips.twitch.tv") {
        const slug = parts[0] || "";
        if (!/^[A-Za-z0-9_-]{5,80}$/.test(slug)) return null;
        return { platform: "twitch", id: slug, kind: "clip", url: "https://clips.twitch.tv/" + slug };
      }
      if (parts.length === 2 && parts[0] === "videos" && /^\d{5,20}$/.test(parts[1])) return { platform: "twitch", id: parts[1], kind: "video", url: "https://www.twitch.tv/videos/" + parts[1] };
      if (parts.length === 1 && /^[A-Za-z0-9_]{3,25}$/.test(parts[0])) return { platform: "twitch", id: parts[0].toLowerCase(), kind: "channel", url: "https://www.twitch.tv/" + parts[0].toLowerCase() };
    }
  } catch {}
  return null;
}

function publicDto(row: any, gallery: any[] = []) {
  const imageUrl = row.image_key && row.status === "published" ? publicImageUrl(row.id) : null;
  return {
    id: row.id, slug: row.slug, display_name: row.display_name, tagline: row.tagline,
    description: row.description, category: row.category, website_url: row.website_url,
    social_links: publicSocialLinks(row.social_links), song: row.song_metadata ? JSON.parse(row.song_metadata) : null, video: row.video_metadata ? JSON.parse(row.video_metadata) : null, image_url: imageUrl,
    images: row.status === "published" ? [
      ...(imageUrl ? [{ url: imageUrl, position: 0 }] : []),
      ...gallery.map(item => ({ url: publicImageUrl(row.id, Number(item.position)), position: Number(item.position) })),
    ] : [],
    featured: Number(row.featured_until || 0) > now(), featured_until: Number(row.featured_until || 0) > now() ? row.featured_until : null,
    created_at: row.created_at,
  };
}

export function handleSpotlightPublic(request: Request, path: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  return wrap(async () => {
    const seg = segments(path);
    if (request.method === "GET" && seg.length === 0) {
      checkPublicRate(request, env, "spotlight-list", 2);
      const requestUrl = new URL(request.url);
      const category = requestUrl.searchParams.get("category") || "all";
      if (category !== "all" && !CATEGORIES.has(category)) {
        throw new HttpError(422, "invalid_category", "Choose a valid category.");
      }
      const query = clean(requestUrl.searchParams.get("q"), 80).toLowerCase();
      const requestedLimit = requestUrl.searchParams.get("limit");
      const limit = requestedLimit === null ? 30 : Number(requestedLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new HttpError(422, "invalid_limit", "Directory page size must be between 1 and 50.");
      }
      const cursor = decodeCursor(requestUrl.searchParams.get("cursor"));
      const timestamp = cursor?.asOf ?? now();
      const clauses = ["status='published'", "(listing_expires_at IS NULL OR listing_expires_at>?)"];
      const bindings: (string | number)[] = [now()];
      if (category !== "all") {
        clauses.push("category=?");
        bindings.push(category);
      }
      if (query) {
        clauses.push("(lower(display_name) LIKE ? OR lower(tagline) LIKE ? OR lower(description) LIKE ? OR lower(category) LIKE ?)");
        const searchTerm = `%${query}%`;
        bindings.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }
      if (cursor) {
        clauses.push(`(
          CASE WHEN featured_until > ? THEN 0 ELSE 1 END > ?
          OR (CASE WHEN featured_until > ? THEN 0 ELSE 1 END = ?
            AND (COALESCE(published_at, created_at) < ?
              OR (COALESCE(published_at, created_at) = ? AND id < ?)))
        )`);
        bindings.push(timestamp, cursor.featured, timestamp, cursor.featured, cursor.publishedAt, cursor.publishedAt, cursor.id);
      }
      const rows = await env.DB.prepare(
        `SELECT id,slug,display_name,tagline,description,category,website_url,social_links,song_metadata,image_key,image_size,image_content_type,status,featured_until,created_at,published_at
           FROM spotlight_profiles
          WHERE ${clauses.join(" AND ")}
          ORDER BY CASE WHEN featured_until > ? THEN 0 ELSE 1 END,
                   COALESCE(published_at, created_at) DESC, id DESC
          LIMIT ?`,
      ).bind(...bindings, timestamp, limit + 1).all<any>();
      const page = (rows.results || []).slice(0, limit);
      const gallery = await spotlightGalleryByProfile(env, page.map(row => row.id));
      const hasMore = (rows.results || []).length > limit;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last
        ? encodeCursor({
          featured: Number(last.featured_until || 0) > timestamp ? 0 : 1,
          publishedAt: Number(last.published_at ?? last.created_at),
          id: last.id,
          asOf: timestamp,
        })
        : null;
      return json({
        ok: true,
        profiles: page.map(row => publicDto(row, gallery.get(row.id))),
        next_cursor: nextCursor,
        has_more: hasMore,
      }, 200, { "Cache-Control": "no-store" });
    }
    if (request.method === "GET" && seg[0] === "image" && (seg.length === 2 || seg.length === 3)) {
      const position = seg.length === 3 ? Number(seg[2]) : 0;
      if (seg.length === 3 && (!Number.isInteger(position) || position < 1 || position > 4)) return error("Image not found",404);
      const row = position === 0
        ? await env.DB.prepare("SELECT image_key,image_content_type FROM spotlight_profiles WHERE id=? AND status='published' AND (listing_expires_at IS NULL OR listing_expires_at>?)").bind(seg[1],now()).first<any>()
        : await env.DB.prepare("SELECT g.image_key,g.image_content_type FROM spotlight_gallery_images g JOIN spotlight_profiles p ON p.id=g.profile_id WHERE g.profile_id=? AND g.position=? AND p.status='published' AND (p.listing_expires_at IS NULL OR p.listing_expires_at>?)").bind(seg[1], position, now()).first<any>();
      if (!row?.image_key) return error("Image not found",404);
      const object = await env.BUCKET.get(row.image_key);
      if (!object) return error("Image not found",404);
      return new Response(object.body,{headers:{"Content-Type":row.image_content_type || "image/jpeg","Cache-Control":"public, max-age=60","X-Content-Type-Options":"nosniff"}});
    }
    if (request.method === "GET" && seg[0] === "share" && seg.length === 2) {
      checkPublicRate(request, env, "spotlight-share", 2);
      const slug = clean(seg[1], 60);
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) return error("Profile not found", 404);
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE slug=? AND status='published' AND (listing_expires_at IS NULL OR listing_expires_at>?)").bind(slug,now()).first<any>();
      if (!row) return error("Profile not found", 404);
      const gallery = await spotlightGalleryByProfile(env, [row.id]);
      const profile = publicDto(row, gallery.get(row.id));
      const origin = "https://www.boztik.com";
      const profileUrl = origin + "/spotlight/profile.html?slug=" + encodeURIComponent(profile.slug);
      const shareUrl = "https://deliver-api.boztik.com/api/public/spotlight/share/" + encodeURIComponent(profile.slug);
      const imageUrl = profile.image_url || origin + "/images/boztik-mark.png";
      const title = clean(profile.display_name, 80) + " — Boztik Spotlight";
      const description = clean(profile.tagline, 180) || clean(profile.description, 180) || "Discover independent businesses and creators on Boztik Spotlight.";
      const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"\']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"' : "&quot;", "\'": "&#39;" }[char] || char));
      const page =
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        "<title>" + escapeHtml(title) + "</title><meta name=\"description\" content=\"" + escapeHtml(description) + "\">" +
        '<link rel="canonical" href="' + escapeHtml(profileUrl) + '">' +
        '<meta property="og:type" content="profile"><meta property="og:site_name" content="Boztik Spotlight">' +
        '<meta property="og:title" content="' + escapeHtml(title) + '"><meta property="og:description" content="' + escapeHtml(description) + '">' +
        '<meta property="og:url" content="' + escapeHtml(shareUrl) + '"><meta property="og:image" content="' + escapeHtml(imageUrl) + '">' +
        '<meta property="og:image:alt" content="' + escapeHtml(profile.display_name) + ' on Boztik Spotlight">' +
        '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + escapeHtml(title) + '">' +
        '<meta name="twitter:description" content="' + escapeHtml(description) + '"><meta name="twitter:image" content="' + escapeHtml(imageUrl) + '">' +
        '<meta http-equiv="refresh" content="2;url=' + escapeHtml(profileUrl) + '"><meta name="theme-color" content="#080b0d">' +
        '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080b0d;color:#f2f5f2;font:16px Inter,system-ui,sans-serif}.card{width:min(520px,calc(100% - 48px));padding:32px;border:1px solid #28332c;border-radius:16px;background:#101719;text-align:center}.mark{color:#8eff3d;font-weight:800;letter-spacing:.16em}.card p{color:#aab7ae;line-height:1.6}.card a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:8px;background:#8eff3d;color:#0b1207;text-decoration:none;font-weight:800}</style>' +
        '</head><body><main class="card"><div class="mark">BOZTIK SPOTLIGHT</div><h1>' + escapeHtml(profile.display_name) + '</h1><p>' + escapeHtml(description) + '</p><p>Opening this profile…</p><a href="' + escapeHtml(profileUrl) + '">View profile</a></main>' +
        "<script>location.replace(" + JSON.stringify(profileUrl) + ");</script></body></html>";
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
    }
    if (request.method === "GET" && seg[0] === "profile" && seg.length === 2) {
      checkPublicRate(request, env, "spotlight-profile", 2);
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE slug=? AND status='published' AND (listing_expires_at IS NULL OR listing_expires_at>?)").bind(seg[1],now()).first<any>();
      if (!row) return error("Profile not found", 404);
      const gallery = await spotlightGalleryByProfile(env, [row.id]);
      return json({ ok: true, profile: publicDto(row, gallery.get(row.id)) }, 200, { "Cache-Control": "no-store" });
    }
    if (request.method === "POST" && seg[0] === "submit" && seg.length === 1) {
      checkPublicRate(request, env, "spotlight-submit", 0.25);
      assertSameSiteOrigin(request, env);
      await checkSpotlightSubmissionRate(request, env);
      const contentType = request.headers.get("Content-Type") || "";
      const isMultipart = contentType.toLowerCase().startsWith("multipart/form-data");
      let b: Record<string, any>;
      let mainImage: File | null = null;
      let showcaseImages: File[] = [];
      if (isMultipart) {
        const contentLength = Number(request.headers.get("Content-Length") || 0);
        if (contentLength > 16 * 1024 * 1024) throw new HttpError(413, "submission_too_large", "All Spotlight images together must be no larger than 15 MB.");
        const form = await request.formData();
        const value = (key: string) => form.get(key);
        let socialLinks: unknown = {};
        const socialText = value("social_links");
        if (typeof socialText === "string" && socialText.trim()) {
          try { socialLinks = JSON.parse(socialText); }
          catch { throw new HttpError(422, "invalid_social_links", "Check the social links and try submitting again."); }
        }
        b = {
          display_name: value("display_name"), tagline: value("tagline"), description: value("description"),
          category: value("category"), website_url: value("website_url"), contact_email: value("contact_email"),
          song_url: value("song_url"), video_url: value("video_url"), company_website: value("company_website"),
          consent: value("consent") === "on", social_links: socialLinks,
        };
        const primary = value("main_image");
        mainImage = typeof File !== "undefined" && primary instanceof File && primary.size ? primary : null;
        showcaseImages = form.getAll("showcase_images")
          .filter((file): file is File => typeof File !== "undefined" && file instanceof File && file.size > 0);
        if (showcaseImages.length > 2) throw new HttpError(422, "too_many_images", "Choose one main image and no more than two additional images.");
        if (!mainImage) throw new HttpError(422, "main_image_required", "Choose your main logo or profile image first.");
        for (const file of [mainImage, ...showcaseImages]) {
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new HttpError(415, "invalid_image_type", "Choose JPG, PNG or WebP images.");
          if (file.size > 5 * 1024 * 1024) throw new HttpError(413, "image_too_large", "Each Spotlight image must be no larger than 5 MB.");
        }
      } else {
        requireJson(request);
        b = await readJson(request, 32 * 1024);
      }
      // Honeypot: silently accept automated submissions without storing them.
      if (clean(b.company_website, 200)) return json({ ok: true });
      const displayName = clean(b.display_name, 80), tagline = clean(b.tagline, 120);
      const description = cleanDescription(b.description), category = clean(b.category, 40);
      const email = clean(b.contact_email, 254).toLowerCase();
      const songTrack = b.song_url ? spotifyTrack(b.song_url) : null;
      if (b.song_url && !songTrack) throw new HttpError(422, "invalid_spotify_track", "Use a public Spotify track link.");
      const song = songTrack ? await spotifyMetadata(songTrack) : null;
      const video = b.video_url ? featuredVideo(b.video_url) : null;
      if (b.video_url && !video) throw new HttpError(422, "invalid_featured_video", "Use a public YouTube video or Twitch channel, VOD or clip URL.");
      const website = safeWebsiteUrl(b.website_url);
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30) throw new HttpError(422, "invalid_profile", "Please provide a name, a clear tagline and a description of at least 30 characters.");
      if (!CATEGORIES.has(category)) throw new HttpError(422, "invalid_category", "Choose a valid category.");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "invalid_email", "Enter a valid contact email, or leave the field blank.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      if (b.consent !== true) throw new HttpError(422, "consent_required", "Confirm that you own or are authorised to submit this profile.");
      const social: Record<string,string> = {};
      if (b.social_links && typeof b.social_links === "object" && !Array.isArray(b.social_links)) {
        for (const key of ["youtube","twitch","instagram","tiktok","facebook","linkedin","x","spotify","pinterest"]) {
          const value = (b.social_links as Record<string,unknown>)[key];
          if (value) {
            const url = safeSocialUrl(key, value);
            if (!url) throw new HttpError(422, "invalid_social_url", `Use a valid HTTPS ${key} link.`);
            social[key] = url;
          }
        }
      }
      const id = ID(), timestamp = now();
      const slug = slugify(displayName) + "-" + id.slice(0, 5);
      const inserted = await env.DB.prepare(
        `INSERT INTO spotlight_profiles
          (id,slug,display_name,tagline,description,category,contact_email,website_url,social_links,song_metadata,video_metadata,
           status,application_status,review_expires_at,review_unread,created_at,updated_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,'pending','new',?,1,?,?
          WHERE NOT EXISTS (
            SELECT 1 FROM spotlight_profiles
             WHERE contact_email=? AND lower(display_name)=lower(?) AND status<>'archived' AND created_at>=?
          )`,
      ).bind(id,slug,displayName,tagline,description,category,email,website,JSON.stringify(social),song ? JSON.stringify(song) : null,video ? JSON.stringify(video) : null,timestamp + SPOTLIGHT_TERM_SECONDS,timestamp,timestamp,email,displayName,timestamp - SPOTLIGHT_TERM_SECONDS).run();
      if ((inserted.meta.changes || 0) === 0) {
        return json({
          ok: true,
          duplicate: true,
          message: "A submission with those details was received within the last 72 hours. You can submit again after the 72-hour Spotlight application window has passed.",
        });
      }
      if (mainImage) {
        try {
          const requireImageUpload = async (response: Response) => {
            if (response.ok) return;
            const result = await response.json().catch(() => ({})) as { error?: unknown };
            throw new HttpError(response.status, "image_upload_failed", typeof result.error === "string" ? result.error : "The image could not be uploaded.");
          };
          const primaryResponse = await uploadSpotlightImage(new Request(request.url, {
            method: "PUT", headers: { "Content-Type": mainImage.type }, body: mainImage,
          }), env, id);
          await requireImageUpload(primaryResponse);
          for (let index = 0; index < showcaseImages.length; index += 1) {
            const file = showcaseImages[index]!;
            const imageResponse = await uploadSpotlightImage(new Request(request.url, {
              method: "PUT", headers: { "Content-Type": file.type }, body: file,
            }), env, id, index + 1);
            await requireImageUpload(imageResponse);
          }
        } catch (uploadError) {
          console.error("[spotlight] public submission image upload failed", uploadError);
          try {
            await deletePendingSpotlightSubmission(env, id);
          } catch (cleanupError) {
            console.error("[spotlight] failed submission cleanup requires reconciliation", cleanupError);
            throw new HttpError(503, "submission_image_cleanup_pending", "Image processing could not finish. Please contact Boztik and include submission reference " + id + ".");
          }
          throw uploadError;
        }
      }
      let notificationQueued = false;
      let notificationSent = false;
      try {
        await enqueueSpotlightEmail(env, id, "new_submission");
        notificationQueued = true;
        notificationSent = (await processSpotlightEmailOutbox(env, 1, id, "new_submission")).sent > 0;
      } catch (notificationError) {
        console.error("[spotlight] owner notification could not be processed", notificationError);
      }
      return json({
        ok: true,
        notification_sent: notificationSent,
        notification_queued: notificationQueued,
        message: notificationSent
          ? "Your profile has been received. The Boztik team has also been notified."
          : notificationQueued
            ? "Your profile has been safely received for review. The email alert is queued for retry; you do not need to submit it again."
            : "Your profile has been safely received for review, but the email alert could not be queued. You do not need to submit it again."
      }, 201);
    }
    if (request.method === "POST" && seg[0] === "event" && seg.length === 1) {
      checkPublicRate(request, env, "spotlight-event", 2);
      assertSameSiteOrigin(request, env); requireJson(request);
      const b = await readJson(request, 1024);
      const eventId = clean(b.event_id, 64), profileId = clean(b.profile_id, 32), type = b.type;
      const visitorId = clean(b.visitor_id, 64);
      if (!/^[a-zA-Z0-9_-]{12,64}$/.test(eventId) || !/^[a-f0-9]{20}$/i.test(profileId) || !["view","click"].includes(String(type)) || (type === "view" && !/^[a-f0-9-]{36}$/i.test(visitorId))) throw new HttpError(422, "invalid_event", "Invalid analytics event.");
      const profile = await env.DB.prepare("SELECT id FROM spotlight_profiles WHERE id=? AND status='published' AND (listing_expires_at IS NULL OR listing_expires_at>?)").bind(profileId,now()).first();
      if (!profile) return json({ ok: true, counted: false });
      const d = day(env), t = now();
      const insert = await env.DB.prepare("INSERT OR IGNORE INTO spotlight_events(event_id,profile_id,event_type,day,created_at) VALUES(?,?,?,?,?)").bind(eventId,profileId,type,d,t).run();
      if ((insert.meta.changes || 0) > 0) {
        await env.DB.prepare(`INSERT INTO spotlight_daily_metrics(profile_id,day,${type === "view" ? "views" : "outbound_clicks"}) VALUES(?,?,1) ON CONFLICT(profile_id,day) DO UPDATE SET ${type === "view" ? "views" : "outbound_clicks"}=${type === "view" ? "views" : "outbound_clicks"}+1`).bind(profileId,d).run();
        if (type === "view") {
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(visitorId + ":" + d + ":" + env.AUTH_TOKEN_SALT));
          const visitorKey = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
          const unique = await env.DB.prepare("INSERT OR IGNORE INTO spotlight_visitors(profile_id,day,visitor_key,created_at) VALUES(?,?,?,?)").bind(profileId,d,visitorKey,t).run();
          if ((unique.meta.changes || 0) > 0) await env.DB.prepare("UPDATE spotlight_daily_metrics SET unique_views=unique_views+1 WHERE profile_id=? AND day=?").bind(profileId,d).run();
        }
      }
      return json({ ok: true, counted: (insert.meta.changes || 0) > 0 });
    }
    if (request.method === "POST" && seg[0] === "impression" && seg.length === 1) {
      checkPublicRate(request, env, "spotlight-impression", 2);
      assertSameSiteOrigin(request, env); requireJson(request);
      const b = await readJson(request, 1024);
      const eventId = clean(b.event_id, 64), profileId = clean(b.profile_id, 32);
      if (!/^[a-zA-Z0-9_-]{12,64}$/.test(eventId) || !/^[a-f0-9]{20}$/i.test(profileId)) throw new HttpError(422, "invalid_event", "Invalid impression event.");
      const d = day(env), t = now();
      const featured = await env.DB.prepare("SELECT id FROM spotlight_profiles WHERE id=? AND status='published' AND featured_until>? AND (listing_expires_at IS NULL OR listing_expires_at>?)").bind(profileId,t,t).first();
      if (!featured) return json({ok:true,counted:false});
      const insert = await env.DB.prepare("INSERT OR IGNORE INTO spotlight_impressions(event_id,profile_id,day,created_at) VALUES(?,?,?,?)").bind(eventId,profileId,d,t).run();
      if ((insert.meta.changes || 0) > 0) await env.DB.prepare("INSERT INTO spotlight_daily_metrics(profile_id,day,featured_impressions) VALUES(?,?,1) ON CONFLICT(profile_id,day) DO UPDATE SET featured_impressions=featured_impressions+1").bind(profileId,d).run();
      return json({ok:true,counted:(insert.meta.changes || 0)>0});
    }
    return error("Not found", 404);
  });
}

export function handleSpotlightAdmin(request: Request, path: string, env: Env): Promise<Response> {
  return wrap(async () => {
    const actor = await requireSession(request, env);
    const seg = segments(path);
    if (seg.length === 1 && seg[0] === "profile" && request.method === "POST") {
      requireJson(request);
      const b = await readJson(request, 32 * 1024);
      const displayName = clean(b.display_name, 80), tagline = clean(b.tagline, 120);
      const description = cleanDescription(b.description), category = clean(b.category, 40);
      const email = clean(b.contact_email, 254).toLowerCase();
      const website = b.website_url ? safeWebsiteUrl(b.website_url) : null;
      const songTrack = b.song_url ? spotifyTrack(b.song_url) : null;
      if (b.song_url && !songTrack) throw new HttpError(422, "invalid_spotify_track", "Use a public Spotify track link.");
      const song = songTrack ? await spotifyMetadata(songTrack) : null;
      const video = b.video_url ? featuredVideo(b.video_url) : null;
      if (b.video_url && !video) throw new HttpError(422, "invalid_featured_video", "Use a public YouTube video or Twitch channel, VOD or clip URL.");
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30) throw new HttpError(422, "invalid_profile", "Please provide a name, a clear tagline and a description of at least 30 characters.");
      if (!CATEGORIES.has(category)) throw new HttpError(422, "invalid_category", "Choose a valid category.");
      // Contact email is optional for admin-created profiles (the column is NOT NULL, so blank is stored as "").
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "invalid_email", "Enter a valid contact email, or leave the field blank.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      const social: Record<string,string> = {};
      if (b.social_links && typeof b.social_links === "object" && !Array.isArray(b.social_links)) {
        for (const key of ["youtube","twitch","instagram","tiktok","facebook","linkedin","x","spotify","pinterest"]) {
          const value = (b.social_links as Record<string,unknown>)[key];
          if (value) {
            const url = safeSocialUrl(key, value);
            if (!url) throw new HttpError(422, "invalid_social_url", `Use a valid HTTPS ${key} link.`);
            social[key] = url;
          }
        }
      }
      const id = ID(), timestamp = now(), slug = slugify(displayName) + "-" + id.slice(0, 5);
      await env.DB.prepare(
        "INSERT INTO spotlight_profiles (id,slug,display_name,tagline,description,category,contact_email,website_url,social_links,song_metadata,video_metadata,status,application_status,review_unread,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending','approved',0,?,?)"
      ).bind(id,slug,displayName,tagline,description,category,email,website,JSON.stringify(social),song ? JSON.stringify(song) : null,video ? JSON.stringify(video) : null,timestamp,timestamp).run();
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(id).first<any>();
      return json({ ok:true, profile:{...publicDto(row),contact_email:row.contact_email,status:row.status,application_status:row.application_status} }, 201);
    }
    if (!seg.length && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT * FROM spotlight_profiles ORDER BY CASE application_status WHEN 'new' THEN 0 WHEN 'under_review' THEN 1 WHEN 'approved' THEN 2 WHEN 'declined' THEN 3 WHEN 'expired' THEN 4 ELSE 5 END, created_at DESC LIMIT 300",
      ).all<any>();
      const counts = await env.DB.prepare(
        `SELECT SUM(CASE WHEN application_status IN ('new','under_review') THEN 1 ELSE 0 END) AS pending_decision_count,
                SUM(CASE WHEN application_status='new' AND review_unread=1 THEN 1 ELSE 0 END) AS unread_count,
                SUM(CASE WHEN application_status='approved' THEN 1 ELSE 0 END) AS approved_count
           FROM spotlight_profiles`,
      ).first<any>();
      const gallery = await spotlightGalleryByProfile(env, (rows.results || []).map((row: any) => row.id));
      const profiles = (rows.results || []).map((r:any) => ({
        ...publicDto(r, gallery.get(r.id)),
        contact_email:r.contact_email,
        status:r.status,
        application_status:r.application_status,
        review_unread:Boolean(r.review_unread),
        review_expires_at:r.review_expires_at,
        listing_expires_at:r.listing_expires_at,
        decline_reason:r.decline_reason,
        gallery_positions:(gallery.get(r.id) || []).map((image: any) => Number(image.position)),
        invalid_social_links: invalidSocialLinkKeys(r.social_links),
      }));
      return json({
        ok: true,
        profiles,
        unread_count: Number(counts?.unread_count || 0),
        pending_decision_count: Number(counts?.pending_decision_count || 0),
        approved_count: Number(counts?.approved_count || 0),
      });
    }
    if (seg.length === 3 && seg[0] === "profile" && seg[2] === "review" && request.method === "PATCH") {
      requireJson(request);
      const body = await readJson(request, 4096);
      const action = clean(body.action, 24);
      const old = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if (!old) return error("Profile not found", 404);
      const timestamp = now();
      const fromStatus = String(old.application_status || (old.status === "published" ? "published" : "new"));
      if (action === "mark_read") {
        if (fromStatus !== "new" || !old.review_unread) return json({ ok: true, unread: false });
        const result = await env.DB.batch([
          env.DB.prepare("UPDATE spotlight_profiles SET review_unread=0 WHERE id=? AND application_status='new' AND review_unread=1").bind(seg[1]),
          env.DB.prepare(
            "INSERT INTO spotlight_review_events(id,profile_id,actor,action,from_status,to_status,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()>0",
          ).bind(ID(),seg[1],actor,"mark_read",fromStatus,fromStatus,timestamp),
        ]);
        if ((result[0]?.meta.changes || 0) !== 1) return error("Profile changed during review. Refresh and try again.", 409);
        return json({ ok: true, unread: false });
      }

      let toStatus: string;
      let updateSql: string;
      let updateArgs: unknown[];
      let reason: string | null = null;
      if (action === "start_review" && fromStatus === "new") {
        toStatus = "under_review";
        updateSql = "UPDATE spotlight_profiles SET application_status='under_review',review_unread=0,reviewed_at=COALESCE(reviewed_at,?) WHERE id=? AND application_status='new'";
        updateArgs = [timestamp,seg[1]];
      } else if (action === "approve" && ["new","under_review"].includes(fromStatus)) {
        toStatus = "approved";
        updateSql = "UPDATE spotlight_profiles SET application_status='approved',review_unread=0,review_expires_at=?,reviewed_at=COALESCE(reviewed_at,?),decided_at=? WHERE id=? AND application_status IN ('new','under_review')";
        updateArgs = [timestamp + SPOTLIGHT_TERM_SECONDS,timestamp,timestamp,seg[1]];
      } else if (action === "decline" && ["new","under_review"].includes(fromStatus)) {
        reason = cleanDescription(body.reason).slice(0, 1000);
        if (reason.length < 10) throw new HttpError(422, "decline_reason_required", "Provide a clear decline reason of at least 10 characters.");
        toStatus = "declined";
        updateSql = "UPDATE spotlight_profiles SET application_status='declined',review_unread=0,decline_reason=?,review_expires_at=?,reviewed_at=COALESCE(reviewed_at,?),decided_at=? WHERE id=? AND application_status IN ('new','under_review')";
        updateArgs = [reason,timestamp + 7 * 86400,timestamp,timestamp,seg[1]];
      } else {
        throw new HttpError(409, "invalid_review_transition", "This application can no longer make that review transition. Refresh the queue and try again.");
      }

      const statements = [
        env.DB.prepare(updateSql).bind(...updateArgs),
        env.DB.prepare(
          "INSERT INTO spotlight_review_events(id,profile_id,actor,action,from_status,to_status,reason,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0",
        ).bind(ID(),seg[1],actor,action,fromStatus,toStatus,reason,timestamp),
      ];
      const result = await env.DB.batch(statements);
      if ((result[0]?.meta.changes || 0) !== 1) return error("Profile changed during review. Refresh and try again.", 409);
      return json({ ok: true, application_status: toStatus, email_available: Boolean(old.contact_email) });
    }
    if (seg.length === 3 && seg[0] === "profile" && seg[2] === "image" && request.method === "PUT") return uploadSpotlightImage(request,env,seg[1]!);
    if (seg.length === 4 && seg[0] === "profile" && seg[2] === "gallery" && /^[1-4]$/.test(seg[3]!) && request.method === "PUT") return uploadSpotlightImage(request,env,seg[1]!,Number(seg[3]));
    if (seg.length === 4 && seg[0] === "profile" && seg[2] === "gallery" && /^[1-4]$/.test(seg[3]!) && request.method === "DELETE") {
      await deleteSpotlightGalleryImage(env,seg[1]!,Number(seg[3]));
      return json({ok:true});
    }
    if (seg.length === 3 && seg[0] === "profile" && seg[2] === "image" && request.method === "GET") {
      const row=await env.DB.prepare("SELECT image_key,image_content_type FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if(!row?.image_key)return error("Image not found",404);
      const object=await env.BUCKET.get(row.image_key);
      if(!object)return error("Image not found",404);
      return new Response(object.body,{headers:{"Content-Type":row.image_content_type || "image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    if (seg.length === 4 && seg[0] === "profile" && seg[2] === "gallery" && /^[1-4]$/.test(seg[3]!) && request.method === "GET") {
      const row=await env.DB.prepare("SELECT image_key,image_content_type FROM spotlight_gallery_images WHERE profile_id=? AND position=?").bind(seg[1],Number(seg[3])).first<any>();
      if(!row?.image_key)return error("Image not found",404);
      const object=await env.BUCKET.get(row.image_key);
      if(!object)return error("Image not found",404);
      return new Response(object.body,{headers:{"Content-Type":row.image_content_type || "image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    if (seg.length === 2 && seg[0] === "profile" && request.method === "PATCH") {
      requireJson(request); const b = await readJson(request, 32 * 1024);
      const old = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if (!old) return error("Profile not found",404);
      if (b.status !== undefined && !["pending","published","archived"].includes(String(b.status))) {
        throw new HttpError(422, "invalid_status", "Choose pending, published or archived.");
      }
      const status = b.status === undefined ? old.status : String(b.status);
      const applicationStatus = String(old.application_status || (old.status === "published" ? "published" : "new"));
      const displayName = b.display_name === undefined ? old.display_name : clean(b.display_name, 80);
      const tagline = b.tagline === undefined ? old.tagline : clean(b.tagline, 120);
      const description = b.description === undefined ? old.description : cleanDescription(b.description);
      const category = b.category === undefined ? old.category : clean(b.category, 40);
      const contactEmail = b.contact_email === undefined ? old.contact_email : clean(b.contact_email, 254).toLowerCase();
      const website = b.website_url === undefined ? old.website_url : (b.website_url ? safeWebsiteUrl(b.website_url) : null);
      const songTrack = b.song_url === undefined ? (old.song_metadata ? spotifyTrack(JSON.parse(old.song_metadata).url) : null) : (b.song_url ? spotifyTrack(b.song_url) : null);
      if (b.song_url && !songTrack) throw new HttpError(422, "invalid_spotify_track", "Use a public Spotify track link.");
      const song = b.song_url === undefined ? (old.song_metadata ? JSON.parse(old.song_metadata) : null) : (songTrack ? await spotifyMetadata(songTrack) : null);
      const video = b.video_url === undefined ? (old.video_metadata ? JSON.parse(old.video_metadata) : null) : (b.video_url ? featuredVideo(b.video_url) : null);
      if (b.video_url && !video) throw new HttpError(422, "invalid_featured_video", "Use a public YouTube video or Twitch channel, VOD or clip URL.");
      const social = b.social_links === undefined ? publicSocialLinks(old.social_links) : checkedSocialLinks(b.social_links);
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30 || !CATEGORIES.has(category)) throw new HttpError(422, "invalid_profile", "Check the name, tagline, description and category.");
      if (b.contact_email !== undefined && contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new HttpError(422, "invalid_email", "Enter a valid contact email, or leave the field blank.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      if (b.featured === true && status !== "published") throw new HttpError(422, "feature_requires_published", "Publish the profile before featuring it.");
      if (status === "published" && !["approved","published"].includes(applicationStatus)) {
        throw new HttpError(409, "application_not_approved", "Approve this application in the review queue before publishing it.");
      }
      const featured = status !== "published" ? null : b.featured === true ? now()+86400 : b.featured === false ? null : old.featured_until;
      const updated = now();
      if (status === "published" && old.status === "published" && old.listing_expires_at
        && Number(old.listing_expires_at) <= updated && (b.status === "published" || b.featured === true)) {
        throw new HttpError(409, "listing_expired", "This listing has expired and cannot be republished or featured.");
      }
      const nextApplicationStatus = status === "published" ? "published" : applicationStatus;
      const listingExpiresAt = status === "published"
        ? (old.status === "published" ? old.listing_expires_at : updated + SPOTLIGHT_TERM_SECONDS)
        : null;
      // Only one profile can hold the daily featured placement at a time.
      const statements = [
        env.DB.prepare("UPDATE spotlight_profiles SET featured_until=NULL WHERE featured_until > ? AND id<>?").bind(updated,seg[1]),
        env.DB.prepare(
          "UPDATE spotlight_profiles SET display_name=?,tagline=?,description=?,category=?,contact_email=?,website_url=?,social_links=?,song_metadata=?,video_metadata=?,status=?,application_status=?,review_expires_at=CASE WHEN ?='published' THEN NULL ELSE review_expires_at END,listing_expires_at=?,featured_until=?,updated_at=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END WHERE id=?",
        ).bind(displayName,tagline,description,category,contactEmail,website,JSON.stringify(social),song ? JSON.stringify(song) : null,video ? JSON.stringify(video) : null,status,nextApplicationStatus,status,listingExpiresAt,featured,updated,status,updated,seg[1])
      ];
      if (status === "published" && old.status !== "published") {
        statements.push(env.DB.prepare(
          "INSERT INTO spotlight_review_events(id,profile_id,actor,action,from_status,to_status,created_at) SELECT ?,?,?,'publish',?,'published',? WHERE changes()>0",
        ).bind(ID(),seg[1],actor,applicationStatus,updated));
      }
      await env.DB.batch(statements);
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      return json({
        ok:true,
        profile:{
          ...publicDto(row),
          contact_email:row.contact_email,
          status:row.status,
          application_status:row.application_status,
          listing_expires_at:row.listing_expires_at,
        },
      });
    }
    if (seg.length === 2 && seg[0] === "profile" && request.method === "DELETE") {
      const old=await env.DB.prepare("SELECT image_key,image_size FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if (!old) return error("Profile not found", 404);
      const galleryRows = await env.DB.prepare("SELECT image_key FROM spotlight_gallery_images WHERE profile_id=?").bind(seg[1]).all<any>();
      const imageKeys = [old.image_key, ...(galleryRows.results || []).map((image: any) => image.image_key)].filter(Boolean);
      for (const imageKey of imageKeys) {
        try {
          await env.BUCKET.delete(imageKey);
        } catch (e) {
          console.error("[spotlight] profile gallery image delete failed", e);
          await markUncertain(env, "spotlight_profile_image_delete_failed");
          throw new HttpError(503, "image_delete_unverified", "A profile image could not be safely deleted. Storage verification has been scheduled.");
        }
      }
      let deleted;
      try {
        deleted = await env.DB.prepare(
          "DELETE FROM spotlight_profiles WHERE id=? AND image_key IS ?",
        ).bind(seg[1], old.image_key ?? null).run();
      } catch (e) {
        console.error("[spotlight] profile deletion could not be committed after image removal", e);
        await markUncertain(env, "spotlight_profile_delete_commit_failed");
        throw new HttpError(503, "profile_delete_unverified", "The images were removed but the profile deletion could not be confirmed. Storage verification has been scheduled.");
      }
      if ((deleted.meta.changes || 0) !== 1) {
        if (imageKeys.length) await reconcileSpotlightImageStorage(env, "spotlight_profile_delete_conflict");
        return error("Profile changed during deletion. Refresh and try again.", 409);
      }
      if (imageKeys.length) await reconcileSpotlightImageStorage(env, "spotlight_profile_deleted");
      return json({ ok:true });
    }
    if (seg.length === 1 && seg[0] === "analytics" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT p.id,p.display_name,COALESCE(SUM(m.views),0) views,COALESCE(SUM(m.unique_views),0) unique_views,COALESCE(SUM(m.outbound_clicks),0) outbound_clicks,COALESCE(SUM(m.featured_impressions),0) featured_impressions FROM spotlight_profiles p LEFT JOIN spotlight_daily_metrics m ON m.profile_id=p.id GROUP BY p.id ORDER BY views DESC LIMIT 100"
      ).all<any>();
      return json({ ok:true, profiles:rows.results || [] });
    }
    return error("Not found",404);
  });
}

// Spotlight images share the existing atomic storage ledger and the same 3 GiB ceiling as Deliver.
async function releaseSpotlightImagePending(env: Env, uploadId: string, size: number): Promise<void> {
  try {
    await releaseStoredPending(env, uploadId, size);
  } catch (e) {
    console.error("[spotlight] image deletion accounting failed", e);
    await markUncertain(env, "spotlight_image_storage_release_failed");
    throw new HttpError(503, "storage_accounting_unverified", "The image was deleted, but storage accounting needs verification. Uploads are paused until it is reconciled.");
  }
}

async function reconcileSpotlightImageStorage(env: Env, reason: string): Promise<void> {
  await markUncertain(env, reason);
  try {
    const result = await reconcileStorage(env);
    if (result.deferred || result.state.needs_reconcile === 1) {
      throw new Error("Storage reconciliation was deferred while another upload is in progress.");
    }
  } catch (e) {
    console.error("[spotlight] image deletion storage reconciliation failed", e);
    await markUncertain(env, "spotlight_image_storage_reconcile_failed");
    throw new HttpError(503, "storage_accounting_unverified", "The profile image was deleted, but shared storage accounting still needs verification. Uploads are paused until it is reconciled.");
  }
}

async function deleteSpotlightGalleryImage(env: Env, profileId: string, position: number): Promise<void> {
  const image = await env.DB.prepare(
    "SELECT image_key FROM spotlight_gallery_images WHERE profile_id=? AND position=?",
  ).bind(profileId, position).first<{ image_key: string }>();
  if (!image) throw new HttpError(404, "image_not_found", "Image not found.");
  try {
    await env.BUCKET.delete(image.image_key);
  } catch (e) {
    console.error("[spotlight] gallery image delete failed", e);
    await markUncertain(env, "spotlight_gallery_image_delete_failed");
    throw new HttpError(503, "image_delete_unverified", "The image could not be safely deleted. Storage verification has been scheduled.");
  }
  let deleted;
  try {
    deleted = await env.DB.prepare(
      "DELETE FROM spotlight_gallery_images WHERE profile_id=? AND position=? AND image_key=?",
    ).bind(profileId, position, image.image_key).run();
  } catch (e) {
    console.error("[spotlight] gallery image metadata deletion failed after R2 removal", e);
    await reconcileSpotlightImageStorage(env, "spotlight_gallery_image_metadata_delete_failed");
    throw new HttpError(503, "image_delete_unverified", "The image was removed but its profile data could not be updated. Refresh and check again.");
  }
  if ((deleted.meta.changes || 0) !== 1) {
    await reconcileSpotlightImageStorage(env, "spotlight_gallery_image_changed_during_delete");
    throw new HttpError(409, "image_changed", "The image changed during deletion. Refresh and try again.");
  }
  await reconcileSpotlightImageStorage(env, "spotlight_gallery_image_deleted");
}

async function deletePendingSpotlightSubmission(env: Env, profileId: string): Promise<void> {
  const profile = await env.DB.prepare(
    "SELECT image_key FROM spotlight_profiles WHERE id=? AND status='pending'",
  ).bind(profileId).first<{ image_key: string | null }>();
  if (!profile) throw new HttpError(409, "submission_no_longer_pending", "The submitted profile is no longer pending review.");
  const gallery = await env.DB.prepare(
    "SELECT image_key FROM spotlight_gallery_images WHERE profile_id=?",
  ).bind(profileId).all<{ image_key: string }>();
  const keys = [profile.image_key, ...(gallery.results || []).map(image => image.image_key)].filter((key): key is string => Boolean(key));
  for (const key of keys) {
    try {
      await env.BUCKET.delete(key);
    } catch (e) {
      console.error("[spotlight] failed submission image cleanup failed", e);
      await markUncertain(env, "spotlight_submission_image_cleanup_failed");
      throw new HttpError(503, "submission_image_cleanup_pending", "The uploaded images could not be safely removed. Storage verification has been scheduled.");
    }
  }
  let deleted;
  try {
    deleted = await env.DB.prepare(
      "DELETE FROM spotlight_profiles WHERE id=? AND status='pending' AND image_key IS ? AND NOT EXISTS (SELECT 1 FROM spotlight_gallery_images WHERE profile_id=?)",
    ).bind(profileId, profile.image_key, profileId).run();
  } catch (e) {
    console.error("[spotlight] pending submission deletion failed after image cleanup", e);
    if (keys.length) await reconcileSpotlightImageStorage(env, "spotlight_submission_delete_failed");
    throw new HttpError(503, "submission_cleanup_pending", "The images were removed but the queued submission could not be deleted.");
  }
  if ((deleted.meta.changes || 0) !== 1) {
    await reconcileSpotlightImageStorage(env, "spotlight_submission_cleanup_conflict");
    throw new HttpError(409, "submission_cleanup_conflict", "The submission changed during image cleanup.");
  }
  if (keys.length) await reconcileSpotlightImageStorage(env, "spotlight_submission_images_removed");
}

async function rollbackSpotlightUpload(env: Env, uploadId: string, key: string, size: number): Promise<void> {
  try {
    await env.BUCKET.delete(key);
  } catch (e) {
    console.error("[spotlight] upload cleanup failed; retaining shared storage accounting", e);
    try {
      const pending = await getPendingUpload(env, uploadId);
      if (pending?.state === "stored") await holdStoredUploadReservation(env, uploadId, size);
    } catch (holdError) {
      console.error("[spotlight] unable to retain the upload reservation after cleanup failure", holdError);
    }
    await markUncertain(env, "spotlight_image_upload_cleanup_failed");
    return;
  }

  try {
    const pending = await getPendingUpload(env, uploadId);
    if (pending?.state === "stored") {
      await releaseStoredPending(env, uploadId, size);
    } else if (pending && (pending.state === "reserved" || pending.state === "uploading")) {
      await releaseReservation(env, uploadId, size);
    } else {
      await markUncertain(env, "spotlight_image_upload_ledger_missing");
    }
  } catch (e) {
    console.error("[spotlight] upload rollback accounting failed", e);
    await markUncertain(env, "spotlight_image_upload_rollback_failed");
  }
}

export async function uploadSpotlightImage(request:Request,env:Env,profileId:string,position=0):Promise<Response>{
  if(!/^[a-f0-9]{20}$/i.test(profileId))return error("Profile not found",404);
  if(!Number.isInteger(position)||position<0||position>2)return error("Image slot not found",404);
  const profile=await env.DB.prepare("SELECT id,image_key,image_size,application_status FROM spotlight_profiles WHERE id=?").bind(profileId).first<any>();
  if(!profile)return error("Profile not found",404);
  if(["declined","expired"].includes(String(profile.application_status)))return error("This application is no longer accepting image changes.",409);
  const previous = position === 0
    ? profile
    : await env.DB.prepare("SELECT image_key,image_size FROM spotlight_gallery_images WHERE profile_id=? AND position=?").bind(profileId,position).first<any>();
  const previousKey=previous?.image_key??null,previousSize=Number(previous?.image_size||0);
  const contentType=request.headers.get("Content-Type")||"";
  const type=contentType.split(";")[0]?.trim().toLowerCase()||"";
  const declaredHeader=request.headers.get("Content-Length");
  const declared=declaredHeader===null?null:Number(declaredHeader);
  const maxBytes=5*1024*1024;
  if(!["image/jpeg","image/png","image/webp"].includes(type))throw new HttpError(415,"invalid_image_type","Choose a JPG, PNG or WebP image.");
  if(declared!==null&&(!Number.isInteger(declared)||declared<1||declared>maxBytes))throw new HttpError(413,"image_too_large","Spotlight images must be no larger than 5 MB.");
  const reader=request.body?.getReader();
  if(!reader)throw new HttpError(422,"empty_image","Choose an image to upload.");
  const chunks:Uint8Array[]=[];let total=0;
  for(;;){
    const part=await reader.read();
    if(part.done)break;
    total+=part.value.byteLength;
    if(total>maxBytes){await reader.cancel();throw new HttpError(413,"image_too_large","Spotlight images must be no larger than 5 MB.");}
    chunks.push(part.value);
  }
  if(total<1)throw new HttpError(422,"empty_image","Choose an image to upload.");
  if(declared!==null&&total!==declared)throw new HttpError(422,"image_size_mismatch","The uploaded image size could not be verified.");
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const valid=type==="image/jpeg"
    ? bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217
    : type==="image/png"
      ? bytes.length>=20&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&new TextDecoder().decode(bytes.slice(-8,-4))==="IEND"
      : bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true)+8===bytes.length&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
  if(!valid)throw new HttpError(422,"invalid_image","The file contents do not match the selected image type.");
  const dimensions = readImageDimensions(bytes,type);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new HttpError(422,"invalid_image_dimensions","The image dimensions could not be verified.");
  }
  if (Math.max(dimensions.width,dimensions.height) > 2000) {
    throw new HttpError(422,"image_dimensions_too_large","Resize images so their longest side is no more than 2,000 pixels.");
  }
  const uploadId=crypto.randomUUID().replace(/-/g,"").slice(0,16),fileId=crypto.randomUUID().replace(/-/g,"").slice(0,16),key="spotlight/"+profileId+"/"+uploadId;
  await reserveUpload(env,{uploadId,deliveryId:profileId,fileId,r2Key:key,fileName:"spotlight-profile-image",fileSize:bytes.length,contentType:type});
  let writeAttempted=false,attached=false;
  const deletionId=crypto.randomUUID().replace(/-/g,"").slice(0,16);
  try{
    if(!(await claimUpload(env,uploadId)))throw new HttpError(409,"upload_conflict","The image upload could not be started.");
    writeAttempted=true;
    await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});
    if(!(await commitUpload(env,uploadId,bytes.length)))throw new HttpError(409,"upload_conflict","The image upload could not be completed.");
    const previousFileId=crypto.randomUUID().replace(/-/g,"").slice(0,16);
    const attachedAt=now();
    const attachStatement = position === 0
      ? env.DB.prepare("UPDATE spotlight_profiles SET image_key=?,image_size=?,image_content_type=?,updated_at=? WHERE id=? AND image_key IS ? AND application_status NOT IN ('declined','expired')").bind(key,bytes.length,type,attachedAt,profileId,previousKey)
      : env.DB.prepare("INSERT INTO spotlight_gallery_images(profile_id,position,image_key,image_size,image_content_type,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,position) DO UPDATE SET image_key=excluded.image_key,image_size=excluded.image_size,image_content_type=excluded.image_content_type,created_at=excluded.created_at WHERE spotlight_gallery_images.image_key IS ? AND EXISTS (SELECT 1 FROM spotlight_profiles WHERE id=? AND application_status NOT IN ('declined','expired'))").bind(profileId,position,key,bytes.length,type,attachedAt,previousKey,profileId);
    const attachedResult=await env.DB.batch([
      attachStatement,
      env.DB.prepare("DELETE FROM pending_uploads WHERE upload_id=? AND state='stored' AND changes()>0").bind(uploadId),
      env.DB.prepare(
        `INSERT INTO pending_uploads
           (upload_id,delivery_id,file_id,r2_key,file_name,file_size,content_type,created_at,confirmed_at,state,stored_at)
         SELECT ?,?,?,?,?,?,?,?,NULL,'stored',?
          WHERE changes()>0 AND ? IS NOT NULL`,
      ).bind(deletionId,profileId,previousFileId,previousKey,"spotlight-previous-image",previousSize,null,attachedAt,attachedAt,previousKey),
      env.DB.prepare(
        "UPDATE storage_state SET mutation_seq=mutation_seq+1,last_mutation_at=? WHERE id=1 AND changes()>0",
      ).bind(attachedAt)
    ]);
    if((attachedResult[0]?.meta.changes??0)!==1) {
      throw new HttpError(409,"image_replaced_concurrently","Another image update or profile deletion completed first. Refresh the profile and try again.");
    }
    attached=true;
    if(previousKey){
      try {
        await env.BUCKET.delete(previousKey);
      } catch (e) {
        console.error("[spotlight] previous image delete failed; retaining both images in shared accounting", e);
        await markUncertain(env,"spotlight_previous_image_delete_failed");
        throw new HttpError(503,"previous_image_cleanup_pending","The new image is active, but the previous image could not be deleted. Storage verification has been scheduled.");
      }
      await releaseSpotlightImagePending(env,deletionId,previousSize);
    }
    return json({ok:true,image_size:bytes.length});
  }catch(e){
    if(!attached){
      let current;
      try {
        current=position === 0
          ? await env.DB.prepare("SELECT image_key FROM spotlight_profiles WHERE id=?").bind(profileId).first<any>()
          : await env.DB.prepare("SELECT image_key FROM spotlight_gallery_images WHERE profile_id=? AND position=?").bind(profileId,position).first<any>();
      } catch (lookupError) {
        console.error("[spotlight] unable to verify image attachment after upload error",lookupError);
        await markUncertain(env,"spotlight_image_attachment_unknown");
        throw e;
      }
      if(current?.image_key===key) {
        await markUncertain(env,"spotlight_image_attachment_unknown");
      } else if(writeAttempted) {
        await rollbackSpotlightUpload(env,uploadId,key,bytes.length);
      } else {
        await releaseReservation(env,uploadId,bytes.length);
      }
    }
    throw e;
  }
}
