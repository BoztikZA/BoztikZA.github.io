// Boztik Deliver — Command Centre
// Drives the tabbed dashboard (Overview / Create / Deliveries / Analytics),
// including the Photoshop Battles delivery type. Talks to Supabase only
// through auth.js / api.js / shared.js — no direct Supabase calls here.

import { getSession, signIn, signOut, onAuthChange } from "./auth.js";
import {
  listDeliveries,
  createDelivery,
  updateDelivery,
  deleteDelivery,
  duplicateDelivery,
  fetchRedditMetadata,
  DELIVERY_SOURCES
} from "./api.js";
import { config } from "./config.js";
import {
  escapeHtml,
  formatBytes,
  formatDate,
  countdown,
  deliveryId,
  deliveryLink,
  isValidFile
} from "./shared.js";
import { getImageDimensions } from "./fileinfo.js";

const $ = id => document.getElementById(id);

/* =========================================================
   ELEMENTS
========================================================= */

const els = {
  logoutLink: $("dash-logout-link"),

  loginView: $("dash-login-view"),
  loginForm: $("dash-login-form"),
  email: $("dash-email"),
  password: $("dash-password"),
  loginBtn: $("dash-login-btn"),
  loginError: $("dash-login-error"),

  mainView: $("dash-main-view"),
  refreshBtn: $("dash-refresh"),

  tabButtons: Array.from(document.querySelectorAll(".dash-tab[data-tab]")),
  panels: Array.from(document.querySelectorAll(".dash-tab-panel[data-panel]")),
  goTabButtons: Array.from(document.querySelectorAll("[data-go-tab]")),

  overviewCreateBtn: $("dash-overview-create"),
  statActive: $("stat-active"),
  statMonthlyViews: $("stat-monthly-views"),
  statMonthlyDownloads: $("stat-monthly-downloads"),
  statLifetimeViews: $("stat-lifetime-views"),
  statLifetimeDownloads: $("stat-lifetime-downloads"),
  overviewRecent: $("overview-recent-deliveries"),
  activityStatus: $("dash-activity-status"),
  overviewActivity: $("overview-activity-list"),
  actionCards: Array.from(document.querySelectorAll(".dash-action-card[data-create-source]")),

  createForm: $("dash-create-form"),
  sourceOptions: Array.from(document.querySelectorAll(".dash-source-option[data-source]")),
  sourceInput: $("dash-source"),
  photoshopNotice: $("dash-photoshop-battles-notice"),
  clientFieldsNote: $("dash-client-fields-note"),
  clientName: $("dash-client-name"),
  projectName: $("dash-project-name"),
  redditFields: $("dash-reddit-fields"),
  redditUrl: $("dash-reddit-url"),
  notes: $("dash-notes"),

  // Reddit Source (Optional) — independent "original post" attribution,
  // available on every delivery type. Not to be confused with
  // `redditFields`/`redditUrl` above, which is the PhotoshopBattles-only
  // reference-link note field.
  redditSourceUrl: $("dash-reddit-source-url"),
  redditSourceFetchBtn: $("dash-reddit-source-fetch"),
  redditSourceStatus: $("dash-reddit-source-status"),
  redditSourcePreview: $("dash-reddit-source-preview"),
  redditSourceSub: $("dash-reddit-source-sub"),
  redditSourceTitle: $("dash-reddit-source-title"),
  redditSourceAuthor: $("dash-reddit-source-author"),
  redditSourceLink: $("dash-reddit-source-link"),
  redditSourceClearBtn: $("dash-reddit-source-clear"),
  uploadZone: $("dash-upload-zone"),
  fileInput: $("dash-file"),
  filePreview: $("dash-file-preview"),
  fileName: $("dash-file-name"),
  fileSize: $("dash-file-size"),
  fileRemove: $("dash-file-remove"),
  battleImagePreview: $("dash-battle-image-preview"),
  battleImagePreviewFrame: $("dash-battle-image-preview-frame"),
  battleImagePreviewImg: $("dash-battle-image-preview-img"),
  expirySelect: $("dash-expiry"),
  battleExpiryNote: $("dash-battle-expiry-note"),
  createSubmit: $("dash-create-submit"),
  createSubmitLabel: $("dash-create-submit-label"),
  createSubmitSpinner: $("dash-create-submit-spinner"),
  createError: $("dash-create-error"),

  deliveriesRefresh: $("dash-deliveries-refresh"),
  deliveriesCreate: $("dash-deliveries-create"),
  deliverySearch: $("dash-delivery-search"),
  sourceFilter: $("dash-delivery-source-filter"),
  statusFilter: $("dash-delivery-status-filter"),
  deliveryCount: $("dash-delivery-count"),
  deliveryList: $("dash-delivery-list"),

  analyticsMonthlyViews: $("analytics-monthly-views"),
  analyticsMonthlyDownloads: $("analytics-monthly-downloads"),
  analyticsLifetimeViews: $("analytics-lifetime-views"),
  analyticsLifetimeDownloads: $("analytics-lifetime-downloads"),
  battleMonthlyViews: $("battle-monthly-views"),
  battleLifetimeViews: $("battle-lifetime-views"),
  battleMonthlyDownloads: $("battle-monthly-downloads"),
  battleLifetimeDownloads: $("battle-lifetime-downloads"),
  analyticsMonthLabel: $("dash-analytics-month-label"),
  analyticsTableBody: $("dash-analytics-table-body"),

  loadingOverlay: $("dash-loading-overlay"),
  loadingTitle: $("dash-loading-title"),
  loadingMessage: $("dash-loading-message"),

  successModal: $("dash-success-modal"),
  successClose: $("dash-success-close"),
  successMessage: $("dash-success-message"),
  successNormalUrl: $("dash-success-normal-url"),
  successUrl: $("dash-success-url"),
  successCopy: $("dash-success-copy"),
  successBattleUrl: $("dash-success-battle-url"),
  successBattleDirectUrl: $("dash-success-battle-direct-url"),
  successBattleCopy: $("dash-success-battle-copy"),
  successBattleOpen: $("dash-success-battle-open"),
  successView: $("dash-success-view"),
  successDone: $("dash-success-done"),

  editModal: $("dash-edit-modal"),
  editClose: $("dash-edit-close"),
  editForm: $("dash-edit-form"),
  editId: $("dash-edit-id"),
  editClientName: $("dash-edit-client-name"),
  editProjectName: $("dash-edit-project-name"),
  editSource: $("dash-edit-source"),
  editRedditFields: $("dash-edit-reddit-fields"),
  editRedditUrl: $("dash-edit-reddit-url"),
  editNotes: $("dash-edit-notes"),

  editRedditSourceUrl: $("dash-edit-reddit-source-url"),
  editRedditSourceFetchBtn: $("dash-edit-reddit-source-fetch"),
  editRedditSourceStatus: $("dash-edit-reddit-source-status"),
  editRedditSourcePreview: $("dash-edit-reddit-source-preview"),
  editRedditSourceSub: $("dash-edit-reddit-source-sub"),
  editRedditSourceTitle: $("dash-edit-reddit-source-title"),
  editRedditSourceAuthor: $("dash-edit-reddit-source-author"),
  editRedditSourceLink: $("dash-edit-reddit-source-link"),
  editRedditSourceClearBtn: $("dash-edit-reddit-source-clear"),
  editError: $("dash-edit-error"),
  editCancel: $("dash-edit-cancel"),
  editSave: $("dash-edit-save"),

  deleteModal: $("dash-delete-modal"),
  deleteClose: $("dash-delete-close"),
  deleteSummary: $("dash-delete-summary"),
  deleteError: $("dash-delete-error"),
  deleteCancel: $("dash-delete-cancel"),
  deleteConfirm: $("dash-delete-confirm"),

  toast: $("dash-toast"),
  toastIcon: $("dash-toast-icon"),
  toastMessage: $("dash-toast-message")
};

