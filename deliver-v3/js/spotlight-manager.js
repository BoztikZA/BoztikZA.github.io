import { config } from "./config.js";
import { authHeaders, getSession, onAuthChange } from "./auth.js";
import { prepareSpotlightImage } from "../../spotlight/image-processing.js";
import { spotlightProfileSaveRequest, normaliseWebsiteUrl, validateSpotlightDraft, publishGateState, describeSaveError } from "./spotlight-profile-request.mjs?v=2";

const $ = id => document.getElementById(id);
const list = $("sp-admin-list");
const feedback = $("sp-admin-feedback");
const formStatus = $("sp-admin-form-status");

// Save/publish results are shown right beside the buttons (the page-level status line
// sits above the form and is usually scrolled out of view), and mirrored there too.
function showFormStatus(kind, message) {
  feedback.textContent = message;
  feedback.classList.toggle("sp-admin-feedback-success", kind === "success");
  if (!formStatus) return;
  formStatus.hidden = !message;
  formStatus.textContent = message;
  formStatus.dataset.kind = kind;
  if (message) formStatus.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function clearFormStatus() {
  feedback.classList.remove("sp-admin-feedback-success");
  if (formStatus) { formStatus.hidden = true; formStatus.textContent = ""; }
}
function applyPublishGate(profileId, status) {
  const expired = status === "expired";
  const canPublish = status === "approved" || status === "published";
  const gate = publishGateState(profileId, status === "published" ? "published" : "pending");
  const button = $("sp-admin-publish");
  button.hidden = false;
  button.disabled = gate.disabled || (Boolean(profileId) && (!canPublish || expired));
  button.textContent = expired ? "Listing expired" : profileId && !canPublish ? "Approve application to publish" : gate.label;
}
const publishState = profile => profile.status === "published" && profile.listing_expires_at
  && profile.listing_expires_at * 1000 <= Date.now() ? "expired" : profile.application_status || profile.status;
function updatePublicationEmail(profile) {
  const panel = $("sp-publication-email");
  const available = profile?.status === "published" && profile.contact_email;
  panel.hidden = !available;
  $("sp-publication-email-status").textContent = "";
  if (!available) return;
  const profileUrl = "https://www.boztik.com/spotlight/profile.html?slug=" + encodeURIComponent(profile.slug);
  $("sp-publication-email-to").value = profile.contact_email;
  $("sp-publication-email-subject").value = "Your Boztik Spotlight profile is live";
  $("sp-publication-email-body").value = `Hello ${profile.display_name},\n\nYour profile is now live on Boztik Spotlight. Thank you for sharing your work with our community.\n\nView your profile: ${profileUrl}\n\nYou can share this link with your customers and community. If you would like any changes, reply to this email and our team will be happy to help.\n\nThe Boztik Spotlight team\nwww.boztik.com`;
}
const analytics = $("sp-admin-analytics");
const editForm = $("sp-admin-edit");
const descriptionField = editForm.elements.description;
const descriptionCount = $("sp-description-count");
const DESCRIPTION_MAX_LENGTH = 5000;
function updateDescriptionCount() {
  const length = descriptionField.value.length;
  descriptionCount.textContent = `${length.toLocaleString()} / ${DESCRIPTION_MAX_LENGTH.toLocaleString()} characters`;
  descriptionCount.classList.toggle("is-near-limit", length >= DESCRIPTION_MAX_LENGTH * 0.9);
}
descriptionField.addEventListener("input", updateDescriptionCount);
updateDescriptionCount();
let profiles = [];
let moderation = { unread_count: 0, pending_decision_count: 0, approved_count: 0 };
let galleryPreviewUrls = [];

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c]));

