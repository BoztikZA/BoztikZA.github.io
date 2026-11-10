import { socialLinksMarkup } from "./social-links.js";

const API = "https://deliver-api.boztik.com/api/public/spotlight";
const visitorId = (() => {
  try {
    let id = localStorage.getItem("boztik_spotlight_visitor");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("boztik_spotlight_visitor", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();
const host = document.querySelector("#sp-profile-content");
const slug = new URLSearchParams(location.search).get("slug");
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const label = value => String(value || "").replace(/-/g, " ").replace(/\b\w/g, char => char.toUpperCase());
function safeProfileImageUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "deliver-api.boztik.com"
      || !url.pathname.startsWith("/api/public/spotlight/image/")) return "";
    return url.href;
  } catch {
    return "";
  }
}
const event = (profileId, type) => fetch(API + "/event", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    event_id: crypto.randomUUID().replace(/-/g, ""),
    profile_id: profileId,
    type,
    visitor_id: visitorId
  }),
  keepalive: true
}).catch(() => {});

function setMeta(selector, attr, value, create) {
  let el = document.head.querySelector(selector);
  if (!el && create) { el = document.createElement(create.tag); Object.entries(create.attrs).forEach(([k, v]) => el.setAttribute(k, v)); document.head.appendChild(el); }
  if (el) el.setAttribute(attr, value);
}

function applySeo(profile, mainImage, websiteUrl) {
  const name = profile.display_name;
  const url = "https://www.boztik.com/spotlight/profile.html?slug=" + encodeURIComponent(profile.slug);
  const text = String(profile.tagline || profile.description || "").replace(/\s+/g, " ").trim();
  const desc = (name + " — " + (text || "independent business") + " Discover what they offer on Boztik Spotlight, the free business directory.").slice(0, 300);
  document.title = name + " — " + label(profile.category) + " | Boztik Spotlight";
  setMeta('meta[name="description"]', "content", desc, { tag: "meta", attrs: { name: "description" } });
  setMeta('link[rel="canonical"]', "href", url, { tag: "link", attrs: { rel: "canonical" } });
  [["og:title", document.title], ["og:description", desc], ["og:url", url], ["og:type", "profile"], ["og:site_name", "Boztik Spotlight"], ["og:image", mainImage || "https://www.boztik.com/images/boztik-og.png"]]
    .forEach(([prop, value]) => setMeta('meta[property="' + prop + '"]', "content", value, { tag: "meta", attrs: { property: prop } }));
  setMeta('meta[name="twitter:card"]', "content", "summary_large_image", { tag: "meta", attrs: { name: "twitter:card" } });
  const sameAs = (Array.isArray(profile.social_links) ? profile.social_links : Object.values(profile.social_links || {})).map(link => typeof link === "string" ? link : link?.url).filter(value => typeof value === "string" && value.startsWith("https://"));
  const entity = { "@type": "Organization", name, description: text || undefined, url: websiteUrl || undefined, image: mainImage || undefined, sameAs: sameAs.length ? sameAs : undefined };
  const ld = { "@context": "https://schema.org", "@type": "ProfilePage", name: document.title, url, mainEntity: entity };
  let script = document.getElementById("sp-jsonld");
  if (!script) { script = document.createElement("script"); script.type = "application/ld+json"; script.id = "sp-jsonld"; document.head.appendChild(script); }
  script.textContent = JSON.stringify(ld);
}

function renderMusic(song) {
  if (!song || typeof song.id !== "string" || !/^[A-Za-z0-9]{22}$/.test(song.id)) return "";
  const url = "https://open.spotify.com/track/" + song.id;
  return `<section class="sp-media-link-card" aria-label="Featured song">
    <div><span class="sp-kicker">FEATURED SINGLE</span><strong>${esc(song.title || "Listen to their music")}</strong><p>Hear the full track on Spotify.</p></div>
    <a class="sp-button sp-button-outline" href="${url}" target="_blank" rel="noopener noreferrer" data-outbound>Listen on Spotify ↗</a>
  </section>`;
}

function renderFeaturedVideo(video) {
  if (!video || !["youtube", "twitch"].includes(video.platform) || typeof video.id !== "string") return "";
  let external = "";
  const provider = video.platform === "youtube" ? "YouTube" : "Twitch";
  if (video.platform === "youtube" && video.kind === "video" && /^[A-Za-z0-9_-]{11}$/.test(video.id)) {
    external = "https://www.youtube.com/watch?v=" + video.id;
  } else if (video.platform === "twitch" && video.kind === "channel" && /^[a-z0-9_]{3,25}$/.test(video.id)) {
    external = "https://www.twitch.tv/" + video.id;
  } else if (video.platform === "twitch" && video.kind === "video" && /^\\d{5,20}$/.test(video.id)) {
    external = "https://www.twitch.tv/videos/" + video.id;
  } else if (video.platform === "twitch" && video.kind === "clip" && /^[A-Za-z0-9_-]{5,80}$/.test(video.id)) {
    external = "https://clips.twitch.tv/" + video.id;
  }
  if (!external) return "";
  return `<section class="sp-media-link-card" aria-label="Featured video">
    <div><span class="sp-kicker">FEATURED VIDEO · ${provider.toUpperCase()}</span><strong>Watch their work</strong><p>Open the original video or stream on ${provider}.</p></div>
    <a class="sp-button sp-button-outline" href="${esc(external)}" target="_blank" rel="noopener noreferrer" data-outbound>Watch on ${provider} ↗</a>
  </section>`;
}

