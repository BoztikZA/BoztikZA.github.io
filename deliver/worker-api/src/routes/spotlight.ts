import type { Env } from "../types";
import { HttpError } from "../types";
import { requireSession } from "../lib/auth";
import { localDay } from "../lib/db";
import { reserveUpload, claimUpload, commitUpload, getPendingUpload, holdStoredUploadReservation, releaseReservation, releaseStoredPending, markUncertain, reconcileStorage } from "../lib/storage";
import { assertSameSiteOrigin, checkPublicRate, error, json, readJson, requireJson, segments, wrap } from "./util";

const CATEGORIES = new Set(["small-business","youtube","twitch","gaming","photography","design","music","creator","freelance","other"]);
const ID = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const now = () => Math.floor(Date.now() / 1000);
const day = (env: Env) => localDay(env);
const clean = (v: unknown, max: number) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";

const SOCIAL_HOSTS: Record<string, string[]> = {
  youtube: ["youtube.com", "youtu.be"],
  twitch: ["twitch.tv"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.watch"],
  linkedin: ["linkedin.com", "lnkd.in"],
  x: ["x.com", "twitter.com"],
  spotify: ["spotify.com", "spotify.link"],
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

function isAllowedPlatformHost(hostname: string, roots: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return roots.some(root => host === root || host.endsWith("." + root));
}

export function safeSocialUrl(platform: string, value: unknown): string | null {
  const url = safeUrl(value);
  if (!url || !SOCIAL_HOSTS[platform]) return null;
  const parsed = new URL(url);
  return isAllowedPlatformHost(parsed.hostname, SOCIAL_HOSTS[platform]) ? url : null;
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

function publicDto(row: any) {
  return {
    id: row.id, slug: row.slug, display_name: row.display_name, tagline: row.tagline,
    description: row.description, category: row.category, website_url: row.website_url,
    social_links: publicSocialLinks(row.social_links), song: row.song_metadata ? JSON.parse(row.song_metadata) : null, image_url: row.image_key && row.status === "published" ? "https://deliver-api.boztik.com/api/public/spotlight/image/" + row.id : null,
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
      const clauses = ["status='published'"];
      const bindings: (string | number)[] = [];
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
        profiles: page.map(publicDto),
        next_cursor: nextCursor,
        has_more: hasMore,
      }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" });
    }
    if (request.method === "GET" && seg[0] === "image" && seg.length === 2) {
      const row = await env.DB.prepare("SELECT image_key,image_content_type FROM spotlight_profiles WHERE id=? AND status='published'").bind(seg[1]).first<any>();
      if (!row?.image_key) return error("Image not found",404);
      const object = await env.BUCKET.get(row.image_key);
      if (!object) return error("Image not found",404);
      return new Response(object.body,{headers:{"Content-Type":row.image_content_type || "image/jpeg","Cache-Control":"public, max-age=3600","X-Content-Type-Options":"nosniff"}});
    }
    if (request.method === "GET" && seg[0] === "share" && seg.length === 2) {
      checkPublicRate(request, env, "spotlight-share", 2);
      const slug = clean(seg[1], 60);
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) return error("Profile not found", 404);
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE slug=? AND status='published'").bind(slug).first<any>();
      if (!row) return error("Profile not found", 404);
      const profile = publicDto(row);
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
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300, stale-while-revalidate=600", "X-Robots-Tag": "noindex" } });
    }
    if (request.method === "GET" && seg[0] === "profile" && seg.length === 2) {
      checkPublicRate(request, env, "spotlight-profile", 2);
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE slug=? AND status='published'").bind(seg[1]).first<any>();
      if (!row) return error("Profile not found", 404);
      return json({ ok: true, profile: publicDto(row) }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" });
    }
    if (request.method === "POST" && seg[0] === "submit" && seg.length === 1) {
      checkPublicRate(request, env, "spotlight-submit", 0.25);
      assertSameSiteOrigin(request, env); requireJson(request);
      await checkSpotlightSubmissionRate(request, env);
      const b = await readJson(request, 8 * 1024);
      // Honeypot: silently accept automated submissions without storing them.
      if (clean(b.company_website, 200)) return json({ ok: true });
      const displayName = clean(b.display_name, 80), tagline = clean(b.tagline, 120);
      const description = clean(b.description, 900), category = clean(b.category, 40);
      const email = clean(b.contact_email, 254).toLowerCase();
      const songTrack = b.song_url ? spotifyTrack(b.song_url) : null;
      if (b.song_url && !songTrack) throw new HttpError(422, "invalid_spotify_track", "Use a public Spotify track link.");
      const song = songTrack ? await spotifyMetadata(songTrack) : null;
      const website = safeUrl(b.website_url);
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30) throw new HttpError(422, "invalid_profile", "Please provide a name, a clear tagline and a description of at least 30 characters.");
      if (!CATEGORIES.has(category)) throw new HttpError(422, "invalid_category", "Choose a valid category.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "invalid_email", "Enter a valid contact email.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      if (b.consent !== true) throw new HttpError(422, "consent_required", "Confirm that you own or are authorised to submit this profile.");
      const social: Record<string,string> = {};
      if (b.social_links && typeof b.social_links === "object" && !Array.isArray(b.social_links)) {
        for (const key of ["youtube","twitch","instagram","tiktok","facebook","linkedin","x","spotify"]) {
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
        `INSERT INTO spotlight_profiles (id,slug,display_name,tagline,description,category,contact_email,website_url,social_links,song_metadata,status,created_at,updated_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,'pending',?,?
          WHERE NOT EXISTS (
            SELECT 1 FROM spotlight_profiles
             WHERE contact_email=? AND lower(display_name)=lower(?) AND status<>'archived' AND created_at>=?
          )`,
      ).bind(id,slug,displayName,tagline,description,category,email,website,JSON.stringify(social),song ? JSON.stringify(song) : null,timestamp,timestamp,email,displayName,timestamp - 86400).run();
      if ((inserted.meta.changes || 0) === 0) {
        return json({
          ok: true,
          duplicate: true,
          message: "A recent submission with those details is already in review. You do not need to submit it again.",
        });
      }
      // Attempt the owner notification before responding so the submitter sees
      // whether the email alert was sent. The D1 submission is already safely
      // stored, so provider failure never loses the profile.
      const notificationSent = await notifySpotlightSubmission(env, { displayName, tagline, category, email, website, id })
        .catch(e => { console.error("[spotlight] notification failed", e); return false; });
      return json({
        ok: true,
        notification_sent: notificationSent,
        message: notificationSent
          ? "Your profile has been received. The Boztik team has also been notified."
          : "Your profile has been safely received for review, but the email alert could not be sent. You do not need to submit it again."
      }, 201);
    }
    if (request.method === "POST" && seg[0] === "event" && seg.length === 1) {
      checkPublicRate(request, env, "spotlight-event", 2);
      assertSameSiteOrigin(request, env); requireJson(request);
      const b = await readJson(request, 1024);
      const eventId = clean(b.event_id, 64), profileId = clean(b.profile_id, 32), type = b.type;
      const visitorId = clean(b.visitor_id, 64);
      if (!/^[a-zA-Z0-9_-]{12,64}$/.test(eventId) || !/^[a-f0-9]{20}$/i.test(profileId) || !["view","click"].includes(String(type)) || (type === "view" && !/^[a-f0-9-]{36}$/i.test(visitorId))) throw new HttpError(422, "invalid_event", "Invalid analytics event.");
      const profile = await env.DB.prepare("SELECT id FROM spotlight_profiles WHERE id=? AND status='published'").bind(profileId).first();
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
      const featured = await env.DB.prepare("SELECT id FROM spotlight_profiles WHERE id=? AND status='published' AND featured_until>?").bind(profileId,t).first();
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
    await requireSession(request, env);
    const seg = segments(path);
    if (seg.length === 1 && seg[0] === "profile" && request.method === "POST") {
      requireJson(request);
      const b = await readJson(request, 12 * 1024);
      const displayName = clean(b.display_name, 80), tagline = clean(b.tagline, 120);
      const description = clean(b.description, 900), category = clean(b.category, 40);
      const email = clean(b.contact_email, 254).toLowerCase();
      const website = b.website_url ? safeUrl(b.website_url) : null;
      const songTrack = b.song_url ? spotifyTrack(b.song_url) : null;
      if (b.song_url && !songTrack) throw new HttpError(422, "invalid_spotify_track", "Use a public Spotify track link.");
      const song = songTrack ? await spotifyMetadata(songTrack) : null;
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30) throw new HttpError(422, "invalid_profile", "Please provide a name, a clear tagline and a description of at least 30 characters.");
      if (!CATEGORIES.has(category)) throw new HttpError(422, "invalid_category", "Choose a valid category.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "invalid_email", "Enter a valid contact email.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      const social: Record<string,string> = {};
      if (b.social_links && typeof b.social_links === "object" && !Array.isArray(b.social_links)) {
        for (const key of ["youtube","twitch","instagram","tiktok","facebook","linkedin","x","spotify"]) {
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
        "INSERT INTO spotlight_profiles (id,slug,display_name,tagline,description,category,contact_email,website_url,social_links,song_metadata,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)"
      ).bind(id,slug,displayName,tagline,description,category,email,website,JSON.stringify(social),song ? JSON.stringify(song) : null,timestamp,timestamp).run();
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(id).first<any>();
      return json({ ok:true, profile:{...publicDto(row),contact_email:row.contact_email,status:row.status} }, 201);
    }
    if (!seg.length && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT * FROM spotlight_profiles ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, created_at DESC LIMIT 300").all<any>();
      return json({ ok: true, profiles: (rows.results || []).map((r:any) => ({
        ...publicDto(r),
        contact_email:r.contact_email,
        status:r.status,
        invalid_social_links: invalidSocialLinkKeys(r.social_links),
      })) });
    }
    if (seg.length === 3 && seg[0] === "profile" && seg[2] === "image" && request.method === "PUT") return uploadSpotlightImage(request,env,seg[1]!);
    if (seg.length === 3 && seg[0] === "profile" && seg[2] === "image" && request.method === "GET") {
      const row=await env.DB.prepare("SELECT image_key,image_content_type FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if(!row?.image_key)return error("Image not found",404);
      const object=await env.BUCKET.get(row.image_key);
      if(!object)return error("Image not found",404);
      return new Response(object.body,{headers:{"Content-Type":row.image_content_type || "image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    if (seg.length === 2 && seg[0] === "profile" && request.method === "PATCH") {
      requireJson(request); const b = await readJson(request, 8 * 1024);
      const old = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if (!old) return error("Profile not found",404);
      const status = ["pending","published","archived"].includes(String(b.status)) ? String(b.status) : old.status;
      const displayName = b.display_name === undefined ? old.display_name : clean(b.display_name, 80);
      const tagline = b.tagline === undefined ? old.tagline : clean(b.tagline, 120);
      const description = b.description === undefined ? old.description : clean(b.description, 900);
      const category = b.category === undefined ? old.category : clean(b.category, 40);
      const contactEmail = b.contact_email === undefined ? old.contact_email : clean(b.contact_email, 254).toLowerCase();
      const website = b.website_url === undefined ? old.website_url : (b.website_url ? safeUrl(b.website_url) : null);
      const songTrack = b.song_url === undefined ? (old.song_metadata ? spotifyTrack(JSON.parse(old.song_metadata).url) : null) : (b.song_url ? spotifyTrack(b.song_url) : null);
      if (b.song_url && !songTrack) throw new HttpError(422, "invalid_spotify_track", "Use a public Spotify track link.");
      const song = b.song_url === undefined ? (old.song_metadata ? JSON.parse(old.song_metadata) : null) : (songTrack ? await spotifyMetadata(songTrack) : null);
      const social = b.social_links === undefined ? publicSocialLinks(old.social_links) : checkedSocialLinks(b.social_links);
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30 || !CATEGORIES.has(category)) throw new HttpError(422, "invalid_profile", "Check the name, tagline, description and category.");
      if (b.contact_email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new HttpError(422, "invalid_email", "Enter a valid contact email.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      if (b.featured === true && status !== "published") throw new HttpError(422, "feature_requires_published", "Publish the profile before featuring it.");
      const featured = status !== "published" ? null : b.featured === true ? now()+86400 : b.featured === false ? null : old.featured_until;
      const updated = now();
      // Only one profile can hold the daily featured placement at a time.
      await env.DB.batch([
        env.DB.prepare("UPDATE spotlight_profiles SET featured_until=NULL WHERE featured_until > ? AND id<>?").bind(updated,seg[1]),
        env.DB.prepare("UPDATE spotlight_profiles SET display_name=?,tagline=?,description=?,category=?,contact_email=?,website_url=?,social_links=?,song_metadata=?,status=?,featured_until=?,updated_at=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END WHERE id=?").bind(displayName,tagline,description,category,contactEmail,website,JSON.stringify(social),song ? JSON.stringify(song) : null,status,featured,updated,status,updated,seg[1])
      ]);
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      return json({ ok:true, profile:{...publicDto(row),contact_email:row.contact_email,status:row.status} });
    }
    if (seg.length === 2 && seg[0] === "profile" && request.method === "DELETE") {
      const old=await env.DB.prepare("SELECT image_key,image_size FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if (!old) return error("Profile not found", 404);
      if (old.image_key) {
        try {
          await env.BUCKET.delete(old.image_key);
        } catch (e) {
          console.error("[spotlight] profile image delete failed", e);
          await markUncertain(env, "spotlight_profile_image_delete_failed");
          throw new HttpError(503, "image_delete_unverified", "The profile image could not be safely deleted. Storage verification has been scheduled.");
        }
      }
      let deleted;
      try {
        deleted = await env.DB.prepare("DELETE FROM spotlight_profiles WHERE id=? AND image_key IS ?").bind(seg[1], old.image_key ?? null).run();
      } catch (e) {
        console.error("[spotlight] profile deletion could not be committed after image removal", e);
        await markUncertain(env, "spotlight_profile_delete_commit_failed");
        throw new HttpError(503, "profile_delete_unverified", "The image was removed but the profile deletion could not be confirmed. Storage verification has been scheduled.");
      }
      if ((deleted.meta.changes || 0) !== 1) return error("Profile changed during deletion. Refresh and try again.", 409);
      if (old.image_key) await reconcileSpotlightImageStorage(env, "spotlight_profile_deleted");
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

async function notifySpotlightSubmission(env: Env, item: {displayName:string;tagline:string;category:string;email:string;website:string|null;id:string}): Promise<boolean> {
  const to=env.NOTIFY_EMAIL_TO?.trim(), from=env.NOTIFY_EMAIL_FROM?.trim(), url=env.EMAIL_PROVIDER_URL?.trim();
  if(!to||!from||!url){console.warn("[spotlight] owner email notification is not configured; submission remains safely queued in D1.");return false;}
  const subject="New Boztik Spotlight submission: "+item.displayName;
  const textBody=[
    "A new Spotlight profile is waiting for review.",
    "",
    "Name: "+item.displayName,
    "Category: "+item.category,
    "Tagline: "+item.tagline,
    "Contact: "+item.email,
    "Website: "+(item.website||"Not supplied"),
    "",
    "Review it in the Boztik Command Centre > Spotlight.",
    "Submission reference: "+item.id
  ].join("\n");
  const headers:Record<string,string>={"Content-Type":"application/json"};
  if(env.EMAIL_PROVIDER_KEY)headers.Authorization="Bearer "+env.EMAIL_PROVIDER_KEY;
  const response=await fetch(url,{method:"POST",headers,body:JSON.stringify({from,to,subject,text:textBody})});
  if(!response.ok)throw new Error("Email provider returned "+response.status);
  return true;
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

export async function uploadSpotlightImage(request:Request,env:Env,profileId:string):Promise<Response>{
  if(!/^[a-f0-9]{20}$/i.test(profileId))return error("Profile not found",404);
  const profile=await env.DB.prepare("SELECT id,image_key,image_size FROM spotlight_profiles WHERE id=?").bind(profileId).first<any>();
  if(!profile)return error("Profile not found",404);
  const contentType=request.headers.get("Content-Type")||"";
  const type=contentType.split(";")[0]?.trim().toLowerCase()||"";
  const declaredHeader=request.headers.get("Content-Length");
  const declared=declaredHeader===null?null:Number(declaredHeader);
  const maxBytes=2*1024*1024;
  if(!["image/jpeg","image/png","image/webp"].includes(type))throw new HttpError(415,"invalid_image_type","Choose a JPG, PNG or WebP image.");
  if(declared!==null&&(!Number.isInteger(declared)||declared<1||declared>maxBytes))throw new HttpError(413,"image_too_large","Spotlight images must be no larger than 2 MB.");
  const reader=request.body?.getReader();
  if(!reader)throw new HttpError(422,"empty_image","Choose an image to upload.");
  const chunks:Uint8Array[]=[];let total=0;
  for(;;){
    const part=await reader.read();
    if(part.done)break;
    total+=part.value.byteLength;
    if(total>maxBytes){await reader.cancel();throw new HttpError(413,"image_too_large","Spotlight images must be no larger than 2 MB.");}
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
  const uploadId=crypto.randomUUID().replace(/-/g,"").slice(0,16),fileId=crypto.randomUUID().replace(/-/g,"").slice(0,16),key="spotlight/"+profileId+"/"+uploadId;
  await reserveUpload(env,{uploadId,deliveryId:profileId,fileId,r2Key:key,fileName:"spotlight-profile-image",fileSize:bytes.length,contentType:type});
  let writeAttempted=false,attached=false;
  const deletionId=crypto.randomUUID().replace(/-/g,"").slice(0,16);
  try{
    if(!(await claimUpload(env,uploadId)))throw new HttpError(409,"upload_conflict","The image upload could not be started.");
    writeAttempted=true;
    await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});
    if(!(await commitUpload(env,uploadId,bytes.length)))throw new HttpError(409,"upload_conflict","The image upload could not be completed.");
    const previousKey=profile.image_key,previousSize=Number(profile.image_size||0);
    const previousFileId=crypto.randomUUID().replace(/-/g,"").slice(0,16);
    const attachedAt=now();
    const attachedResult=await env.DB.batch([
      env.DB.prepare("UPDATE spotlight_profiles SET image_key=?,image_size=?,image_content_type=?,updated_at=? WHERE id=? AND image_key IS ?").bind(key,bytes.length,type,attachedAt,profileId,previousKey??null),
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
        current=await env.DB.prepare("SELECT image_key FROM spotlight_profiles WHERE id=?").bind(profileId).first<any>();
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
