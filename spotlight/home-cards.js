/**
 * Spotlight homepage card markup: the large "Featured creator" hero card and the compact "Discover More Creators"
 * cards. Pure functions that return strings, so they can be unit tested in Node and reused by the Command Centre
 * preview (what an administrator previews is rendered by exactly this code, not a lookalike).
 *
 * Safety rules are unchanged: every value is escaped, images may only come from the Spotlight image endpoint, and
 * websites must be https. Only profiles the Worker already returns publicly (approved, published, listing live) are
 * ever passed in here.
 */
import { socialLinksMarkup } from "./social-links.js";
import { downloadButtonsMarkup } from "./downloads.js";

export const API_BASE = "https://deliver-api.boztik.com/api/public/spotlight";

export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

export const categoryLabel = value => String(value || "").replace(/-/g, " ").replace(/\b\w/g, char => char.toUpperCase());

export function initials(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "B";
}

export function safeProfileImageUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "deliver-api.boztik.com"
      || !url.pathname.startsWith("/api/public/spotlight/image/")) return "";
    return url.href;
  } catch { return ""; }
}

export function safeWebsiteUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.href;
  } catch { return ""; }
}

/** Portrait first, then showcase images, de-duplicated; only Spotlight image URLs survive. */
export function profileImageUrls(profile) {
  const images = Array.isArray(profile?.images) ? profile.images
    .map(image => ({ position: Number(image?.position), url: safeProfileImageUrl(image?.url) }))
    .filter(image => image.url)
    .sort((a, b) => a.position - b.position) : [];
  if (!images.some(image => image.position === 0)) {
    const primary = safeProfileImageUrl(profile?.image_url);
    if (primary) images.unshift({ position: 0, url: primary });
  }
  return [...new Map(images.map(image => [image.url, image])).values()].map(image => image.url);
}

const profileHref = (profile, base, source) =>
  `${base}profile.html?slug=${encodeURIComponent(profile.slug)}${source ? "&src=" + source : ""}`;

/**
 * The premium placement. `profileBase` is where profile.html lives relative to the page showing the card
 * ("spotlight/" on the homepage, an absolute URL in the Command Centre preview).
 */