function profileImages(profile) {
  const supplied = Array.isArray(profile.images) ? profile.images : [];
  const images = supplied
    .map((image, index) => ({ url: safeProfileImageUrl(image?.url), position: Number(image?.position ?? index) }))
    .filter(image => image.url);
  if (!images.length && profile.image_url) {
    const url = safeProfileImageUrl(profile.image_url);
    if (url) images.push({ url, position: 0 });
  }
  return images;
}

function renderGallery(images, name) {
  if (images.length < 2) return "";
  return `<section class="sp-profile-gallery" aria-label="${esc(name)} image gallery">
    <div class="sp-profile-gallery-heading"><span class="sp-kicker">A CLOSER LOOK</span><p>More from ${esc(name)}.</p></div>
    <div class="sp-profile-gallery-stage"><img id="sp-gallery-active-image" src="${esc(images[0].url)}" alt="${esc(name)} — image 1 of ${images.length}" loading="lazy" decoding="async"></div>
    <div class="sp-profile-gallery-controls" role="group" aria-label="Choose a profile image">
      ${images.map((image, index) => `<button type="button" class="sp-gallery-thumb${index === 0 ? " is-active" : ""}" data-gallery-index="${index}" aria-label="Show image ${index + 1} of ${images.length}" aria-pressed="${index === 0}"><img src="${esc(image.url)}" alt="" loading="lazy" decoding="async"></button>`).join("")}
    </div>
  </section>`;
}

function bindGallery(images, name) {
  const stage = host.querySelector("#sp-gallery-active-image");
  if (!stage) return;
  host.querySelectorAll("[data-gallery-index]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.galleryIndex);
      const selected = images[index];
      if (!selected) return;
      stage.src = selected.url;
      stage.alt = `${name} — image ${index + 1} of ${images.length}`;
      host.querySelectorAll("[data-gallery-index]").forEach(item => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
    });
  });
}

function updateCountdown(profile) {
  const countdown = host.querySelector("[data-countdown]");
  if (!countdown) return;
  const remaining = Math.max(0, Number(countdown.dataset.countdown || 0) - Math.floor(Date.now() / 1000));
  const time = countdown.querySelector("time");
  if (time) {
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    time.textContent = [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":");
  }
  if (!remaining) {
    countdown.remove();
    const kicker = host.querySelector(".sp-profile-hero .sp-kicker");
    if (kicker) kicker.textContent = label(profile.category);
  }
}

function bindShare(profile) {
  const shareButton = host.querySelector("#sp-share-profile");
  const shareStatus = host.querySelector("#sp-share-status");
  const shareFallback = host.querySelector("#sp-share-fallback");
  const shareUrl = "https://deliver-api.boztik.com/api/public/spotlight/share/" + encodeURIComponent(profile.slug);
  shareButton?.addEventListener("click", async () => {
    const shareData = {
      title: profile.display_name + " — Boztik Spotlight",
      text: "Discover " + profile.display_name + " on Boztik Spotlight.",
      url: shareUrl
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        shareStatus.textContent = "Thanks for sharing.";
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        shareStatus.textContent = "Profile link copied. Share it wherever you like.";
      } else {
        shareFallback.hidden = false;
        shareFallback.querySelector("input").value = shareUrl;
        shareFallback.querySelector("input").focus();
        shareFallback.querySelector("input").select();
        shareStatus.textContent = "Select and copy the profile link below.";
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        shareFallback.hidden = false;
        shareFallback.querySelector("input").value = shareUrl;
        shareStatus.textContent = "Copy the profile link below to share it.";
      }
    }
  });
}

