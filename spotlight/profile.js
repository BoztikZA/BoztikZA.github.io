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

function renderMusic(song) {
  if (!song || typeof song.id !== "string" || !/^[A-Za-z0-9]{22}$/.test(song.id)) return "";
  const url = "https://open.spotify.com/track/" + song.id;
  return `<section class="sp-music-card" aria-label="Featured song">
    <div class="sp-music-heading"><span class="sp-kicker">FEATURED SINGLE</span><strong>${esc(song.title)}</strong></div>
    <iframe title="Listen to ${esc(song.title)} on Spotify" src="https://open.spotify.com/embed/track/${song.id}?utm_source=generator&amp;theme=0" width="100%" height="152" style="border:0;border-radius:12px" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <a class="sp-music-more" href="${url}" target="_blank" rel="noopener noreferrer" data-outbound>Want to hear more? Explore their music on Spotify ↗</a>
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
    document.title = profile.display_name + " — Boztik Spotlight";
    const initials = profile.display_name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
    const images = profileImages(profile);
    const mainImage = images[0]?.url || "";
    let websiteUrl = "";
    try {
      const url = new URL(profile.website_url);
      if (url.protocol === "https:" && !url.username && !url.password) websiteUrl = url.href;
    } catch {}
    const socialLinks = socialLinksMarkup(profile.social_links, profile.display_name, "sp-profile-social-link", true);
    const music = renderMusic(profile.song);
    const featuredLabel = profile.featured
      ? ` · FEATURED TODAY <span class="sp-countdown" data-countdown="${Number(profile.featured_until || 0)}">Ends in <time>--:--:--</time></span>`
      : "";

    host.innerHTML = `
      <div class="sp-profile-hero">
        <div class="sp-profile-avatar">${mainImage ? `<img src="${esc(mainImage)}" alt="${esc(profile.display_name)} logo or profile photograph" loading="eager" decoding="async">` : esc(initials)}</div>
        <div>
          <p class="sp-kicker">${esc(label(profile.category))}${featuredLabel}</p>
          <h1>${esc(profile.display_name)}</h1>
          <p class="sp-profile-tagline">${esc(profile.tagline)}</p>
        </div>
      </div>
      ${renderGallery(images, profile.display_name)}
      <article class="sp-profile-about">
        <p class="sp-kicker">THE STORY</p>
        <h2>What they're building.</h2>
        <p>${esc(profile.description)}</p>
        <div class="sp-profile-links">
          ${websiteUrl ? `<a href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer" data-outbound><span>Website</span><b>↗</b></a>` : ""}
          ${socialLinks}
        </div>
      </article>
      ${music}
      <section class="sp-share-panel" aria-label="Share this creator">
        <div><strong>Know someone who should discover this work?</strong><p>Share this Spotlight profile and help more people find them.</p></div>
        <button class="sp-share-button" type="button" id="sp-share-profile">Share this profile <span aria-hidden="true">↗</span></button>
        <p class="sp-share-status" id="sp-share-status" role="status" aria-live="polite"></p>
        <div class="sp-share-fallback" id="sp-share-fallback" hidden><label for="sp-share-url">Profile link</label><input id="sp-share-url" type="url" readonly></div>
      </section>
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
