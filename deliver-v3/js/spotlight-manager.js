import { config } from "./config.js";
import { authHeaders, getSession, onAuthChange } from "./auth.js";
import { spotlightProfileSaveRequest } from "./spotlight-profile-request.mjs";

const $ = id => document.getElementById(id);
const list = $("sp-admin-list");
const feedback = $("sp-admin-feedback");
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

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c]));

const api = async (path, init = {}) => {
  const response = await fetch(config.apiBaseUrl + path, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Spotlight request failed.");
  return data;
};

function render() {
  const pending = profiles.filter(p => p.status === "pending");
  const published = profiles.filter(p => p.status === "published");
  const featured = published.find(p => p.featured);
  $("sp-admin-pending").textContent = pending.length;
  $("sp-admin-published").textContent = published.length;
  $("sp-admin-featured").textContent = featured ? featured.display_name : "None";
  const overviewCount = $("stat-spotlight-active");
  if (overviewCount) overviewCount.textContent = published.length.toLocaleString();

  list.innerHTML = profiles.length ? profiles.map(p => `
    <article class="sp-admin-row">
      <div class="sp-admin-main">
        <strong>${esc(p.display_name)}</strong>
        <span>${esc(p.category.replace(/-/g, " "))} · ${esc(p.status)} · ${new Date(p.created_at * 1000).toLocaleDateString()}</span>
        <small>${esc(p.contact_email || "")}</small>
        ${p.invalid_social_links?.length ? `<small class="sp-admin-link-warning">Review invalid ${esc(p.invalid_social_links.join(", "))} link(s) before publishing.</small>` : ""}
        <p>${esc(p.tagline)}</p>
      </div>
      <div class="sp-admin-actions">
        <button class="cc-btn" data-action="edit" data-id="${esc(p.id)}">Edit profile</button>
        ${p.status === "pending" ? `<button class="cc-btn sp-approve" data-action="publish" data-id="${esc(p.id)}">Approve &amp; publish</button>` : p.status === "published" ? `<button class="cc-btn" data-action="archive" data-id="${esc(p.id)}">Archive</button>` : `<button class="cc-btn" data-action="publish" data-id="${esc(p.id)}">Republish</button>`}
        ${p.status === "published" ? (p.featured ? `<button class="cc-btn" data-action="unfeature" data-id="${esc(p.id)}">Remove feature</button>` : `<button class="cc-btn" data-action="feature" data-id="${esc(p.id)}">Feature 24h</button>`) : ""}
        <button class="cc-btn sp-delete" data-action="delete" data-id="${esc(p.id)}">Delete</button>
      </div>
    </article>`).join("") : "<p class='cc-muted'>No submissions yet. New entries will appear here for review.</p>";
}

async function load() {
  feedback.textContent = "Refreshing Spotlight…";
  try {
    const profilesResponse = await api("/api/admin/spotlight");
    profiles = Array.isArray(profilesResponse.profiles) ? profilesResponse.profiles : [];
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
  $("sp-profile-feature").checked = false;
  $("sp-admin-publish").hidden = false;
  $("sp-admin-publish").disabled = true;
  $("sp-admin-publish").textContent = "Save draft to unlock publishing";
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
  $("sp-admin-publish").hidden = false;
  $("sp-admin-publish").disabled = false;
  $("sp-admin-publish").textContent = profile.status === "published" ? "Apply live settings" : "Publish profile";
  for (const key of ["youtube", "twitch", "instagram", "tiktok", "facebook", "linkedin", "x", "spotify"]) editForm.elements[key].value = profile.social_links?.[key] || "";
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
  editForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

$("sp-admin-new").addEventListener("click", openNewProfile);

// Accept pasted domains and add HTTPS before validating or saving.
function normaliseProfileUrls() {
  for (const input of editForm.querySelectorAll('input[type="url"]')) {
    const value = input.value.trim();
    if (value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) input.value = "https://" + value.replace(/^\/+/, "");
  }
}
editForm.addEventListener("focusout", event => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.type === "url") {
    const value = input.value.trim();
    if (value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) input.value = "https://" + value.replace(/^\/+/, "");
  }
}, true);

list.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  const profile = profiles.find(item => item.id === id);
  if (!profile) return;
  if (action === "edit") { openEditor(profile); return; }
  if (action === "delete" && !confirm("Permanently delete this profile and its analytics? This cannot be undone.")) return;

  button.disabled = true;
  feedback.textContent = "Updating profile…";
  try {
    if (action === "delete") {
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(id), { method: "DELETE" });
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
    if (action === "publish") feedback.textContent = "✓ Profile is live on the Boztik Spotlight directory.";
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
    feedback.textContent = "Save the profile draft first, then publish it.";
    return;
  }
  const button = $("sp-admin-publish");
  const name = editForm.elements.display_name.value.trim() || "Profile";
  button.disabled = true;
  feedback.textContent = "Publishing profile…";
  try {
    const result = await api("/api/admin/spotlight/profile/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published", featured: $("sp-profile-feature").checked })
    });
    if (result?.profile?.status !== "published") throw new Error("The server did not confirm that the profile is live. Refresh and check its status.");
    await load();
    feedback.textContent = $("sp-profile-feature").checked
      ? "✓ " + name + " is live on Boztik and featured on the homepage for 24 hours."
      : "✓ " + name + " is now live on the Boztik Spotlight directory.";
    button.textContent = "Apply live settings";
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