async function load() {
  if (!slug) {
    host.textContent = "Profile not found.";
    return;
  }

  try {
    const response = await fetch(API + "/profile/" + encodeURIComponent(slug));
    const data = await response.json();
    if (!response.ok || !data.profile) throw new Error("This profile could not be found.");

    const profile = data.profile;
        const initials = profile.display_name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
    const images = profileImages(profile);
    const mainImage = images[0]?.url || "";
    let websiteUrl = "";
    try {
      const url = new URL(profile.website_url);
      if (url.protocol === "https:" && !url.username && !url.password) websiteUrl = url.href;
    } catch {}
    const socialLinks = socialLinksMarkup(profile.social_links, profile.display_name, "sp-profile-social-link", true);
    applySeo(profile, mainImage, websiteUrl);
    const name = profile.display_name;
    const host_ = websiteUrl ? new URL(websiteUrl).hostname.replace(/^www\./, "") : "";
    const music = renderMusic(profile.song);
    const featuredVideo = renderFeaturedVideo(profile.video);
    const featuredLabel = profile.featured
      ? ` · FEATURED TODAY <span class="sp-countdown" data-countdown="${Number(profile.featured_until || 0)}">Ends in <time>--:--:--</time></span>`
      : "";

    host.innerHTML = `
      <div class="sp-profile-hero">
        <div class="sp-profile-avatar">${mainImage ? `<img src="${esc(mainImage)}" alt="${esc(name)} logo or profile photograph" loading="eager" decoding="async">` : esc(initials)}</div>
        <div class="sp-profile-hero-body">
          <p class="sp-kicker">${esc(label(profile.category))}${featuredLabel}</p>
          <h1>${esc(name)}</h1>
          ${profile.tagline ? `<p class="sp-profile-tagline">${esc(profile.tagline)}</p>` : ""}
          <div class="sp-profile-badges"><span>✓ Listed on Boztik Spotlight</span><span>Reviewed by Boztik</span></div>
          ${websiteUrl ? `<div class="sp-profile-hero-actions"><a class="sp-button sp-button-primary" href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer" data-outbound>Visit ${esc(name)} <span aria-hidden="true">↗</span></a></div>` : ""}
        </div>
      </div>
      <dl class="sp-profile-facts">
        <div><dt>Category</dt><dd>${esc(label(profile.category))}</dd></div>
        ${host_ ? `<div><dt>Website</dt><dd>${esc(host_)}</dd></div>` : ""}
        <div><dt>Listing</dt><dd>Boztik Spotlight</dd></div>
      </dl>
      ${renderGallery(images, profile.display_name)}
      <article class="sp-profile-about">
        <p class="sp-kicker">WHAT THEY OFFER</p>
        <h2>About ${esc(name)}</h2>
        <p>${esc(profile.description || profile.tagline || "")}</p>
        <div class="sp-profile-links">
          ${websiteUrl ? `<a href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer" data-outbound><span>Website</span><b>↗</b></a>` : ""}
          ${socialLinks}
        </div>
      </article>
      ${music}
      ${featuredVideo}
      ${websiteUrl ? `<section class="sp-visit-band" aria-label="Visit ${esc(name)}"><div><strong>Like what you see?</strong><p>Go straight to ${esc(name)} to learn more, get in touch or buy.</p></div><a class="sp-button sp-button-primary" href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer" data-outbound>Visit ${esc(host_)} <span aria-hidden="true">↗</span></a></section>` : ""}
      <section class="sp-share-panel" aria-label="Share this creator">
        <div><strong>Know someone who should discover this work?</strong><p>Share this Spotlight profile and help more people find them.</p></div>
        <button class="sp-share-button" type="button" id="sp-share-profile">Share this profile <span aria-hidden="true">↗</span></button>
        <p class="sp-share-status" id="sp-share-status" role="status" aria-live="polite"></p>
        <div class="sp-share-fallback" id="sp-share-fallback" hidden><label for="sp-share-url">Profile link</label><input id="sp-share-url" type="url" readonly></div>
      </section>
      <section class="sp-profile-join"><div><strong>Run a business or create something original?</strong><p>Get your own professional Spotlight profile, free during our pilot.</p></div><a class="sp-button sp-button-outline" href="submit/">Get featured for free <span aria-hidden="true">↗</span></a></section>
      <p class="sp-profile-note">Discovered on <a href="./">Boztik Spotlight</a> · Independent work deserves to be seen.</p>`;

    if (profile.featured) {
      updateCountdown(profile);
      setInterval(() => updateCountdown(profile), 1000);
    }
    event(profile.id, "view");
    bindShare(profile);
    bindGallery(images, profile.display_name);
    host.querySelector(".sp-profile-avatar img")?.addEventListener("error", event => {
      const avatar = event.currentTarget.closest(".sp-profile-avatar");
      avatar.textContent = initials;
    }, { once: true });
    host.querySelector("#sp-gallery-active-image")?.addEventListener("error", event => {
      const stage = event.currentTarget.parentElement;
      stage.textContent = "This image is temporarily unavailable.";
      stage.setAttribute("role", "status");
    }, { once: true });
    host.querySelectorAll(".sp-gallery-thumb img").forEach(image => {
      image.addEventListener("error", () => { image.hidden = true; }, { once: true });
    });
    host.querySelectorAll("[data-outbound]").forEach(link => {
      link.addEventListener("click", () => event(profile.id, "click"));
    });
  } catch {
    host.innerHTML = '<div class="sp-empty"><h2>We couldn’t find that profile.</h2><p>It may have been removed or is no longer published.</p><a class="sp-button sp-button-primary" href="./">Return to Spotlight</a></div>';
  }
}

load();
