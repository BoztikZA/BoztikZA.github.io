/**
 * Boztik Spotlight media (client side), shared by the directory, the featured showcase and profile pages.
 *
 * Rules this module enforces:
 *  - Playable media exists ONLY in the featured showcase (`featuredPlayersMarkup` + `mountMediaPlayers`).
 *    Directory cards and profile pages get artwork, a label and an outbound link (`mediaChipsMarkup`,
 *    `mediaLinkCardMarkup`) and never an embedded player.
 *  - Nothing loads from YouTube, Twitch or Spotify's player origins and nothing plays until the visitor clicks
 *    (click-to-load facade). There is no autoplay on page load. After the click, the player starts because that
 *    click is the visitor's play request.
 *  - Every URL is rebuilt here from a validated platform id. A `url` field in the API response is never used.
 *  - Boztik never stores or proxies media: embeds are the providers' official players (YouTube privacy-enhanced
 *    mode, Twitch with the page's own hostname as `parent`, Spotify's embed).
 *
 * Pure functions return strings or plain objects so they can be unit tested in Node without a DOM.
 */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_CHANNEL = /^[a-z0-9_]{3,25}$/;
const TWITCH_VIDEO = /^\d{5,20}$/;
const TWITCH_CLIP = /^[A-Za-z0-9_-]{5,80}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_TYPES = ["track", "album", "artist", "playlist"];
/** Hostname `parent` values Twitch will accept: plain DNS names (and localhost for development). */
const TWITCH_PARENT = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;
const EMBED_ORIGINS = new Set([
  "https://www.youtube-nocookie.com", "https://player.twitch.tv", "https://clips.twitch.tv", "https://open.spotify.com",
]);
const SPOTIFY_ARTWORK_HOST = /(^|\.)(scdn\.co|spotifycdn\.com)$/i;
/** Seconds before the "taking a while" hint appears if a provider's iframe never reports `load`. */
const LOAD_HINT_MS = 8000;

export const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

// ---------------------------------------------------------------------------------------------------------------
// Descriptors: validated, canonical views of the API's `video` and `song` objects
// ---------------------------------------------------------------------------------------------------------------

/**
 * @returns {null | {kind:"video", platform:"youtube"|"twitch", type:string, id:string, provider:string,
 *   label:string, href:string, short:boolean, thumb:string|null}}
 */
export function describeVideo(video) {
  if (!video || typeof video !== "object" || typeof video.id !== "string") return null;
  const { platform, kind, id } = video;
  if (platform === "youtube" && kind === "video" && YOUTUBE_ID.test(id)) {
    const short = video.format === "short";
    return {
      kind: "video", platform, type: "video", id, provider: "YouTube", short,
      label: short ? "YouTube Short" : "YouTube video",
      href: "https://www.youtube.com/watch?v=" + id,
      thumb: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
    };
  }
  if (platform === "twitch") {
    const base = { kind: "video", platform, provider: "Twitch", short: false, thumb: null };
    if (kind === "channel" && TWITCH_CHANNEL.test(id)) return { ...base, type: "channel", id, label: "Twitch channel", href: "https://www.twitch.tv/" + id };
    if (kind === "video" && TWITCH_VIDEO.test(id)) return { ...base, type: "video", id, label: "Twitch video", href: "https://www.twitch.tv/videos/" + id };
    if (kind === "clip" && TWITCH_CLIP.test(id)) return { ...base, type: "clip", id, label: "Twitch clip", href: "https://clips.twitch.tv/" + id };
  }
  return null;
}

