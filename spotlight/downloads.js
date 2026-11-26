/**
 * Shared Spotlight download destination validation and branded store/download button markup.
 * Pure functions so they can be unit tested in Node and reused across the homepage,
 * Command Centre preview, directory showcase, profile page, and submission form.
 */

export const DOWNLOAD_TYPES = ["apple_app_store", "google_play", "generic"];

export const DOWNLOAD_TYPE_META = {
  apple_app_store: {
    name: "Apple App Store",
    defaultLabel: "Download on the App Store",
    placeholder: "https://apps.apple.com/app/...",
    hint: "Must be an HTTPS link on apps.apple.com or itunes.apple.com."
  },
  google_play: {
    name: "Google Play Store",
    defaultLabel: "Get it on Google Play",
    placeholder: "https://play.google.com/store/apps/details?id=...",
    hint: "Must be an HTTPS link on play.google.com."
  },
  generic: {
    name: "Generic Download",
    defaultLabel: "Download Now",
    placeholder: "https://example.com/download",
    hint: "Must be a valid HTTPS URL. Optional custom button label supported."
  }
};

const APPLE_HOSTS = ["apps.apple.com", "itunes.apple.com"];
const GOOGLE_PLAY_HOSTS = ["play.google.com"];
const MAX_URL_LENGTH = 500;
const MAX_LABEL_LENGTH = 48;

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function isAllowedHost(hostname, roots) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return roots.some(root => host === root || host.endsWith("." + root));
}

export function safeDownloadUrl(type, value) {
  if (!DOWNLOAD_TYPES.includes(type) || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return "";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return "";
  if (type === "apple_app_store" && !isAllowedHost(parsed.hostname, APPLE_HOSTS)) return "";
  if (type === "google_play" && !isAllowedHost(parsed.hostname, GOOGLE_PLAY_HOSTS)) return "";
  return parsed.toString();
}

export function cleanDownloadLabel(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_LABEL_LENGTH);
}

export function normaliseDownloadLinks(list) {
  if (!Array.isArray(list)) return [];
  const valid = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const type = item.type;
    const url = safeDownloadUrl(type, item.url);
    if (!url) continue;
    const label = cleanDownloadLabel(item.label);
    valid.push(label ? { type, url, label } : { type, url });
    if (valid.length >= 10) break;
  }
  return valid;
}

const APPLE_ICON_SVG = `<svg class="sp-dl-icon sp-dl-icon--apple" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.96 6.33c.68-.83 1.14-1.98 1.01-3.13-.98.04-2.17.65-2.87 1.48-.62.72-1.17 1.89-1.02 3.01 1.09.09 2.2-.55 2.88-1.36Z"/></svg>`;

const GOOGLE_PLAY_ICON_SVG = `<svg class="sp-dl-icon sp-dl-icon--google" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M3.61 1.814 13.793 12 3.61 22.186a1.76 1.76 0 0 1-.61-1.344V3.158c0-.525.23-1.016.61-1.344Z"/><path fill="#34A853" d="m17.167 8.626-3.374 3.374L3.61 1.814c.42-.364 1.033-.444 1.564-.14l11.993 6.952Z"/><path fill="#FBBC05" d="M20.985 10.84c.95.55.95 1.77 0 2.32l-3.818 2.214L13.793 12l3.374-3.374 3.818 2.214Z"/><path fill="#EA4335" d="M17.167 15.374 5.174 22.326c-.531.304-1.144.224-1.564-.14L13.793 12l3.374 3.374Z"/></svg>`;

const GENERIC_DOWNLOAD_ICON_SVG = `<svg class="sp-dl-icon sp-dl-icon--generic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`;

function buttonMarkup(item, { profileName = "", forceStoreLabels = false } = {}) {
  const customLabel = cleanDownloadLabel(item.label);
  const nameSuffix = profileName ? ` for ${profileName}` : "";

  if (item.type === "apple_app_store") {
    const useDefault = forceStoreLabels || !customLabel || customLabel.toLowerCase() === "download on the app store";
    const text = useDefault
      ? `<span class="sp-dl-text"><span class="sp-dl-kicker">Download on the</span><span class="sp-dl-title">App Store</span></span>`
      : `<span class="sp-dl-text"><span class="sp-dl-title">${esc(customLabel)}</span></span>`;
    const aria = (useDefault ? "Download on the App Store" : customLabel) + nameSuffix + " (opens in a new tab)";
    return `<a class="sp-dl-btn sp-dl-btn--apple" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" data-outbound aria-label="${esc(aria)}">${APPLE_ICON_SVG}${text}</a>`;
  }

  if (item.type === "google_play") {
    const useDefault = forceStoreLabels || !customLabel || customLabel.toLowerCase() === "get it on google play";
    const text = useDefault
      ? `<span class="sp-dl-text"><span class="sp-dl-kicker">Get it on</span><span class="sp-dl-title">Google Play</span></span>`
      : `<span class="sp-dl-text"><span class="sp-dl-title">${esc(customLabel)}</span></span>`;
    const aria = (useDefault ? "Get it on Google Play" : customLabel) + nameSuffix + " (opens in a new tab)";
    return `<a class="sp-dl-btn sp-dl-btn--google" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" data-outbound aria-label="${esc(aria)}">${GOOGLE_PLAY_ICON_SVG}${text}</a>`;
  }

  const label = customLabel || DOWNLOAD_TYPE_META.generic.defaultLabel;
  const aria = label + nameSuffix + " (opens in a new tab)";
  return `<a class="sp-dl-btn sp-dl-btn--generic" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" data-outbound aria-label="${esc(aria)}">${GENERIC_DOWNLOAD_ICON_SVG}<span class="sp-dl-text"><span class="sp-dl-title">${esc(label)}</span></span></a>`;
}

/**
 * Renders branded download buttons for a profile's approved download_links.
 * Returns "" (empty string) when there are no valid download links.
 */
export function downloadButtonsMarkup(downloadLinks, { variant = "profile", profileName = "" } = {}) {
  const valid = normaliseDownloadLinks(downloadLinks);
  if (!valid.length) return "";
  const forceStoreLabels = variant === "hero";
  const buttons = valid.map(item => buttonMarkup(item, { profileName, forceStoreLabels })).join("");
  const heading = variant === "profile"
    ? `<p class="sp-kicker">DOWNLOAD</p><h2 class="sp-dl-heading">Get ${esc(profileName || "the app")}</h2>`
    : "";
  return `<div class="sp-downloads sp-downloads--${esc(variant)}" aria-label="${esc((profileName ? profileName + " " : "") + "downloads")}">${heading}<div class="sp-downloads-row">${buttons}</div></div>`;
}