/* =========================================================
   STATE
========================================================= */

let deliveries = [];
let currentTab = "overview";
let editingId = null;
let pendingDeleteId = null;
let createSaving = false;
let editSaving = false;
let deleteWorking = false;
let selectedFile = null;
let toastTimer = null;

const SOURCE_LABELS = {
  private: "Private Client",
  paid: "Paid Client",
  free: "Free Edit",
  returning: "Returning Client",
  other: "Other",
  reddit: "Reddit",
  photoshop_battles: "PhotoshopBattles"
};

const BATTLE_EXTENSIONS = ["jpg", "jpeg", "png"];

/* =========================================================
   REDDIT SOURCE (OPTIONAL) — "original post" attribution
   Independent of the `source` channel field and of the
   PhotoshopBattles reference-link note (`redditFields`/`redditUrl`
   above). Available on every delivery type. Server-side metadata
   fetch only, via fetchRedditMetadata() — never blocks delivery
   creation/editing on failure; the admin can always save the raw
   URL with no metadata and retry later.

   One controller instance is created for the create form and a
   second for the edit modal so both stay independent, using the
   same behaviour.
========================================================= */

function createRedditSourceController(refs) {
  const {
    urlInput,
    fetchBtn,
    statusEl,
    previewEl,
    subEl,
    titleEl,
    authorEl,
    linkEl,
    clearBtn
  } = refs;

  // The last successfully fetched/loaded metadata for whatever URL is
  // currently in urlInput. Cleared whenever the URL is edited so a stale
  // preview never gets saved against a different link.
  let fetched = null;
  let fetching = false;

  function setStatus(message, tone = "error") {
    if (!statusEl) return;
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  }

  function renderPreview() {
    if (!previewEl) return;

    if (!fetched) {
      previewEl.hidden = true;
      return;
    }

    if (subEl) subEl.textContent = fetched.subreddit ? `r/${fetched.subreddit}` : "Reddit";
    if (titleEl) titleEl.textContent = fetched.title || "(title unavailable)";
    if (authorEl) authorEl.textContent = fetched.author ? `Posted by u/${fetched.author}` : "Poster unknown";
    if (linkEl) linkEl.href = fetched.canonicalUrl || fetched.url;

    previewEl.hidden = false;
  }

  function setFetching(state) {
    fetching = state;
    if (fetchBtn) {
      fetchBtn.disabled = state;
      fetchBtn.textContent = state ? "Fetching…" : "Fetch Post Details";
    }
  }

  async function handleFetch() {
    if (fetching) return;

    const raw = urlInput?.value.trim() || "";

    if (!raw) {
      setStatus("Paste a Reddit URL first.");
      return;
    }

    setStatus("");
    setFetching(true);

    try {
      const meta = await fetchRedditMetadata(raw);

      fetched = {
        url: raw,
        canonicalUrl: meta.canonicalUrl || raw,
        subreddit: meta.subreddit || null,
        author: meta.author || null,
        title: meta.title || null
      };

      renderPreview();
      setStatus("");

    } catch (error) {
      fetched = null;
      renderPreview();
      setStatus(
        `${error?.message || "Unable to retrieve Reddit post details."} You can still save the delivery with the source link.`
      );

    } finally {
      setFetching(false);
    }
  }

  function handleClear() {
    fetched = null;
    if (urlInput) urlInput.value = "";
    setStatus("");
    renderPreview();
  }

  // If the admin edits the URL after a successful fetch, the old preview
  // no longer matches — drop it rather than risk saving mismatched data.
  function handleUrlInput() {
    if (fetched && urlInput && urlInput.value.trim() !== fetched.url) {
      fetched = null;
      renderPreview();
    }
    setStatus("");
  }

  function reset() {
    fetched = null;
    if (urlInput) urlInput.value = "";
    setStatus("");
    if (previewEl) previewEl.hidden = true;
  }

  // Loads an existing delivery's reddit_source (or null) into the controls,
  // used when opening the Edit Delivery modal.
  function load(existing) {
    fetched = existing ? { ...existing } : null;
    if (urlInput) urlInput.value = existing?.url || "";
    setStatus("");
    renderPreview();
  }

  // Builds the value to persist. Returns null when the URL field is empty
  // (no Reddit source attached — existing delivery behaviour is unaffected).
  // If a URL is present but was never successfully fetched (or was edited
  // since the last fetch), it still saves the raw link with no metadata,
  // per the "save without metadata" requirement.
  function get() {
    const raw = urlInput?.value.trim() || "";
    if (!raw) return null;

    if (fetched && fetched.url === raw) return fetched;

    return {
      url: raw,
      canonicalUrl: raw,
      subreddit: null,
      author: null,
      title: null
    };
  }

  fetchBtn?.addEventListener("click", handleFetch);
  clearBtn?.addEventListener("click", handleClear);
  urlInput?.addEventListener("input", handleUrlInput);

  return { reset, load, get };
}

