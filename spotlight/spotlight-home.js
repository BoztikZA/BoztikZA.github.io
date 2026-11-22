import {
  API_BASE as API, heroCardMarkup, discoverSectionMarkup, profileImageUrls, initials,
} from "./home-cards.js";

/**
 * Homepage Spotlight.
 *  - The Worker selects one homepage featured creator for each 24-hour window.
 *  - The Command Centre can replace that creator at any time.
 *  - Pending, declined and unpublished applications are never returned by the public API, so they can never appear.
 */
(() => {
  const host = document.getElementById("hm-spotlight-grid");
  if (!host) return;

  let countdownInterval = null;
  let galleryIntervals = [];
  const DISCOVER_LIMIT = 50;

  function trackFeaturedImpression(card) {
    if (!card || card.dataset.impressionSent) return;
    card.dataset.impressionSent = "1";
    fetch(API + "/impression", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: crypto.randomUUID().replace(/-/g, ""), profile_id: card.dataset.profileId, placement: card.dataset.featuredMode || "manual" }),
      keepalive: true
    }).catch(() => {});
  }

  function updateCountdowns() {
    const now = Math.floor(Date.now() / 1000);
    host.querySelectorAll("[data-countdown]").forEach(element => {
      const left = Math.max(0, Number(element.dataset.countdown || 0) - now);
      const time = element.querySelector("time");
      if (time) {
        time.textContent = [Math.floor(left / 3600), Math.floor(left % 3600 / 60), left % 60]
          .map(value => String(value).padStart(2, "0")).join(":");
      }
      if (!left) element.remove();
    });
    if (!host.querySelector("[data-countdown]") && countdownInterval !== null) {
      window.clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function trackFeaturedImpressions() {
    const cards = host.querySelectorAll('[data-featured="1"]');
    if (!cards.length) return;
    if (!("IntersectionObserver" in window)) { cards.forEach(trackFeaturedImpression); return; }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { trackFeaturedImpression(entry.target); observer.unobserve(entry.target); }
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
      let activeIndex = 0, activeLayer = 0, paused = false, isLoading = false;
      let imageFailed = media.dataset.galleryError === "1";
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
      media.addEventListener("focusout", event => { if (!media.contains(event.relatedTarget)) paused = false; });
      if (!reducedMotion) {
        galleryIntervals.push(window.setInterval(() => { if (!paused && !imageFailed) select((activeIndex + 1) % urls.length); }, 4500));
      }
    });
  }

  /** Arrow buttons + edge state for the horizontal strip. Native scrolling (touch, wheel, keyboard) stays untouched. */
  function bindDiscoverStrip() {
    const viewport = host.querySelector(".hm-discover-viewport");
    const track = host.querySelector(".hm-discover-track");
    if (!viewport || !track) return;
    const prev = host.querySelector('[data-discover-dir="-1"]');
    const next = host.querySelector('[data-discover-dir="1"]');
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sync = () => {
      const max = track.scrollWidth - track.clientWidth - 2;
      const atStart = track.scrollLeft <= 2;
      const atEnd = track.scrollLeft >= max;
      viewport.classList.toggle("is-start", atStart);
      viewport.classList.toggle("is-end", atEnd);
      if (prev) prev.disabled = atStart;
      if (next) next.disabled = atEnd;
    };
    [prev, next].forEach(button => button?.addEventListener("click", () => {
      const step = Math.max(240, Math.round(track.clientWidth * 0.8)) * Number(button.dataset.discoverDir);
      track.scrollBy({ left: step, behavior: reducedMotion ? "auto" : "smooth" });
    }));
    track.addEventListener("scroll", () => window.requestAnimationFrame(sync), { passive: true });
    window.addEventListener("resize", sync, { passive: true });
    sync();
  }

  function showEmptyState() {
    host.innerHTML = `
      <div class="hm-spotlight-empty">
        <div class="bz-spot-preview__copy">
          <span class="hm-spotlight-category">BOZTIK BUSINESS SPOTLIGHT</span>
          <h3>No active featured profiles right now.</h3>
          <p>Browse approved directory listings or submit your own profile for review. A featured creator appears here when an eligible published listing is available.</p>
          <div class="hm-spotlight-empty-actions">
            <a class="hm-spotlight-profile-link" href="spotlight/">Browse the directory <span aria-hidden="true">↗</span></a>
            <a class="hm-spotlight-website-link" href="spotlight/submit/">Apply to be listed</a>
          </div>
        </div>
      </div>`;
  }

  function showUnavailableState() {
    host.innerHTML = `
      <div class="hm-spotlight-empty">
        <div class="bz-spot-preview__copy">
          <span class="hm-spotlight-category">BOZTIK BUSINESS SPOTLIGHT</span>
          <h3>Featured profiles are temporarily unavailable.</h3>
          <p>The directory remains available. Visit Spotlight to browse published profiles and learn how to submit your own.</p>
          <div class="hm-spotlight-empty-actions">
            <a class="hm-spotlight-profile-link" href="spotlight/">Open the directory <span aria-hidden="true">↗</span></a>
            <a class="hm-spotlight-website-link" href="spotlight/submit/">Apply to be listed</a>
          </div>
        </div>
      </div>`;
  }

  function renderProfiles(featured, others, mode) {
    const previousScroll = host.querySelector(".hm-discover-track")?.scrollLeft || 0;
    galleryIntervals.forEach(intervalId => window.clearInterval(intervalId));
    galleryIntervals = [];
    if (countdownInterval !== null) {
      window.clearInterval(countdownInterval);
      countdownInterval = null;
    }

    host.innerHTML = heroCardMarkup(featured) + discoverSectionMarkup(others);
    host.classList.add("hm-spotlight-grid--stacked");
    const hero = host.querySelector('[data-featured="1"]');
    if (hero) hero.dataset.featuredMode = mode;

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
    host.querySelectorAll(".hm-discover-thumb img").forEach(image => {
      image.addEventListener("error", () => {
        const fallback = document.createElement("span");
        fallback.className = "hm-discover-initials";
        fallback.setAttribute("aria-hidden", "true");
        fallback.textContent = initials(image.closest(".hm-discover-card")?.querySelector(".hm-discover-name")?.textContent);
        image.replaceWith(fallback);
      }, { once: true });
    });

    bindShareButtons();
    bindImageGalleries([featured]);
    bindDiscoverStrip();
    const newTrack = host.querySelector(".hm-discover-track");
    if (newTrack && previousScroll) newTrack.scrollLeft = previousScroll;
    trackFeaturedImpressions();
    updateCountdowns();
    if (host.querySelector("[data-countdown]")) countdownInterval = window.setInterval(updateCountdowns, 1000);
  }

  fetch(API + "?limit=" + DISCOVER_LIMIT, { headers: { Accept: "application/json" } })
    .then(response => {
      if (!response.ok) throw new Error("Spotlight is temporarily unavailable.");
      return response.json();
    })
    .then(data => {
      if (!data || !Array.isArray(data.profiles)) throw new Error("Spotlight returned an invalid profile list.");
      const nowSeconds = Math.floor(Date.now() / 1000);
      const valid = data.profiles.filter(profile => profile && typeof profile === "object"
        && typeof profile.display_name === "string" && profile.display_name.trim()
        && typeof profile.slug === "string" && profile.slug);
      const featured = valid.find(profile => profile.featured === true && Number(profile.featured_until) > nowSeconds) || valid[0] || null;

      if (!featured) { showEmptyState(); return; }

      // The server owns the 24-hour rotation schedule. Do not rotate on a visitor-side timer:
      // that would make the featured profile change every few seconds and bypass Command Centre choices.
      renderProfiles(featured, valid.filter(profile => profile !== featured), featured.featured ? "rotation" : "manual");
    })
    .catch(error => {
      console.error("[spotlight-home] Unable to load published profiles.", error);
      showUnavailableState();
    })
    .finally(() => {
      host.setAttribute("aria-busy", "false");
    });
})();