const api = async (path, init = {}) => {
  const response = await fetch(config.apiBaseUrl + path, {
    ...init,
    cache: "no-store",
    headers: { ...authHeaders(), ...(init.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(data.error || "Spotlight request failed.");
    failure.status = response.status;
    throw failure;
  }
  return data;
};

/* Queue filters (client-side over the already-loaded profiles; nothing is hidden from the data, only from view). */
const QUEUE_FILTERS = [
  ["all", "All"],
  ["action", "Needs action"],
  ["waiting", "Waiting on applicant"],
  ["approved", "Approved, not live"],
  ["live", "Live"],
  ["closed", "Declined, expired or archived"],
];
let queueFilter = "all";
const isLive = p => p.status === "published" && (!p.listing_expires_at || p.listing_expires_at * 1000 > Date.now());
function matchesQueueFilter(p, filter = queueFilter) {
  switch (filter) {
    case "action": return (p.application_status === "new" || (p.application_status === "under_review" && !p.awaiting_applicant));
    case "waiting": return Boolean(p.awaiting_applicant);
    case "approved": return p.application_status === "approved" && p.status !== "published";
    case "live": return isLive(p);
    case "closed": return ["declined", "expired"].includes(p.application_status) || p.status === "archived";
    default: return true;
  }
}
const filterBar = document.createElement("div");
filterBar.className = "sp-queue-filters";
filterBar.setAttribute("role", "group");
filterBar.setAttribute("aria-label", "Filter submissions");
list.before(filterBar);
filterBar.addEventListener("click", event => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  queueFilter = button.dataset.filter;
  render();
});
function renderFilterBar() {
  filterBar.innerHTML = QUEUE_FILTERS.map(([key, label]) => {
    const count = profiles.filter(p => matchesQueueFilter(p, key)).length;
    return `<button type="button" class="cc-btn" data-filter="${key}" aria-pressed="${key === queueFilter}">${esc(label)} <b>${count}</b></button>`;
  }).join("");
}

function render() {
  const pending = profiles.filter(p => ["new", "under_review"].includes(p.application_status));
  const published = profiles.filter(p => p.status === "published" && (!p.listing_expires_at || p.listing_expires_at * 1000 > Date.now()));
  const featured = published.find(p => p.featured);
  $("sp-admin-pending").textContent = Number(moderation.pending_decision_count ?? pending.length).toLocaleString();
  $("sp-admin-unread").textContent = Number(moderation.unread_count || 0).toLocaleString();
  $("sp-admin-approved").textContent = Number(moderation.approved_count ?? profiles.filter(p => p.application_status === "approved").length).toLocaleString();
  const unreadBadge = $("sp-admin-tab-unread");
  unreadBadge.textContent = Number(moderation.unread_count || 0) + " unread";
  unreadBadge.hidden = !moderation.unread_count;
  $("sp-admin-published").textContent = published.length;
  $("sp-admin-featured").textContent = featured ? featured.display_name : "None";
  const overviewCount = $("stat-spotlight-active");
  if (overviewCount) overviewCount.textContent = published.length.toLocaleString();

  const reviewActions = p => {
    if (p.application_status === "new") return `
      ${p.review_unread ? `<button class="cc-btn" data-action="mark-read" data-id="${esc(p.id)}">Mark read</button>` : ""}
      <button class="cc-btn sp-review" data-action="review" data-id="${esc(p.id)}">Review application</button>`;
    if (p.application_status === "under_review") return `
      <button class="cc-btn sp-review" data-action="review" data-id="${esc(p.id)}">Review application</button>`;
    if (p.application_status === "approved" && p.status !== "published") return `<button class="cc-btn sp-approve" data-action="publish" data-id="${esc(p.id)}">Publish</button>`;
    if (p.status === "published" && p.listing_expires_at && p.listing_expires_at * 1000 <= Date.now()) return "<small>Expired listing · cleanup pending</small>";
    if (p.status === "published") return `<button class="cc-btn" data-action="archive" data-id="${esc(p.id)}">Archive</button>`;
    if (p.application_status === "published" && p.status === "archived") return `<button class="cc-btn" data-action="publish" data-id="${esc(p.id)}">Republish</button>`;
    return "";
  };
  renderFilterBar();
  const visible = profiles.filter(p => matchesQueueFilter(p));
  list.innerHTML = visible.length ? visible.map(p => `
    <article class="sp-admin-row">
      <div class="sp-admin-main">
        <strong>${esc(p.display_name)}</strong>
        <span>${esc(p.category.replace(/-/g, " "))} · ${esc(p.application_status || p.status)} · ${new Date(p.created_at * 1000).toLocaleDateString()}${p.placement_plan && p.placement_plan !== "free" ? ` · <b class="sp-plan-badge">${esc(p.placement_plan)}</b>` : ""}</span>
        <small>${esc(p.contact_email || "")}</small>
        ${p.application_status === "new" || p.application_status === "under_review" || p.application_status === "approved"
          ? `<small>Decision deadline: ${p.review_expires_at ? new Date(p.review_expires_at * 1000).toLocaleString() : "Not set"}</small>` : ""}
        ${p.status === "published" && p.listing_expires_at ? `<small>Listing expires: ${new Date(p.listing_expires_at * 1000).toLocaleString()}</small>` : ""}
        ${p.decline_reason ? `<small>Decline reason: ${esc(p.decline_reason)}</small>` : ""}
        ${p.awaiting_applicant ? `<small><strong>Waiting for applicant reply</strong></small>` : p.info_response_note && p.application_status === "under_review" ? `<small><strong>Applicant replied — ready to review</strong></small>` : ""}
        ${p.invalid_social_links?.length ? `<small class="sp-admin-link-warning">Review invalid ${esc(p.invalid_social_links.join(", "))} link(s) before publishing.</small>` : ""}
        <p>${esc(p.tagline)}</p>
      </div>
      <div class="sp-admin-actions">
        <button class="cc-btn" data-action="review" data-id="${esc(p.id)}">Review</button>
        <button class="cc-btn" data-action="edit" data-id="${esc(p.id)}">Edit profile</button>
        ${p.status === "published" || p.completed_plays !== undefined ? `<button class="cc-btn" data-action="stats" data-id="${esc(p.id)}">Analytics</button>` : ""}
        ${reviewActions(p)}
        ${p.status === "published" && (!p.listing_expires_at || p.listing_expires_at * 1000 > Date.now()) ? (p.featured ? `<button class="cc-btn" data-action="unfeature" data-id="${esc(p.id)}">Remove feature</button>` : `<button class="cc-btn" data-action="feature" data-id="${esc(p.id)}">Feature 24h</button>`) : ""}
        <button class="cc-btn sp-delete" data-action="delete" data-id="${esc(p.id)}">Delete</button>
      </div>
    </article>`).join("") : profiles.length ? "<p class='cc-muted'>Nothing matches this filter.</p>" : "<p class='cc-muted'>No submissions yet. New entries will appear here for review.</p>";
}

let spotlightLoadInProgress = false;
let spotlightRefreshQueued = false;
async function load({ silent = false } = {}) {
  if (spotlightLoadInProgress) {
    spotlightRefreshQueued = true;
    return false;
  }
  spotlightLoadInProgress = true;
  const refreshButton = $("sp-admin-refresh");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    refreshButton.textContent = "Refreshing…";
  }
  if (!silent) feedback.textContent = "Refreshing Spotlight profiles and views…";
  try {
    const profilesResponse = await api("/api/admin/spotlight");
    profiles = Array.isArray(profilesResponse.profiles) ? profilesResponse.profiles : [];
    moderation = profilesResponse;
    render();

    // Analytics are secondary: keep profile creation and moderation usable if
    // the analytics endpoint is temporarily unavailable.
    let analyticsResponse = { profiles: [] };
    let analyticsUnavailable = false;
    try {
      analyticsResponse = await api("/api/admin/spotlight/analytics");
    } catch (analyticsError) {
      analyticsUnavailable = true;
      analytics.innerHTML = "<p class=\"cc-inline-error\" role=\"status\">Profiles are available. Engagement analytics could not load: " + esc(analyticsError.message) + "</p>";
    }
    const rows = Array.isArray(analyticsResponse.profiles) ? analyticsResponse.profiles : [];
    const views = rows.reduce((total, p) => total + Number(p.views || 0), 0);
    $("sp-admin-views").textContent = views.toLocaleString();
    if (!analyticsUnavailable) analytics.innerHTML = rows.length ? rows.map(p => `
      <div class="sp-admin-metric">
        <strong>${esc(p.display_name)}</strong>
        <span>${Number(p.views || 0).toLocaleString()} views</span>
        <span>${Number(p.unique_views || 0).toLocaleString()} daily unique visitors</span>
        <span>${Number(p.outbound_clicks || 0).toLocaleString()} outbound clicks</span>
        <span>${Number(p.featured_impressions || 0).toLocaleString()} featured impressions</span>
        <span>${Number(p.website_clicks || 0).toLocaleString()} website · ${Number(p.social_clicks || 0).toLocaleString()} social · ${Number(p.media_clicks || 0).toLocaleString()} media clicks</span>
        <span>${Number(p.player_interactions || 0).toLocaleString()} plays · ${Number(p.completed_plays || 0).toLocaleString()} completed (YouTube)</span>
      </div>`).join("") : "<p class='cc-muted'>Engagement will appear when visitors start exploring profiles.</p>";
    const updatedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    feedback.textContent = analyticsUnavailable
      ? `Spotlight profiles loaded · analytics temporarily unavailable · Updated ${updatedAt}`
      : `Spotlight profiles and views updated · ${updatedAt}`;
    return true;
  } catch (error) {
    feedback.textContent = error.message;
    return false;
  } finally {
    spotlightLoadInProgress = false;
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.removeAttribute("aria-busy");
      refreshButton.textContent = "Refresh";
    }
    if (spotlightRefreshQueued) {
      spotlightRefreshQueued = false;
      void load({ silent: true });
    }
  }
}