const createRedditSource = createRedditSourceController({
  urlInput: els.redditSourceUrl,
  fetchBtn: els.redditSourceFetchBtn,
  statusEl: els.redditSourceStatus,
  previewEl: els.redditSourcePreview,
  subEl: els.redditSourceSub,
  titleEl: els.redditSourceTitle,
  authorEl: els.redditSourceAuthor,
  linkEl: els.redditSourceLink,
  clearBtn: els.redditSourceClearBtn
});

const editRedditSource = createRedditSourceController({
  urlInput: els.editRedditSourceUrl,
  fetchBtn: els.editRedditSourceFetchBtn,
  statusEl: els.editRedditSourceStatus,
  previewEl: els.editRedditSourcePreview,
  subEl: els.editRedditSourceSub,
  titleEl: els.editRedditSourceTitle,
  authorEl: els.editRedditSourceAuthor,
  linkEl: els.editRedditSourceLink,
  clearBtn: els.editRedditSourceClearBtn
});

/* =========================================================
   PHOTOSHOP BATTLES — source <-> UI value mapping
   ---------------------------------------------------------
   A battle delivery is stored as a completely ordinary row:
   source = "reddit", source_meta = { type: "photoshop_battles",
   direct_token, redditUrl? }. This is what the deployed
   photoshop-battles-image edge function already checks for, so
   the create/edit UI just needs to translate its single
   "photoshop_battles" radio value to/from those two real columns.
========================================================= */

function isBattle(delivery) {
  return (
    delivery?.source === "reddit" &&
    delivery?.source_meta?.type === "photoshop_battles"
  );
}

function uiSourceOf(delivery) {
  if (isBattle(delivery)) return "photoshop_battles";
  return delivery?.source || "private";
}

function sourceLabelOf(delivery) {
  return SOURCE_LABELS[uiSourceOf(delivery)] || "Other";
}

function battleDirectUrl(delivery) {
  if (!isBattle(delivery)) return null;

  const token = delivery.source_meta?.direct_token;
  if (!token) return null;

  const fileName =
    delivery.file_name ||
    delivery.delivery_files?.[0]?.file_name ||
    "";

  const rawExt = fileName.split(".").pop()?.toLowerCase() || "jpg";
  const ext = rawExt === "jpeg" ? "jpg" : (BATTLE_EXTENSIONS.includes(rawExt) ? rawExt : "jpg");

  return `${config.supabaseUrl}/functions/v1/photoshop-battles-image/${encodeURIComponent(delivery.id)}--${encodeURIComponent(token)}.${ext}`;
}

/* =========================================================
   TOAST
========================================================= */

function showToast(message, kind = "success") {
  if (!els.toast) return;

  clearTimeout(toastTimer);

  els.toast.hidden = false;
  els.toast.classList.remove("is-error", "is-success");
  els.toast.classList.add(kind === "error" ? "is-error" : "is-success");

  if (els.toastIcon) els.toastIcon.textContent = kind === "error" ? "!" : "✓";
  if (els.toastMessage) els.toastMessage.textContent = message;

  requestAnimationFrame(() => els.toast.classList.add("is-visible"));

  toastTimer = setTimeout(() => {
    els.toast.classList.remove("is-visible");
    setTimeout(() => { els.toast.hidden = true; }, 250);
  }, 4200);
}

/* =========================================================
   LOADING OVERLAY
========================================================= */

function showLoading(title = "Working…", message = "Please wait.") {
  if (!els.loadingOverlay) return;
  if (els.loadingTitle) els.loadingTitle.textContent = title;
  if (els.loadingMessage) els.loadingMessage.textContent = message;
  els.loadingOverlay.hidden = false;
  els.loadingOverlay.setAttribute("aria-hidden", "false");
}

function hideLoading() {
  if (!els.loadingOverlay) return;
  els.loadingOverlay.hidden = true;
  els.loadingOverlay.setAttribute("aria-hidden", "true");
}

/* =========================================================
   MODAL HELPERS (plain div overlays, not <dialog>)
========================================================= */

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.hidden = false;
  modalEl.setAttribute("aria-hidden", "false");
  document.body.classList.add("dash-modal-open");
}

function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.hidden = true;
  modalEl.setAttribute("aria-hidden", "true");
  document.body.classList.remove("dash-modal-open");
}

function wireModalDismiss(modalEl, closeBtn, onClose) {
  if (!modalEl) return;

  closeBtn?.addEventListener("click", () => onClose());

  const backdrop = modalEl.querySelector(".dash-modal-backdrop");
  backdrop?.addEventListener("click", () => onClose());

  modalEl.addEventListener("keydown", event => {
    if (event.key === "Escape") onClose();
  });
}

/* =========================================================
   AUTH
========================================================= */

function showLoginView() {
  if (els.loginView) els.loginView.hidden = false;
  if (els.mainView) els.mainView.hidden = true;
  if (els.logoutLink) els.logoutLink.hidden = true;
}

function showDashboardView() {
  if (els.loginView) els.loginView.hidden = true;
  if (els.mainView) els.mainView.hidden = false;
  if (els.logoutLink) els.logoutLink.hidden = false;
}

function setLoginError(message = "") {
  if (!els.loginError) return;
  els.loginError.textContent = message;
  els.loginError.hidden = !message;
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  const email = els.email?.value.trim() || "";
  const password = els.password?.value || "";

  setLoginError("");

  if (!email || !password) {
    setLoginError("Enter your email and password.");
    return;
  }

  if (els.loginBtn) {
    els.loginBtn.disabled = true;
    els.loginBtn.textContent = "Signing in…";
  }

  try {
    await signIn(email, password);
    if (els.password) els.password.value = "";
    showDashboardView();
    await bootstrapDashboard();
  } catch (error) {
    console.error("[Boztik Deliver] Sign-in failed:", error);
    setLoginError(
      error?.message?.includes("Invalid login credentials")
        ? "Incorrect email or password."
        : (error?.message || "Sign-in failed. Please try again.")
    );
  } finally {
    if (els.loginBtn) {
      els.loginBtn.disabled = false;
      els.loginBtn.textContent = "Sign in";
    }
  }
}

