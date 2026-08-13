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


/* =========================================================
   SUPPORT / TIP POPUP (first successful download only)
========================================================= */

const SUPPORT_POPUP_STORAGE_KEY =
  "boztik-deliver-support-shown";

function hasSeenSupportPopup() {
  try {
    return (
      localStorage.getItem(
        SUPPORT_POPUP_STORAGE_KEY
      ) === "1"
    );
  } catch (error) {
    return true;
  }
}

function markSupportPopupSeen() {
  try {
    localStorage.setItem(
      SUPPORT_POPUP_STORAGE_KEY,
      "1"
    );
  } catch (error) {
    // Non-critical
  }
}

function showSupportPopup() {
  const modal = els.supportModal;
  if (
    !modal?.showModal ||
    modal.open
  ) {
    return;
  }
  modal.showModal();
}

function wireSupportPopup() {
  const modal = els.supportModal;
  if (!modal) return;

  els.supportModalClose?.addEventListener(
    "click",
    () => modal.close()
  );

  modal.addEventListener(
    "click",
    event => {
      if (event.target === modal) {
        modal.close();
      }
    }
  );
}

wireSupportPopup();

let delivery;
let timer;
let initializationComplete = false;


/* =========================================================
   PAGE STATE
========================================================= */

function state(name) {
  console.log(`[Boztik Deliver] Transitioning to state: ${name}`);

  ["loading", "active", "expired", "error"].forEach(key => {
    if (els[key]) {
      els[key].hidden = key !== name;
    }
  });

  const showPromo = name === "active";

  if (els.discover) {
    els.discover.hidden = !showPromo;
  }

  if (els.adSlot) {
    els.adSlot.hidden = !showPromo;
    if (showPromo) loadAd();
  }

  if (els.support) {
    els.support.hidden = !showPromo;
  }

  if (els.privateRequests) {
    els.privateRequests.hidden = !showPromo;
  }
}


/* =========================================================
   ADSENSE
========================================================= */

let adLoaded = false;

function loadAd() {
  if (adLoaded) return;
  adLoaded = true;
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch (error) {
    console.error("Boztik Deliver: AdSense failed to load:", error);
  }
}


/* =========================================================
   RENDER FILES
========================================================= */