function openNewProfile() {
  editForm.reset();
  editForm.elements.id.value = "";
  $("sp-profile-image-preview").textContent = "Save the profile first, then upload its logo or photograph.";
  $("sp-profile-image-status").textContent = "";
  $("sp-gallery-images").value = "";
  $("sp-gallery-image-list").textContent = "Save the profile first, then add showcase images.";
  $("sp-gallery-upload").disabled = true;
  $("sp-gallery-status").textContent = "";
  updatePublicationEmail(null);
  galleryPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  galleryPreviewUrls = [];
  $("sp-profile-feature").checked = false;
  clearFormStatus();
  applyPublishGate("");
  editForm.hidden = false;
  editForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function openEditor(profile) {
  editForm.elements.id.value = profile.id;
  editForm.elements.display_name.value = profile.display_name || "";
  editForm.elements.tagline.value = profile.tagline || "";
  editForm.elements.description.value = profile.description || "";
  editForm.elements.category.value = profile.category || "other";
  editForm.elements.website_url.value = profile.website_url || "";
  editForm.elements.contact_email.value = profile.contact_email || "";
  editForm.elements.song_url.value = profile.song?.url || "";
  editForm.elements.video_url.value = profile.video?.url || "";
  $("sp-profile-feature").checked = Boolean(profile.featured);
  clearFormStatus();
  applyPublishGate(profile.id, publishState(profile));
  for (const key of ["youtube", "twitch", "instagram", "tiktok", "facebook", "linkedin", "x", "spotify", "pinterest"]) editForm.elements[key].value = profile.social_links?.[key] || "";
  editForm.hidden = false;
  const preview = $("sp-profile-image-preview");
  preview.textContent = "Loading image…";
  fetch(config.apiBaseUrl + "/api/admin/spotlight/profile/" + encodeURIComponent(profile.id) + "/image", { headers: authHeaders() })
    .then(async response => {
      if (!response.ok) throw new Error("No image uploaded");
      const blob = await response.blob();
      preview.innerHTML = '<img alt="Current Spotlight profile image" src="' + URL.createObjectURL(blob) + '">';
    })
    .catch(() => { preview.textContent = "No image uploaded"; });
  $("sp-profile-image").value = "";
  $("sp-profile-image-status").textContent = "";
  $("sp-gallery-images").value = "";
  $("sp-gallery-status").textContent = "";
  updatePublicationEmail(profile);
  loadGallery(profile);
  editForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadGallery(profile) {
  const list = $("sp-gallery-image-list");
  const uploadButton = $("sp-gallery-upload");
  galleryPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  galleryPreviewUrls = [];
  list.replaceChildren();
  uploadButton.disabled = !profile.id;
  if (!profile.id) {
    list.textContent = "Save the profile first, then add showcase images.";
    return;
  }
  const positions = Array.isArray(profile.gallery_positions) ? profile.gallery_positions : [];
  if (!positions.length) {
    list.textContent = "No additional images uploaded.";
    return;
  }
  for (const position of positions) {
    const item = document.createElement("div");
    item.className = "sp-gallery-admin-item";
    item.textContent = "Loading image " + position + "…";
    list.append(item);
    try {
      const response = await fetch(config.apiBaseUrl + "/api/admin/spotlight/profile/" + encodeURIComponent(profile.id) + "/gallery/" + position, { headers: authHeaders() });
      if (!response.ok) throw new Error("Image " + position + " could not be loaded.");
      const url = URL.createObjectURL(await response.blob());
      galleryPreviewUrls.push(url);
      const image = document.createElement("img");
      image.src = url;
      image.alt = "Spotlight showcase image " + position;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "cc-btn";
      remove.textContent = "Remove image " + position;
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        $("sp-gallery-status").textContent = "Removing image…";
        try {
          await api("/api/admin/spotlight/profile/" + encodeURIComponent(profile.id) + "/gallery/" + position, { method: "DELETE" });
          await load();
          const updated = profiles.find(item => item.id === profile.id);
          if (updated) await loadGallery(updated);
          $("sp-gallery-status").textContent = "Image removed and shared storage accounting updated.";
        } catch (error) {
          $("sp-gallery-status").textContent = error.message;
          remove.disabled = false;
        }
      });
      item.replaceChildren(image, remove);
      item.className = "sp-gallery-admin-item";
    } catch (error) {
      item.textContent = error.message;
      item.classList.add("is-error");
    }
  }
}

$("sp-admin-new").addEventListener("click", openNewProfile);

// Accept pasted domains and add HTTPS before validating or saving.
function normaliseProfileUrls() {
  for (const input of editForm.querySelectorAll('input[type="url"]')) input.value = normaliseWebsiteUrl(input.value);
}
editForm.addEventListener("focusout", event => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.type === "url") input.value = normaliseWebsiteUrl(input.value);
}, true);