async function handleLogout(event) {
  event.preventDefault();

  try {
    await signOut();
  } catch (error) {
    console.error("[Boztik Deliver] Sign-out failed:", error);
  }

  deliveries = [];
  showLoginView();
}

function setupAuth() {
  els.loginForm?.addEventListener("submit", handleLoginSubmit);
  els.logoutLink?.addEventListener("click", handleLogout);

  // Session expiring/being revoked elsewhere (e.g. another tab signs out,
  // or the token can no longer be refreshed) should return to the login
  // screen rather than leaving a dead dashboard on screen.
  onAuthChange(session => {
    if (!session) {
      showLoginView();
    }
  });
}

/* =========================================================
   TABS
========================================================= */

function switchTab(name) {
  currentTab = name;

  els.tabButtons.forEach(btn => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
  });

  els.panels.forEach(panel => {
    panel.hidden = panel.dataset.panel !== name;
    panel.classList.toggle("is-active", panel.dataset.panel === name);
  });
}

function setupTabs() {
  els.tabButtons.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  els.goTabButtons.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.goTab));
  });
}

/* =========================================================
   CREATE FORM — SOURCE SELECTION
========================================================= */

function applySource(value) {
  const known = new Set([...DELIVERY_SOURCES, "photoshop_battles"]);
  const source = known.has(value) ? value : "private";

  if (els.sourceInput) els.sourceInput.value = source;

  els.sourceOptions.forEach(btn => {
    const active = btn.dataset.source === source;
    btn.setAttribute("aria-checked", String(active));
    btn.classList.toggle("is-selected", active);
  });

  const isBattleMode = source === "photoshop_battles";

  if (els.photoshopNotice) els.photoshopNotice.hidden = !isBattleMode;
  if (els.redditFields) els.redditFields.hidden = !isBattleMode;
  if (els.battleExpiryNote) els.battleExpiryNote.hidden = !isBattleMode;

  if (els.clientFieldsNote) {
    els.clientFieldsNote.textContent = isBattleMode
      ? "Optional — for your own reference only"
      : "Required for delivery";
  }

  if (els.clientName) els.clientName.required = !isBattleMode;
  if (els.projectName) {
    els.projectName.required = !isBattleMode;
    els.projectName.placeholder = isBattleMode
      ? "e.g. Old car photo restoration (optional)"
      : "e.g. Wedding Restoration";
  }

  // Re-validate the currently selected file against the new mode's rules.
  if (selectedFile) validateSelectedFile(selectedFile, isBattleMode);

  if (els.battleImagePreview && !isBattleMode) {
    els.battleImagePreview.hidden = true;
  } else if (isBattleMode && selectedFile) {
    void renderBattlePreview(selectedFile);
  }
}

function setupSourceSelection() {
  const handlers = [...els.actionCards, ...els.sourceOptions];

  els.actionCards.forEach(btn => {
    btn.addEventListener("click", () => {
      applySource(btn.dataset.createSource);
      switchTab("create");
    });
  });

  els.sourceOptions.forEach(btn => {
    btn.addEventListener("click", () => applySource(btn.dataset.source));
  });

  applySource("private");
}

/* =========================================================
   CREATE FORM — FILE SELECTION
========================================================= */

function currentSource() {
  return els.sourceInput?.value || "private";
}

function setCreateError(message = "") {
  if (!els.createError) return;
  els.createError.textContent = message;
  els.createError.hidden = !message;
}

function validateSelectedFile(file, isBattleMode) {
  if (isBattleMode) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const mimeOk = !file.type || file.type === "image/jpeg" || file.type === "image/png";

    if (!BATTLE_EXTENSIONS.includes(ext) || !mimeOk) {
      setCreateError("PhotoshopBattles only supports JPG or PNG images.");
      return false;
    }

    setCreateError("");
    return true;
  }

  if (!isValidFile(file)) {
    setCreateError("That file type isn't supported, or the file is too large.");
    return false;
  }

  setCreateError("");
  return true;
}

async function renderBattlePreview(file) {
  if (!els.battleImagePreview || !els.battleImagePreviewImg) return;

  const url = URL.createObjectURL(file);
  els.battleImagePreviewImg.src = url;
  els.battleImagePreview.hidden = false;

  try {
    await getImageDimensions(url);
  } catch {
    // Non-fatal — the thumbnail itself still renders fine.
  } finally {
    // Release the object URL once the browser has decoded it; a short
    // delay avoids revoking before the <img> paints.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

function setSelectedFile(file) {
  selectedFile = file || null;

  if (!file) {
    if (els.filePreview) els.filePreview.hidden = true;
    if (els.battleImagePreview) els.battleImagePreview.hidden = true;
    if (els.fileInput) els.fileInput.value = "";
    return;
  }

  const isBattleMode = currentSource() === "photoshop_battles";
  const valid = validateSelectedFile(file, isBattleMode);

  if (els.fileName) els.fileName.textContent = file.name;
  if (els.fileSize) els.fileSize.textContent = formatBytes(file.size);
  if (els.filePreview) els.filePreview.hidden = false;

  if (isBattleMode && valid) {
    void renderBattlePreview(file);
  } else if (els.battleImagePreview) {
    els.battleImagePreview.hidden = true;
  }
}

function setupFileSelection() {
  els.uploadZone?.addEventListener("click", () => els.fileInput?.click());

  els.uploadZone?.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.fileInput?.click();
    }
  });

  els.uploadZone?.addEventListener("dragover", event => {
    event.preventDefault();
    els.uploadZone.classList.add("is-dragover");
  });

  els.uploadZone?.addEventListener("dragleave", () => {
    els.uploadZone.classList.remove("is-dragover");
  });

  els.uploadZone?.addEventListener("drop", event => {
    event.preventDefault();
    els.uploadZone.classList.remove("is-dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) setSelectedFile(file);
  });

  els.fileInput?.addEventListener("change", () => {
    const file = els.fileInput.files?.[0];
    if (file) setSelectedFile(file);
  });

  els.fileRemove?.addEventListener("click", () => setSelectedFile(null));
}

