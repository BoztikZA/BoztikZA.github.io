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


/* =========================================================
   DOM HELPERS
========================================================= */

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
   SUPPORT / TIP POPUP
   FIRST SUCCESSFUL DOWNLOAD ONLY
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

  if (!modal) {
    return;
  }

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


/* =========================================================
   DELIVERY STATE
========================================================= */

let delivery;
let timer;
let initializationComplete = false;


/* =========================================================
   PREVIEW URL CACHE
=========================================================

   A delivery file may need its signed preview URL for:

   - the visible image preview
   - image dimensions
   - EXIF metadata
   - full-resolution viewer

   The previous implementation requested the signed URL
   multiple times.

   Keep one URL per file for the current page session.
========================================================= */

const previewUrlCache = new Map();


function clearPreviewUrlCache() {
  previewUrlCache.clear();
}


async function getCachedPreviewUrl(file) {

  const key =
    file?.file_path ||
    `${file?.delivery_id || ""}:${file?.file_name || ""}`;

  if (!key) {
    throw new Error(
      "The file does not contain a valid preview identifier."
    );
  }

  if (previewUrlCache.has(key)) {
    return previewUrlCache.get(key);
  }

  const url =
    await signedPreview(file);

  if (
    !url ||
    typeof url !== "string"
  ) {
    throw new Error(
      "The preview service did not return a valid image URL."
    );
  }

  previewUrlCache.set(
    key,
    url
  );

  return url;
}


/* =========================================================
   HTML ESCAPING
=========================================================

   File names and metadata can originate from uploaded files.
   Escape values before inserting them into innerHTML.
========================================================= */