function safeSpotifyArtwork(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !SPOTIFY_ARTWORK_HOST.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

/**
 * Legacy rows (before album/artist/playlist support) have no `type` and are tracks.
 * @returns {null | {kind:"song", platform:"spotify", type:string, id:string, provider:string, title:string,
 *   label:string, href:string, thumb:string|null}}
 */
export function describeSong(song) {
  if (!song || typeof song !== "object" || typeof song.id !== "string" || !SPOTIFY_ID.test(song.id)) return null;
  const type = song.type === undefined ? "track" : song.type;
  if (!SPOTIFY_TYPES.includes(type)) return null;
  const title = typeof song.title === "string" ? song.title.trim().slice(0, 200) : "";
  return {
    kind: "song", platform: "spotify", type, id: song.id, provider: "Spotify",
    title: title || "Listen on Spotify", label: "Spotify " + type,
    href: `https://open.spotify.com/${type}/${song.id}`, thumb: safeSpotifyArtwork(song.artwork),
  };
}

/** Both descriptors for a profile, nulls removed. */
export function profileMedia(profile) {
  return [describeVideo(profile?.video), describeSong(profile?.song)].filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------
// Embeds (featured showcase only)
// ---------------------------------------------------------------------------------------------------------------

const EMBED_ALLOW = {
  youtube: "autoplay; encrypted-media; picture-in-picture; fullscreen",
  twitch: "autoplay; fullscreen; picture-in-picture",
  spotify: "encrypted-media; clipboard-write; fullscreen; picture-in-picture",
};

export function currentHostname() {
  try { return globalThis.location?.hostname || ""; } catch { return ""; }
}

/**
 * The official embed URL for a descriptor, or null when it cannot be embedded safely. Twitch needs the embedding
 * page's own hostname as `parent`, so it is read at runtime (works on the live site and on preview deployments)
 * and rejected if it is not a plain DNS name.
 */
export function embedUrl(media, hostname = currentHostname()) {
  if (!media) return null;
  const parent = encodeURIComponent(hostname);
  if (media.platform === "youtube") return `https://www.youtube-nocookie.com/embed/${media.id}?rel=0&playsinline=1&autoplay=1`;
  if (media.platform === "spotify") return `https://open.spotify.com/embed/${media.type}/${media.id}?utm_source=generator&theme=0`;
  if (media.platform === "twitch") {
    if (!TWITCH_PARENT.test(hostname || "")) return null;
    if (media.type === "channel") return `https://player.twitch.tv/?channel=${media.id}&parent=${parent}&autoplay=true`;
    if (media.type === "video") return `https://player.twitch.tv/?video=v${media.id}&parent=${parent}&autoplay=true`;
    if (media.type === "clip") return `https://clips.twitch.tv/embed?clip=${media.id}&parent=${parent}&autoplay=true`;
  }
  return null;
}

/** Spotify's compact player is for single tracks; everything else needs the taller one. */
export const spotifyEmbedHeight = media => media?.type === "track" ? 152 : 352;

// ---------------------------------------------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------------------------------------------

const GLYPH = { youtube: "▶", twitch: "▶", spotify: "♫" };

/** Artwork when the platform provides it; otherwise a branded placeholder. Never an embed. */
export function thumbMarkup(media, className = "sp-media-thumb") {
  const placeholder = media.thumb ? "" : " sp-media-thumb-placeholder";
  const inner = media.thumb
    ? `<img src="${esc(media.thumb)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<span aria-hidden="true">${GLYPH[media.platform] || "▶"}</span>`;
  return `<span class="${className}${placeholder}" data-platform="${esc(media.platform)}">${inner}</span>`;
}

/**
 * Directory card row: a compact thumbnail and label per item that links to the original platform.
 * @param {object} profile  public profile DTO
 */
export function mediaChipsMarkup(profile) {
  const items = profileMedia(profile);
  if (!items.length) return "";
  const name = esc(profile?.display_name || "this profile");
  const links = items.map(media => `<a class="sp-card-media-link sp-card-media-${esc(media.platform)}" href="${esc(media.href)}" target="_blank" rel="noopener noreferrer" data-outbound aria-label="${esc(media.kind === "song" ? "Listen to" : "Watch")} ${name} on ${esc(media.provider)} (opens in a new tab)">${thumbMarkup(media, "sp-media-chip-thumb")}<span>${esc(media.label)}</span><span aria-hidden="true">↗</span></a>`);
  return `<div class="sp-card-media-links" aria-label="Featured media">${links.join("")}</div>`;
}

/**
 * Profile page card: artwork, a label and a link to the original platform. Deliberately not a player.
 * @param {ReturnType<typeof describeVideo>|ReturnType<typeof describeSong>} media
 */
export function mediaLinkCardMarkup(media) {
  if (!media) return "";
  const isSong = media.kind === "song";
  const heading = isSong ? media.title : "Watch their work";
  const blurb = isSong ? `Open this ${media.type} on Spotify.` : `Open the original ${media.type === "channel" ? "stream" : media.type === "clip" ? "clip" : "video"} on ${media.provider}.`;
  const verb = isSong ? "Listen" : "Watch";
  return `<section class="sp-media-link-card" aria-label="${isSong ? "Featured music" : "Featured video"}">
    ${thumbMarkup(media)}
    <div><span class="sp-kicker">${isSong ? "FEATURED MUSIC" : "FEATURED VIDEO"} · ${esc(media.provider.toUpperCase())}</span><strong>${esc(heading)}</strong><p>${esc(blurb)}</p></div>
    <a class="sp-button sp-button-outline" href="${esc(media.href)}" target="_blank" rel="noopener noreferrer" data-outbound>${verb} on ${esc(media.provider)} ↗</a>
  </section>`;
}

function playerMarkup(media, hostname) {
  const src = embedUrl(media, hostname);
  if (!src) return mediaLinkCardMarkup(media); // cannot embed safely: degrade to an outbound card
  const isSong = media.kind === "song";
  const heading = isSong ? media.title : media.short ? "Watch the Short" : "See their work in action";
  const eyebrow = (isSong ? "FEATURED " + media.type.toUpperCase() : "FEATURED VIDEO") + " · " + media.provider.toUpperCase();
  const height = media.platform === "spotify" ? spotifyEmbedHeight(media) : 0;
  const playLabel = `Play ${isSong ? media.title : "the video"} (loads ${media.provider})`;
  return `<div class="sp-media-player" data-media-platform="${esc(media.platform)}" data-media-type="${esc(media.type)}" data-short="${media.short ? "1" : "0"}" data-state="idle" data-embed-src="${esc(src)}" data-embed-title="${esc(isSong ? "Spotify player: " + media.title : media.provider + " player")}"${height ? ` style="--sp-embed-h:${height}px"` : ""}>
    <div class="sp-featured-media-label"><span>${esc(eyebrow)}</span><strong>${esc(heading)}</strong></div>
    <div class="sp-media-stage"><button type="button" class="sp-media-play" data-media-play aria-label="${esc(playLabel)}">${thumbMarkup(media, "sp-media-facade-art")}<span class="sp-media-play-badge" aria-hidden="true"></span><span class="sp-media-play-text">${isSong ? "Load Spotify player" : "Play video"}</span></button></div>
    <p class="sp-media-status" role="status" aria-live="polite"></p>
    <p class="sp-media-fallback"><a href="${esc(media.href)}" target="_blank" rel="noopener noreferrer" data-outbound>Open on ${esc(media.provider)} ↗</a><span> · Loads ${esc(media.provider)} only when you press play.</span></p>
  </div>`;
}

/**
 * The ONLY place playable media is rendered: the featured showcase. Returns "" when the profile has no media.
 * Each item is a click-to-load facade; call `mountMediaPlayers(container)` once after inserting the markup.
 */
export function featuredPlayersMarkup(profile, { hostname = currentHostname() } = {}) {
  const items = profileMedia(profile);
  return items.length ? `<div class="sp-featured-media">${items.map(media => playerMarkup(media, hostname)).join("")}</div>` : "";
}

// ---------------------------------------------------------------------------------------------------------------
// Behaviour (browser only)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Activates a facade: swaps it for the provider's official iframe. Exported for tests. Returns the iframe, or null
 * when the player is not idle or its embed URL is not on the provider allow-list.
 */
export function activatePlayer(player, doc = globalThis.document) {
  if (!player || player.dataset.state !== "idle") return null;
  const stage = player.querySelector(".sp-media-stage");
  const platform = player.dataset.mediaPlatform || "";
  let src;
  try {
    const url = new URL(player.dataset.embedSrc || "");
    if (url.protocol !== "https:" || !EMBED_ORIGINS.has(url.origin)) return null;
    src = url.href;
  } catch { return null; }
  if (!stage) return null;

  const frame = doc.createElement("iframe");
  frame.className = "sp-media-frame";
  frame.title = player.dataset.embedTitle || "Embedded player";
  frame.setAttribute("allow", EMBED_ALLOW[platform] || "fullscreen");
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  frame.src = src;
  player.dataset.state = "loading";
  stage.replaceChildren(frame);
  const status = player.querySelector(".sp-media-status");
  const timer = setTimeout(() => {
    if (player.dataset.state === "loading" && status) {
      status.textContent = `${platform === "spotify" ? "Spotify" : platform === "twitch" ? "Twitch" : "YouTube"} is taking a while to load. If the player does not appear, use the link below to open it there.`;
      player.dataset.state = "slow";
    }
  }, LOAD_HINT_MS);
  frame.addEventListener("load", () => {
    clearTimeout(timer);
    if (status) status.textContent = "";
    player.dataset.state = "playing";
  }, { once: true });
  try { frame.focus(); } catch { /* focus is best effort: the activated button no longer exists */ }
  player.dispatchEvent(new CustomEvent("spotlight:media-play", {
    bubbles: true, detail: { platform, type: player.dataset.mediaType || "" },
  }));
  return frame;
}

/** Click-to-load for every facade inside `root` (delegated, so it survives re-renders of the showcase). */
export function mountMediaPlayers(root) {
  if (!root || root.dataset.mediaMounted === "1") return;
  root.dataset.mediaMounted = "1";
  root.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("[data-media-play]") : null;
    if (button && root.contains(button)) activatePlayer(button.closest(".sp-media-player"));
  });
}