/* Private application review dialog: all applicant-supplied content is escaped,
   and external destinations are rendered as explicit HTTPS links. */
const reviewModal = document.createElement("div");
reviewModal.className = "sp-review-modal";
reviewModal.hidden = true;
reviewModal.innerHTML = `
  <div class="sp-review-backdrop" data-review-close></div>
  <section class="sp-review-card" role="dialog" aria-modal="true" aria-labelledby="sp-review-title">
    <button type="button" class="sp-review-close" data-review-close aria-label="Close review">×</button>
    <span class="cc-eyebrow">Private application review</span>
    <h2 id="sp-review-title">Review application</h2>
    <div id="sp-review-content" class="sp-review-content">Loading application…</div>
    <div id="sp-review-decline-panel" class="sp-review-decline-panel" hidden>
      <label for="sp-review-decline-reason">Reason for declining (at least 10 characters)</label>
      <textarea id="sp-review-decline-reason" rows="4" maxlength="1000" placeholder="Explain why the application cannot be approved."></textarea>
      <div class="sp-review-actions">
        <button type="button" class="cc-btn" data-review-cancel-decline>Back</button>
        <button type="button" class="cc-btn sp-decline" data-review-confirm-decline>Confirm decline</button>
      </div>
    </div>
    <div id="sp-review-info-panel" class="sp-review-decline-panel" hidden>
      <label for="sp-review-info-note">What do you need from the applicant? (at least 10 characters; they will see this and be emailed)</label>
      <textarea id="sp-review-info-note" rows="4" maxlength="1000" placeholder="e.g. Please link a portfolio or confirm the website is yours."></textarea>
      <div class="sp-review-actions">
        <button type="button" class="cc-btn" data-review-cancel-info>Back</button>
        <button type="button" class="cc-btn sp-approve" data-review-confirm-info>Send request</button>
      </div>
    </div>
    <div id="sp-review-actions" class="sp-review-actions">
      <button type="button" class="cc-btn" data-review-close>Close</button>
      <button type="button" class="cc-btn" data-review-info>Request information</button>
      <button type="button" class="cc-btn sp-approve" data-review-approve>Approve application</button>
      <button type="button" class="cc-btn sp-decline" data-review-decline>Decline</button>
    </div>
    <p id="sp-review-status" role="status" aria-live="polite"></p>
  </section>`;