function escapeHTML(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================================================
   PAGE STATE
========================================================= */

function state(name) {

  console.log(
    `[Boztik Deliver] Transitioning to state: ${name}`
  );

  ["loading", "active", "expired", "error"]
    .forEach(key => {

      if (els[key]) {
        els[key].hidden =
          key !== name;
      }

    });


  const showPromo =
    name === "active";


  if (els.discover) {
    els.discover.hidden =
      !showPromo;
  }


  if (els.adSlot) {
    els.adSlot.hidden =
      !showPromo;

    if (showPromo) {
      loadAd();
    }
  }


  if (els.support) {
    els.support.hidden =
      !showPromo;
  }


  if (els.privateRequests) {
    els.privateRequests.hidden =
      !showPromo;
  }
}


/* =========================================================
   ADSENSE
========================================================= */

let adLoaded = false;


function loadAd() {

  if (adLoaded) {
    return;
  }

  adLoaded = true;

  try {

    (
      window.adsbygoogle =
        window.adsbygoogle || []
    ).push({});

  } catch (error) {

    console.error(
      "Boztik Deliver: AdSense failed to load:",
      error
    );

  }
}


/* =========================================================
   FULL RESOLUTION VIEWER
========================================================= */

let fullResolutionDialog = null;
let fullResolutionImage = null;
let fullResolutionTitle = null;
let fullResolutionDownload = null;
let fullResolutionLoading = null;
let fullResolutionError = null;

let fullResolutionReturnFocus = null;


function ensureFullResolutionViewer() {

  if (fullResolutionDialog) {
    return;
  }


  fullResolutionDialog =
    document.createElement("dialog");

  fullResolutionDialog.className =
    "deliver-fullscreen-viewer";

  fullResolutionDialog.setAttribute(
    "aria-labelledby",
    "deliver-viewer-title"
  );


  fullResolutionDialog.innerHTML = `

    <div class="deliver-viewer-shell">

      <div class="deliver-viewer-header">

        <div class="deliver-viewer-title-wrap">

          <span class="deliver-viewer-eyebrow">
            FULL RESOLUTION
          </span>

          <strong
            id="deliver-viewer-title"
            class="deliver-viewer-title"
          ></strong>

        </div>


        <button
          type="button"
          class="deliver-viewer-close"
          aria-label="Close full resolution viewer"
        >
          ×
        </button>

      </div>


      <div class="deliver-viewer-stage">

        <div
          class="deliver-viewer-loading"
          aria-live="polite"
        >
          Loading full-resolution image…
        </div>


        <img
          id="deliver-viewer-image"
          class="deliver-viewer-image"
          alt=""
          hidden
        >


        <div
          class="deliver-viewer-error"
          hidden
        >

          <strong>
            Preview unavailable
          </strong>

          <span>
            The full-resolution image could not be loaded.
          </span>

        </div>

      </div>


      <div class="deliver-viewer-footer">

        <span class="deliver-viewer-hint">
          Press Esc to close
        </span>


        <button
          type="button"
          class="deliver-viewer-download"
        >
          Download
        </button>

      </div>

    </div>

  `;


  document.body.appendChild(
    fullResolutionDialog
  );


  fullResolutionImage =
    fullResolutionDialog.querySelector(
      "#deliver-viewer-image"
    );


  fullResolutionTitle =
    fullResolutionDialog.querySelector(
      "#deliver-viewer-title"
    );


  fullResolutionDownload =
    fullResolutionDialog.querySelector(
      ".deliver-viewer-download"
    );


  fullResolutionLoading =
    fullResolutionDialog.querySelector(
      ".deliver-viewer-loading"
    );


  fullResolutionError =
    fullResolutionDialog.querySelector(
      ".deliver-viewer-error"
    );


  const closeButton =
    fullResolutionDialog.querySelector(
      ".deliver-viewer-close"
    );


  closeButton?.addEventListener(
    "click",
    closeFullResolutionViewer
  );


  fullResolutionDialog.addEventListener(
    "click",
    event => {

      if (
        event.target ===
        fullResolutionDialog
      ) {
        closeFullResolutionViewer();
      }

    }
  );


  fullResolutionImage.addEventListener(
    "load",
    () => {

      if (fullResolutionLoading) {
        fullResolutionLoading.hidden =
          true;
      }

      if (fullResolutionError) {
        fullResolutionError.hidden =
          true;
      }

      fullResolutionImage.hidden =
        false;

    }
  );


  fullResolutionImage.addEventListener(
    "error",
    () => {

      if (fullResolutionLoading) {
        fullResolutionLoading.hidden =
          true;
      }

      fullResolutionImage.hidden =
        true;

      if (fullResolutionError) {
        fullResolutionError.hidden =
          false;
      }

    }
  );


  fullResolutionDialog.addEventListener(
    "close",
    () => {

      fullResolutionImage?.removeAttribute(
        "src"
      );

      if (fullResolutionReturnFocus) {

        try {
          fullResolutionReturnFocus.focus();
        } catch {}

      }

      fullResolutionReturnFocus =
        null;
    }
  );

}


async function openFullResolution(
  file,
  triggerButton = null
) {

  ensureFullResolutionViewer();


  fullResolutionReturnFocus =
    triggerButton ||
    document.activeElement;


  if (fullResolutionLoading) {
    fullResolutionLoading.hidden =
      false;
  }


  if (fullResolutionError) {
    fullResolutionError.hidden =
      true;
  }


  if (fullResolutionImage) {

    fullResolutionImage.hidden =
      true;

    fullResolutionImage.removeAttribute(
      "src"
    );

    fullResolutionImage.alt =
      `Full resolution view of ${
        file.file_name || "image"
      }`;

  }


  if (fullResolutionTitle) {

    fullResolutionTitle.textContent =
      file.file_name ||
      "Image";

  }


  if (fullResolutionDownload) {

    fullResolutionDownload.onclick =
      () => {

        download(
          file,
          fullResolutionDownload
        );

      };

  }


  if (
    !fullResolutionDialog.open
  ) {

    fullResolutionDialog.showModal();

  }


  try {

    const url =
      await getCachedPreviewUrl(
        file
      );


    if (!fullResolutionImage) {
      throw new Error(
        "Full-resolution viewer image element is unavailable."
      );
    }


    /*
      Set src only after the viewer and image element
      are already in the DOM.
    */

    fullResolutionImage.src =
      url;


  } catch (error) {

    console.error(
      "[Boztik Deliver] Full resolution preview failed:",
      file?.file_name,
      error
    );


    if (fullResolutionLoading) {
      fullResolutionLoading.hidden =
        true;
    }


    if (fullResolutionImage) {
      fullResolutionImage.hidden =
        true;
    }


    if (fullResolutionError) {
      fullResolutionError.hidden =
        false;
    }

  }
}


function closeFullResolutionViewer() {

  if (
    fullResolutionDialog &&
    fullResolutionDialog.open
  ) {

    fullResolutionDialog.close();

  }

}


/* =========================================================
   FILE TYPE HELPERS
========================================================= */

function getFileExtension(fileName) {

  return (
    fileName
      ?.split(".")
      .pop()
      ?.toUpperCase()
      || "FILE"
  );

}


/* =========================================================
   FILE CARDS
========================================================= */

function renderFiles(files) {

  if (!els.gallery) {
    return;
  }


  clearPreviewUrlCache();


  if (!Array.isArray(files)) {
    els.gallery.innerHTML = "";
    return;
  }


  els.gallery.innerHTML =
    files.map(
      (file, index) => {

        const previewable =
          isPreviewable(
            file.file_name
          );


        const extension =
          getFileExtension(
            file.file_name
          );


        return `

          <article
            class="file-card-premium"
            data-file-card="${index}"
          >


            <div
              class="file-preview-wrap"
              data-preview="${index}"
            >

              ${
                previewable

                  ? `

                    <div
                      class="file-preview-loading"
                    >

                      <span
                        class="preview-spinner"
                        aria-hidden="true"
                      ></span>

                      <span>
                        Loading preview…
                      </span>

                    </div>

                  `

                  : `

                    <div
                      class="file-type-placeholder"
                    >

                      <span
                        class="file-type-badge"
                      >
                        ${escapeHTML(extension)}
                      </span>

                      <span>
                        Preview not available
                      </span>

                    </div>

                  `
              }

            </div>


            <div
              class="file-info-premium"
            >


              <div
                class="file-heading"
              >

                <span
                  class="file-heading-label"
                >
                  DELIVERED FILE
                </span>


                <strong
                  class="file-name-premium"
                >
                  ${escapeHTML(
                    file.file_name
                  )}
                </strong>

              </div>


              <div
                class="file-meta-line"
              >

                <span>
                  ${escapeHTML(
                    formatBytes(
                      file.file_size
                    )
                  )}
                </span>

                <span
                  class="meta-divider"
                  aria-hidden="true"
                >
                  •
                </span>

                <span>
                  ${escapeHTML(
                    extension
                  )}
                </span>

              </div>


              <div
                class="fileinfo-slot"
                data-info="${index}"
              ></div>


              <div
                class="file-actions"
              >

                ${
                  previewable

                    ? `

                      <button
                        class="
                          btn-secondary-deliver
                          file-view-button
                        "
                        type="button"
                        data-view="${index}"
                      >

                        <span
                          class="button-icon"
                          aria-hidden="true"
                        >

                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                          >

                            <path
                              d="M2.5 12s3.5-6 9.5-6
                                 9.5 6 9.5 6-3.5 6-9.5 6
                                -9.5-6-9.5-6Z"
                              stroke="currentColor"
                              stroke-width="1.8"
                            />

                            <circle
                              cx="12"
                              cy="12"
                              r="2.7"
                              stroke="currentColor"
                              stroke-width="1.8"
                            />

                          </svg>

                        </span>


                        <span>
                          View Full Resolution
                        </span>

                      </button>

                    `

                    : ""
                }


                <button
                  class="
                    btn-primary-deliver
                    file-download-button
                  "
                  type="button"
                  data-download="${index}"
                >

                  <span
                    class="button-icon"
                    aria-hidden="true"
                  >

                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                    >

                      <path
                        d="M12 3v11"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />

                      <path
                        d="m7 10 5 5 5-5"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />

                      <path
                        d="M4 20h16"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />

                    </svg>

                  </span>


                  <span>
                    Download
                  </span>

                </button>

              </div>

            </div>

          </article>

        `;

      }
    ).join("");


  /* =======================================================
     DOWNLOAD BUTTONS
  ======================================================= */

  els.gallery
    .querySelectorAll(
      "[data-download]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const index =
            Number(
              button.dataset.download
            );


          if (
            Number.isInteger(index) &&
            files[index]
          ) {

            download(
              files[index],
              button
            );

          }

        }
      );

    });


  /* =======================================================
     FULL RESOLUTION BUTTONS
  ======================================================= */

  els.gallery
    .querySelectorAll(
      "[data-view]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const index =
            Number(
              button.dataset.view
            );


          if (
            Number.isInteger(index) &&
            files[index]
          ) {

            openFullResolution(
              files[index],
              button
            );

          }

        }
      );

    });


  /* =======================================================
     IMAGE PREVIEWS
  ======================================================= */

  els.gallery
    .querySelectorAll(
      "[data-preview]"
    )
    .forEach(preview => {

      const index =
        Number(
          preview.dataset.preview
        );


      const file =
        files[index];


      if (
        !file ||
        !isPreviewable(
          file.file_name
        )
      ) {
        return;
      }


      loadImagePreview(
        file,
        preview
      );

    });


  /* =======================================================
     FILE INFORMATION
  ======================================================= */

  els.gallery
    .querySelectorAll(
      "[data-info]"
    )
    .forEach(slot => {

      const index =
        Number(
          slot.dataset.info
        );


      if (
        Number.isInteger(index) &&
        files[index]
      ) {

        renderFileInfo(
          files[index],
          slot
        );

      }

    });

}


