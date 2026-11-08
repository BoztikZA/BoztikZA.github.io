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
      <button class="cc-btn" data-action="start-review" data-id="${esc(p.id)}">Start review</button>
      <button class="cc-btn sp-approve" data-action="approve" data-id="${esc(p.id)}">Approve</button>
      <button class="cc-btn sp-decline" data-action="decline" data-id="${esc(p.id)}">Decline</button>`;
    if (p.application_status === "under_review") return `
      <button class="cc-btn sp-approve" data-action="approve" data-id="${esc(p.id)}">Approve</button>
      <button class="cc-btn sp-decline" data-action="decline" data-id="${esc(p.id)}">Decline</button>`;
    if (p.application_status === "approved" && p.status !== "published") return `<button class="cc-btn sp-approve" data-action="publish" data-id="${esc(p.id)}">Publish</button>`;
    if (p.status === "published" && p.listing_expires_at && p.listing_expires_at * 1000 <= Date.now()) return "<small>Expired listing · cleanup pending</small>";
    if (p.status === "published") return `<button class="cc-btn" data-action="archive" data-id="${esc(p.id)}">Archive</button>`;
    if (p.application_status === "published" && p.status === "archived") return `<button class="cc-btn" data-action="publish" data-id="${esc(p.id)}">Republish</button>`;
    return "";
  };
  list.innerHTML = profiles.length ? profiles.map(p => `
    <article class="sp-admin-row">
      <div class="sp-admin-main">
        <strong>${esc(p.display_name)}</strong>
        <span>${esc(p.category.replace(/-/g, " "))} · ${esc(p.application_status || p.status)} · ${new Date(p.created_at * 1000).toLocaleDateString()}</span>
        <small>${esc(p.contact_email || "")}</small>
        ${p.application_status === "new" || p.application_status === "under_review" || p.application_status === "approved"
          ? `<small>Decision deadline: ${p.review_expires_at ? new Date(p.review_expires_at * 1000).toLocaleString() : "Not set"}</small>` : ""}
        ${p.status === "published" && p.listing_expires_at ? `<small>Listing expires: ${new Date(p.listing_expires_at * 1000).toLocaleString()}</small>` : ""}
        ${p.decline_reason ? `<small>Decline reason: ${esc(p.decline_reason)}</small>` : ""}
        ${p.invalid_social_links?.length ? `<small class="sp-admin-link-warning">Review invalid ${esc(p.invalid_social_links.join(", "))} link(s) before publishing.</small>` : ""}
        <p>${esc(p.tagline)}</p>
      </div>
      <div class="sp-admin-actions">
        <button class="cc-btn" data-action="edit" data-id="${esc(p.id)}">Edit profile</button>
        ${reviewActions(p)}
        ${p.status === "published" && (!p.listing_expires_at || p.listing_expires_at * 1000 > Date.now()) ? (p.featured ? `<button class="cc-btn" data-action="unfeature" data-id="${esc(p.id)}">Remove feature</button>` : `<button class="cc-btn" data-action="feature" data-id="${esc(p.id)}">Feature 24h</button>`) : ""}
        <button class="cc-btn sp-delete" data-action="delete" data-id="${esc(p.id)}">Delete</button>
      </div>
    </article>`).join("") : "<p class='cc-muted'>No submissions yet. New entries will appear here for review.</p>";
}

async function load() {
  feedback.textContent = "Refreshing Spotlight…";
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
      </div>`).join("") : "<p class='cc-muted'>Engagement will appear when visitors start exploring profiles.</p>";
    feedback.textContent = analyticsUnavailable ? "Spotlight profiles loaded. Analytics are temporarily unavailable." : "Spotlight profiles and analytics updated.";
    return true;
  } catch (error) {
    feedback.textContent = error.message;
    return false;
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

list.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  const profile = profiles.find(item => item.id === id);
  if (!profile) return;
  if (action === "edit") { openEditor(profile); return; }
  if (action === "delete" && !confirm("Permanently delete this profile and its analytics? This cannot be undone.")) return;
  const declineReason = action === "decline" ? prompt("Enter the reason to share with the applicant (at least 10 characters):") : null;
  if (action === "decline" && declineReason === null) return;

  button.disabled = true;
  feedback.textContent = "Updating profile…";
  try {
    if (action === "delete") {
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(id), { method: "DELETE" });
    } else if (["mark-read", "start-review", "approve", "decline"].includes(action)) {
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(id) + "/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action === "mark-read" ? "mark_read" : action === "start-review" ? "start_review" : action,
          ...(action === "decline" ? { reason: declineReason } : {})
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
    if (action === "start-review") feedback.textContent = "Application marked as under review.";
    else if (action === "approve") feedback.textContent = "Application approved. Publish it separately within 72 hours.";
    else if (action === "decline") feedback.textContent = "Application declined. The reason is stored and an email is queued when the applicant supplied an address.";
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
$("sp-admin-refresh").addEventListener("click", load);

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