editForm.addEventListener("submit", async event => {
  event.preventDefault();
  normaliseProfileUrls();
  if (!editForm.checkValidity()) {
    const invalid = editForm.querySelector(":invalid");
    feedback.textContent = invalid?.validationMessage || "Please complete the required profile fields.";
    editForm.reportValidity();
    invalid?.focus();
    return;
  }
  if (editForm.dataset.saving === "true") return;
  const id = editForm.elements.id.value;
  const profile = profiles.find(item => item.id === id);
  if (id && !profile) {
    feedback.textContent = "This profile is no longer in the manager list. Refresh Spotlight and try again.";
    return;
  }
  const form = new FormData(editForm);
  const social = { ...(profile?.social_links || {}) };
  for (const key of ["youtube", "twitch", "instagram", "tiktok", "facebook", "linkedin", "x", "spotify"]) {
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
  feedback.textContent = "Saving profile changes…";
  try {
    const request = spotlightProfileSaveRequest(id, body);
    const saved = await api(request.path, request.init);
    if (!saved?.profile?.id) throw new Error("The server did not confirm the saved profile. Refresh Spotlight before trying again.");
    const savedIndex = profiles.findIndex(item => item.id === saved.profile.id);
    if (savedIndex === -1) profiles.unshift(saved.profile);
    else profiles[savedIndex] = saved.profile;
    render();
    if (!id) {
      editForm.elements.id.value = saved.profile.id;
      $("sp-admin-publish").hidden = false;
      $("sp-admin-publish").disabled = false;
      $("sp-admin-publish").textContent = "Publish profile";
    }
    const refreshed = await load();
    if (id) editForm.hidden = true;
    feedback.textContent = id
      ? refreshed ? "✓ Profile changes saved. Publish or apply live settings when ready." : "Profile changes saved, but the list could not refresh. Use Refresh to sync."
      : refreshed ? "✓ Draft saved. Upload its logo or photograph, then select Publish profile when ready."
        : "Draft saved, but the list could not refresh. Use Refresh to sync.";
  } catch (error) {
    feedback.textContent = error.message;
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
  if (file.size > 2 * 1024 * 1024) { status.textContent = "Image must be 2 MB or smaller."; return; }
  if (!["image/jpeg","image/png","image/webp"].includes(file.type)) { status.textContent = "Choose a JPG, PNG or WebP image."; return; }
  const button = $("sp-profile-image-upload");
  button.disabled = true; status.textContent = "Uploading and checking storage…";
  try {
    const response = await fetch(config.apiBaseUrl + "/api/admin/spotlight/profile/" + encodeURIComponent(profileId) + "/image", {
      method: "PUT", headers: { ...authHeaders(), "Content-Type": file.type }, body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Image upload failed.");
    status.textContent = "Image uploaded. It will appear publicly when the profile is published.";
    const preview = $("sp-profile-image-preview"), url = URL.createObjectURL(file);
    preview.innerHTML = '<img alt="Uploaded Spotlight profile image" src="' + url + '">';
    await load();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

$("sp-admin-edit-cancel").addEventListener("click", () => {
  editForm.reset();
  editForm.hidden = true;
  $("sp-admin-publish").hidden = true;
  $("sp-admin-publish").disabled = true;
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