document.body.append(reviewModal);
const reviewContent = reviewModal.querySelector("#sp-review-content");
const reviewStatus = reviewModal.querySelector("#sp-review-status");
const reviewDeclinePanel = reviewModal.querySelector("#sp-review-decline-panel");
const reviewActionsPanel = reviewModal.querySelector("#sp-review-actions");
const reviewInfoPanel = reviewModal.querySelector("#sp-review-info-panel");
let activeReviewProfile = null;
let reviewObjectUrls = [];
function closeReviewModal() {
  reviewModal.hidden = true;
  reviewObjectUrls.forEach(url => URL.revokeObjectURL(url));
  reviewObjectUrls = [];
  activeReviewProfile = null;
}
function reviewLink(label, url) {
  if (!url) return "";
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
}
const EVENT_LABELS = { submitted: "Application submitted", mark_read: "Marked as read", start_review: "Review started", request_info: "Information requested", info_received: "Applicant replied", approve: "Approved", decline: "Declined", publish: "Published", expire: "Expired" };
/** Terms acceptance and the information-request exchange. All values are escaped. */
function applicantDialogue(profile) {
  const terms = profile.terms_accepted_at
    ? `Accepted terms version ${esc(profile.terms_version || "?")} on ${esc(new Date(profile.terms_accepted_at * 1000).toLocaleString())}`
    : "No terms record (created by an administrator or before terms were recorded)";
  let exchange = "";
  if (profile.info_request_note) {
    exchange = `<p><strong>You asked</strong> (${esc(new Date(profile.info_requested_at * 1000).toLocaleString())}):</p><p class="sp-review-description">${esc(profile.info_request_note)}</p>` +
      (profile.awaiting_applicant ? "<p><strong>Waiting for the applicant to reply.</strong></p>"
        : profile.info_response_note ? `<p><strong>Applicant replied</strong> (${esc(new Date(profile.info_responded_at * 1000).toLocaleString())}):</p><p class="sp-review-description">${esc(profile.info_response_note)}</p>` : "");
  }
  return `<section><h4>Applicant communication</h4><p>${terms}</p>${exchange || "<p>No information has been requested.</p>"}</section>`;
}
async function loadReviewEvents(id) {
  const target = reviewContent.querySelector("#sp-review-events");
  try {
    const data = await api("/api/admin/spotlight/profile/" + encodeURIComponent(id) + "/events");
    const events = (data.events || []).slice().reverse();
    target.replaceChildren(...(events.length ? events : [{ action: "", created_at: 0 }]).map(event => {
      const li = document.createElement("li");
      li.textContent = event.action
        ? new Date(event.created_at * 1000).toLocaleString() + " · " + (EVENT_LABELS[event.action] || event.action) + " · " + event.actor + (event.action === "request_info" || event.action === "decline" ? " · " + (event.reason || "") : "")
        : "No events recorded.";
      return li;
    }));
  } catch { target.textContent = "Audit log unavailable."; }
}
async function openReviewModal(profile) {
  activeReviewProfile = profile;
  reviewModal.hidden = false;
  reviewContent.innerHTML = "<p>Loading private application details…</p>";
  reviewStatus.textContent = "";
  reviewDeclinePanel.hidden = true;
  reviewInfoPanel.hidden = true;
  reviewActionsPanel.hidden = false;
  reviewObjectUrls.forEach(url => URL.revokeObjectURL(url));
  reviewObjectUrls = [];
  if (profile.application_status === "new") {
    try {
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(profile.id) + "/review", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_review" })
      });
      await load();
      profile = profiles.find(item => item.id === profile.id) || profile;
      activeReviewProfile = profile;
    } catch (error) {
      reviewStatus.textContent = "Could not mark this application as under review: " + error.message;
    }
  }
  const socials = Object.entries(profile.social_links || {}).map(([key, value]) => reviewLink(key, value)).join("");
  const song = profile.song?.url ? reviewLink("Spotify " + (profile.song.type || "track") + (profile.song.verified === false ? " (unverified: Spotify was unreachable)" : "") + ": " + (profile.song.title || "Open link"), profile.song.url) : "";
  let videoEmbed = "";
  const video = profile.video;
  if (video?.platform === "youtube" && video.kind === "video" && /^[A-Za-z0-9_-]{11}$/.test(video.id || "")) {
    videoEmbed = "https://www.youtube-nocookie.com/embed/" + video.id + "?controls=1&rel=0";
  } else if (video?.platform === "twitch" && video.kind === "channel" && /^[a-z0-9_]{3,25}$/.test(video.id || "")) {
    videoEmbed = "https://player.twitch.tv/?channel=" + encodeURIComponent(video.id) + "&parent=www.boztik.com&autoplay=false";
  } else if (video?.platform === "twitch" && video.kind === "video" && /^\d{5,20}$/.test(video.id || "")) {
    videoEmbed = "https://player.twitch.tv/?video=v" + video.id + "&parent=www.boztik.com&autoplay=false";
  } else if (video?.platform === "twitch" && video.kind === "clip" && /^[A-Za-z0-9_-]{5,80}$/.test(video.id || "")) {
    videoEmbed = "https://clips.twitch.tv/embed?clip=" + encodeURIComponent(video.id) + "&parent=www.boztik.com";
  }
  const videoPreview = videoEmbed ? `<section><h4>Applicant's featured video · ${esc(video.platform.toUpperCase())}</h4><div class="sp-review-video"><iframe title="Private review preview of applicant video" src="${esc(videoEmbed)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div><p>Review the actual content, audio, quality and suitability before approving this application. Player controls are provided by the platform.</p>${reviewLink("Open original video", video.url)}</section>` : (video?.url ? `<section><h4>Featured video link</h4>${reviewLink("Open submitted video", video.url)}<p>The submitted link could not be embedded. Check it manually before making a decision.</p></section>` : "");
  reviewContent.innerHTML = `
    <div class="sp-review-identity">
      <div class="sp-review-avatar" id="sp-review-avatar">Loading image…</div>
      <div><h3>${esc(profile.display_name)}</h3><p>${esc(profile.tagline)}</p><span>${esc((profile.category || "other").replace(/-/g," "))} · Submitted ${esc(new Date(profile.created_at * 1000).toLocaleString())}</span></div>
    </div>
    <dl class="sp-review-facts">
      <div><dt>Contact email</dt><dd>${profile.contact_email ? `<a href="mailto:${esc(profile.contact_email)}">${esc(profile.contact_email)}</a>` : "Not supplied"}</dd></div>
      <div><dt>Website</dt><dd>${reviewLink(profile.website_url, profile.website_url) || "Not supplied"}</dd></div>
    </dl>
    <section><h4>About the applicant</h4><p class="sp-review-description">${esc(profile.description || "No description supplied.")}</p></section>
    <section><h4>Website and social profiles</h4><div class="sp-review-links">${socials || "<span>No social links supplied.</span>"}${song}</div></section>
    ${videoPreview}
    ${applicantDialogue(profile)}
    <section><h4>Showcase images</h4><div id="sp-review-gallery" class="sp-review-gallery"><span>Loading showcase images…</span></div></section>
    <section><h4>Audit log</h4><ol id="sp-review-events" class="sp-review-events"><li>Loading…</li></ol></section>`;
  loadReviewEvents(profile.id);
  const loadPrivateImage = async (path, alt, target) => {
    try {
      const response = await fetch(config.apiBaseUrl + path, { headers: authHeaders() });
      if (!response.ok) throw new Error("Image unavailable");
      const url = URL.createObjectURL(await response.blob());
      reviewObjectUrls.push(url);
      const img = document.createElement("img");
      img.src = url; img.alt = alt;
      target.replaceChildren(img);
    } catch { target.textContent = "Image unavailable"; }
  };
  const avatar = reviewContent.querySelector("#sp-review-avatar");
  const gallery = reviewContent.querySelector("#sp-review-gallery");
  await loadPrivateImage("/api/admin/spotlight/profile/" + encodeURIComponent(profile.id) + "/image", "Applicant logo or profile image", avatar);
  const positions = Array.isArray(profile.gallery_positions) ? profile.gallery_positions : [];
  gallery.replaceChildren();
  if (!positions.length) gallery.textContent = "No additional showcase images supplied.";
  else for (const position of positions) {
    const tile = document.createElement("div");
    tile.className = "sp-review-gallery-item";
    tile.textContent = "Loading…";
    gallery.append(tile);
    await loadPrivateImage("/api/admin/spotlight/profile/" + encodeURIComponent(profile.id) + "/gallery/" + position, "Applicant showcase image " + position, tile);
  }
  reviewModal.querySelector("[data-review-approve]").hidden = !["new","under_review"].includes(profile.application_status);
  reviewModal.querySelector("[data-review-decline]").hidden = !["new","under_review"].includes(profile.application_status);
  reviewModal.querySelector("[data-review-info]").hidden = !["new","under_review"].includes(profile.application_status);
  reviewModal.querySelector(".sp-review-card").focus?.();
}
reviewModal.addEventListener("click", async event => {
  const target = event.target.closest("[data-review-close],[data-review-approve],[data-review-decline],[data-review-cancel-decline],[data-review-confirm-decline],[data-review-info],[data-review-cancel-info],[data-review-confirm-info]");
  if (!target) return;
  if (target.hasAttribute("data-review-close")) { closeReviewModal(); return; }
  if (!activeReviewProfile) return;
  if (target.hasAttribute("data-review-decline")) {
    reviewDeclinePanel.hidden = false; reviewActionsPanel.hidden = true;
    reviewModal.querySelector("#sp-review-decline-reason").focus(); return;
  }
  if (target.hasAttribute("data-review-info")) {
    reviewInfoPanel.hidden = false; reviewActionsPanel.hidden = true;
    reviewModal.querySelector("#sp-review-info-note").focus(); return;
  }
  if (target.hasAttribute("data-review-cancel-info")) {
    reviewInfoPanel.hidden = true; reviewActionsPanel.hidden = false; return;
  }
  if (target.hasAttribute("data-review-confirm-info")) {
    const note = reviewModal.querySelector("#sp-review-info-note").value.trim();
    if (note.length < 10) { reviewStatus.textContent = "Please say what you need (at least 10 characters)."; return; }
    target.disabled = true;
    try {
      const result = await api("/api/admin/spotlight/profile/" + encodeURIComponent(activeReviewProfile.id) + "/review", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_info", note })
      });
      closeReviewModal(); await load();
      feedback.textContent = result.email_queued ? "Information requested. The applicant has been emailed and can reply from their private status link." : "Information requested. No contact email is on file, so the applicant can only see this on their status link.";
    } catch (error) { reviewStatus.textContent = error.message; } finally { target.disabled = false; }
    return;
  }
  if (target.hasAttribute("data-review-cancel-decline")) {
    reviewDeclinePanel.hidden = true; reviewActionsPanel.hidden = false; return;
  }
  const profile = activeReviewProfile;
  if (target.hasAttribute("data-review-approve")) {
    target.disabled = true;
    try {
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(profile.id) + "/review", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" })
      });
      closeReviewModal(); await load();
      feedback.textContent = "Application approved. Publish it separately within 72 hours.";
    } catch (error) { reviewStatus.textContent = error.message; target.disabled = false; }
    return;
  }
  if (target.hasAttribute("data-review-confirm-decline")) {
    const reason = reviewModal.querySelector("#sp-review-decline-reason").value.trim();
    if (reason.length < 10) { reviewStatus.textContent = "Please provide a reason of at least 10 characters."; return; }
    target.disabled = true;
    try {
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(profile.id) + "/review", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline", reason })
      });
      if (profile.contact_email) {
        const subject = "Update on your Boztik Spotlight application";
        const body = `Hello ${profile.display_name},\n\nThank you for applying for Boztik Spotlight. Unfortunately, we are unable to approve your application at this time.\n\nReason: ${reason}\n\nYou are welcome to review your submission and contact us if you have questions.\n\nThe Boztik team\nhttps://www.boztik.com/`;
        window.location.href = "mailto:" + encodeURIComponent(profile.contact_email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
        closeReviewModal(); await load();
        feedback.textContent = "Application declined. Your email app should open with the applicant’s address and your reason ready to review and send.";
      } else {
        await api("/api/admin/spotlight/profile/" + encodeURIComponent(profile.id), { method: "DELETE" });
        closeReviewModal(); await load();
        feedback.textContent = "Application declined. No email was supplied, so the profile and all its images were permanently deleted.";
      }
    } catch (error) { reviewStatus.textContent = error.message; target.disabled = false; }
  }
});

