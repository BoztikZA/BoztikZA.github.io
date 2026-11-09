import { socialLinksMarkup } from "./social-links.js";

const API = "https://deliver-api.boztik.com/api/public/spotlight";
const $ = selector => document.querySelector(selector);
const grid = $("#sp-grid");
const empty = $("#sp-empty");
const count = $("#sp-count");
const search = $("#sp-search");
const filters = $("#sp-filters");
const loadMore = $("#sp-load-more");
const loadStatus = $("#sp-load-status");

let profiles = [];
let category = "all";
let nextCursor = null;
let loading = false;
let loaded = false;
let lastFailedReset = false;
let lastFailedMore = false;
let requestNumber = 0;
let controller = null;
let searchTimer;
const impressionsSent = new Set();

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const label = value => String(value || "").replace(/-/g, " ").replace(/\b\w/g, char => char.toUpperCase());

function card(profile) {
  const initials = profile.display_name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const platformIcons = socialLinksMarkup(profile.social_links, profile.display_name, "sp-social-link");
  const featured = profile.featured
    ? `<span class="sp-featured">FEATURED TODAY</span><span class="sp-countdown" data-countdown="${Number(profile.featured_until || 0)}">Ends in <time>--:--:--</time></span>`
    : Date.now() / 1000 - profile.created_at < 604800 ? '<span class="sp-new">JUST ADDED</span>' : "";

  return `<article class="sp-card" data-profile-id="${esc(profile.id)}" data-featured="${profile.featured ? "1" : "0"}">
    ${featured}
    <div class="sp-card-top">
      <div class="sp-avatar" aria-hidden="true">${profile.image_url ? `<img src="${esc(profile.image_url)}" alt="" loading="lazy">` : esc(initials)}</div>
      <div><h3 class="sp-card-name">${esc(profile.display_name)}</h3><span class="sp-card-category">${esc(label(profile.category))}</span></div>
    </div>
    ${profile.tagline ? `<h3 class="sp-card-offer">${esc(profile.tagline)}</h3>` : ""}
    <p>${esc(profile.description)}</p>
    <div class="sp-card-foot">
      ${platformIcons ? `<span class="sp-card-platforms" aria-label="Social profiles">${platformIcons}</span>` : ""}
      <a class="sp-card-link" href="profile.html?slug=${encodeURIComponent(profile.slug)}">See what they offer ↗</a>
      <button class="sp-card-share" type="button" data-share-slug="${esc(profile.slug)}" data-share-name="${esc(profile.display_name)}" aria-label="Share ${esc(profile.display_name)}'s Spotlight profile">Share ↗</button>
    </div>
    <p class="sp-card-share-status" role="status" aria-live="polite"></p>
  </article>`;
}

function updateCountdowns() {
  const timestamp = Math.floor(Date.now() / 1000);
  document.querySelectorAll("[data-countdown]").forEach(element => {
    const remaining = Math.max(0, Number(element.dataset.countdown || 0) - timestamp);
    const time = element.querySelector("time");
    if (time) {
      const hours = Math.floor(remaining / 3600);
      const minutes = Math.floor((remaining % 3600) / 60);
      const seconds = remaining % 60;
      time.textContent = [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":");
    }
    if (!remaining) {
      const profileCard = element.closest(".sp-card");
      if (profileCard) {
        profileCard.dataset.featured = "0";
        profileCard.querySelector(".sp-featured")?.remove();
      }
      element.remove();
    }
  });
}

function trackImpressions() {
  const cards = [...grid.querySelectorAll('[data-featured="1"]')];
  const send = element => {
    const profileId = element.dataset.profileId;
    if (impressionsSent.has(profileId)) return;
    impressionsSent.add(profileId);
    fetch(API + "/impression", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: crypto.randomUUID().replace(/-/g, ""), profile_id: profileId }),
      keepalive: true
    }).catch(() => {});
  };

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        send(entry.target);
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.35 });
    cards.forEach(element => observer.observe(element));
  } else {
    cards.forEach(send);
  }
}

function render() {
  grid.innerHTML = profiles.map(card).join("");
  grid.hidden = profiles.length === 0;
  empty.hidden = profiles.length > 0 || !loaded || lastFailedReset;
  count.textContent = profiles.length
    ? `Showing ${profiles.length} ${profiles.length === 1 ? "profile" : "profiles"}`
    : lastFailedReset ? "Directory unavailable" : "No profiles found";
  trackImpressions();
  updateCountdowns();
}