/* =========================================================
   IMAGE PREVIEW LOADER
========================================================= */

async function loadImagePreview(
  file,
  preview
) {

  if (!preview) {
    return;
  }


  try {

    /*
      Obtain the signed URL once and cache it.
    */

    const url =
      await getCachedPreviewUrl(
        file
      );


    if (!url) {
      throw new Error(
        "No preview URL was returned."
      );
    }


    /*
      Create the clickable preview container.
    */

    const link =
      document.createElement(
        "button"
      );


    link.type =
      "button";


    link.className =
      "file-preview-link";


    link.setAttribute(
      "aria-label",
      `View ${
        file.file_name || "image"
      } in full resolution`
    );


    /*
      Create the image element.
    */

    const img =
      document.createElement(
        "img"
      );


    img.alt =
      `Preview of ${
        file.file_name || "image"
      }`;


    img.decoding =
      "async";


    /*
      Do not lazy-load the primary client preview.

      These images are the central content of the
      delivery page and should begin loading immediately.
    */

    img.loading =
      "eager";


    /*
      Insert the image into the document BEFORE assigning src.
    */

    link.appendChild(
      img
    );


    preview.innerHTML =
      "";


    preview.appendChild(
      link
    );


    /*
      Successful image load.
    */

    img.addEventListener(
      "load",
      () => {

        preview.classList.add(
          "preview-loaded"
        );

      },
      { once: true }
    );


    /*
      Image decode failure / invalid image response.
    */

    img.addEventListener(
      "error",
      () => {

        console.error(
          "[Boztik Deliver] Image preview failed:",
          file.file_name
        );


        preview.innerHTML = `

          <div
            class="file-preview-fallback"
          >

            <div
              class="preview-fallback-icon"
              aria-hidden="true"
            >
              !
            </div>

            <strong>
              Preview unavailable
            </strong>

            <span>
              The file is still available
              to download.
            </span>

          </div>

        `;

      },
      { once: true }
    );


    /*
      Clicking the image opens the full-resolution viewer.
    */

    link.addEventListener(
      "click",
      () => {

        openFullResolution(
          file,
          link
        );

      }
    );


    /*
      IMPORTANT:
      Set src only AFTER the image is already attached.
    */

    img.src =
      url;


  } catch (error) {

    console.error(
      "[Boztik Deliver] signedPreview() failed:",
      file?.file_name,
      error
    );


    preview.innerHTML = `

      <div
        class="file-preview-fallback"
      >

        <div
          class="preview-fallback-icon"
          aria-hidden="true"
        >
          !
        </div>

        <strong>
          Preview unavailable
        </strong>

        <span>
          The file is still available
          to download.
        </span>

      </div>

    `;

  }

}