function renderFiles(files) {

  els.gallery.innerHTML = files.map((file, index) => {
    const previewable = isPreviewable(file.file_name);

    return `
      <article class="file-card-premium">
        <div class="file-preview-wrap" data-preview="${index}">
          ${
            previewable
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
          
          <div style="margin-top: auto; padding-top: 20px; display: flex; gap: 10px;">
            <button class="btn-primary-deliver" type="button" data-download="${index}" style="padding: 12px; font-size: 0.9rem; border-radius: 12px; max-width: none; box-shadow: none;">
              Download
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");


  /* =======================================================
     DOWNLOAD BUTTONS
  ======================================================= */

  els.gallery
    .querySelectorAll("[data-download]")
    .forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.download);
        download(files[index], button);
      });
    });


  /* =======================================================
     IMAGE PREVIEWS
  ======================================================= */

  els.gallery
    .querySelectorAll("[data-preview]")
    .forEach(async preview => {
      const file = files[Number(preview.dataset.preview)];
      if (!isPreviewable(file.file_name)) return;

      try {
        const url = await signedPreview(file);
        const img = new Image();
        img.alt = `Preview of ${file.file_name}`;
        img.loading = "lazy";
        img.onerror = () => {
          preview.innerHTML = `<span style="color: var(--text-muted-deliver); font-size: 0.8rem;">Preview unavailable</span>`;
        };
        img.src = url;

        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `Open larger preview of ${file.file_name}`);
        link.appendChild(img);

        preview.innerHTML = "";
        preview.appendChild(link);
      } catch (error) {
        preview.innerHTML = `<span style="color: var(--text-muted-deliver); font-size: 0.8rem;">Preview unavailable</span>`;
      }
    });


  /* =======================================================
     FILE INFORMATION
  ======================================================= */

  els.gallery
    .querySelectorAll("[data-info]")
    .forEach(slot => {
      const index = Number(slot.dataset.info);
      renderFileInfo(files[index], slot);
    });
}


/* =========================================================
   FILE INFORMATION
========================================================= */

async function renderFileInfo(file, slot) {
  const sizeLabel = formatBytes(file.file_size);
  const mimeType = guessMimeType(file.file_name);
  const format = formatLabelFor(file.file_name, mimeType);
  const isImage = isPreviewable(file.file_name);

  try {
    if (isImage) {
      const url = await signedPreview(file);
      const dims = await getImageDimensions(url);
      let exif = null;

      if (mimeType === "image/jpeg") {
        try {
          const response = await fetch(url);
          const buffer = await response.arrayBuffer();
          exif = await parseExif(buffer);
        } catch {}
      }

      slot.innerHTML = buildImageInfoHTML({
        fileName: file.file_name,
        sizeLabel,
        format,
        mimeType,
        width: dims.width,
        height: dims.height,
        exif
      });
    } else {
      let pageCount = null;
      if (file.file_name.toLowerCase().endsWith(".pdf")) {
        try {
          const url = await signedPreview(file);
          const response = await fetch(url);
          const buffer = await response.arrayBuffer();
          pageCount = await estimatePdfPageCount(buffer);
        } catch {}
      }

      slot.innerHTML = buildGenericInfoHTML({
        fileName: file.file_name,
        sizeLabel,
        format,
        mimeType,
        pageCount
      });
    }
  } catch {}
}


/* =========================================================
   COUNTDOWN
========================================================= */

function updateCountdown() {
  const value = countdown(delivery.expires_at);

  if (value.expired) {
    clearInterval(timer);
    state("expired");
    return;
  }

  els.count.textContent = value.label;
  
  if (els.countdownWrap) {
    const isUrgent = value.label.includes("h") && !value.label.includes("d");
    if (isUrgent) {
      els.countdownWrap.classList.add("warning");
    } else {
      els.countdownWrap.classList.remove("warning");
    }
  }
}


/* =========================================================
   DOWNLOAD
========================================================= */

function triggerFileSave(url, fileName) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("Download started.");
}

async function download(file, button) {
  if (button?.disabled) return;

  const originalLabel = button?.innerHTML;

  if (button) {
    button.disabled = true;
    button.textContent = "Preparing…";
  }

  try {
    const url = await signedDownload(file);
    
    recordDownload(delivery.id).catch(error => {
      console.error("[Boztik Deliver] recordDownload failed:", error);
    });

    if (!hasSeenSupportPopup()) {
      markSupportPopupSeen();
      showSupportPopup();
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    triggerFileSave(url, file.file_name);
  } catch (error) {
    console.error("[Boztik Deliver] Download failed:", file.file_name, error);
    toast("The download could not be prepared. Please try again.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }
}


/* =========================================================
   INITIALIZE CLIENT DELIVERY
========================================================= */

async function init() {
  initializationComplete = false;

  const id = new URLSearchParams(location.search)
    .get("id")
    ?.trim()
    .toUpperCase();

  // Safety Timeout
  setTimeout(() => {
    if (!initializationComplete) {
      console.warn("[Boztik Deliver] Initialization safety timeout reached.");
      showError({ message: "The delivery is taking longer than expected to load. Please try refreshing." });
    }
  }, 10000);

  if (!id || !/^BZ-[A-Z2-9-]+$/.test(id)) {
    initializationComplete = true;
    return state("expired");
  }

  try {
    delivery = await getPublicDelivery(id);

    if (!delivery) return state("expired");

    if (countdown(delivery.expires_at).expired) {
      return state("expired");
    }

    // Populate data
    if (els.title) els.title.textContent = "Your finished work is ready";
    if (els.displayProjectName) els.displayProjectName.textContent = delivery.project_name || "Your project";
    
    if (els.client) {
      els.client.textContent = delivery.client_name
        ? `Prepared especially for ${delivery.client_name}`
        : "Prepared especially for you";
    }

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

    recordView(delivery.id).catch(error => {
      console.error("[Boztik Deliver] recordView failed:", error);
    });

    const files = delivery.delivery_files?.length
      ? delivery.delivery_files
      : [
          {
            delivery_id: delivery.id,
            file_path: delivery.file_path,
            file_name: delivery.file_name,
            file_size: delivery.file_size
          }
        ];

    renderFiles(files);

    /* =======================================================
       DOWNLOAD ALL
    ======================================================= */

    els.all.addEventListener("click", async () => {
      if (els.all.disabled) return;
      els.all.disabled = true;
      const original = els.all.innerHTML;
      els.all.textContent = "Preparing All Files…";

      try {
        for (const file of files) {
          await download(file);
        }
      } finally {
        els.all.disabled = false;
        els.all.innerHTML = original;
      }
    });

    updateCountdown();
    
    if (timer) clearInterval(timer);
    timer = setInterval(updateCountdown, 30000);

    initializationComplete = true;
    state("active");

  } catch (error) {
    initializationComplete = true;
    console.error("Boztik Deliver client initialization failed:", error);
    showError(error);
  }
}


/* =========================================================
   ERROR HANDLING
========================================================= */

function showError(error) {
  if (els.errorDetail) {
    const parts = [];
    if (error?.message) parts.push(error.message);
    if (error?.code) parts.push(`(code: ${error.code})`);
    els.errorDetail.textContent = parts.length
      ? `Diagnostic: ${parts.join(" ")}`
      : "Diagnostic: no error details were available.";
    els.errorDetail.hidden = false;
  }
  state("error");
}


/* =========================================================
   SAFETY NET
========================================================= */

window.addEventListener("error", event => {
  console.error("Boztik Deliver: uncaught error:", event.error || event.message);
  if (els.loading && !els.loading.hidden) {
    showError(event.error || { message: String(event.message) });
  }
});

init();
