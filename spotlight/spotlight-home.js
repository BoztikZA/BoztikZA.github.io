import { socialLinksMarkup } from "./social-links.js";

(() => {
  const host = document.getElementById("hm-spotlight-grid");
  if (!host) return;

  const API = "https://deliver-api.boztik.com/api/public/spotlight";
  let countdownInterval = null;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  const label = value => String(value || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());

  function initials(name) {
    return String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join("")
      .toUpperCase() || "B";
  }

  function safeProfileImageUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return "";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:"
        || url.hostname !== "deliver-api.boztik.com"
        || !url.pathname.startsWith("/api/public/spotlight/image/")) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function safeWebsiteUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return "";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function profileImageUrls(profile) {
    const images = Array.isArray(profile.images) ? profile.images
      .map(image => ({ position: Number(image?.position), url: safeProfileImageUrl(image?.url) }))
      .filter(image => image.url)
      .sort((a, b) => a.position - b.position) : [];
    if (!images.some(image => image.position === 0)) {
      const primary = safeProfileImageUrl(profile.image_url);
      if (primary) images.unshift({ position: 0, url: primary });
    }
    return [...new Map(images.map(image => [image.url, image])).values()].map(image => image.url);
  }

  function trackFeaturedImpression(card) {
    if (!card || card.dataset.impressionSent) return;
    card.dataset.impressionSent = "1";
    fetch(API + "/impression", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: crypto.randomUUID().replace(/-/g, ""),
        profile_id: card.dataset.profileId
      }),
      keepalive: true
    }).catch(() => {});
  }

  function cardMarkup(profile) {
    const name = String(profile.display_name || "").trim();
    const profilePath = "spotlight/profile.html?slug=" + encodeURIComponent(profile.slug);
    const featuredUntil = Number(profile.featured_until) || 0;
    const featured = profile.featured === true && featuredUntil > Math.floor(Date.now() / 1000);
    const category = label(profile.category) || "Spotlight profile";
    const imageUrls = profileImageUrls(profile);
    const imageUrl = imageUrls[0] || "";
    const websiteUrl = safeWebsiteUrl(profile.website_url);
    const shareUrl = API + "/share/" + encodeURIComponent(profile.slug);
    const socialLinks = socialLinksMarkup(profile.social_links, name, "hm-spotlight-social-link");
    const image = imageUrl
      ? `<img class="is-active" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} logo or profile photograph" width="640" height="420" loading="lazy" decoding="async" data-layer="0"><img alt="" width="640" height="420" loading="lazy" decoding="async" data-layer="1" aria-hidden="true">`
      : `<span class="hm-spotlight-image-fallback" role="img" aria-label="Initials for ${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`;

    return `
      <article class="hm-spotlight-card" data-profile-id="${escapeHtml(profile.id)}" data-featured="${featured ? "1" : "0"}">
        <div class="hm-spotlight-media" data-image-count="${imageUrls.length}">
          <a class="hm-spotlight-image-link" href="${profilePath}" aria-label="View ${escapeHtml(name)}'s Boztik Spotlight profile">
            <div class="hm-spotlight-image">
              ${image}
              ${featured ? `<span class="hm-spotlight-featured-label">Featured today</span>` : ""}
            </div>
          </a>
          ${imageUrls.length > 1 ? `<div class="hm-spotlight-gallery-controls" role="group" aria-label="${escapeHtml(name)} image gallery">${imageUrls.map((_, index) => `<button type="button" data-gallery-index="${index}" aria-label="Show image ${index + 1} of ${imageUrls.length}" aria-pressed="${index === 0}" class="${index === 0 ? "is-active" : ""}"></button>`).join("")}</div>` : ""}
        </div>
        ${featured ? `<p class="hm-spotlight-countdown" data-countdown="${featuredUntil}">Featured for <time>--:--:--</time> more</p>` : ""}
        <div class="hm-spotlight-card-content">
          <span class="hm-spotlight-category">${escapeHtml(category)}</span>
          <h3><a href="${profilePath}">${escapeHtml(name)}</a></h3>
          <p class="hm-spotlight-tagline">${escapeHtml(profile.tagline)}</p>
          <p class="hm-spotlight-description">${escapeHtml(profile.description)}</p>
          ${socialLinks ? `<div class="hm-spotlight-socials" aria-label="Social profiles">${socialLinks}</div>` : ""}
          <div class="hm-spotlight-actions">
            <a class="hm-spotlight-profile-link" href="${profilePath}">View Boztik profile <span aria-hidden="true">↗</span></a>
            ${websiteUrl ? `<a class="hm-spotlight-website-link" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" data-outbound>Visit website <span aria-hidden="true">↗</span></a>` : ""}
            <button class="hm-spotlight-share" type="button" data-share-url="${escapeHtml(shareUrl)}" data-share-title="${escapeHtml(name)}">Share profile</button>
          </div>
          <span class="hm-spotlight-share-status" role="status" aria-live="polite"></span>
        </div>
      </article>`;
  }

  function updateCountdowns() {
    const now = Math.floor(Date.now() / 1000);
    host.querySelectorAll("[data-countdown]").forEach(element => {
      const left = Math.max(0, Number(element.dataset.countdown || 0) - now);
      const time = element.querySelector("time");
      if (time) {
        const hours = Math.floor(left / 3600);
        const minutes = Math.floor(left % 3600 / 60);
        const seconds = left % 60;
        time.textContent = [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":");
      }
      if (!left) {
        const card = element.closest(".hm-spotlight-card");
        if (card) {
          card.dataset.featured = "0";
          card.querySelector(".hm-spotlight-featured-label")?.remove();
        }
        element.remove();
      }
    });

    if (!host.querySelector("[data-countdown]") && countdownInterval !== null) {
      window.clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function trackFeaturedImpressions() {
    const cards = host.querySelectorAll('[data-featured="1"]');
    if (!cards.length) return;
    if (!("IntersectionObserver" in window)) {
      cards.forEach(trackFeaturedImpression);
      return;
    }

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          trackFeaturedImpression(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    cards.forEach(card => observer.observe(card));
  }

  function bindShareButtons() {
    host.querySelectorAll(".hm-spotlight-share").forEach(button => {
      button.addEventListener("click", async () => {
        const url = button.dataset.shareUrl;
        const title = button.dataset.shareTitle;
        const status = button.closest(".hm-spotlight-card").querySelector(".hm-spotlight-share-status");
        try {
          if (navigator.share) {
            await navigator.share({ title: title + " — Boztik Spotlight", text: "Discover " + title + " on Boztik Spotlight.", url });
            status.textContent = "Thanks for sharing.";
          } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            status.textContent = "Profile link copied.";
          } else {
            status.textContent = "Copy this link: " + url;
          }
        } catch (error) {
          if (error?.name !== "AbortError") status.textContent = "Copy this link: " + url;
        }
      });
    });
  }

  function bindImageGalleries(profiles) {
    const byId = new Map(profiles.map(profile => [profile.id, profileImageUrls(profile)]));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    host.querySelectorAll(".hm-spotlight-card").forEach(card => {
      const urls = byId.get(card.dataset.profileId) || [];
      const media = card.querySelector(".hm-spotlight-media");
      const controls = [...card.querySelectorAll("[data-gallery-index]")];
      const layers = [...card.querySelectorAll("[data-layer]")];
      if (urls.length < 2 || layers.length !== 2) return;
      let activeIndex = 0;
      let activeLayer = 0;
      let paused = false;
      let imageFailed = media.dataset.galleryError === "1";
      let isLoading = false;
      const select = index => {
        if (index === activeIndex || !urls[index] || isLoading) return;
        isLoading = true;
        const nextLayer = 1 - activeLayer;
        const next = layers[nextLayer];
        const previous = layers[activeLayer];
        next.onload = () => {
          next.classList.add("is-active");
          next.removeAttribute("aria-hidden");
          previous.classList.remove("is-active");
          previous.setAttribute("aria-hidden", "true");
          window.setTimeout(() => { previous.removeAttribute("src"); }, 350);
          activeIndex = index;
          activeLayer = nextLayer;
          isLoading = false;
          controls.forEach((button, buttonIndex) => {
            const active = buttonIndex === index;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
          });
        };
        next.onerror = () => {
          isLoading = false;
          imageFailed = true;
          media.querySelector(".hm-spotlight-gallery-controls")?.remove();
          media.dataset.imageCount = "1";
          next.remove();
          previous.classList.add("is-active");
        };
        next.src = urls[index];
        next.alt = card.querySelector("h3")?.textContent.trim() + " — image " + (index + 1);
      };
      controls.forEach(button => button.addEventListener("click", () => select(Number(button.dataset.galleryIndex))));
      media.addEventListener("pointerenter", () => { paused = true; });
      media.addEventListener("pointerleave", () => { paused = false; });
      media.addEventListener("focusin", () => { paused = true; });
      media.addEventListener("focusout", event => {
        if (!media.contains(event.relatedTarget)) paused = false;
      });
      if (!reducedMotion) {
        window.setInterval(() => {
          if (!paused && !imageFailed) select((activeIndex + 1) % urls.length);
        }, 4500);
      }
    });
  }

  function showEmptyState() {
    host.innerHTML = `
      <div class="hm-spotlight-empty">
        <span class="hm-spotlight-category">THE DIRECTORY</span>
        <h3>No published profiles to feature right now.</h3>
        <p>Explore the full Spotlight directory to meet independent businesses and creators.</p>
        <a class="hm-spotlight-profile-link" href="spotlight/">Explore all Spotlight profiles <span aria-hidden="true">↗</span></a>
      </div>`;
  }

  function showUnavailableState() {
    host.innerHTML = `
      <div class="hm-spotlight-empty" role="status">
        <span class="hm-spotlight-category">SPOTLIGHT</span>
        <h3>Profiles are temporarily unavailable.</h3>
        <p>Please visit the Spotlight directory and try again later.</p>
        <a class="hm-spotlight-profile-link" href="spotlight/">Open the Spotlight directory <span aria-hidden="true">↗</span></a>
      </div>`;
  }

  fetch(API + "?limit=3", { headers: { Accept: "application/json" } })
    .then(response => {
      if (!response.ok) throw new Error("Spotlight is temporarily unavailable.");
      return response.json();
    })
    .then(data => {
      if (!data || !Array.isArray(data.profiles)) throw new Error("Spotlight returned an invalid profile list.");
      const profiles = data.profiles
        .filter(profile => profile && typeof profile === "object"
          && typeof profile.display_name === "string" && profile.display_name.trim()
          && typeof profile.slug === "string" && profile.slug)
        .slice(0, 3);

      if (!profiles.length) {
        showEmptyState();
        return;
      }

      host.innerHTML = profiles.map(cardMarkup).join("");
      host.querySelectorAll(".hm-spotlight-image [data-layer='0']").forEach(image => {
        image.addEventListener("error", () => {
          const fallback = document.createElement("span");
          fallback.className = "hm-spotlight-image-fallback";
          fallback.setAttribute("role", "img");
          fallback.setAttribute("aria-label", "Initials for " + image.alt.split(" logo or profile photograph")[0]);
          fallback.textContent = initials(image.alt);
          image.closest(".hm-spotlight-media").dataset.galleryError = "1";
          image.closest(".hm-spotlight-media").querySelector(".hm-spotlight-gallery-controls")?.remove();
          image.closest(".hm-spotlight-image").replaceChildren(fallback);
        }, { once: true });
      });

      bindShareButtons();
      bindImageGalleries(profiles);
      trackFeaturedImpressions();
      updateCountdowns();
      if (host.querySelector("[data-countdown]")) {
        countdownInterval = window.setInterval(updateCountdowns, 1000);
      }
    })
    .catch(error => {
      console.error("[spotlight-home] Unable to load published profiles.", error);
      showUnavailableState();
    })
    .finally(() => {
      host.setAttribute("aria-busy", "false");
    });
})();