/* =========================================================
   FILE INFORMATION
========================================================= */

async function renderFileInfo(
  file,
  slot
) {

  if (!file || !slot) {
    return;
  }


  const sizeLabel =
    formatBytes(
      file.file_size
    );


  const mimeType =
    guessMimeType(
      file.file_name
    );


  const format =
    formatLabelFor(
      file.file_name,
      mimeType
    );


  const isImage =
    isPreviewable(
      file.file_name
    );


  try {

    /* =====================================================
       IMAGE INFORMATION
    ===================================================== */

    if (isImage) {

      /*
        Reuse the exact same signed URL used
        by the visible image preview.
      */

      const url =
        await getCachedPreviewUrl(
          file
        );


      const dims =
        await getImageDimensions(
          url
        );


      let exif =
        null;


      /*
        EXIF is currently extracted only from JPEG files.
      */

      if (
        mimeType === "image/jpeg"
      ) {

        try {

          const response =
            await fetch(
              url
            );


          if (
            response.ok
          ) {

            const buffer =
              await response.arrayBuffer();


            exif =
              await parseExif(
                buffer
              );

          }

        } catch (error) {

          console.warn(
            "[Boztik Deliver] EXIF unavailable:",
            file.file_name,
            error
          );

        }

      }


      slot.innerHTML =
        buildImageInfoHTML({

          fileName:
            file.file_name,

          sizeLabel,

          format,

          mimeType,

          width:
            dims.width,

          height:
            dims.height,

          exif

        });


      return;
    }


    /* =====================================================
       NON-IMAGE FILE INFORMATION
    ===================================================== */

    let pageCount =
      null;


    /*
      PDF metadata is optional.

      We reuse the cached signed URL.
    */

    if (
      file.file_name
        ?.toLowerCase()
        .endsWith(".pdf")
    ) {

      try {

        const url =
          await getCachedPreviewUrl(
            file
          );


        const response =
          await fetch(
            url
          );


        if (
          response.ok
        ) {

          const buffer =
            await response.arrayBuffer();


          pageCount =
            await estimatePdfPageCount(
              buffer
            );

        }

      } catch (error) {

        console.warn(
          "[Boztik Deliver] PDF metadata unavailable:",
          file.file_name
        );

      }

    }


    slot.innerHTML =
      buildGenericInfoHTML({

        fileName:
          file.file_name,

        sizeLabel,

        format,

        mimeType,

        pageCount

      });


  } catch (error) {

    /*
      Metadata failure must NEVER make the whole
      delivery page enter the global error state.
    */

    console.warn(
      "[Boztik Deliver] File metadata unavailable:",
      file.file_name,
      error
    );


    slot.innerHTML = `

      <div
        class="fileinfo-fallback"
      >

        <span>
          File information
        </span>

        <strong>
          ${escapeHTML(format)}
          ·
          ${escapeHTML(sizeLabel)}
        </strong>

      </div>

    `;

  }

}