/* =========================================================
   CREATE FORM — SUBMIT
========================================================= */

function setCreateSaving(saving) {
  createSaving = saving;

  if (els.createSubmit) els.createSubmit.disabled = saving;
  if (els.createSubmitLabel) {
    els.createSubmitLabel.textContent = saving ? "Creating…" : "Create Delivery";
  }
  if (els.createSubmitSpinner) els.createSubmitSpinner.hidden = !saving;
}

function resetCreateForm() {
  els.createForm?.reset();
  setSelectedFile(null);
  setCreateError("");
  applySource("private");
  createRedditSource.reset();
}

async function handleCreateSubmit(event) {
  event.preventDefault();

  if (createSaving) return;

  const source = currentSource();
  const isBattleMode = source === "photoshop_battles";

  setCreateError("");

  if (!selectedFile) {
    setCreateError("Please choose a file to upload.");
    return;
  }

  if (!validateSelectedFile(selectedFile, isBattleMode)) {
    return;
  }

  const clientNameRaw = els.clientName?.value.trim() || "";
  const projectNameRaw = els.projectName?.value.trim() || "";
  const notesRaw = els.notes?.value.trim() || "";
  const redditUrlRaw = els.redditUrl?.value.trim() || "";
  const hours = Number(els.expirySelect?.value || config.defaultExpiryHours);

  if (!isBattleMode) {
    if (!clientNameRaw) { setCreateError("Please enter a client name."); return; }
    if (!projectNameRaw) { setCreateError("Please enter a project name."); return; }
  }

  const id = deliveryId();

  const metadata = {
    id,
    client_name: clientNameRaw || "PhotoshopBattles",
    project_name: projectNameRaw || selectedFile.name.replace(/\.[^.]+$/, ""),
    notes: notesRaw || null,
    expires_at: new Date(Date.now() + hours * 3600000).toISOString()
  };

  if (isBattleMode) {
    metadata.source = "reddit";
    metadata.source_meta = {
      type: "photoshop_battles",
      direct_token: crypto.randomUUID().replace(/-/g, ""),
      ...(redditUrlRaw ? { redditUrl: redditUrlRaw } : {})
    };
  } else {
    metadata.source = source;
    metadata.source_meta = null;
  }

  // Reddit Source (Optional) — independent of the channel/source fields
  // above. null when the field was left empty, so a delivery created
  // without it behaves exactly as before.
  metadata.reddit_source = createRedditSource.get();

  setCreateSaving(true);
  showLoading("Uploading…", "Uploading your file — this may take a moment.");

  try {
    await createDelivery(metadata, [selectedFile], () => {
      showLoading("Finishing up…", "Saving delivery details.");
    });

    const created = { ...metadata, file_name: selectedFile.name, file_size: selectedFile.size };
    showSuccessModal(created);

    resetCreateForm();
    await loadDeliveries();

  } catch (error) {
    console.error("[Boztik Deliver] createDelivery failed:", error);
    setCreateError(error?.message || "Could not create this delivery. Please try again.");
  } finally {
    setCreateSaving(false);
    hideLoading();
  }
}

function setupCreateForm() {
  els.createForm?.addEventListener("submit", handleCreateSubmit);
  els.overviewCreateBtn?.addEventListener("click", () => switchTab("create"));
  els.deliveriesCreate?.addEventListener("click", () => switchTab("create"));
}

/* =========================================================
   SUCCESS MODAL
========================================================= */

function showSuccessModal(delivery) {
  const url = deliveryLink(delivery.id);
  const battle = isBattle(delivery);

  if (els.successMessage) {
    els.successMessage.textContent = battle
      ? "Your PhotoshopBattles image is ready. Copy the direct URL below into Reddit."
      : "Your delivery is ready to share.";
  }

  if (els.successUrl) els.successUrl.value = url;
  if (els.successNormalUrl) els.successNormalUrl.hidden = false;

  if (battle) {
    const directUrl = battleDirectUrl(delivery);
    if (els.successBattleDirectUrl) els.successBattleDirectUrl.value = directUrl || "";
    if (els.successBattleOpen) els.successBattleOpen.href = directUrl || "#";
    if (els.successBattleUrl) els.successBattleUrl.hidden = false;
  } else if (els.successBattleUrl) {
    els.successBattleUrl.hidden = true;
  }

  if (els.successView) els.successView.onclick = () => window.open(url, "_blank", "noopener,noreferrer");

  openModal(els.successModal);
}

async function copyToClipboard(value, label = "Link") {
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
    showToast(`${label} copied.`);
  } catch (error) {
    console.error("[Boztik Deliver] Clipboard write failed:", error);
    showToast("Could not copy — please copy it manually.", "error");
  }
}

function setupSuccessModal() {
  const close = () => closeModal(els.successModal);

  wireModalDismiss(els.successModal, els.successClose, close);
  els.successDone?.addEventListener("click", close);

  els.successCopy?.addEventListener("click", () => copyToClipboard(els.successUrl?.value, "Delivery link"));
  els.successBattleCopy?.addEventListener("click", () => copyToClipboard(els.successBattleDirectUrl?.value, "Direct image URL"));
}

/* =========================================================
   OVERVIEW / STATS
========================================================= */

function computeTotals(list) {
  return list.reduce((totals, delivery) => {
    totals.monthlyViews += Number(delivery.monthly_views || 0);
    totals.monthlyDownloads += Number(delivery.monthly_downloads || 0);
    totals.lifetimeViews += Number(delivery.lifetime_views || 0);
    totals.lifetimeDownloads += Number(delivery.lifetime_downloads || 0);
    return totals;
  }, { monthlyViews: 0, monthlyDownloads: 0, lifetimeViews: 0, lifetimeDownloads: 0 });
}

function activeCount(list) {
  const now = Date.now();
  return list.filter(d => d.expires_at && new Date(d.expires_at).getTime() > now).length;
}