/* Per-profile analytics (real aggregates from the Worker; admin previews and bots are already excluded server-side). */
const statsModal = document.createElement("div");
statsModal.className = "sp-review-modal";
statsModal.hidden = true;
statsModal.innerHTML = `
  <div class="sp-review-backdrop" data-stats-close></div>
  <section class="sp-review-card" role="dialog" aria-modal="true" aria-labelledby="sp-stats-title">
    <button type="button" class="sp-review-close" data-stats-close aria-label="Close analytics">×</button>
    <span class="cc-eyebrow">Profile analytics</span>
    <h2 id="sp-stats-title">Analytics</h2>
    <div class="sp-queue-filters" role="group" aria-label="Date range">
      <button type="button" class="cc-btn" data-stats-days="7">7 days</button>
      <button type="button" class="cc-btn" data-stats-days="30">30 days</button>
      <button type="button" class="cc-btn" data-stats-days="90">90 days</button>
    </div>
    <div id="sp-stats-body" class="sp-review-content" aria-live="polite">Loading…</div>
  </section>`;
document.body.append(statsModal);
let statsProfileId = "";
async function loadStats(days) {
  const body = statsModal.querySelector("#sp-stats-body");
  statsModal.querySelectorAll("[data-stats-days]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.statsDays) === days)));
  body.textContent = "Loading…";
  try {
    const data = await api("/api/admin/spotlight/profile/" + encodeURIComponent(statsProfileId) + "/analytics?days=" + days);
    const a = data.analytics, t = a.totals;
    const max = Math.max(1, ...a.series.map(d => d.views));
    const names = { direct: "Direct or unknown", directory: "Spotlight directory", featured: "Featured page", search: "Search engines", social: "Social platforms", other: "Other websites" };
    body.innerHTML = `
      <dl class="sp-review-facts">
        <div><dt>Featured impressions</dt><dd>${Number(t.featured_impressions).toLocaleString()}</dd></div>
        <div><dt>Profile views (${Number(t.unique_views).toLocaleString()} unique visitor-days)</dt><dd>${Number(t.views).toLocaleString()}</dd></div>
        <div><dt>Link clicks: website / social / media</dt><dd>${Number(t.link_clicks).toLocaleString()} (${t.website_clicks} / ${t.social_clicks} / ${t.media_clicks})</dd></div>
        <div><dt>Player plays · completed (YouTube only)</dt><dd>${Number(t.player_interactions).toLocaleString()} · ${Number(t.completed_plays).toLocaleString()}</dd></div>
      </dl>
      <section><h4>Views per day, ${esc(a.from)} to ${esc(a.to)}</h4>
        <div class="sp-stats-bars" role="img" aria-label="Profile views per day: ${Number(t.views)} in total">${a.series.map(d => `<i style="height:${Math.round(d.views / max * 100)}%" title="${esc(d.day)}: ${d.views}"></i>`).join("")}</div></section>
      <section><h4>Where visits came from</h4><div class="sp-review-links">${a.sources.filter(x => x.views).map(x => `<span>${esc(names[x.source] || x.source)}: <b>${Number(x.views).toLocaleString()}</b></span>`).join("") || "<span>No visits in this period.</span>"}</div></section>`;
  } catch (error) { body.textContent = "Analytics unavailable: " + error.message; }
}
statsModal.addEventListener("click", event => {
  if (event.target.closest("[data-stats-close]")) { statsModal.hidden = true; return; }
  const button = event.target.closest("[data-stats-days]");
  if (button) loadStats(Number(button.dataset.statsDays));
});

list.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  const profile = profiles.find(item => item.id === id);
  if (!profile) return;
  if (action === "stats") {
    statsProfileId = profile.id;
    statsModal.querySelector("#sp-stats-title").textContent = profile.display_name + " — analytics";
    statsModal.hidden = false;
    loadStats(30);
    return;
  }
  if (action === "edit") { openEditor(profile); return; }
  if (action === "review") { openReviewModal(profile); return; }
  if (action === "delete" && !confirm("Permanently delete this profile and its analytics? This cannot be undone.")) return;

  button.disabled = true;
  feedback.textContent = "Updating profile…";
  try {
    if (action === "delete") {
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(id), { method: "DELETE" });
    } else if (["mark-read", "start-review", "approve"].includes(action)) {
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(id) + "/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action === "mark-read" ? "mark_read" : action === "start-review" ? "start_review" : action,
          
        })
      });
    } else {
      const body = action === "publish" ? { status: "published" }
        : action === "archive" ? { status: "archived" }
        : action === "feature" ? { featured: true } : { featured: false };
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    }
    await load();
    if (action === "delete") feedback.textContent = "Profile and its images deleted; shared storage accounting was reconciled.";
    else if (action === "start-review") feedback.textContent = "Application marked as under review.";
    else if (action === "approve") feedback.textContent = "Application approved. Publish it separately within 72 hours.";
    else if (action === "mark-read") feedback.textContent = "Application marked as read.";
    else if (action === "publish") feedback.textContent = "✓ Profile is live on the Boztik Spotlight directory for 72 hours.";
    else if (action === "feature") feedback.textContent = "✓ Homepage feature is active for 24 hours.";
    else if (action === "unfeature") feedback.textContent = "Homepage feature removed.";
  } catch (error) {
    feedback.textContent = error.message;
    button.disabled = false;
  }
});

