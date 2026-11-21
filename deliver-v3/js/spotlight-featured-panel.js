/**
 * Command Centre: "Main featured creator" panel.
 *
 * The ONLY place (besides the legacy per-row buttons, which route here) where the homepage featured creator is
 * changed. Flow: choose an approved, live creator -> preview the exact homepage placement -> confirm -> publish.
 * Reviewing, approving, editing and publishing never touch this state; the Worker enforces that too.
 *
 * The preview is rendered by the same code as the homepage (spotlight/home-cards.js) inside a sandboxed iframe
 * so the homepage stylesheets cannot leak into, or be changed by, the dashboard.
 */
import { heroCardMarkup, discoverSectionMarkup, categoryLabel, profileImageUrls } from "../../spotlight/home-cards.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SITE = "https://www.boztik.com/";
const STYLESHEETS = ["styles-premium.css", "homepage.css", "spotlight/spotlight-home.css", "homepage-boost.css",
  "spotlight/spotlight-premium.css", "spotlight/spotlight-discovery.css"];

/** A creator that can be featured: approved/published, listing still live. */
export const isLiveProfile = p => p.status === "published" && (!p.listing_expires_at || p.listing_expires_at * 1000 > Date.now());

export function previewDocument(target, others) {
  const links = STYLESHEETS.map(href => `<link rel="stylesheet" href="../${href}">`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@700;800&display=swap" rel="stylesheet">
${links}<style>html,body{margin:0;background:#0a1011;color:#f4f7f2;font-family:Inter,sans-serif}body{padding:18px}.hm-spotlight-card--hero{animation:none!important}</style></head>
<body><div class="hm-spotlight-grid hm-spotlight-grid--stacked">${heroCardMarkup(target, { profileBase: SITE + "spotlight/" })}${discoverSectionMarkup(others, { profileBase: SITE + "spotlight/", directoryHref: SITE + "spotlight/", submitHref: SITE + "spotlight/submit/" })}</div></body></html>`;
}

export function createFeaturedPanel({ api, getProfiles, reload, notify, anchor }) {
  const panel = document.createElement("article");
  panel.className = "cc-card sp-featured-card";
  panel.id = "sp-featured-panel";
  anchor.before(panel);

  const modal = document.createElement("div");
  modal.className = "sp-review-modal sp-feature-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="sp-review-backdrop" data-feature-close></div>
    <section class="sp-review-card sp-feature-card" role="dialog" aria-modal="true" aria-labelledby="sp-feature-title" tabindex="-1">
      <button type="button" class="sp-review-close" data-feature-close aria-label="Close preview">×</button>
      <span class="cc-eyebrow">Homepage placement</span>
      <h2 id="sp-feature-title">Preview featured creator</h2>
      <p class="sp-feature-lead" id="sp-feature-lead"></p>
      <iframe class="sp-feature-preview" id="sp-feature-preview" title="Preview of the homepage featured placement" sandbox="" tabindex="-1"></iframe>
      <label class="sp-feature-ack" id="sp-feature-ack-wrap" hidden><input type="checkbox" id="sp-feature-ack"><span id="sp-feature-ack-text"></span></label>
      <p role="alert" class="sp-feature-error" id="sp-feature-error" hidden></p>
      <div class="sp-review-actions">
        <button type="button" class="cc-btn" data-feature-close>Cancel</button>
        <button type="button" class="cc-btn sp-approve" id="sp-feature-confirm">Publish as main featured creator</button>
      </div>
    </section>`;
  document.body.append(modal);

  let opener = null;
  let pending = null; // { target, current }

  const live = () => getProfiles().filter(isLiveProfile);
  const currentFeatured = () => live().find(p => p.featured) || null;

  function counts() {
    const all = getProfiles();
    return {
      pending: all.filter(p => ["new", "under_review"].includes(p.application_status)).length,
      community: live().filter(p => !p.featured).length,
      rejected: all.filter(p => p.application_status === "declined").length,
      featured: currentFeatured() ? 1 : 0,
    };
  }

  function render() {
    const current = currentFeatured();
    const candidates = live().filter(p => !p.featured).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
    const c = counts();
    const thumb = current ? profileImageUrls(current)[0] : "";
    panel.innerHTML = `
      <header class="cc-card-head"><div><span class="cc-eyebrow">Homepage placement</span><h3>Main featured creator</h3>
        <p class="cc-card-desc">Approving, publishing or editing a profile never changes this. Only you change it, here, after a preview and confirmation. A creator you replace stays published in the directory and in Discover More Creators.</p></div></header>
      <div class="sp-featured-summary" role="group" aria-label="Spotlight status overview">
        <button type="button" class="sp-featured-chip" data-filter-jump="pending"><b>${c.pending}</b><span>Pending review</span></button>
        <button type="button" class="sp-featured-chip" data-filter-jump="community"><b>${c.community}</b><span>Approved community</span></button>
        <button type="button" class="sp-featured-chip" data-filter-jump="rejected"><b>${c.rejected}</b><span>Rejected</span></button>
        <button type="button" class="sp-featured-chip is-featured" data-filter-jump="featured"><b>${c.featured}</b><span>Currently featured</span></button>
      </div>
      <div class="sp-featured-current">
        ${current ? `
          <div class="sp-featured-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" width="72" height="72">` : esc((current.display_name || "?").slice(0, 2).toUpperCase())}</div>
          <div class="sp-featured-meta"><span class="cc-eyebrow">Currently featured on the homepage</span><strong>${esc(current.display_name)}</strong>
            <small>${esc(categoryLabel(current.category))} · stays featured until you change it</small></div>
          <div class="sp-featured-actions">
            <button type="button" class="cc-btn" data-featured-preview="${esc(current.id)}">View placement</button>
            <button type="button" class="cc-btn" data-featured-remove="${esc(current.id)}">Remove from featured</button>
          </div>` : `
          <div class="sp-featured-meta"><span class="cc-eyebrow">Currently featured on the homepage</span><strong>Nobody</strong>
            <small>The homepage shows an open featured spot. Approved creators still appear in Discover More Creators.</small></div>`}
      </div>
      <div class="sp-featured-picker">
        <label for="sp-featured-select">${current ? "Replace with an approved creator" : "Feature an approved creator"}</label>
        <div class="sp-featured-picker-row">
          <select id="sp-featured-select" ${candidates.length ? "" : "disabled"}>
            ${candidates.length ? `<option value="">Choose a creator…</option>${candidates.map(p => `<option value="${esc(p.id)}">${esc(p.display_name)} · ${esc(categoryLabel(p.category))}</option>`).join("")}` : `<option value="">No other approved, published creators yet</option>`}
          </select>
          <button type="button" class="cc-btn sp-approve" id="sp-featured-go" disabled>Preview &amp; feature…</button>
        </div>
        <small>Only approved creators with a live listing can be featured. Approve and publish an application first.</small>
      </div>`;
  }

  function open(id, trigger) {
    const all = getProfiles();
    const target = all.find(p => p.id === id);
    if (!target) return;
    const current = currentFeatured();
    const isCurrent = current?.id === target.id;
    pending = { target, current: isCurrent ? null : current, viewOnly: isCurrent };
    opener = trigger || document.activeElement;
    const others = live().filter(p => p.id !== target.id);
    modal.querySelector("#sp-feature-preview").srcdoc = previewDocument(target, others);
    modal.querySelector("#sp-feature-title").textContent = isCurrent ? "Current featured placement" : "Preview featured creator";
    modal.querySelector("#sp-feature-lead").textContent = isCurrent
      ? target.display_name + " is the main featured creator on the homepage right now."
      : pending.current
        ? "This is how " + target.display_name + " will look on the homepage. " + pending.current.display_name + " will move out of the main spot but stays in Discover More Creators and the directory."
        : "This is how " + target.display_name + " will look on the homepage. Nobody is featured right now, so this fills the open spot.";
    const ackWrap = modal.querySelector("#sp-feature-ack-wrap");
    const ack = modal.querySelector("#sp-feature-ack");
    ack.checked = false;
    ackWrap.hidden = !pending.current;
    modal.querySelector("#sp-feature-ack-text").textContent = pending.current
      ? "I understand " + pending.current.display_name + " will be replaced as the main featured creator."
      : "";
    const confirm = modal.querySelector("#sp-feature-confirm");
    confirm.hidden = isCurrent;
    confirm.disabled = Boolean(pending.current);
    confirm.textContent = pending.current ? "Replace " + pending.current.display_name + " and feature " + target.display_name : "Publish as main featured creator";
    modal.querySelector("#sp-feature-error").hidden = true;
    modal.hidden = false;
    modal.querySelector(".sp-feature-card").focus();
  }

  function close() {
    modal.hidden = true;
    modal.querySelector("#sp-feature-preview").srcdoc = "";
    pending = null;
    if (opener && document.contains(opener)) opener.focus();
  }

  async function confirmFeature() {
    if (!pending || pending.viewOnly) return;
    const { target, current } = pending;
    const confirm = modal.querySelector("#sp-feature-confirm");
    const error = modal.querySelector("#sp-feature-error");
    confirm.disabled = true;
    error.hidden = true;
    try {
      await api("/api/admin/spotlight/featured", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: target.id, expected_current_id: current ? current.id : null }),
      });
      close();
      await reload();
      notify("✓ " + target.display_name + " is now the main featured creator on the homepage." + (current ? " " + current.display_name + " remains published in the directory." : ""));
    } catch (failure) {
      if (failure.status === 409) {
        error.textContent = failure.message + " The list has been refreshed; close this window and try again.";
        await reload();
      } else {
        error.textContent = failure.message || "Could not update the featured creator.";
        confirm.disabled = Boolean(current) && !modal.querySelector("#sp-feature-ack").checked;
      }
      error.hidden = false;
    }
  }

  async function remove(id) {
    const current = getProfiles().find(p => p.id === id);
    if (!current) return;
    if (!window.confirm("Remove " + current.display_name + " from the homepage featured spot? They stay published in the directory and in Discover More Creators.")) return;
    try {
      await api("/api/admin/spotlight/profile/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured: false }),
      });
      await reload();
      notify(current.display_name + " is no longer featured. They remain in the directory.");
    } catch (failure) { notify(failure.message || "Could not remove the feature."); }
  }

  panel.addEventListener("change", event => {
    if (event.target.id === "sp-featured-select") panel.querySelector("#sp-featured-go").disabled = !event.target.value;
  });
  panel.addEventListener("click", event => {
    const go = event.target.closest("#sp-featured-go");
    if (go) { open(panel.querySelector("#sp-featured-select").value, go); return; }
    const view = event.target.closest("[data-featured-preview]");
    if (view) { open(view.dataset.featuredPreview, view); return; }
    const rm = event.target.closest("[data-featured-remove]");
    if (rm) { remove(rm.dataset.featuredRemove); return; }
    const jump = event.target.closest("[data-filter-jump]");
    if (jump) panel.dispatchEvent(new CustomEvent("spotlight-filter", { bubbles: true, detail: jump.dataset.filterJump }));
  });
  modal.addEventListener("click", event => {
    if (event.target.closest("[data-feature-close]")) close();
    else if (event.target.closest("#sp-feature-confirm")) confirmFeature();
  });
  modal.addEventListener("change", event => {
    if (event.target.id === "sp-feature-ack") modal.querySelector("#sp-feature-confirm").disabled = !event.target.checked;
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !modal.hidden) close(); });

  return { render, open, remove, panel };
}
