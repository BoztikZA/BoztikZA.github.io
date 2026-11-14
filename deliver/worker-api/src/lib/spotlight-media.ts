/**
 * Spotlight media helpers.
 *
 * Boztik never downloads, copies or hosts YouTube, Twitch or Spotify media. A profile stores only a validated
 * platform identifier. The featured showcase renders the provider's official embed; every other surface links
 * out to the original platform.
 *
 * Everything here is pure (no Env, no D1) except `fetchSpotifyMetadata`, which takes an injectable fetch so it can
 * be tested without the network. Every value that reaches a public API response is re-validated by the
 * `normalize*` functions, so a hand-edited or legacy database row can never emit an unvalidated URL.
 */
import { HttpError } from "../types";

// ---------------------------------------------------------------------------
// Video (YouTube + Twitch)
// ---------------------------------------------------------------------------

export type FeaturedVideo = {
  platform: "youtube" | "twitch";
  id: string;
  kind: "video" | "channel" | "clip";
  url: string;
  /** Present only for YouTube Shorts so the player can use a vertical frame. */
  format?: "short";
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_SLUG = /^[A-Za-z0-9_-]{5,80}$/;
const TWITCH_CHANNEL = /^[A-Za-z0-9_]{3,25}$/;

// Twitch URLs that look like a channel name but are site pages. Embedding them would render a dead player.
const TWITCH_RESERVED = new Set([
  "about", "bits", "broadcast", "clip", "clips", "dashboard", "directory", "downloads", "drops", "embed", "event", "events",
  "friends", "inventory", "jobs", "legal", "moderator", "music", "p", "popout", "prime", "privacy", "search",
  "settings", "store", "subscriptions", "team", "turbo", "u", "videos", "wallet",
]);

/** Parses a pasted YouTube or Twitch link into a canonical, embed-safe descriptor, or null if unsupported. */
export function parseFeaturedVideo(value: unknown): FeaturedVideo | null {
  if (typeof value !== "string" || !value.trim() || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
      let id = "";
      let short = false;
      if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
      else if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      else {
        const m = url.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/);
        if (m) { id = m[2] || ""; short = m[1] === "shorts"; }
      }
      if (!YOUTUBE_ID.test(id)) return null;
      return {
        platform: "youtube", id, kind: "video", url: "https://www.youtube.com/watch?v=" + id,
        ...(short ? { format: "short" as const } : {}),
      };
    }
    if (host === "twitch.tv" || host === "clips.twitch.tv") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (host === "clips.twitch.tv") {
        const slug = parts[0] || "";
        return TWITCH_SLUG.test(slug) ? { platform: "twitch", id: slug, kind: "clip", url: "https://clips.twitch.tv/" + slug } : null;
      }
      const first = parts[0] || "";
      if (parts.length === 2 && first === "videos" && /^\d{5,20}$/.test(parts[1]!)) {
        return { platform: "twitch", id: parts[1]!, kind: "video", url: "https://www.twitch.tv/videos/" + parts[1] };
      }
      const clipSlug = parts.length === 2 && first === "clip" ? parts[1]! : parts.length === 3 && parts[1] === "clip" ? parts[2]! : "";
      if (clipSlug) return TWITCH_SLUG.test(clipSlug) ? { platform: "twitch", id: clipSlug, kind: "clip", url: "https://clips.twitch.tv/" + clipSlug } : null;
      if (parts.length === 1 && TWITCH_CHANNEL.test(first) && !TWITCH_RESERVED.has(first.toLowerCase())) {
        const channel = first.toLowerCase();
        return { platform: "twitch", id: channel, kind: "channel", url: "https://www.twitch.tv/" + channel };
      }
    }
  } catch { /* fall through: not a valid URL */ }
  return null;
}

/** Re-validates a stored video descriptor (JSON string or object) before it is returned by any API. */
export function normalizeVideo(raw: unknown): FeaturedVideo | null {
  const data = parseStoredJson(raw);
  if (!data || typeof data.url !== "string") return null;
  const parsed = parseFeaturedVideo(data.url);
  if (!parsed || parsed.platform !== data.platform || parsed.id !== data.id) return null;
  // The stored URL is canonical, so a Short is only recognisable from the stored flag.
  if (parsed.platform === "youtube" && data.format === "short") return { ...parsed, format: "short" };
  return parsed;
}

// ---------------------------------------------------------------------------
// Spotify (track, album, artist, playlist)
// ---------------------------------------------------------------------------

export type SpotifyKind = "track" | "album" | "artist" | "playlist";
export type SpotifyResource = { type: SpotifyKind; id: string; url: string };
export type SpotifyMedia = SpotifyResource & {
  title: string;
  artwork: string | null;
  /** false when Spotify could not be reached to confirm the link. Shown to moderators only. */
  verified?: false;
};