$("sp-admin-publish").addEventListener("click", async () => {
  const id = editForm.elements.id.value;
  if (!id) {
    showFormStatus("error", "Save the profile draft first, then publish it.");
    return;
  }
  const button = $("sp-admin-publish");
  const name = editForm.elements.display_name.value.trim() || "Profile";
  button.disabled = true;
  showFormStatus("info", "Publishing profile…");
  try {
    const result = await api("/api/admin/spotlight/profile/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published", featured: $("sp-profile-feature").checked })
    });
    if (result?.profile?.status !== "published") throw new Error("The server did not confirm that the profile is live. Refresh and check its status.");
    await load();
    const publishedProfile = profiles.find(item => item.id === id);
    if (publishedProfile) updatePublicationEmail(publishedProfile);
    showFormStatus("success", $("sp-profile-feature").checked
      ? "✓ " + name + " is live on Boztik and featured on the homepage for 24 hours."
      : "✓ " + name + " is now live on the Boztik Spotlight directory.");
    button.textContent = "Apply live settings";
  } catch (error) {
    showFormStatus("error", "Could not publish: " + describeSaveError(error));
  } finally {
    button.disabled = false;
  }
});

editForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (editForm.dataset.saving === "true") return;
  normaliseProfileUrls();
  const draft = Object.fromEntries(new FormData(editForm).entries());
  const problem = validateSpotlightDraft(draft);
  if (problem) {
    showFormStatus("error", problem);
    return;
  }
  if (!editForm.checkValidity()) {
    const invalid = editForm.querySelector(":invalid");
    const label = invalid?.closest("label")?.firstChild?.textContent?.trim();
    showFormStatus("error", (label ? label + ": " : "") + (invalid?.validationMessage || "Please complete the required profile fields."));
    editForm.reportValidity();
    invalid?.focus();
    return;
  }
  const id = editForm.elements.id.value;
  const profile = profiles.find(item => item.id === id);
  if (id && !profile) {
    showFormStatus("error", "This profile is no longer in the manager list. Refresh Spotlight and try again.");
    return;
  }
  const form = new FormData(editForm);
  const social = { ...(profile?.social_links || {}) };
  for (const key of ["youtube", "twitch", "instagram", "tiktok", "facebook", "linkedin", "x", "spotify", "pinterest"]) {
    const value = String(form.get(key) || "").trim();
    if (value) social[key] = value;
    else delete social[key];
  }
  const body = {
    song_url: form.get("song_url"),
    video_url: form.get("video_url"),
    display_name: form.get("display_name"),
    tagline: form.get("tagline"),
    description: form.get("description"),
    category: form.get("category"),
    contact_email: form.get("contact_email"),
    website_url: form.get("website_url"),
    social_links: social
  };
  const save = editForm.querySelector('button[type="submit"]');
  editForm.dataset.saving = "true";
  save.disabled = true;
  showFormStatus("info", "Saving…");
  try {
    const request = spotlightProfileSaveRequest(id, body);
    const saved = await api(request.path, request.init);
    if (!saved?.profile?.id) throw new Error("The server did not confirm the saved profile. Refresh Spotlight before trying again.");
    const savedIndex = profiles.findIndex(item => item.id === saved.profile.id);
    if (savedIndex === -1) profiles.unshift(saved.profile);
    else profiles[savedIndex] = saved.profile;
    render();
    // The server has confirmed the save (it returned the stored profile), so publishing may unlock.
    editForm.elements.id.value = saved.profile.id;
    applyPublishGate(saved.profile.id, publishState(saved.profile));
    const refreshed = await load();
    const refreshedProfile = profiles.find(item => item.id === saved.profile.id);
    if (refreshedProfile) {
      await loadGallery(refreshedProfile);
      updatePublicationEmail(refreshedProfile);
    }
    showFormStatus("success", id
      ? refreshed ? "✓ Profile changes saved. Publish or apply live settings when ready." : "✓ Profile changes saved, but the list could not refresh. Use Refresh to sync."
      : refreshed ? "✓ Draft saved and added to the list below. Upload its logo or photograph, then select Publish profile when ready."
        : "✓ Draft saved, but the list could not refresh. Use Refresh to sync.");
  } catch (error) {
    showFormStatus("error", "Could not save the draft: " + describeSaveError(error));
  } finally {
    editForm.dataset.saving = "false";
    save.disabled = false;
  }
});


