import {
  countdown,
  formatBytes,
  formatDate,
  toast,
  guessMimeType,
  isPreviewable
} from "./shared.js";

import {
  getPublicDelivery,
  recordView,
  recordDownload,
  signedDownload,
  signedPreview
} from "./api.js";

import {
  getImageDimensions,
  parseExif,
  estimatePdfPageCount,
  buildImageInfoHTML,
  buildGenericInfoHTML,
  formatLabelFor
} from "./fileinfo.js";

const $ = id => document.getElementById(id);

const els = {
  loading: $("deliver-loading"),
  active: $("deliver-active"),
  expired: $("deliver-expired"),
  error: $("deliver-error"),
  errorDetail: $("deliver-error-detail"),

  title: $("deliver-project-name"),
  displayProjectName: $("display-project-name"),
  client: $("deliver-client-name"),
  id: $("deliver-id-value"),
  size: $("deliver-file-size"),
  date: $("deliver-upload-date"),

  notes: $("deliver-notes"),
  notesWrap: $("deliver-notes-wrap"),

  count: $("deliver-countdown-label"),
  countdownWrap: $("deliver-countdown-wrap"),
  expiryDate: $("deliver-expiry-date"),
  expiryDateWrap: $("deliver-expiry-date-wrap"),

  gallery: $("deliver-gallery"),
  all: $("deliver-download-all"),

  discover: $("deliver-discover"),
  adSlot: $("deliver-adsense-slot"),
  support: $("deliver-support"),
  privateRequests: $("deliver-private-requests"),

  supportModal: $("deliver-support-modal"),
  supportModalClose: $("deliver-support-modal-close")
};

let delivery;
let timer;
let initializationComplete = false;

/* =========================================================
   PAGE STATE MANAGEMENT
========================================================= */

function state(name) {
  console.log(`[Boztik Deliver Debug] Transitioning to state: ${name}`);

  const states = ["loading", "active", "expired", "error"];
  states.forEach(key => {
    if (els[key]) {
      els[key].hidden = key !== name;
    }
  });

  // Marketing and discovery only show in active state
  const isShowActive = name === "active";
  if (els.discover) els.discover.hidden = !isShowActive;
  if (els.support) els.support.hidden = !isShowActive;
  if (els.privateRequests) els.privateRequests.hidden = !isShowActive;
  
  if (els.adSlot) {
    els.adSlot.hidden = !isShowActive;
    if (isShowActive) loadAd();
  }
}

/* =========================================================
   SUPPORT / TIP POPUP
========================================================= */

const SUPPORT_POPUP_STORAGE_KEY = "boztik-deliver-support-shown";

function hasSeenSupportPopup() {
  try { return localStorage.getItem(SUPPORT_POPUP_STORAGE_KEY) === "1"; }
  catch { return true; }
}

function markSupportPopupSeen() {
  try { localStorage.setItem(SUPPORT_POPUP_STORAGE_KEY, "1"); }
  catch {}
}

function showSupportPopup() {
  const modal = els.supportModal;
  if (!modal?.showModal || modal.open) return;
  modal.showModal();
}

function wireSupportPopup() {
  const modal = els.supportModal;
  if (!modal) return;
  els.supportModalClose?.addEventListener("click", () => modal.close());
  modal.addEventListener("click", e => { if (e.target === modal) modal.close(); });
}

wireSupportPopup();

/* =========================================================
   ADSENSE
========================================================= */