/* =========================================================
   COUNTDOWN
========================================================= */

function updateCountdown() {

  if (
    !delivery ||
    !delivery.expires_at
  ) {
    return;
  }


  const value =
    countdown(
      delivery.expires_at
    );


  if (value.expired) {

    clearInterval(
      timer
    );


    state(
      "expired"
    );


    return;
  }


  if (els.count) {

    els.count.textContent =
      value.label;

  }


  if (els.countdownWrap) {

    const isUrgent =
      value.label.includes("h") &&
      !value.label.includes("d");


    if (isUrgent) {

      els.countdownWrap.classList.add(
        "warning"
      );

    } else {

      els.countdownWrap.classList.remove(
        "warning"
      );

    }

  }

}


/* =========================================================
   DOWNLOAD
========================================================= */

function triggerFileSave(
  url,
  fileName
) {

  const a =
    document.createElement(
      "a"
    );


  a.href =
    url;


  a.download =
    fileName;


  a.rel =
    "noopener";


  document.body.appendChild(
    a
  );


  a.click();


  a.remove();


  toast(
    "Download started."
  );

}


async function download(
  file,
  button = null
) {

  if (
    button?.disabled
  ) {
    return;
  }


  const originalLabel =
    button?.innerHTML;


  if (button) {

    button.disabled =
      true;


    button.setAttribute(
      "aria-busy",
      "true"
    );


    button.textContent =
      "Preparing…";

  }


  try {

    const url =
      await signedDownload(
        file
      );


    /*
      Analytics failure must never prevent
      the actual download.
    */

    if (
      delivery?.id
    ) {

      recordDownload(
        delivery.id
      ).catch(
        error => {

          console.error(
            "[Boztik Deliver] recordDownload failed:",
            error
          );

        }
      );

    }


    /*
      Show the support message only after a
      successful download URL has been prepared.
    */

    if (
      !hasSeenSupportPopup()
    ) {

      markSupportPopupSeen();

      showSupportPopup();

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1500
          )
      );

    }


    triggerFileSave(
      url,
      file.file_name
    );


  } catch (error) {

    console.error(
      "[Boztik Deliver] Download failed:",
      file?.file_name,
      error
    );


    toast(
      "The download could not be prepared. Please try again.",
      "error"
    );


  } finally {

    if (button) {

      button.disabled =
        false;


      button.removeAttribute(
        "aria-busy"
      );


      button.innerHTML =
        originalLabel;

    }

  }

}