$("sp-profile-image-upload").addEventListener("click", async () => {
  const profileId = editForm.elements.id.value;
  const file = $("sp-profile-image").files[0];
  const status = $("sp-profile-image-status");
  if (!profileId) { status.textContent = "Save or select a profile first."; return; }
  if (!file) { status.textContent = "Choose an image first."; return; }
  if (file.size > 20 * 1024 * 1024) { status.textContent = "Choose a source image no larger than 20 MB."; return; }
  if (!["image/jpeg","image/png","image/webp"].includes(file.type)) { status.textContent = "Choose a JPG, PNG or WebP image."; return; }
  const button = $("sp-profile-image-upload");
  button.disabled = true; status.textContent = "Uploading and checking storage…";
  try {
    status.textContent = "Optimizing image…";
    const optimized = await prepareSpotlightImage(file);
    const response = await fetch(config.apiBaseUrl + "/api/admin/spotlight/profile/" + encodeURIComponent(profileId) + "/image", {
      method: "PUT", headers: { ...authHeaders(), "Content-Type": optimized.type }, body: optimized
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Image upload failed.");
    status.textContent = "Image uploaded. It will appear publicly when the profile is published.";
    const preview = $("sp-profile-image-preview"), url = URL.createObjectURL(optimized);
    preview.innerHTML = '<img alt="Uploaded Spotlight profile image" src="' + url + '">';
    await load();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

$("sp-publication-email-copy").addEventListener("click", async () => {
  const message = $("sp-publication-email-body");
  const status = $("sp-publication-email-status");
  try {
    await navigator.clipboard.writeText([
      "To: " + $("sp-publication-email-to").value,
      "Subject: " + $("sp-publication-email-subject").value,
      "",
      message.value
    ].join("\n"));
    status.textContent = "Publication email copied. Send it manually from your email account.";
  } catch {
    message.focus();
    message.select();
    status.textContent = "Clipboard access was unavailable. The message is selected so you can copy it manually.";
  }
});

$("sp-gallery-upload").addEventListener("click", async () => {
  const profileId = editForm.elements.id.value;
  const files = Array.from($("sp-gallery-images").files || []);
  const status = $("sp-gallery-status");
  if (!profileId) { status.textContent = "Save or select a profile first."; return; }
  if (!files.length) { status.textContent = "Choose one or more images first."; return; }
  if (files.length > 2) { status.textContent = "Choose no more than two images at a time."; return; }
  if (files.some(file => file.size > 20 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
    status.textContent = "Choose JPG, PNG or WebP source images no larger than 20 MB.";
    return;
  }
  const profile = profiles.find(item => item.id === profileId);
  if (!profile) { status.textContent = "Refresh Spotlight and select the profile again."; return; }
  const occupied = new Set(profile.gallery_positions || []);
  const slots = [1, 2].filter(position => !occupied.has(position));
  if (files.length > slots.length) {
    status.textContent = "This profile has room for " + slots.length + " more showcase image(s). Remove an image first to make space.";
    return;
  }
  const button = $("sp-gallery-upload");
  button.disabled = true;
  status.textContent = "Optimizing images and checking shared storage…";
  let uploaded = 0;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = await prepareSpotlightImage(files[index]);
      const response = await fetch(config.apiBaseUrl + "/api/admin/spotlight/profile/" + encodeURIComponent(profileId) + "/gallery/" + slots[index], {
        method: "PUT", headers: { ...authHeaders(), "Content-Type": file.type }, body: file
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Showcase image upload failed.");
      uploaded += 1;
    }
    $("sp-gallery-images").value = "";
    await load();
    const updated = profiles.find(item => item.id === profileId);
    if (updated) await loadGallery(updated);
    status.textContent = uploaded + " showcase image(s) uploaded successfully.";
  } catch (error) {
    status.textContent = uploaded
      ? uploaded + " image(s) uploaded. " + error.message
      : error.message;
    await load();
    const updated = profiles.find(item => item.id === profileId);
    if (updated) await loadGallery(updated);
  } finally {
    button.disabled = false;
  }
});

$("sp-admin-edit-cancel").addEventListener("click", () => {
  editForm.reset();
  editForm.hidden = true;
  clearFormStatus();
  $("sp-admin-publish").hidden = true;
  $("sp-admin-publish").disabled = true;
  galleryPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  galleryPreviewUrls = [];
});
$("sp-admin-refresh").addEventListener("click", () => { void load(); });

// Keep new applications and engagement counts current without requiring a full
// Command Centre page reload. Pause polling in background tabs to avoid wasted calls.
const SPOTLIGHT_LIVE_REFRESH_MS = 30000;
let spotlightLiveRefreshTimer = null;
function startSpotlightLiveRefresh() {
  clearInterval(spotlightLiveRefreshTimer);
  spotlightLiveRefreshTimer = setInterval(() => {
    if (!document.hidden && getSession) void load({ silent: true });
  }, SPOTLIGHT_LIVE_REFRESH_MS);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void load({ silent: true });
});
window.addEventListener("boztik:refresh-spotlight", () => { void load(); });
startSpotlightLiveRefresh();

let authChangeVersion = 0;
function handleSpotlightAuthChange(session) {
  authChangeVersion += 1;
  if (session) {
    load();
  } else {
    feedback.textContent = "Sign in to manage Spotlight.";
    list.innerHTML = "";
    analytics.innerHTML = "";
    const overviewCount = $("stat-spotlight-active");
    if (overviewCount) overviewCount.textContent = "—";
    editForm.hidden = true;
  }
}

onAuthChange(handleSpotlightAuthChange);

// onAuthChange only subscribes to future changes; it does not emit the current
// session. Initialise the manager for administrators who are already signed in
// when the Command Centre loads.
getSession().then(session => {
  if (authChangeVersion === 0) {
    if (session) load();
    else {
      feedback.textContent = "Sign in to manage Spotlight.";
      list.innerHTML = "";
      analytics.innerHTML = "";
    }
  }
}).catch(error => {
  feedback.textContent = "Could not initialise Spotlight: " + error.message;
});