function renderOverview() {
  const totals = computeTotals(deliveries);

  if (els.statActive) els.statActive.textContent = activeCount(deliveries);
  if (els.statMonthlyViews) els.statMonthlyViews.textContent = totals.monthlyViews;
  if (els.statMonthlyDownloads) els.statMonthlyDownloads.textContent = totals.monthlyDownloads;
  if (els.statLifetimeViews) els.statLifetimeViews.textContent = totals.lifetimeViews;
  if (els.statLifetimeDownloads) els.statLifetimeDownloads.textContent = totals.lifetimeDownloads;

  renderRecentDeliveries();
  renderActivity();
}

function emptyState(icon, title, body) {
  const el = document.createElement("div");
  el.className = "dash-empty-state compact";
  el.innerHTML = `
    <span class="dash-empty-icon">${icon}</span>
    ${title ? `<h4>${escapeHtml(title)}</h4>` : ""}
    <p>${escapeHtml(body)}</p>
  `;
  return el;
}

function renderRecentDeliveries() {
  if (!els.overviewRecent) return;
  els.overviewRecent.innerHTML = "";

  if (!deliveries.length) {
    els.overviewRecent.append(emptyState("▣", "", "No deliveries yet."));
    return;
  }

  deliveries.slice(0, 5).forEach(delivery => {
    const row = document.createElement("div");
    row.className = "dash-recent-item";

    const expired = delivery.expires_at && new Date(delivery.expires_at).getTime() <= Date.now();

    row.innerHTML = `
      <div class="dash-recent-item-main">
        <strong>${escapeHtml(delivery.project_name || "Untitled")}</strong>
        <span>${escapeHtml(delivery.client_name || "")}</span>
      </div>
      <span class="dash-status-pill ${expired ? "is-expired" : "is-active"}">
        ${expired ? "Expired" : "Active"}
      </span>
    `;

    row.addEventListener("click", () => {
      switchTab("deliveries");
      if (els.deliverySearch) {
        els.deliverySearch.value = delivery.project_name || delivery.client_name || "";
        renderDeliveryList();
      }
    });

    els.overviewRecent.append(row);
  });
}

function renderActivity() {
  if (!els.overviewActivity) return;
  els.overviewActivity.innerHTML = "";

  const events = [];

  for (const delivery of deliveries) {
    if (delivery.last_viewed_at) {
      events.push({ type: "view", delivery, at: delivery.last_viewed_at });
    }
    if (delivery.last_downloaded_at) {
      events.push({ type: "download", delivery, at: delivery.last_downloaded_at });
    }
  }

  events.sort((a, b) => new Date(b.at) - new Date(a.at));

  if (els.activityStatus) els.activityStatus.textContent = "Live";

  if (!events.length) {
    els.overviewActivity.append(emptyState("◉", "", "No activity yet."));
    return;
  }

  events.slice(0, 8).forEach(event => {
    const row = document.createElement("div");
    row.className = "dash-activity-item";
    row.innerHTML = `
      <span class="dash-activity-icon">${event.type === "download" ? "↓" : "◉"}</span>
      <div class="dash-activity-item-main">
        <strong>${escapeHtml(event.delivery.project_name || "Untitled")}</strong>
        <span>${event.type === "download" ? "Downloaded" : "Viewed"} · ${formatDate(event.at)}</span>
      </div>
    `;
    els.overviewActivity.append(row);
  });
}

/* =========================================================
   DELIVERIES TAB
========================================================= */