/* =========================================================
   INITIALIZE CLIENT DELIVERY
========================================================= */

async function init() {

  initializationComplete =
    false;


  clearPreviewUrlCache();


  const id =
    new URLSearchParams(
      location.search
    )
      .get("id")
      ?.trim()
      .toUpperCase();


  /*
    Safety timeout.

    This only concerns the INITIAL delivery request.

    Preview failures must NOT trigger this timeout
    because previews are loaded independently after
    the delivery has already become active.
  */

  setTimeout(
    () => {

      if (
        !initializationComplete
      ) {

        console.warn(
          "[Boztik Deliver] Initialization safety timeout reached."
        );


        showError({
          message:
            "The delivery is taking longer than expected to load. Please try refreshing."
        });

      }

    },
    10000
  );


  if (
    !id ||
    !/^BZ-[A-Z2-9-]+$/.test(id)
  ) {

    initializationComplete =
      true;


    return state(
      "expired"
    );

  }


  try {

    /*
      Fetch the public delivery record.
    */

    delivery =
      await getPublicDelivery(
        id
      );


    if (!delivery) {

      initializationComplete =
        true;

      return state(
        "expired"
      );

    }


    /*
      Check actual delivery expiry.
    */

    if (
      countdown(
        delivery.expires_at
      ).expired
    ) {

      initializationComplete =
        true;

      return state(
        "expired"
      );

    }


    /* =====================================================
       POPULATE DELIVERY HEADER
    ===================================================== */

    if (els.title) {

      els.title.textContent =
        "Your finished work is ready";

    }


    if (
      els.displayProjectName
    ) {

      els.displayProjectName.textContent =
        delivery.project_name ||
        "Your project";

    }


    if (els.client) {

      els.client.textContent =
        delivery.client_name
          ? `Prepared especially for ${delivery.client_name}`
          : "Prepared especially for you";

    }


    if (els.id) {

      els.id.textContent =
        delivery.id;

    }


    if (els.size) {

      els.size.textContent =
        formatBytes(
          delivery.file_size
        );

    }


    if (els.date) {

      els.date.textContent =
        formatDate(
          delivery.created_at
        );

    }


    if (
      els.expiryDate &&
      els.expiryDateWrap &&
      delivery.expires_at
    ) {

      els.expiryDate.textContent =
        formatDate(
          delivery.expires_at
        );


      els.expiryDateWrap.hidden =
        false;

    }


    if (
      delivery.notes &&
      els.notes &&
      els.notesWrap
    ) {

      els.notes.textContent =
        delivery.notes;


      els.notesWrap.hidden =
        false;

    }


    /* =====================================================
       RECORD DELIVERY VIEW
    ===================================================== */

    recordView(
      delivery.id
    ).catch(
      error => {

        console.error(
          "[Boztik Deliver] recordView failed:",
          error
        );

      }
    );


    /* =====================================================
       RESOLVE FILES
    ===================================================== */

    const files =
      delivery.delivery_files?.length

        ? delivery.delivery_files

        : [
            {
              delivery_id:
                delivery.id,

              file_path:
                delivery.file_path,

              file_name:
                delivery.file_name,

              file_size:
                delivery.file_size
            }
          ];


    /*
      Render the delivery files.

      Preview and metadata loading happens independently.
      A preview failure cannot reject this initialization.
    */

    renderFiles(
      files
    );


    /* =====================================================
       DOWNLOAD ALL
    ===================================================== */

    if (
      els.all
    ) {

      /*
        Avoid accidentally adding the event listener
        more than once if init() is ever called again.
      */

      if (
        els.all._boztikDownloadAllHandler
      ) {

        els.all.removeEventListener(
          "click",
          els.all._boztikDownloadAllHandler
        );

      }


      const downloadAllHandler =
        async () => {

          if (
            els.all.disabled
          ) {
            return;
          }


          els.all.disabled =
            true;


          const original =
            els.all.innerHTML;


          els.all.textContent =
            "Preparing All Files…";


          try {

            for (
              const file of files
            ) {

              await download(
                file
              );

            }

          } finally {

            els.all.disabled =
              false;


            els.all.innerHTML =
              original;

          }

        };


      els.all._boztikDownloadAllHandler =
        downloadAllHandler;


      els.all.addEventListener(
        "click",
        downloadAllHandler
      );

    }


    /* =====================================================
       COUNTDOWN
    ===================================================== */

    updateCountdown();


    if (timer) {

      clearInterval(
        timer
      );

    }


    timer =
      setInterval(
        updateCountdown,
        30000
      );


    /*
      IMPORTANT:

      Mark initialization complete BEFORE entering
      active state.

      This prevents the safety timeout from incorrectly
      treating slow previews as an initialization failure.
    */

    initializationComplete =
      true;


    state(
      "active"
    );


  } catch (error) {

    initializationComplete =
      true;


    console.error(
      "Boztik Deliver client initialization failed:",
      error
    );


    showError(
      error
    );

  }

}