function updateLoadControls() {
  loadMore.hidden = profiles.length === 0 && !lastFailedReset;
  loadMore.disabled = loading;
  loadMore.textContent = loading
    ? "Loading profiles…"
    : lastFailedReset ? "Retry loading Spotlight"
      : lastFailedMore ? "Retry loading more profiles"
        : "Load more profiles";
  if (!loading && !lastFailedReset && !nextCursor && profiles.length) {
    loadMore.hidden = true;
    loadStatus.textContent = "You’re all caught up.";
  } else if (nextCursor && !loading) {
    loadMore.hidden = false;
    loadStatus.textContent = "";
  }
}

async function load(reset = true) {
  if (loading && !reset) return;
  if (reset) {
    requestNumber += 1;
    controller?.abort();
    controller = new AbortController();
    loading = false;
    loaded = false;
    profiles = [];
    nextCursor = null;
    lastFailedReset = false;
    lastFailedMore = false;
    render();
  }

  const thisRequest = requestNumber;
  const thisController = controller || new AbortController();
  loading = true;
  loadStatus.textContent = reset ? "Loading profiles…" : "Loading more profiles…";
  updateLoadControls();

  const url = new URL(API);
  url.searchParams.set("limit", "30");
  if (category !== "all") url.searchParams.set("category", category);
  const query = search.value.trim().slice(0, 80);
  if (query) url.searchParams.set("q", query);
  if (!reset && nextCursor) url.searchParams.set("cursor", nextCursor);

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: thisController.signal });
    if (!response.ok) throw new Error("Spotlight is temporarily unavailable.");
    const data = await response.json();
    if (thisRequest !== requestNumber) return;
    const seen = new Set(profiles.map(profile => profile.id));
    for (const profile of Array.isArray(data.profiles) ? data.profiles : []) {
      if (!seen.has(profile.id)) {
        profiles.push(profile);
        seen.add(profile.id);
      }
    }
    nextCursor = typeof data.next_cursor === "string" && data.next_cursor ? data.next_cursor : null;
    loaded = true;
    lastFailedReset = false;
    lastFailedMore = false;
    render();
    loadStatus.textContent = nextCursor ? "More profiles are available." : "You’re all caught up.";
  } catch (error) {
    if (error?.name === "AbortError" || thisRequest !== requestNumber) return;
    lastFailedReset = reset;
    lastFailedMore = !reset;
    loadStatus.textContent = reset
      ? "Spotlight is taking a short break. Please retry."
      : "Could not load more profiles. Your current results are still available.";
    if (reset) {
      grid.innerHTML = '<div class="sp-loading">Spotlight is taking a short break. Please try again.</div>';
      grid.hidden = false;
      empty.hidden = true;
      count.textContent = "Directory unavailable";
    }
  } finally {
    if (thisRequest === requestNumber) {
      loading = false;
      updateLoadControls();
    }
  }
}

grid.addEventListener("click", async event => {
  const button = event.target.closest("button[data-share-slug]");
  if (!button) return;
  const slug = button.dataset.shareSlug;
  const name = button.dataset.shareName || "this creator";
  const status = button.closest(".sp-card")?.querySelector(".sp-card-share-status");
  const url = "https://deliver-api.boztik.com/api/public/spotlight/share/" + encodeURIComponent(slug);
  try {
    if (navigator.share) {
      await navigator.share({ title: name + " — Boztik Spotlight", text: "Discover " + name + " on Boztik Spotlight.", url });
      if (status) status.textContent = "Thanks for sharing.";
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      if (status) status.textContent = "Profile share link copied.";
    } else if (status) status.textContent = "Copy this link: " + url;
  } catch (error) {
    if (error?.name !== "AbortError" && status) status.textContent = "Copy this link: " + url;
  }
});

filters.addEventListener("click", event => {
  const button = event.target.closest("button[data-category]");
  if (!button || loading) return;
  category = button.dataset.category;
  filters.querySelectorAll("button").forEach(item => item.classList.toggle("is-active", item === button));
  load(true);
});

search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => load(true), 250);
});

loadMore.addEventListener("click", () => {
  if (lastFailedReset) load(true);
  else load(false);
});

load();
setInterval(updateCountdowns, 1000);
