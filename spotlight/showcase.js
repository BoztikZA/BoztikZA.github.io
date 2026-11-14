/**
 * Spotlight presentation helpers shared by the directory (featured showcase) and the profile page.
 * Pure functions returning strings so they can be unit tested in Node.
 *
 * Playback rules are unchanged: only `featuredShowcaseMarkup` can contain players (via media.js facades). The
 * profile page uses `linkRailMarkup`, which only ever links out to the creator's own website and social profiles.
 */
import { esc, featuredPlayersMarkup } from "./media.js";
import { socialLinksMarkup } from "./social-links.js";

/** The featured window is 24 hours; the stage's progress bar drains across it. */
export const FEATURE_WINDOW_SECONDS = 86400;

export const labelize = value => String(value || "").replace(/-/g, " ").replace(/\b\w/g, char => char.toUpperCase());
export const initials = name => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";

/** https only, no credentials. Returns "" for anything else. */
export function safeWebsite(value) {
  if (typeof value !== "string" || value.length > 500) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

/** Profile images are served only by the Spotlight image endpoint. */
export function safeImage(value) {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "deliver-api.boztik.com" && url.pathname.startsWith("/api/public/spotlight/image/") ? url.href : "";
  } catch { return ""; }
}

/** 1 at the start of the featured window, 0 when it ends. */
export function remainingFraction(featuredUntil, nowSeconds = Math.floor(Date.now() / 1000)) {
  const remaining = Number(featuredUntil || 0) - nowSeconds;
  return Math.min(1, Math.max(0, remaining / FEATURE_WINDOW_SECONDS));
}

export function profileHref(profile) {
  return "profile.html?slug=" + encodeURIComponent(profile?.slug || "");
}

/** The creator's own destinations: website first (primary action), then social profiles. Links out only. */
export function linkRailMarkup(profile) {
  const site = safeWebsite(profile?.website_url);
  const name = esc(profile?.display_name || "this creator");
  const socials = socialLinksMarkup(profile?.social_links, profile?.display_name || "this creator", "sp-rail-social");
  if (!site && !socials) return "";
  const host = site ? new URL(site).hostname.replace(/^www\./, "") : "";
  return `<div class="sp-link-rail" aria-label="Where to find ${name}">${site ? `<a class="sp-rail-site" href="${esc(site)}" target="_blank" rel="noopener noreferrer" data-outbound><span>Visit ${esc(host)}</span><b aria-hidden="true">↗</b></a>` : ""}${socials ? `<span class="sp-rail-socials">${socials}</span>` : ""}</div>`;
}

/** Up to `max` portfolio images (the first image is the portrait, so it is skipped). Links to the full gallery. */
export function portfolioStripMarkup(profile, max = 4) {
  const all = (Array.isArray(profile?.images) ? profile.images : []).map(image => safeImage(image?.url)).filter(Boolean);
  const shots = all.slice(1);
  if (!shots.length) return "";
  const shown = shots.slice(0, max);
  const extra = shots.length - shown.length;
  const name = esc(profile?.display_name || "this creator");
  const items = shown.map((url, index) => {
    const more = extra > 0 && index === shown.length - 1 ? `<span class="sp-portfolio-more" aria-hidden="true">+${extra}</span>` : "";
    return `<a class="sp-portfolio-item" href="${esc(profileHref(profile))}#gallery" aria-label="See ${name}'s portfolio${more ? ` (${shots.length} images)` : ""}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async">${more}</a>`;
  }).join("");
  return `<div class="sp-portfolio" aria-label="Portfolio preview"><p>Portfolio</p><div class="sp-portfolio-strip">${items}</div></div>`;
}

function portraitMarkup(profile) {
  const image = safeImage(profile?.image_url) || safeImage((profile?.images || [])[0]?.url);
  const name = esc(profile?.display_name || "");
  return `<figure class="sp-stage-portrait"${image ? ` style="--sp-art:url('${esc(image)}')"` : ""}>
    ${image ? `<span class="sp-stage-blur" aria-hidden="true"></span><img src="${esc(image)}" alt="${name}" loading="eager" decoding="async">` : `<span class="sp-stage-initials" aria-hidden="true">${esc(initials(profile?.display_name))}</span>`}
    <figcaption class="sp-stage-time" data-countdown="${Number(profile?.featured_until || 0)}"><span>Featured today</span><time>--:--:--</time><i class="sp-stage-bar" aria-hidden="true"></i></figcaption>
  </figure>`;
}

/**
 * The main featured showcase. `data-placement` / `data-plan` are hooks for future paid placements: the free plan
 * is the only one rendered today, and nothing here depends on payment state.
 */
export function featuredShowcaseMarkup(profile, { hostname, now } = {}) {
  if (!profile) return "";
  const name = esc(profile.display_name);
  const media = featuredPlayersMarkup(profile, hostname === undefined ? undefined : { hostname });
  return `<div class="sp-featured-shell" data-placement="featured" data-plan="free" data-profile-id="${esc(profile.id)}" style="--sp-remaining:${remainingFraction(profile.featured_until, now).toFixed(4)}">
    ${portraitMarkup(profile)}
    <div class="sp-featured-copy">
      <p class="sp-stage-category">${esc(labelize(profile.category))}</p>
      <h2>${name}</h2>
      ${profile.tagline ? `<h3>${esc(profile.tagline)}</h3>` : ""}
      <p class="sp-featured-description">${esc(profile.description || "Discover the person behind this independent business or creative project.")}</p>
      ${linkRailMarkup(profile)}
      ${portfolioStripMarkup(profile)}
      <a class="sp-stage-profile" href="${esc(profileHref(profile))}">Read the full profile</a>
    </div>
    ${media}
  </div>`;
}
