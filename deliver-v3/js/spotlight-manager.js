import { config } from "./config.js";
import { authHeaders, onAuthChange } from "./auth.js";

const $ = id => document.getElementById(id);
const list = $("sp-admin-list");
const feedback = $("sp-admin-feedback");
const analytics = $("sp-admin-analytics");
const editForm = $("sp-admin-edit");
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

  list.innerHTML = profiles.length ? profiles.map(p => `
    <article class="sp-admin-row">
      <div class="sp-admin-main">
        <strong>${esc(p.display_name)}</strong>
        <span>${esc(p.category.replace(/-/g, " "))} · ${esc(p.status)} · ${new Date(p.created_at * 1000).toLocaleDateString()}</span>
        <small>${esc(p.contact_email || "")}</small>
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
    const [profilesResponse, analyticsResponse] = await Promise.all([
      api("/api/admin/spotlight"),
      api("/api/admin/spotlight/analytics")
    ]);
    profiles = profilesResponse.profiles || [];
    render();
    const rows = analyticsResponse.profiles || [];
    const views = rows.reduce((total, p) => total + Number(p.views || 0), 0);
    $("sp-admin-views").textContent = views.toLocaleString();
    analytics.innerHTML = rows.length ? rows.map(p => `
      <div class="sp-admin-metric">
        <strong>${esc(p.display_name)}</strong>
        <span>${Number(p.views || 0).toLocaleString()} views</span>
        <span>${Number(p.unique_views || 0).toLocaleString()} daily unique visitors</span>
        <span>${Number(p.outbound_clicks || 0).toLocaleString()} outbound clicks</span>
        <span>${Number(p.featured_impressions || 0).toLocaleString()} featured impressions</span>
      </div>`).join("") : "<p class='cc-muted'>Engagement will appear when visitors start exploring profiles.</p>";
    feedback.textContent = "Spotlight data updated.";
  } catch (error) {
    feedback.textContent = error.message;
  }
}

function openEditor(profile) {
  editForm.elements.id.value = profile.id;
  editForm.elements.display_name.value = profile.display_name || "";
  editForm.elements.tagline.value = profile.tagline || "";
  editForm.elements.description.value = profile.description || "";
  editForm.elements.category.value = profile.category || "other";
  editForm.elements.website_url.value = profile.website_url || "";
  for (const key of ["youtube", "twitch", "instagram", "tiktok", "facebook", "linkedin", "x"]) editForm.elements[key].value = profile.social_links?.[key] || "";
  editForm.hidden = false;
  editForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

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
  } catch (error) {
    feedback.textContent = error.message;
    button.disabled = false;
  }
});

editForm.addEventListener("submit", async event => {
  event.preventDefault();
  const id = editForm.elements.id.value;
  const profile = profiles.find(item => item.id === id);
  if (!profile) return;
  const form = new FormData(editForm);
  const social = { ...(profile.social_links || {}) };
  for (const key of ["youtube", "twitch", "instagram", "tiktok", "facebook", "linkedin", "x"]) {
    const value = String(form.get(key) || "").trim();
    if (value) social[key] = value;
    else delete social[key];
  }
  const body = {
    display_name: form.get("display_name"),
    tagline: form.get("tagline"),
    description: form.get("description"),
    category: form.get("category"),
    website_url: form.get("website_url"),
    social_links: social
  };
  const save = editForm.querySelector('button[type="submit"]');
  save.disabled = true;
  feedback.textContent = "Saving profile changes…";
  try {
    await api("/api/admin/spotlight/profile/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    editForm.hidden = true;
    await load();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    save.disabled = false;
  }
});

$("sp-admin-edit-cancel").addEventListener("click", () => { editForm.reset(); editForm.hidden = true; });
$("sp-admin-refresh").addEventListener("click", load);

onAuthChange(session => {
  if (session) load();
  else {
    feedback.textContent = "Sign in to manage Spotlight.";
    list.innerHTML = "";
    analytics.innerHTML = "";
    editForm.hidden = true;
  }
});