export function heroCardMarkup(profile, { profileBase = "spotlight/" } = {}) {
  const name = String(profile.display_name || "").trim();
  const href = profileHref(profile, profileBase, "featured");
  const category = categoryLabel(profile.category) || "Spotlight profile";
  const imageUrls = profileImageUrls(profile);
  const imageUrl = imageUrls[0] || "";
  const websiteUrl = safeWebsiteUrl(profile.website_url);
  const shareUrl = API_BASE + "/share/" + encodeURIComponent(profile.slug);
  const socialLinks = socialLinksMarkup(profile.social_links, name, "hm-spotlight-social-link");
  const downloads = downloadButtonsMarkup(profile.download_links, { variant: "hero", profileName: name });
  const image = imageUrl
    ? `<img class="is-active" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} logo or profile photograph" width="640" height="420" loading="lazy" decoding="async" data-layer="0"><img alt="" width="640" height="420" loading="lazy" decoding="async" data-layer="1" aria-hidden="true">`
    : `<span class="hm-spotlight-image-fallback" role="img" aria-label="Initials for ${escapeHtml(name)}">${escapeHtml(initials(name))}</span><span class="hm-spotlight-image-note">${escapeHtml(category)}</span>`;
  // Featured placements set before the open-ended change still carry a real end time; show their countdown.
  // The open-ended placement (featured_open_ended) has no timer and shows none.
  const until = Number(profile.featured_until) || 0;
  const legacyCountdown = profile.featured_open_ended === false && until
    ? `<p class="hm-spotlight-countdown" data-countdown="${until}">Featured for <time>--:--:--</time> more</p>` : "";
  const backdrop = imageUrl ? ` style="--hm-art:url('${escapeHtml(imageUrl)}')"` : "";

  return `
      <article class="hm-spotlight-card hm-spotlight-card--hero" data-profile-id="${escapeHtml(profile.id)}" data-featured="1" aria-label="Featured creator: ${escapeHtml(name)}">
        <div class="hm-spotlight-media" data-image-count="${imageUrls.length}"${backdrop}>
          <a class="hm-spotlight-image-link" href="${escapeHtml(href)}" aria-label="View ${escapeHtml(name)}'s Boztik Spotlight profile">
            <div class="hm-spotlight-image">
              ${image}
              <span class="hm-spotlight-featured-label"><span aria-hidden="true">★</span> Featured creator</span><span class="bz-spot-seal"><span class="bz-spot-seal__tick" aria-hidden="true">✓</span> Hand-reviewed</span>
            </div>
          </a>
          ${imageUrls.length > 1 ? `<div class="hm-spotlight-gallery-controls" role="group" aria-label="${escapeHtml(name)} image gallery">${imageUrls.map((_, index) => `<button type="button" data-gallery-index="${index}" aria-label="Show image ${index + 1} of ${imageUrls.length}" aria-pressed="${index === 0}" class="${index === 0 ? "is-active" : ""}"></button>`).join("")}</div>` : ""}
        </div>
        <div class="hm-spotlight-card-content">
          <span class="hm-spotlight-category">${escapeHtml(category)}</span>
          <h3><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></h3>
          ${legacyCountdown}
          ${profile.tagline ? `<p class="hm-spotlight-tagline">${escapeHtml(profile.tagline)}</p>` : ""}
          <p class="hm-spotlight-description">${escapeHtml(profile.description)}</p>
          ${downloads}
          ${socialLinks ? `<div class="hm-spotlight-socials" aria-label="Social profiles">${socialLinks}</div>` : ""}
          <div class="hm-spotlight-actions">
            <a class="hm-spotlight-profile-link" href="${escapeHtml(href)}">See what ${escapeHtml(name)} offers <span aria-hidden="true">↗</span></a>
            ${websiteUrl ? `<a class="hm-spotlight-website-link" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" data-outbound>Visit ${escapeHtml(name)} <span aria-hidden="true">↗</span></a>` : ""}
            <button class="hm-spotlight-share" type="button" data-share-url="${escapeHtml(shareUrl)}" data-share-title="${escapeHtml(name)}">Share profile</button>
          </div>
          <span class="hm-spotlight-share-status" role="status" aria-live="polite"></span>
        </div>
      </article>`;
}

/** One small horizontal card for the "Discover More Creators" strip. Thumbnail, name, category/short line, link. */
export function compactCardMarkup(profile, { profileBase = "spotlight/" } = {}) {
  const name = String(profile.display_name || "").trim();
  const href = profileHref(profile, profileBase, "directory");
  const category = categoryLabel(profile.category);
  const imageUrl = profileImageUrls(profile)[0] || "";
  const blurb = String(profile.tagline || "").trim();
  const thumb = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="" width="72" height="72" loading="lazy" decoding="async">`
    : `<span class="hm-discover-initials" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
  return `
        <li class="hm-discover-item">
          <article class="hm-discover-card" data-profile-id="${escapeHtml(profile.id)}">
            <a class="hm-discover-thumb" href="${escapeHtml(href)}" tabindex="-1" aria-hidden="true">${thumb}</a>
            <div class="hm-discover-body">
              ${category ? `<span class="hm-discover-category">${escapeHtml(category)}</span>` : ""}
              <h4 class="hm-discover-name"><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></h4>
              ${blurb ? `<p class="hm-discover-blurb">${escapeHtml(blurb)}</p>` : ""}
              <a class="hm-discover-link" href="${escapeHtml(href)}" aria-label="View ${escapeHtml(name)}'s profile">View profile <span aria-hidden="true">→</span></a>
            </div>
          </article>
        </li>`;
}

/** Closing card of the strip: invites visitors to apply. Always last, never competes with a creator. */
export function discoverEndCardMarkup({ submitHref = "spotlight/submit/" } = {}) {
  return `
        <li class="hm-discover-item hm-discover-item--cta">
          <article class="hm-discover-card hm-discover-card--cta">
            <div class="hm-discover-body">
              <span class="hm-discover-category">Join the community</span>
              <h4 class="hm-discover-name">Your profile could be here</h4>
              <p class="hm-discover-blurb">Free during the pilot. Every profile is hand-reviewed.</p>
              <a class="hm-discover-link" href="${escapeHtml(submitHref)}">Apply to be listed <span aria-hidden="true">→</span></a>
            </div>
          </article>
        </li>`;
}

/** The whole "Discover More Creators" section (heading, blurb, controls, scrolling strip). */
export function discoverSectionMarkup(profiles, { profileBase = "spotlight/", directoryHref = "spotlight/", submitHref = "spotlight/submit/" } = {}) {
  if (!profiles.length) return "";
  return `
      <section class="hm-discover" aria-labelledby="hm-discover-title">
        <div class="hm-discover-head">
          <div>
            <h3 id="hm-discover-title">Discover More Creators</h3>
            <p>Explore the wider Boztik Spotlight community: independent businesses, creators and freelancers, each one approved by hand.</p>
          </div>
          <div class="hm-discover-controls">
            <button type="button" class="hm-discover-arrow" data-discover-dir="-1" aria-label="Scroll creators left" disabled><span aria-hidden="true">←</span></button>
            <button type="button" class="hm-discover-arrow" data-discover-dir="1" aria-label="Scroll creators right"><span aria-hidden="true">→</span></button>
            <a class="hm-discover-all" href="${escapeHtml(directoryHref)}">Browse all <span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <div class="hm-discover-viewport is-start">
          <ul class="hm-discover-track" role="list" tabindex="0" aria-label="Approved Spotlight creators. Scroll sideways to see more.">${profiles.map(profile => compactCardMarkup(profile, { profileBase })).join("")}${discoverEndCardMarkup({ submitHref })}
          </ul>
        </div>
      </section>`;
}

/** Shown in the featured position when nobody is currently featured but approved creators exist. */
export function noFeaturedMarkup({ submitHref = "spotlight/submit/" } = {}) {
  return `
      <div class="hm-spotlight-empty hm-spotlight-empty--featured">
        <div class="bz-spot-preview__copy">
          <span class="hm-spotlight-category">FEATURED CREATOR</span>
          <h3>The featured spot is open.</h3>
          <p>Boztik hand-picks one creator to feature here. Meanwhile, explore the approved creators below, or apply to be listed.</p>
          <div class="hm-spotlight-empty-actions"><a class="hm-spotlight-website-link" href="${escapeHtml(submitHref)}">Apply to be listed</a></div>
        </div>
      </div>`;
}
