/**
 * Spotlight client analytics helpers. Everything here is privacy-light: no referrer URL or host is ever sent, only
 * a coarse bucket; no identifier is derived from anything but a random per-event id (and the existing per-browser
 * visitor id the profile page already used).
 *
 * Counting rules are enforced by the Worker (published/featured checks, idempotency, bot and admin exclusion); this
 * module only reports what the visitor actually did.
 */
const API = "https://deliver-api.boztik.com/api/public/spotlight";
const ADMIN_SESSION_KEY = "boztik-deliver-session-v3";

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|yandex|baidu|startpage)\.(com|org|net|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})$/i;
const SOCIAL_HOSTS = /(^|\.)(facebook|instagram|twitter|x|t|linkedin|reddit|pinterest|tiktok|youtube|youtu|twitch|threads|whatsapp|wa|discord|bsky)\.(com|co|me|tv|be|app|gg|social)$/i;

/** Coarse source bucket from a referrer, the page host and an optional explicit `?src=` hint. */
export function classifySource(referrer, ownHost, hint = "") {
  if (hint === "featured" || hint === "directory") return hint;
  if (!referrer) return "direct";
  let host = "";
  let path = "";
  try { const url = new URL(referrer); host = url.hostname; path = url.pathname; } catch { return "direct"; }
  if (host === ownHost || host === "boztik.com" || host === "www.boztik.com") {
    return /\/spotlight\/?(index\.html)?$/.test(path) ? "directory" : "other";
  }
  if (SEARCH_HOSTS.test(host)) return "search";
  if (SOCIAL_HOSTS.test(host)) return "social";
  return "other";
}

/** Which kind of outbound link was clicked, from the markup that rendered it. */
export function clickTarget(element) {
  if (!element || typeof element.closest !== "function") return "other";
  if (element.closest(".sp-rail-site")) return "website";
  if (element.closest(".sp-rail-social")) return "social";
  if (element.closest(".sp-media-link-card")) return "media";
  return "other";
}

/** An administrator's session lets the Worker exclude previews; any visitor simply has none. */
export function adminHeaders(storage = globalThis.localStorage) {
  try {
    const session = JSON.parse(storage.getItem(ADMIN_SESSION_KEY) || "null");
    if (session?.token && Date.parse(session.expires_at) > Date.now()) return { Authorization: "Bearer " + session.token };
  } catch { /* no storage, no session */ }
  return {};
}

const randomId = () => crypto.randomUUID().replace(/-/g, "");

export function sendEvent(path, payload) {
  return fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders() },
    body: JSON.stringify({ event_id: randomId(), ...payload }),
    keepalive: true,
  }).catch(() => {});
}

/** `playId` ties a completion to its own start; it is reused for both events of one play. */
export const newPlayId = () => "p" + randomId();

/**
 * YouTube iframe API over postMessage (enablejsapi=1). Returns the numeric player state, or null for anything that is
 * not a state report. 0 = ended, 1 = playing, 2 = paused.
 */
export function parseYouTubeState(data) {
  let message = data;
  if (typeof data === "string") { try { message = JSON.parse(data); } catch { return null; } }
  if (!message || typeof message !== "object") return null;
  if (message.event === "onStateChange" && Number.isInteger(message.info)) return message.info;
  if (message.event === "infoDelivery" && message.info && Number.isInteger(message.info.playerState)) return message.info.playerState;
  return null;
}

/**
 * Report player interactions for one featured showcase root. Fires `player` when the visitor presses play, and
 * `complete` when a YouTube video reports it has ended (other providers do not expose completion to embedders).
 */
export function trackFeaturedPlayer(root, { send = sendEvent, win = globalThis.window } = {}) {
  if (!root || root.dataset.analyticsMounted === "1") return;
  root.dataset.analyticsMounted = "1";
  root.addEventListener("spotlight:media-play", event => {
    const shell = root.querySelector("[data-profile-id]");
    const profileId = shell?.dataset.profileId;
    if (!profileId) return;
    const playId = newPlayId();
    send("/event", { profile_id: profileId, type: "player", play_id: playId });
    if (event.detail?.platform !== "youtube" || !win) return;
    const frame = event.target?.querySelector?.("iframe");
    if (!frame) return;
    let completed = false;
    const onMessage = message => {
      if (message.source !== frame.contentWindow || message.origin !== "https://www.youtube-nocookie.com") return;
      if (parseYouTubeState(message.data) === 0 && !completed) {
        completed = true;
        send("/event", { profile_id: profileId, type: "complete", play_id: playId });
        win.removeEventListener("message", onMessage);
      }
    };
    win.addEventListener("message", onMessage);
    // Ask the embedded player to start reporting state changes.
    frame.addEventListener("load", () => {
      try { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "https://www.youtube-nocookie.com"); } catch { /* player unavailable */ }
    }, { once: true });
  });
}