export const SPOTIFY_KINDS: readonly SpotifyKind[] = ["track", "album", "artist", "playlist"];
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_HOSTS = new Set(["open.spotify.com", "www.open.spotify.com"]);
const SPOTIFY_LOCALE = /^intl-[a-z]{2}(-[a-z]{2,4})?$/i;
const SPOTIFY_DEFAULT_TITLE: Record<SpotifyKind, string> = {
  track: "Spotify track", album: "Spotify album", artist: "Spotify artist", playlist: "Spotify playlist",
};

function isSpotifyKind(value: unknown): value is SpotifyKind {
  return typeof value === "string" && (SPOTIFY_KINDS as readonly string[]).includes(value);
}

/**
 * Parses an open.spotify.com link for a track, album, artist or playlist. Accepts the locale-prefixed
 * (`/intl-de/track/…`), embed (`/embed/track/…`) and legacy user-playlist forms plus tracking queries.
 * Short links (spotify.link) are rejected: resolving them would require following redirects.
 */
export function parseSpotifyResource(value: unknown): SpotifyResource | null {
  if (typeof value !== "string" || !value.trim() || value.length > 500) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.port || !SPOTIFY_HOSTS.has(u.hostname.toLowerCase())) return null;
    let parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] && SPOTIFY_LOCALE.test(parts[0])) parts = parts.slice(1);
    if (parts[0] === "embed") parts = parts.slice(1);
    if (parts[0] === "user" && parts.length === 4 && parts[2] === "playlist") parts = parts.slice(2);
    if (parts.length !== 2) return null;
    const [type, id] = parts;
    if (!isSpotifyKind(type) || !id || !SPOTIFY_ID.test(id)) return null;
    return { type, id, url: `https://open.spotify.com/${type}/${id}` };
  } catch { return null; }
}

function isSpotifyArtworkHost(host: string): boolean {
  return host === "scdn.co" || host.endsWith(".scdn.co") || host === "spotifycdn.com" || host.endsWith(".spotifycdn.com");
}

function safeSpotifyArtwork(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !isSpotifyArtworkHost(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch { return null; }
}

/**
 * Re-validates a stored Spotify descriptor. Legacy rows (track-only, no `type`) are read as tracks. The URL is
 * always rebuilt from type + id, never trusted from storage.
 */
export function normalizeSong(raw: unknown): SpotifyMedia | null {
  const data = parseStoredJson(raw);
  if (!data) return null;
  const type = data.type === undefined ? "track" : data.type;
  if (!isSpotifyKind(type) || typeof data.id !== "string" || !SPOTIFY_ID.test(data.id)) return null;
  const title = typeof data.title === "string" ? data.title.trim().slice(0, 200) : "";
  const media: SpotifyMedia = {
    type, id: data.id, url: `https://open.spotify.com/${type}/${data.id}`,
    title: title || SPOTIFY_DEFAULT_TITLE[type], artwork: safeSpotifyArtwork(data.artwork),
  };
  if (data.verified === false) media.verified = false;
  return media;
}

/**
 * Asks Spotify's public oEmbed endpoint for the title and artwork of a link. A clear "not found / private"
 * answer rejects the submission; a transient failure (timeout, network, 5xx, rate limit) degrades to an
 * unverified link so a Spotify outage never blocks an application.
 */
export async function fetchSpotifyMetadata(resource: SpotifyResource, fetchImpl: typeof fetch = fetch): Promise<SpotifyMedia> {
  const degraded: SpotifyMedia = {
    ...resource, title: SPOTIFY_DEFAULT_TITLE[resource.type], artwork: null, verified: false,
  };
  let response: Response;
  try {
    response = await fetchImpl("https://open.spotify.com/oembed?url=" + encodeURIComponent(resource.url), {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4000),
    });
  } catch { return degraded; }
  if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
    throw new HttpError(422, "spotify_unavailable", `Spotify could not find that ${resource.type}. Check that the link is public and try again.`);
  }
  if (!response.ok) return degraded;
  let data: { title?: unknown; thumbnail_url?: unknown; provider_name?: unknown };
  try { data = await response.json() as typeof data; } catch { return degraded; }
  if (data.provider_name !== "Spotify" || typeof data.title !== "string" || !data.title.trim()) {
    throw new HttpError(422, "spotify_invalid_link", "That does not look like a public Spotify track, album, artist or playlist link.");
  }
  return { ...resource, title: data.title.trim().slice(0, 200), artwork: safeSpotifyArtwork(data.thumbnail_url) };
}

// ---------------------------------------------------------------------------

function parseStoredJson(raw: unknown): Record<string, unknown> | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try { data = JSON.parse(raw); } catch { return null; }
  }
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
}