function filteredDeliveries() {
  const query = (els.deliverySearch?.value || "").trim().toLowerCase();
  const sourceFilter = els.sourceFilter?.value || "all";
  const statusFilter = els.statusFilter?.value || "all";
  const now = Date.now();

  return deliveries.filter(delivery => {
    if (query) {
      const haystack = `${delivery.project_name || ""} ${delivery.client_name || ""} ${delivery.id || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    if (sourceFilter !== "all" && uiSourceOf(delivery) !== sourceFilter) return false;

    if (statusFilter !== "all") {
      const expired = delivery.expires_at && new Date(delivery.expires_at).getTime() <= now;
      if (statusFilter === "active" && expired) return false;
      if (statusFilter === "expired" && !expired) return false;
    }

    return true;
  });
}

function renderDeliveryList() {
  if (!els.deliveryList) return;

  const list = filteredDeliveries();
  if (els.deliveryCount) els.deliveryCount.textContent = String(list.length);

  els.deliveryList.innerHTML = "";

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "dash-empty-state";
    empty.innerHTML = `
      <span class="dash-empty-icon">▣</span>
      <h4>${deliveries.length ? "No matching deliveries" : "No deliveries yet"}</h4>
      <p>${deliveries.length ? "Try adjusting your search or filters." : "Create your first delivery to get started."}</p>
    `;

    if (!deliveries.length) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dash-btn primary";
      btn.textContent = "Create Delivery";
      btn.addEventListener("click", () => switchTab("create"));
      empty.append(btn);
    }

    els.deliveryList.append(empty);
    return;
  }

  list.forEach(delivery => els.deliveryList.append(renderDeliveryCard(delivery)));
}

function renderDeliveryCard(delivery) {
  const expired = delivery.expires_at && new Date(delivery.expires_at).getTime() <= Date.now();
  const battle = isBattle(delivery);
  const cd = !expired && delivery.expires_at ? countdown(delivery.expires_at) : null;
  const fileCount = Array.isArray(delivery.delivery_files) ? (delivery.delivery_files.length || 1) : 1;

  const card = document.createElement("article");
  card.className = `dash-delivery-card${expired ? " is-expired" : ""}${battle ? " is-battle" : ""}`;

  card.innerHTML = `
    <div class="dash-delivery-card-top">
      <div class="dash-delivery-card-heading">
        <strong>${escapeHtml(delivery.project_name || "Untitled delivery")}</strong>
        <span>${escapeHtml(delivery.client_name || "")}</span>
      </div>
      <span class="dash-status-pill ${expired ? "is-expired" : "is-active"}">
        ${expired ? "Expired" : "Active"}
      </span>
    </div>

    <div class="dash-delivery-card-meta">
      <span class="dash-source-tag${battle ? " is-battle" : ""}">${escapeHtml(sourceLabelOf(delivery))}</span>
      <span>${fileCount} file${fileCount === 1 ? "" : "s"} · ${formatBytes(delivery.file_size || 0)}</span>
      <span>${expired ? `Expired ${formatDate(delivery.expires_at)}` : (cd ? cd.label : formatDate(delivery.expires_at))}</span>
    </div>

    <div class="dash-delivery-card-stats">
      <span>${Number(delivery.lifetime_views || 0)} views</span>
      <span>${Number(delivery.lifetime_downloads || 0)} downloads</span>
    </div>

    <div class="dash-delivery-card-actions">
      <button type="button" class="dash-btn dash-compact btn-edit">Edit</button>
      <button type="button" class="dash-btn dash-compact btn-copy" ${expired ? "disabled" : ""}>Copy Link</button>
      ${battle ? `<button type="button" class="dash-btn dash-compact btn-copy-direct" ${expired ? "disabled" : ""}>Copy Direct URL</button>` : ""}
      <button type="button" class="dash-btn dash-compact btn-open" ${expired ? "disabled" : ""}>Open</button>
      <button type="button" class="dash-btn dash-compact btn-duplicate">Duplicate</button>
      <button type="button" class="dash-btn dash-compact danger btn-delete">Delete</button>
    </div>
  `;

  card.querySelector(".btn-edit")?.addEventListener("click", () => openEditModal(delivery));

  card.querySelector(".btn-copy")?.addEventListener("click", () => copyToClipboard(deliveryLink(delivery.id), "Delivery link"));

  card.querySelector(".btn-copy-direct")?.addEventListener("click", () => copyToClipboard(battleDirectUrl(delivery), "Direct image URL"));

  card.querySelector(".btn-open")?.addEventListener("click", () => {
    const url = new URL(deliveryLink(delivery.id));
    url.searchParams.set("preview", "1");
    window.open(url.href, "_blank", "noopener,noreferrer");
  });

  card.querySelector(".btn-duplicate")?.addEventListener("click", async event => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      await duplicateDelivery(delivery);
      showToast("Delivery duplicated.");
      await loadDeliveries();
    } catch (error) {
      console.error("[Boztik Deliver] duplicateDelivery failed:", error);
      showToast(error?.message || "Could not duplicate this delivery.", "error");
    } finally {
      btn.disabled = false;
    }
  });

  card.querySelector(".btn-delete")?.addEventListener("click", () => openDeleteModal(delivery));

  return card;
}

function setupDeliveriesTab() {
  els.deliverySearch?.addEventListener("input", renderDeliveryList);
  els.sourceFilter?.addEventListener("change", renderDeliveryList);
  els.statusFilter?.addEventListener("change", renderDeliveryList);
  els.deliveriesRefresh?.addEventListener("click", () => loadDeliveries());
}

/* =========================================================
   EDIT MODAL
========================================================= */

function setEditError(message = "") {
  if (!els.editError) return;
  els.editError.textContent = message;
  els.editError.hidden = !message;
}

function setEditSaving(saving) {
  editSaving = saving;
  if (els.editSave) {
    els.editSave.disabled = saving;
    els.editSave.textContent = saving ? "Saving…" : "Save Changes";
  }
  if (els.editCancel) els.editCancel.disabled = saving;
}

function applyEditSourceFieldVisibility() {
  const battleMode = els.editSource?.value === "photoshop_battles";
  if (els.editRedditFields) els.editRedditFields.hidden = !battleMode;
}

function openEditModal(delivery) {
  editingId = delivery.id;
  setEditError("");
  setEditSaving(false);

  if (els.editId) els.editId.value = delivery.id;
  if (els.editClientName) els.editClientName.value = delivery.client_name || "";
  if (els.editProjectName) els.editProjectName.value = delivery.project_name || "";
  if (els.editSource) els.editSource.value = uiSourceOf(delivery);
  if (els.editRedditUrl) els.editRedditUrl.value = delivery.source_meta?.redditUrl || "";
  if (els.editNotes) els.editNotes.value = delivery.notes || "";

  editRedditSource.load(delivery.reddit_source || null);

  applyEditSourceFieldVisibility();
  openModal(els.editModal);
}

function closeEditModal() {
  closeModal(els.editModal);
  editingId = null;
  editRedditSource.reset();
}

async function handleEditSubmit(event) {
  event.preventDefault();
  if (editSaving || !editingId) return;

  const clientNameRaw = els.editClientName?.value.trim() || "";
  const projectNameRaw = els.editProjectName?.value.trim() || "";
  const uiSource = els.editSource?.value || "private";
  const notesRaw = els.editNotes?.value.trim() || "";
  const redditUrlRaw = els.editRedditUrl?.value.trim() || "";

  setEditError("");

  if (!clientNameRaw) { setEditError("Please enter a client name."); return; }
  if (!projectNameRaw) { setEditError("Please enter a project name."); return; }

  const existing = deliveries.find(d => d.id === editingId);

  const updates = {
    client_name: clientNameRaw,
    project_name: projectNameRaw,
    notes: notesRaw || null
  };

  if (uiSource === "photoshop_battles") {
    updates.source = "reddit";
    updates.source_meta = {
      // Preserve the existing direct_token so the already-shared direct
      // image URL keeps working — only ever generate a new one if this
      // delivery wasn't a battle image before.
      type: "photoshop_battles",
      direct_token: isBattle(existing) ? existing.source_meta.direct_token : crypto.randomUUID().replace(/-/g, ""),
      ...(redditUrlRaw ? { redditUrl: redditUrlRaw } : {})
    };
  } else {
    updates.source = uiSource;
    updates.source_meta = null;
  }

  // Reddit Source (Optional) — null clears it, same as a normal delivery
  // that never had one attached.
  updates.reddit_source = editRedditSource.get();

  setEditSaving(true);

  try {
    const updated = await updateDelivery(editingId, updates);

    const index = deliveries.findIndex(d => d.id === editingId);
    if (index !== -1) deliveries[index] = { ...deliveries[index], ...updated };

    renderOverview();
    renderDeliveryList();
    renderAnalytics();

    showToast("Delivery updated.");
    closeEditModal();

  } catch (error) {
    console.error("[Boztik Deliver] updateDelivery failed:", error);
    setEditError(error?.message || "Could not save changes. Please try again.");
  } finally {
    setEditSaving(false);
  }
}

function setupEditModal() {
  els.editForm?.addEventListener("submit", handleEditSubmit);
  els.editSource?.addEventListener("change", applyEditSourceFieldVisibility);
  wireModalDismiss(els.editModal, els.editClose, () => { if (!editSaving) closeEditModal(); });
  els.editCancel?.addEventListener("click", () => { if (!editSaving) closeEditModal(); });
}

/* =========================================================
   DELETE MODAL
========================================================= */

function setDeleteError(message = "") {
  if (!els.deleteError) return;
  els.deleteError.textContent = message;
  els.deleteError.hidden = !message;
}

function openDeleteModal(delivery) {
  pendingDeleteId = delivery.id;
  setDeleteError("");

  if (els.deleteSummary) {
    els.deleteSummary.textContent =
      `${delivery.project_name || "Untitled delivery"} — ${delivery.client_name || "no client name"}`;
  }

  if (els.deleteConfirm) {
    els.deleteConfirm.disabled = false;
    els.deleteConfirm.textContent = "Delete Delivery";
  }

  openModal(els.deleteModal);
}

function closeDeleteModal() {
  closeModal(els.deleteModal);
  pendingDeleteId = null;
}

async function handleDeleteConfirm() {
  if (deleteWorking || !pendingDeleteId) return;

  const delivery = deliveries.find(d => d.id === pendingDeleteId);
  if (!delivery) { closeDeleteModal(); return; }

  deleteWorking = true;
  setDeleteError("");

  if (els.deleteConfirm) {
    els.deleteConfirm.disabled = true;
    els.deleteConfirm.textContent = "Deleting…";
  }

  try {
    await deleteDelivery(delivery);
    showToast("Delivery deleted.");
    closeDeleteModal();
    await loadDeliveries();
  } catch (error) {
    console.error("[Boztik Deliver] deleteDelivery failed:", error);
    setDeleteError(error?.message || "Could not delete this delivery. Please try again.");
    if (els.deleteConfirm) {
      els.deleteConfirm.disabled = false;
      els.deleteConfirm.textContent = "Delete Delivery";
    }
  } finally {
    deleteWorking = false;
  }
}

function setupDeleteModal() {
  els.deleteConfirm?.addEventListener("click", handleDeleteConfirm);
  wireModalDismiss(els.deleteModal, els.deleteClose, () => { if (!deleteWorking) closeDeleteModal(); });
  els.deleteCancel?.addEventListener("click", () => { if (!deleteWorking) closeDeleteModal(); });
}

/* =========================================================
   ANALYTICS TAB
========================================================= */

function renderAnalytics() {
  const totals = computeTotals(deliveries);

  if (els.analyticsMonthlyViews) els.analyticsMonthlyViews.textContent = totals.monthlyViews;
  if (els.analyticsMonthlyDownloads) els.analyticsMonthlyDownloads.textContent = totals.monthlyDownloads;
  if (els.analyticsLifetimeViews) els.analyticsLifetimeViews.textContent = totals.lifetimeViews;
  if (els.analyticsLifetimeDownloads) els.analyticsLifetimeDownloads.textContent = totals.lifetimeDownloads;

  const battleDeliveries = deliveries.filter(isBattle);
  const battleTotals = computeTotals(battleDeliveries);

  if (els.battleMonthlyViews) els.battleMonthlyViews.textContent = battleTotals.monthlyViews;
  if (els.battleLifetimeViews) els.battleLifetimeViews.textContent = battleTotals.lifetimeViews;
  if (els.battleMonthlyDownloads) els.battleMonthlyDownloads.textContent = battleTotals.monthlyDownloads;
  if (els.battleLifetimeDownloads) els.battleLifetimeDownloads.textContent = battleTotals.lifetimeDownloads;

  if (els.analyticsMonthLabel) {
    els.analyticsMonthLabel.textContent = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  renderAnalyticsTable();
}

function renderAnalyticsTable() {
  if (!els.analyticsTableBody) return;

  if (!deliveries.length) {
    els.analyticsTableBody.innerHTML = `
      <tr><td colspan="6" class="dash-table-empty">No deliveries yet.</td></tr>
    `;
    return;
  }

  const rows = [...deliveries]
    .sort((a, b) => Number(b.lifetime_views || 0) - Number(a.lifetime_views || 0))
    .map(delivery => `
      <tr>
        <td>${escapeHtml(delivery.project_name || "Untitled")}</td>
        <td>${escapeHtml(sourceLabelOf(delivery))}</td>
        <td>${Number(delivery.lifetime_views || 0)}</td>
        <td>${Number(delivery.lifetime_downloads || 0)}</td>
        <td>${delivery.last_viewed_at ? formatDate(delivery.last_viewed_at) : "—"}</td>
        <td>${delivery.last_downloaded_at ? formatDate(delivery.last_downloaded_at) : "—"}</td>
      </tr>
    `)
    .join("");

  els.analyticsTableBody.innerHTML = rows;
}

/* =========================================================
   DATA LOADING
========================================================= */

async function loadDeliveries() {
  try {
    deliveries = await listDeliveries();
  } catch (error) {
    console.error("[Boztik Deliver] listDeliveries failed:", error);
    showToast("Could not load deliveries.", "error");
    deliveries = [];
  }

  renderOverview();
  renderDeliveryList();
  renderAnalytics();
}

/* =========================================================
   BOOTSTRAP
========================================================= */

function setupGlobalRefresh() {
  els.refreshBtn?.addEventListener("click", () => loadDeliveries());
}

async function bootstrapDashboard() {
  showLoading("Loading dashboard…", "Fetching your deliveries.");
  try {
    await loadDeliveries();
  } finally {
    hideLoading();
  }
}

async function init() {
  setupAuth();
  setupTabs();
  setupSourceSelection();
  setupFileSelection();
  setupCreateForm();
  setupSuccessModal();
  setupDeliveriesTab();
  setupEditModal();
  setupDeleteModal();
  setupGlobalRefresh();

  let session = null;

  try {
    session = await getSession();
  } catch (error) {
    console.error("[Boztik Deliver] getSession failed:", error);
  }

  if (session) {
    showDashboardView();
    await bootstrapDashboard();
  } else {
    showLoginView();
  }
}

init();