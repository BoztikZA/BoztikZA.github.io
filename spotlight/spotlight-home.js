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
    const imageUrl = safeProfileImageUrl(profile.image_url);
    const websiteUrl = safeWebsiteUrl(profile.website_url);
    const shareUrl = API + "/share/" + encodeURIComponent(profile.slug);
    const socialLinks = socialLinksMarkup(profile.social_links, name, "hm-spotlight-social-link");
    const image = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} logo or profile photograph" width="640" height="420" loading="lazy" decoding="async" data-initials="${escapeHtml(initials(name))}" data-profile-name="${escapeHtml(name)}">`
      : `<span class="hm-spotlight-image-fallback" role="img" aria-label="Initials for ${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`;

    return `
      <article class="hm-spotlight-card" data-profile-id="${escapeHtml(profile.id)}" data-featured="${featured ? "1" : "0"}">
        <a class="hm-spotlight-image-link" href="${profilePath}" aria-label="View ${escapeHtml(name)}'s Boztik Spotlight profile">
          <div class="hm-spotlight-image">
            ${image}
            ${featured ? `<span class="hm-spotlight-featured-label">Featured today</span>` : ""}
          </div>
        </a>
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
      host.querySelectorAll(".hm-spotlight-image img").forEach(image => {
        image.addEventListener("error", () => {
          const fallback = document.createElement("span");
          fallback.className = "hm-spotlight-image-fallback";
          fallback.setAttribute("role", "img");
          fallback.setAttribute("aria-label", "Initials for " + image.dataset.profileName);
          fallback.textContent = image.dataset.initials || "B";
          image.replaceWith(fallback);
        }, { once: true });
      });

      bindShareButtons();
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
