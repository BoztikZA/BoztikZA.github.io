// Boztik Growth — private AI marketing/content assistant (Phase 1).
// Renders the "Growth" tab of the Command Centre: Content Studio, Calendar,
// Knowledge base and Settings. Talks to the Worker ONLY through api.js.
// No AI provider is connected in Phase 1; content is written and posted
// manually. No secrets or keys ever live on the client.
import {
  growthDashboard, growthGenerate,
  listGrowthKnowledge, createGrowthKnowledge, updateGrowthKnowledge, deleteGrowthKnowledge,
  listGrowthDrafts, createGrowthDraft, updateGrowthDraft, deleteGrowthDraft,
  listGrowthCalendar, createGrowthCalendar, updateGrowthCalendar, deleteGrowthCalendar,
  getGrowthSettings, updateGrowthSettings,
} from "../api.js";
import { escapeHtml } from "../shared.js";

const host = () => document.getElementById("growth-app");
const PLATFORMS = ["x"];

const s = {
  dash: null, settings: null, knowledge: [], drafts: [], calendar: [],
  view: "studio", editing: null, status: "",
};

const d = v => {
  if (!v) return "—";
  if (typeof v === "number") return new Date(v * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};
const statusClass = st => ({ draft: "is-draft", approved: "is-approved", published: "is-published", planned: "is-planned", posted: "is-posted", cancelled: "is-cancelled" }[st] || "");

function setStatus(msg, kind = "ok") {
  const el = document.getElementById("growth-status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "growth-status " + kind;
  if (el.textContent) { el.hidden = false; } else { el.hidden = true; }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove(); return ok;
  }
}

export async function initGrowth() {
  if (!host()) return;
  await load();
  renderShell();
  bind();
}

async function load() {
  const [dash, settings, knowledge, drafts, calendar] = await Promise.all([
    growthDashboard().catch(e => null),
    getGrowthSettings().catch(e => null),
    listGrowthKnowledge().catch(e => []),
    listGrowthDrafts().catch(e => []),
    listGrowthCalendar().catch(e => []),
  ]);
  s.dash = dash; s.settings = settings; s.knowledge = knowledge;
  s.drafts = drafts; s.calendar = calendar;
}

function renderShell() {
  const aiPaused = !s.settings || s.settings.ai_status === "paused";
  host().innerHTML = `
    <div class="growth-head">
      <div>
        <span class="cc-eyebrow">Boztik Growth</span>
        <h2 class="growth-title">Content Studio</h2>
      </div>
      <span class="growth-ai-badge ${aiPaused ? "is-paused" : "is-active"}" id="growth-ai-badge"
            title="${aiPaused ? "AI provider not connected in Phase 1 — writing is manual." : "AI generation available."}">
        AI · ${aiPaused ? "paused" : "active"}
      </span>
    </div>

    <nav class="growth-nav" role="tablist" aria-label="Growth sections">
      <button type="button" class="growth-nav-btn" data-growth-nav="studio">Studio</button>
      <button type="button" class="growth-nav-btn" data-growth-nav="calendar">Calendar</button>
      <button type="button" class="growth-nav-btn" data-growth-nav="knowledge">Knowledge</button>
      <button type="button" class="growth-nav-btn" data-growth-nav="settings">Settings</button>
    </nav>

    <p id="growth-status" class="growth-status" role="status" hidden></p>
    <div id="growth-view" class="growth-view"></div>
  `;
  renderView();
}

function renderView() {
  const view = document.getElementById("growth-view");
  if (!view) return;
  document.querySelectorAll(".growth-nav-btn").forEach(b => {
    const active = b.dataset.growthNav === s.view;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", String(active));
  });
  const map = { studio: viewStudio, calendar: viewCalendar, knowledge: viewKnowledge, settings: viewSettings };
  view.innerHTML = (map[s.view] || viewStudio)();
}

/* ==========================================================================
   STUDIO — Content Studio: KPIs, actions, drafts, ideas, recent.
   ========================================================================== */
function viewStudio() {
  if (s.editing) return viewDraftEditor();
  const dash = s.dash || {};
  const drafts = s.drafts.filter(x => x.kind === "draft");
  const ideas = s.drafts.filter(x => x.kind === "idea");
  const recent = (dash.recent || []).slice(0, 5);
  const aiPaused = !s.settings || s.settings.ai_status === "paused";

  const draftRows = drafts.length ? drafts.map(row => draftRow(row)).join("") :
    `<div class="growth-empty">No drafts yet. Start with “Generate Post”.</div>`;
  const ideaRows = ideas.length ? ideas.map(row => ideaRow(row)).join("") :
    `<div class="growth-empty">No content ideas yet.</div>`;
  const recentRows = recent.length ? recent.map(row => recentRow(row)).join("") :
    `<div class="growth-empty">Nothing written yet.</div>`;

  return `
    <div class="growth-kpis">
      <div class="growth-kpi"><span>Drafts</span><strong>${dash.drafts ?? 0}</strong></div>
      <div class="growth-kpi"><span>Ideas</span><strong>${dash.ideas ?? 0}</strong></div>
      <div class="growth-kpi"><span>Approved</span><strong>${dash.approved ?? 0}</strong></div>
      <div class="growth-kpi"><span>Published</span><strong>${dash.published ?? 0}</strong></div>
    </div>

    <div class="growth-actions">
      <button type="button" class="dash-btn dash-compact" data-action="generate-post">
        ✦ Generate Post</button>
      <button type="button" class="dash-btn dash-compact cc-btn-ghost" data-action="new-idea">
        + New idea</button>
    </div>

    ${aiPaused ? `<p class="growth-note">AI generation is paused / not connected in Phase 1 — write the post
      manually below, then copy it to publish on X.</p>` : ""}

    <div class="growth-cols">
      <section class="growth-pane">
        <header class="growth-pane-head"><h3>Drafts</h3><span>${drafts.length}</span></header>
        <div class="growth-list">${draftRows}</div>
      </section>
      <div class="growth-side">
        <section class="growth-pane">
          <header class="growth-pane-head"><h3>Content ideas</h3><span>${ideas.length}</span></header>
          <div class="growth-list">${ideaRows}</div>
        </section>
        <section class="growth-pane">
          <header class="growth-pane-head"><h3>Recent posts</h3></header>
          <div class="growth-list">${recentRows}</div>
        </section>
      </div>
    </div>
  `;
}


function draftRow(item) {
  const bodyPreview = (item.body || "").slice(0, 120);
  return `
    <div class="growth-item" data-id="${escapeHtml(item.id)}">
      <div class="growth-item-main">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="growth-item-body">${escapeHtml(bodyPreview) || "No body yet."}</span>
        <small>${d(item.updated_at)} · ${escapeHtml(item.platform.toUpperCase())}</small>
      </div>
      <span class="growth-tag ${statusClass(item.status)}">${escapeHtml(item.status)}</span>
      <div class="growth-item-actions">
        <button type="button" class="dash-btn dash-compact" data-action="edit-draft" data-id="${escapeHtml(item.id)}">Edit</button>
        ${item.status === "approved" ? `<button type="button" class="dash-btn dash-compact" data-action="copy-draft" data-id="${escapeHtml(item.id)}">Copy</button>` : ""}
        ${item.status === "approved" ? `<button type="button" class="dash-btn dash-compact cc-btn-ghost" data-action="mark-posted" data-id="${escapeHtml(item.id)}">Mark posted</button>` : ""}
        <button type="button" class="dash-btn dash-compact danger" data-action="delete-draft" data-id="${escapeHtml(item.id)}">Delete</button>
      </div>
    </div>`;
}

function ideaRow(item) {
  return `
    <div class="growth-item" data-id="${escapeHtml(item.id)}">
      <div class="growth-item-main">
        <strong>${escapeHtml(item.title)}</strong>
        ${item.body ? `<span class="growth-item-body">${escapeHtml((item.body || "").slice(0, 100))}</span>` : ""}
        <small>${d(item.updated_at)}</small>
      </div>
      <div class="growth-item-actions">
        <button type="button" class="dash-btn dash-compact" data-action="edit-draft" data-id="${escapeHtml(item.id)}">Outline</button>
        <button type="button" class="dash-btn dash-compact danger" data-action="delete-draft" data-id="${escapeHtml(item.id)}">Delete</button>
      </div>
    </div>`;
}

function recentRow(item) {
  const isIdea = item.kind === "idea";
  return `
    <div class="growth-item growth-item--recent" data-id="${escapeHtml(item.id)}">
      <div class="growth-item-main">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${d(item.updated_at)} · <span class="growth-tag ${statusClass(item.status)}">${escapeHtml(item.status)}</span>${isIdea ? " · idea" : ""}</small>
      </div>
      <button type="button" class="dash-text-button" data-action="edit-draft" data-id="${escapeHtml(item.id)}">Open</button>
    </div>`;
}

/* ------------------------------- draft editor ------------------------------ */
function viewDraftEditor() {
  const item = s.editing && s.editing.id ? s.editing : { kind: "draft", title: "", body: "", platform: "x", status: "draft", posted_url: null };
  const isNew = !(s.editing && s.editing.id);
  const isIdea = item.kind === "idea";
  const platformOpts = PLATFORMS.map(p => `<option value="${p}" ${p === item.platform ? "selected" : ""}>${p.toUpperCase()}${p === "x" ? " — manual publish" : ""}</option>`).join("");

  const statusOpts = ["draft", "approved", "published"].map(st =>
    `<option value="${st}" ${st === item.status ? "selected" : ""}>${st}</option>`).join("");

  return `
    <section class="growth-editor">
      <header class="growth-pane-head">
        <h3>${isIdea ? "Content idea" : isNew ? "New post" : "Edit post"}</h3>
        <button type="button" class="dash-text-button" data-action="cancel-draft">Close</button>
      </header>

      <label class="dash-field">
        <span>Title</span>
        <input id="growth-ed-title" type="text" value="${escapeHtml(item.title)}" maxlength="200" autocomplete="off" placeholder="${isIdea ? "A short idea or heading" : "Post title"}">
      </label>

      <label class="dash-field">
        <span>Body</span>
        <textarea id="growth-ed-body" rows="8" maxlength="20000" placeholder="${isIdea ? "Notes for this idea…" : "Write the post here. For X keep it concise."}">${escapeHtml(item.body || "")}</textarea>
        <span class="dash-field-help">${isIdea ? "Optional notes." : "Copied verbatim when you press “Copy”."}</span>
      </label>

      <div class="growth-ed-grid">
        <label class="dash-field">
          <span>Platform</span>
          <select id="growth-ed-platform">${platformOpts}</select>
        </label>
        ${isIdea ? "" : `<label class="dash-field">
          <span>Status</span>
          <select id="growth-ed-status">${statusOpts}</select>
        </label>`}
      </div>

      <div class="growth-ed-actions">
        <button type="button" class="dash-btn dash-compact" data-action="save-draft">${isNew ? "Save" : "Save changes"}</button>
        ${(!isIdea && item.status === "approved" && item.id) ? `<button type="button" class="dash-btn dash-compact cc-btn-ghost" data-action="copy-draft" data-id="${escapeHtml(item.id)}">Copy post</button>` : ""}
        ${(!isIdea && item.status === "approved" && item.id) ? `<button type="button" class="dash-btn dash-compact cc-btn-ghost" data-action="mark-posted" data-id="${escapeHtml(item.id)}">Mark as posted</button>` : ""}
      </div>
    </section>`;
}

/* ==========================================================================
   CALENDAR — simple planned-content list.
   ========================================================================== */
function viewCalendar() {
  const rows = s.calendar.map(c => {
    const title = c.draft_title || "(free slot)";
    return `
      <div class="growth-item" data-id="${escapeHtml(c.id)}">
        <div class="growth-item-main">
          <strong>${d(c.scheduled_at)}</strong>
          <span class="growth-item-body">${escapeHtml(title)}</span>
          <small>platform · ${escapeHtml(c.platform.toUpperCase())}</small>
        </div>
        <span class="growth-tag ${statusClass(c.status)}">${escapeHtml(c.status)}</span>
        <div class="growth-item-actions">
          <button type="button" class="dash-btn dash-compact" data-action="edit-calendar" data-id="${escapeHtml(c.id)}">Edit</button>
          <button type="button" class="dash-btn dash-compact danger" data-action="delete-calendar" data-id="${escapeHtml(c.id)}">Delete</button>
        </div>
      </div>`;
  }).join("") || `<div class="growth-empty">Nothing planned yet. Add the first entry below.</div>`;

  const editing = s.calendar.find(c => c.id === (s.editing && s.editing.calendarId)) || null;
  const draftOpts = ["", ...s.drafts].map(x => {
    const v = x.id || ""; const label = x.id ? `${escapeHtml(x.title)} (${x.kind})` : "— free slot —";
    return `<option value="${escapeHtml(v)}" ${editing && editing.draft_id === v ? "selected" : ""}>${label}</option>`;
  }).join("");

  return `
    <div class="growth-cols">
      <section class="growth-pane">
        <header class="growth-pane-head"><h3>Planned content</h3><span>${s.calendar.length}</span></header>
        <div class="growth-list">${rows}</div>
      </section>

      <aside class="growth-pane">
        <header class="growth-pane-head"><h3>${editing ? "Edit entry" : "Add entry"}</h3></header>
        <div class="growth-form">
          <label class="dash-field"><span>Draft</span>
            <select id="growth-cal-draft">${draftOpts}</select>
          </label>
          <label class="dash-field"><span>Date &amp; time (local)</span>
            <input id="growth-cal-date" type="datetime-local" value="${escapeHtml(editing ? editing.scheduled_at : "")}">
          </label>
          <label class="dash-field"><span>Platform</span>
            <select id="growth-cal-platform">
              ${PLATFORMS.map(p => `<option value="${p}" ${(!editing || editing.platform === p) ? "selected" : ""}>${p.toUpperCase()} — manual</option>`).join("")}
            </select>
          </label>
          <label class="dash-field"><span>Status</span>
            <select id="growth-cal-status">
              ${["planned", "posted", "cancelled"].map(st => `<option value="${st}" ${editing && editing.status === st ? "selected" : ""}>${st}</option>`).join("")}
            </select>
          </label>
          <button type="button" class="dash-btn dash-compact" data-action="save-calendar">
            ${editing ? "Save changes" : "Add to calendar"}</button>
        </div>
      </aside>
    </div>`;
}

/* ==========================================================================
   KNOWLEDGE — private knowledge base.
   ========================================================================== */
const KNOWLEDGE_CATS = ["Brand", "Product", "Service", "Audience", "Marketing", "Guidelines"];
function viewKnowledge() {
  const rows = s.knowledge.map(k => `
    <div class="growth-item" data-id="${escapeHtml(k.id)}">
      <div class="growth-item-main">
        <strong>${escapeHtml(k.title)}</strong>
        <span class="growth-item-body">${escapeHtml((k.content || "").slice(0, 160))}</span>
        <small>${escapeHtml(k.category)} · updated ${d(k.updated_at)}</small>
      </div>
      <span class="growth-tag ${k.active ? "is-published" : "is-cancelled"}">${k.active ? "active" : "inactive"}</span>
      <div class="growth-item-actions">
        <button type="button" class="dash-btn dash-compact" data-action="edit-knowledge" data-id="${escapeHtml(k.id)}">Edit</button>
        <button type="button" class="dash-btn dash-compact danger" data-action="delete-knowledge" data-id="${escapeHtml(k.id)}">Delete</button>
      </div>
    </div>`).join("") || `<div class="growth-empty">No knowledge entries yet.</div>`;

  const editing = s.knowledge.find(k => k.id === (s.editing && s.editing.knowledgeId)) || null;
  const catOpts = KNOWLEDGE_CATS.map(c => `<option value="${c}" ${editing && editing.category === c ? "selected" : ""}>${c}</option>`).join("");

  return `
    <div class="growth-cols">
      <section class="growth-pane">
        <header class="growth-pane-head"><h3>Boztik Knowledge</h3><span>${s.knowledge.length}</span></header>
        <div class="growth-list">${rows}</div>
      </section>

      <aside class="growth-pane">
        <header class="growth-pane-head"><h3>${editing ? "Edit entry" : "Add entry"}</h3></header>
        <div class="growth-form">
          <label class="dash-field"><span>Category</span>
            <select id="growth-kb-cat">${catOpts}</select>
          </label>
          <label class="dash-field"><span>Title</span>
            <input id="growth-kb-title" type="text" value="${escapeHtml(editing ? editing.title : "")}" maxlength="200" autocomplete="off">
          </label>
          <label class="dash-field"><span>Content</span>
            <textarea id="growth-kb-content" rows="6" maxlength="20000">${escapeHtml(editing ? editing.content : "")}</textarea>
            <span class="dash-field-help">What the AI should know about this topic. Only real, current facts.</span>
          </label>
          <label class="growth-check">
            <input id="growth-kb-active" type="checkbox" ${(editing ? editing.active : 1) ? "checked" : ""}> Active
            <span class="dash-field-help">Inactive = internal only; never used for customer-facing claims.</span>
          </label>
          <button type="button" class="dash-btn dash-compact" data-action="save-knowledge">
            ${editing ? "Save changes" : "Add to knowledge base"}</button>
        </div>
      </aside>
    </div>`;
}

/* ==========================================================================
   SETTINGS — PAUSE-AI switch.
   ========================================================================== */
function viewSettings() {
  const aiPaused = !s.settings || s.settings.ai_status === "paused";
  return `
    <div class="growth-cols">
      <section class="growth-pane">
        <header class="growth-pane-head"><h3>AI Status</h3></header>
        <div class="growth-form">
          <p class="growth-note">${
            aiPaused
              ? "AI is paused or not connected. In Phase 1 there is no AI provider: posts are written and published manually from the Studio."
              : "AI is active."}
          </p>
          <label class="growth-check">
            <input type="checkbox" id="growth-ai-switch" data-ai-switch ${aiPaused ? "" : "checked"}> Enable AI generation
            <span class="dash-field-help">Enforced server-side. Even when on, there is no provider connected yet in Phase 1.</span>
          </label>
          <small class="growth-meta">Provider: <code>${escapeHtml((s.settings && s.settings.provider) || "manual")}</code></small>
        </div>
      </section>

      <section class="growth-pane">
        <header class="growth-pane-head"><h3>How publishing works</h3></header>
        <div class="growth-form">
          <p class="growth-note">No automated publishing. When a post is approved, copy it from the Studio and
             paste it into X yourself, then mark it as posted (optionally with the post URL).</p>
        </div>
      </section>
    </div>`;
}

/* ==========================================================================
   EVENTS + ACTIONS
   ========================================================================== */
function bind() {
  const app = host();
  app.addEventListener("click", async (ev) => {
    const el = ev.target.closest("[data-action], [data-growth-nav]");
    if (!el) return;
    ev.preventDefault();
    const id = el.dataset.id;
    try {
      if (el.hasAttribute("data-growth-nav")) { s.view = el.dataset.growthNav; renderView(); return; }
      switch (el.dataset.action) {
        case "generate-post": await generatePost(); break;
        case "new-idea": s.editing = { id: null, kind: "idea", title: "", body: "", platform: "x", status: "draft" }; renderView(); break;
        case "edit-draft": openDraft(id); break;
        case "save-draft": await saveDraft(); break;
        case "cancel-draft": s.editing = null; renderView(); break;
        case "delete-draft": await removeDraft(id); break;
        case "copy-draft": await copyDraft(id); break;
        case "mark-posted": await markPosted(id); break;
        case "edit-calendar": s.editing = { calendarId: id }; renderView(); break;
        case "save-calendar": await saveCalendar(); break;
        case "delete-calendar": await removeCalendar(id); break;
        case "edit-knowledge": s.editing = { knowledgeId: id }; renderView(); break;
        case "save-knowledge": await saveKnowledge(); break;
        case "delete-knowledge": await removeKnowledge(id); break;
      }
    } catch (err) {
      setStatus(err?.message || "Something went wrong.", "error");
    }
  });

  const aiSwitch = document.getElementById("growth-ai-switch");
  aiSwitch?.addEventListener("change", async () => {
    try {
      s.settings = await updateGrowthSettings({ ai_status: aiSwitch.checked ? "active" : "paused" });
      setStatus(`AI ${aiSwitch.checked ? "enabled" : "paused"}. Provider is still manual in Phase 1.`, "ok");
    } catch (err) {
      aiSwitch.checked = !aiSwitch.checked;
      setStatus(err?.message || "Could not update AI status.", "error");
    }
  });
}

function openDraft(id) {
  const item = s.drafts.find(x => x.id === id) || null;
  s.editing = item ? { ...item } : { id: null, kind: "draft", title: "", body: "", platform: "x", status: "draft" };
  renderView();
}

async function generatePost() {
  const gen = await growthGenerate(); // AI seam — returns paused/manual in Phase 1.
  s.editing = { id: null, kind: "draft", title: "", body: "", platform: "x", status: "draft" };
  renderView();
  setStatus(
    gen && gen.message ? gen.message : "AI generation is paused or not connected — write this post manually.",
    "ok");
}

async function saveDraft() {
  const title = document.getElementById("growth-ed-title").value.trim();
  if (!title) { setStatus("Title is required.", "error"); return; }
  const payload = {
    title,
    body: document.getElementById("growth-ed-body").value,
    platform: document.getElementById("growth-ed-platform").value,
  };
  if (!s.editing || !s.editing.id) {
    payload.kind = (s.editing && s.editing.kind) || "draft";
    payload.status = "draft";
  } else {
    const statusEl = document.getElementById("growth-ed-status");
    payload.status = statusEl ? statusEl.value : s.editing.status;
  }
  if (s.editing && s.editing.id) await updateGrowthDraft(s.editing.id, payload);
  else await createGrowthDraft(payload);
  s.editing = null;
  await refreshAll();
  setStatus("Saved.");
}

async function copyDraft(id) {
  const item = s.drafts.find(x => x.id === id);
  if (!item || !item.body) { setStatus("This post has no body to copy.", "error"); return; }
  const ok = await copyText(item.body);
  setStatus(ok ? "Post copied — paste it into X." : "Could not copy automatically; select the text and copy manually.", ok ? "ok" : "error");
}


async function markPosted(id) {
  const item = s.drafts.find(x => x.id === id);
  if (!item) return;
  const url = window.prompt("Paste the X post URL (optional). Leave blank to just mark it posted:", item.posted_url || "");
  if (url === null) return; // cancelled
  const cleanUrl = url.trim();
  await updateGrowthDraft(id, { status: "published", posted_url: cleanUrl || null });
  s.editing = null;
  await refreshAll();
  setStatus(cleanUrl ? "Marked as posted and saved the post URL." : "Marked as posted.", "ok");
}

async function removeDraft(id) {
  if (!window.confirm("Delete this draft? This cannot be undone.")) return;
  await deleteGrowthDraft(id);
  s.editing = null;
  await refreshAll();
  setStatus("Draft deleted.", "ok");
}

async function saveCalendar() {
  const scheduled_at = document.getElementById("growth-cal-date").value;
  if (!scheduled_at) { setStatus("A date and time is required.", "error"); return; }
  const payload = {
    scheduled_at,
    platform: document.getElementById("growth-cal-platform").value,
    status: document.getElementById("growth-cal-status").value,
    draft_id: document.getElementById("growth-cal-draft").value || null,
  };
  const existing = s.editing && s.editing.calendarId ? s.calendar.find(c => c.id === s.editing.calendarId) : null;
  if (existing) await updateGrowthCalendar(existing.id, payload);
  else await createGrowthCalendar(payload);
  s.editing = null;
  await refreshAll({ calendar: true });
  setStatus("Calendar updated.", "ok");
}

async function removeCalendar(id) {
  if (!window.confirm("Remove this calendar entry?")) return;
  await deleteGrowthCalendar(id);
  await refreshAll({ calendar: true });
  setStatus("Calendar entry removed.", "ok");
}

async function saveKnowledge() {
  const title = document.getElementById("growth-kb-title").value.trim();
  const category = document.getElementById("growth-kb-cat").value;
  if (!title) { setStatus("Title is required.", "error"); return; }
  const payload = {
    category,
    title,
    content: document.getElementById("growth-kb-content").value,
    active: document.getElementById("growth-kb-active").checked ? 1 : 0,
  };
  const existing = s.editing && s.editing.knowledgeId ? s.knowledge.find(k => k.id === s.editing.knowledgeId) : null;
  if (existing) await updateGrowthKnowledge(existing.id, payload);
  else await createGrowthKnowledge(payload);
  s.editing = null;
  await refreshAll({ knowledge: true });
  setStatus("Knowledge base updated.", "ok");
}

async function removeKnowledge(id) {
  if (!window.confirm("Delete this knowledge entry?")) return;
  await deleteGrowthKnowledge(id);
  await refreshAll({ knowledge: true });
  setStatus("Knowledge entry deleted.", "ok");
}

async function refreshAll(opts = {}) {
  const [dash, settings, knowledge, drafts, calendar] = await Promise.all([
    growthDashboard().catch(e => null),
    getGrowthSettings().catch(e => null),
    opts.knowledge ? listGrowthKnowledge() : Promise.resolve(s.knowledge),
    listGrowthDrafts().catch(e => []),
    opts.calendar ? listGrowthCalendar() : Promise.resolve(s.calendar),
  ]);
  s.dash = dash; s.settings = settings; s.knowledge = knowledge; s.drafts = drafts; s.calendar = calendar;
  renderView();
}