let adLoaded = false;
function loadAd() {
  if (adLoaded) return;
  adLoaded = true;
  try { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
  catch (error) { console.warn("Boztik Deliver: AdSense failed to load:", error); }
}

/* =========================================================
   RENDER FILES
========================================================= */

function renderFiles(files) {
  if (!els.gallery) return;
  
  els.gallery.innerHTML = files.map((file, index) => {
    const previewable = isPreviewable(file.file_name);
    return `
      <article class="file-card-premium">
        <div class="file-preview-wrap" data-preview="${index}">
          ${previewable
            ? `<span style="color: var(--text-muted-deliver); font-size: 0.8rem; font-weight: 600;">Loading preview…</span>`
            : `<span style="font-size: 2.5rem; font-weight: 800; opacity: 0.2; color: var(--text-deliver);">${file.file_name.split(".").pop().toUpperCase()}</span>`
          }
        </div>
        <div class="file-info-premium">
          <strong class="file-name-premium">${file.file_name}</strong>
          <div class="file-meta-line">
            <span>${formatBytes(file.file_size)}</span>
            <span>&bull;</span>
            <span>${file.file_name.split(".").pop().toUpperCase()}</span>
          </div>
          <div class="fileinfo-slot" data-info="${index}" style="margin-top: 8px;"></div>
          <div style="margin-top: auto; padding-top: 20px;">
            <button class="btn-primary-deliver" type="button" data-download="${index}" style="padding: 12px; font-size: 0.9rem; border-radius: 12px; max-width: none; box-shadow: none; width: 100%;">
              Download
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  // Wire download buttons
  els.gallery.querySelectorAll("[data-download]").forEach(btn => {
    btn.addEventListener("click", () => download(files[Number(btn.dataset.download)], btn));
  });

  // Wire previews
  els.gallery.querySelectorAll("[data-preview]").forEach(async wrap => {
    const file = files[Number(wrap.dataset.preview)];
    if (!isPreviewable(file.file_name)) return;
    try {
      const url = await signedPreview(file);
      const img = new Image();
      img.alt = `Preview of ${file.file_name}`;
      img.loading = "lazy";
      img.onload = () => {
        const link = document.createElement("a");
        link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
        link.appendChild(img);
        wrap.innerHTML = "";
        wrap.appendChild(link);
      };
      img.onerror = () => { wrap.innerHTML = `<span style="color: var(--text-muted-deliver); font-size: 0.8rem;">Preview unavailable</span>`; };
      img.src = url;
    } catch {
      wrap.innerHTML = `<span style="color: var(--text-muted-deliver); font-size: 0.8rem;">Preview unavailable</span>`;
    }
  });

  // Wire file info slots
  els.gallery.querySelectorAll("[data-info]").forEach(slot => {
    renderFileInfo(files[Number(slot.dataset.info)], slot);
  });
}

async function renderFileInfo(file, slot) {
  try {
    const sizeLabel = formatBytes(file.file_size);
    const mimeType = guessMimeType(file.file_name);
    const format = formatLabelFor(file.file_name, mimeType);
    
    if (isPreviewable(file.file_name)) {
      const url = await signedPreview(file);
      const dims = await getImageDimensions(url);
      let exif = null;
      if (mimeType === "image/jpeg") {
        try {
          const res = await fetch(url);
          const buf = await res.arrayBuffer();
          exif = await parseExif(buf);
        } catch {}
      }
      slot.innerHTML = buildImageInfoHTML({ fileName: file.file_name, sizeLabel, format, mimeType, width: dims.width, height: dims.height, exif });
    } else {
      let pageCount = null;
      if (file.file_name.toLowerCase().endsWith(".pdf")) {
        try {
          const url = await signedPreview(file);
          const res = await fetch(url);
          const buf = await res.arrayBuffer();
          pageCount = await estimatePdfPageCount(buf);
        } catch {}
      }
      slot.innerHTML = buildGenericInfoHTML({ fileName: file.file_name, sizeLabel, format, mimeType, pageCount });
    }
  } catch {} // Graceful degradation for metadata
}

/* =========================================================
   DOWNLOAD LOGIC
========================================================= */

function triggerFileSave(url, fileName) {
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a);
  a.click(); a.remove();
  toast("Download started.");
}

async function download(file, button) {
  if (button?.disabled) return;
  const originalLabel = button?.innerHTML;
  if (button) { button.disabled = true; button.textContent = "Preparing…"; }

  try {
    const url = await signedDownload(file);
    recordDownload(delivery.id).catch(e => console.warn("[Boztik Deliver] Download analytics failed:", e));

    if (!hasSeenSupportPopup()) {
      markSupportPopupSeen();
      showSupportPopup();
      await new Promise(r => setTimeout(res, 1500));
    }
    triggerFileSave(url, file.file_name);
  } catch (error) {
    console.error("[Boztik Deliver] Download failed:", error);
    toast("The download could not be prepared. Please try again.", "error");
  } finally {
    if (button) { button.disabled = false; button.innerHTML = originalLabel; }
  }
}

/* =========================================================
   INITIALIZATION
========================================================= */

function updateCountdown() {
  if (!delivery?.expires_at) return;
  const value = countdown(delivery.expires_at);
  if (value.expired) {
    clearInterval(timer);
    state("expired");
    return;
  }
  if (els.count) els.count.textContent = value.label;
  if (els.countdownWrap) {
    const isUrgent = value.label.includes("h") && !value.label.includes("d");
    els.countdownWrap.classList.toggle("warning", isUrgent);
  }
}

async function init() {
  console.log("[Boztik Deliver Debug] INIT START");
  initializationComplete = false;
  if (timer) clearInterval(timer);
  if (els.gallery) els.gallery.innerHTML = "";

  const id = new URLSearchParams(location.search).get("id")?.trim().toUpperCase();
  console.log("[Boztik Deliver Debug] ID:", id);

  // Safety Timeout
  setTimeout(() => {
    if (!initializationComplete) {
      console.warn("[Boztik Deliver Debug] Initialization safety timeout reached.");
      showError({ message: "The delivery is taking longer than expected to load." });
    }
  }, 10000);

  if (!id || !/^BZ-[A-Z2-9-]+$/.test(id)) {
    console.log("[Boztik Deliver Debug] Invalid ID format.");
    initializationComplete = true;
    return state("expired");
  }

  try {
    console.log("[Boztik Deliver Debug] Fetching delivery...");
    delivery = await getPublicDelivery(id);
    
    if (!delivery) {
      console.log("[Boztik Deliver Debug] Delivery not found.");
      initializationComplete = true;
      return state("expired");
    }

    const expiryCheck = countdown(delivery.expires_at);
    console.log("[Boztik Deliver Debug] Expiry check:", expiryCheck);
    if (expiryCheck.expired) {
      initializationComplete = true;
      return state("expired");
    }

    // Populate metadata
    if (els.displayProjectName) els.displayProjectName.textContent = delivery.project_name || "Your project";
    if (els.client) els.client.textContent = delivery.client_name ? `Prepared especially for ${delivery.client_name}` : "Prepared especially for you";
    if (els.id) els.id.textContent = delivery.id;
    if (els.size) els.size.textContent = formatBytes(delivery.file_size);
    if (els.date) els.date.textContent = formatDate(delivery.created_at);

    if (els.expiryDate && els.expiryDateWrap && delivery.expires_at) {
      els.expiryDate.textContent = formatDate(delivery.expires_at);
      els.expiryDateWrap.hidden = false;
    }

    if (delivery.notes && els.notes && els.notesWrap) {
      els.notes.textContent = delivery.notes;
      els.notesWrap.hidden = false;
    }

    const files = delivery.delivery_files?.length ? delivery.delivery_files : [{ delivery_id: delivery.id, file_path: delivery.file_path, file_name: delivery.file_name, file_size: delivery.file_size }];

    console.log("[Boztik Deliver Debug] Rendering files...");
    renderFiles(files);

    // Non-blocking analytics
    try {
      recordView(delivery.id).catch(e => console.warn("[Boztik Deliver] View analytics failed:", e));
    } catch (e) {
      console.warn("[Boztik Deliver] View analytics threw synchronous error:", e);
    }

    /* Download All */
    if (els.all) {
      // Remove old listeners by replacing the element or just being careful
      const newAll = els.all.cloneNode(true);
      els.all.parentNode.replaceChild(newAll, els.all);
      els.all = newAll;
      els.all.addEventListener("click", async () => {
        if (els.all.disabled) return;
        els.all.disabled = true;
        const original = els.all.innerHTML;
        els.all.textContent = "Preparing All Files…";
        try { for (const f of files) await download(f); }
        finally { els.all.disabled = false; els.all.innerHTML = original; }
      });
    }

    updateCountdown();
    timer = setInterval(updateCountdown, 30000);

    console.log("[Boztik Deliver Debug] ACTIVE STATE");
    initializationComplete = true;
    state("active");

  } catch (error) {
    console.error("[Boztik Deliver Debug] Initialization error:", error);
    initializationComplete = true;
    showError(error);
  }
}

function showError(error) {
  if (els.errorDetail) {
    const parts = [];
    if (error?.message) parts.push(error.message);
    if (error?.code) parts.push(`(code: ${error.code})`);
    els.errorDetail.textContent = parts.length ? `Diagnostic: ${parts.join(" ")}` : "Diagnostic: no error details were available.";
    els.errorDetail.hidden = false;
  }
  state("error");
}

/* =========================================================
   SAFETY NET
========================================================= */

window.addEventListener("error", event => {
  console.error("Boztik Deliver: uncaught error:", event.error || event.message);
  if (!initializationComplete) {
    showError(event.error || { message: String(event.message) });
  }
});

init();