/* =========================================================
   ERROR HANDLING
========================================================= */

function showError(
  error
) {

  if (
    els.errorDetail
  ) {

    const parts =
      [];


    if (
      error?.message
    ) {

      parts.push(
        error.message
      );

    }


    if (
      error?.code
    ) {

      parts.push(
        `(code: ${error.code})`
      );

    }


    els.errorDetail.textContent =
      parts.length

        ? `Diagnostic: ${parts.join(" ")}`

        : "Diagnostic: no error details were available.";


    els.errorDetail.hidden =
      false;

  }


  state(
    "error"
  );

}


/* =========================================================
   SAFETY NET
========================================================= */

window.addEventListener(
  "error",
  event => {

    console.error(
      "Boztik Deliver: uncaught error:",
      event.error ||
      event.message
    );


    /*
      Only show the global error state while the
      actual delivery initialization is still running.

      Once the page is active, an individual preview
      failure must NOT replace the whole delivery page
      with an error screen.
    */

    if (
      els.loading &&
      !els.loading.hidden &&
      !initializationComplete
    ) {

      showError(
        event.error || {
          message:
            String(
              event.message
            )
        }
      );

    }

  }
);


/* =========================================================
   UNHANDLED PROMISE SAFETY NET
========================================================= */

window.addEventListener(
  "unhandledrejection",
  event => {

    console.error(
      "Boztik Deliver: unhandled promise rejection:",
      event.reason
    );


    /*
      Do not turn asynchronous preview/metadata failures
      into a global delivery error.

      Only initialization errors are allowed to control
      the global state.
    */

    if (
      els.loading &&
      !els.loading.hidden &&
      !initializationComplete
    ) {

      showError(
        event.reason || {
          message:
            "An unexpected error occurred while loading the delivery."
        }
      );

    }

  }
);


/* =========================================================
   START
========================================================= */

init();