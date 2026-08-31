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
   DOM HELPER
========================================================= */

const $ = id =>
  document.getElementById(id);


/* =========================================================
   DOM REFERENCES
========================================================= */

const els = {

  loading:
    $("deliver-loading"),

  active:
    $("deliver-active"),

  expired:
    $("deliver-expired"),

  error:
    $("deliver-error"),

  errorDetail:
    $("deliver-error-detail"),


  title:
    $("deliver-project-name"),

  projectNameDisplay:
    $("display-project-name"),

  client:
    $("deliver-client-name"),

  id:
    $("deliver-id-value"),

  size:
    $("deliver-file-size"),

  date:
    $("deliver-upload-date"),


  notes:
    $("deliver-notes"),

  notesWrap:
    $("deliver-notes-wrap"),


  sourceWrap:
    $("deliver-source-wrap"),

  sourceSub:
    $("deliver-source-sub"),

  sourceAuthor:
    $("deliver-source-author"),

  sourceTitle:
    $("deliver-source-title"),

  sourceLink:
    $("deliver-source-link"),


  count:
    $("deliver-countdown-label"),

  expiryDate:
    $("deliver-expiry-date"),

  expiryDateWrap:
    $("deliver-expiry-date-wrap"),


  gallery:
    $("deliver-gallery"),

  all:
    $("deliver-download-all"),


  discover:
    $("deliver-discover"),

  explore:
    $("deliver-explore"),

  explorePanel:
    $("deliver-explore-panel"),

  adSlot:
    $("deliver-adsense-slot"),

  support:
    $("deliver-support"),

  privateRequests:
    $("deliver-private-requests"),


  supportModal:
    $("deliver-support-modal"),

  supportModalClose:
    $("deliver-support-modal-close")

};


/* =========================================================
   SUPPORT / TIP POPUP
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

  } catch {

    /*
      If storage is unavailable, treat the popup
      as already seen.

      The download must never be affected by
      localStorage problems.
    */

    return true;

  }

}


function markSupportPopupSeen() {

  try {

    localStorage.setItem(
      SUPPORT_POPUP_STORAGE_KEY,
      "1"
    );

  } catch {

    /*
      Non-critical.
    */

  }

}


function showSupportPopup() {

  const modal =
    els.supportModal;


  if (
    !modal ||
    typeof modal.showModal !== "function" ||
    modal.open
  ) {

    return;

  }


  modal.showModal();

}


function wireSupportPopup() {

  const modal =
    els.supportModal;


  if (!modal) {

    return;

  }


  if (
    els.supportModalClose
  ) {

    els.supportModalClose.addEventListener(
      "click",
      () => {

        modal.close();

      }
    );

  }


  /*
    Clicking outside the support card closes
    the dialog.
  */

  modal.addEventListener(
    "click",
    event => {

      if (
        event.target === modal
      ) {

        modal.close();

      }

    }
  );

}


wireSupportPopup();


/* =========================================================
   DELIVERY STATE
========================================================= */

let delivery =
  null;

let timer =
  null;

let initializationComplete =
  false;


/*
  "preview=1" is added ONLY by the Command Centre's own Open
  actions (see dashboard.js) to mark an authenticated admin
  opening a delivery to check/verify it — not a real client
  visit. It is never present on the link a client actually
  receives (Copy Link / the post-upload share link), so a
  genuine external open is always counted normally.

  This is checked here — the moment a view would otherwise be
  recorded — rather than gated on auth/session state, because
  the admin may be logged into Supabase in another tab while a
  real client opens the public link in this one; that visit must
  still count.
*/
const isAdminPreview =
  new URLSearchParams(
    location.search
  ).get(
    "preview"
  ) === "1";


/* =========================================================
   PREVIEW CACHE
=========================================================

   The old implementation requests signed preview URLs
   independently for:

   1. The visual preview.
   2. Image dimensions.
   3. EXIF information.

   That creates unnecessary requests.

   This cache lets all three operations share the same
   signed URL while it is still fresh.

   Signed preview URLs are intentionally short-lived.
========================================================= */

const PREVIEW_CACHE_TTL =
  4 * 60 * 1000;


const previewUrlCache =
  new Map();


function getPreviewCacheKey(file) {

  if (
    file?.file_path
  ) {

    return file.file_path;

  }


  return [
    file?.delivery_id || "",
    file?.file_name || ""
  ].join(":");

}


function invalidatePreviewUrl(file) {

  const key =
    getPreviewCacheKey(file);


  previewUrlCache.delete(
    key
  );

}


async function getPreviewUrl(
  file,
  forceRefresh = false
) {

  if (
    !file ||
    !file.file_path
  ) {

    throw new Error(
      "The file does not contain a valid storage path."
    );

  }


  const key =
    getPreviewCacheKey(file);


  const cached =
    previewUrlCache.get(
      key
    );


  const now =
    Date.now();


  /*
    Reuse a fresh signed URL.
  */

  if (
    !forceRefresh &&
    cached &&
    cached.url &&
    now - cached.createdAt <
      PREVIEW_CACHE_TTL
  ) {

    return cached.url;

  }


  /*
    Ask the existing API layer for a new signed
    preview URL.
  */

  const url =
    await signedPreview(
      file
    );


  if (
    !url ||
    typeof url !== "string"
  ) {

    throw new Error(
      "The server returned an invalid preview URL."
    );

  }


  previewUrlCache.set(
    key,
    {
      url,
      createdAt:
        now
    }
  );


  return url;

}


/* =========================================================
   HTML ESCAPING
========================================================= */

function escapeHTML(
  value
) {

  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );

}


/* =========================================================
   FILE EXTENSION
========================================================= */

function getFileExtension(
  fileName
) {

  if (
    !fileName
  ) {

    return "FILE";

  }


  const parts =
    fileName.split(".");


  if (
    parts.length < 2
  ) {

    return "FILE";

  }


  return (
    parts.pop() ||
    "FILE"
  ).toUpperCase();

}


/* =========================================================
   PAGE STATE MANAGEMENT
========================================================= */

function state(
  name
) {

  console.log(
    `[Boztik Deliver] State: ${name}`
  );


  [
    "loading",
    "active",
    "expired",
    "error"
  ].forEach(
    key => {

      if (
        els[key]
      ) {

        els[key].hidden =
          key !== name;

      }

    }
  );


  /*
    Marketing/discovery elements should only appear
    after the delivery itself has successfully loaded.
  */

  const showPromo =
    name === "active";


  if (
    els.discover
  ) {

    els.discover.hidden =
      !showPromo;

  }


  if (
    els.explore
  ) {

    els.explore.hidden =
      !showPromo;

  }


  if (
    els.adSlot
  ) {

    els.adSlot.hidden =
      !showPromo;

    /*
      The ad no longer auto-loads here — it now loads lazily the
      first time the "Explore More" panel is opened (see
      setupExplorePanel), since the ad slot lives inside that
      panel and starts visually collapsed. Loading it while
      collapsed risked AdSense measuring a 0-height container.
    */

  }


  if (
    els.support
  ) {

    els.support.hidden =
      name === "loading";

  }


  if (
    els.privateRequests
  ) {

    els.privateRequests.hidden =
      !showPromo;

  }

}


/* =========================================================
   ADSENSE
========================================================= */

let adLoaded =
  false;


function loadAd() {

  if (
    adLoaded
  ) {

    return;

  }


  adLoaded =
    true;


  try {

    (
      window.adsbygoogle =
        window.adsbygoogle ||
        []
    ).push({});


  } catch (
    error
  ) {

    console.error(
      "Boztik Deliver: AdSense failed to load:",
      error
    );

  }

}


/* =========================================================
   EXPLORE MORE PANEL
========================================================= */

/*
  Toggles the secondary/promotional content (services, the
  Creative Toolkit promo, and the ad slot) between a collapsed
  and expanded state. The panel's own visibility (shown only for
  an active delivery) is already handled by state() via
  els.explore.hidden — this only wires the open/close interaction.
*/

function setupExplorePanel() {

  const toggle =
    els.explore;

  const panel =
    els.explorePanel;


  if (
    !toggle ||
    !panel
  ) {

    return;

  }


  const label =
    toggle.querySelector(
      ".deliver-explore-toggle-label"
    );


  toggle.addEventListener(
    "click",
    () => {

      const nextOpen =
        toggle.getAttribute(
          "aria-expanded"
        ) !== "true";


      toggle.setAttribute(
        "aria-expanded",
        String(nextOpen)
      );


      panel.classList.toggle(
        "is-open",
        nextOpen
      );


      if (label) {

        label.textContent =
          nextOpen
            ? "Show Less"
            : "Explore More";

      }


      /*
        Lazy-load the AdSense slot the first time the panel is
        opened, since it lives inside this panel and starts
        visually collapsed (see the CSS grid-rows collapse).
        loadAd() is already idempotent via the adLoaded flag.
      */

      if (nextOpen) {

        loadAd();

      }

    }
  );

}


setupExplorePanel();
/* =========================================================
   FULL RESOLUTION IMAGE VIEWER
========================================================= */

let fullResolutionViewer =
  null;

let fullResolutionImage =
  null;

let fullResolutionTitle =
  null;

let fullResolutionLoading =
  null;

let fullResolutionError =
  null;

let fullResolutionRetry =
  null;

let fullResolutionDownload =
  null;

let fullResolutionClose =
  null;

let activeViewerFile =
  null;

let activeViewerTrigger =
  null;


/* =========================================================
   CREATE FULL RESOLUTION VIEWER
========================================================= */

function createFullResolutionViewer() {

  /*
    Only create the viewer once.

    Keeping a single dialog in the DOM prevents duplicate
    modals from being created every time a client clicks
    "View Full Resolution".
  */

  if (
    fullResolutionViewer
  ) {

    return;

  }


  fullResolutionViewer =
    document.createElement(
      "dialog"
    );


  fullResolutionViewer.className =
    "deliver-full-resolution-viewer";


  fullResolutionViewer.setAttribute(
    "aria-label",
    "Full resolution image viewer"
  );


  fullResolutionViewer.innerHTML = `

    <div
      class="deliver-viewer-shell"
    >

      <header
        class="deliver-viewer-header"
      >

        <div
          class="deliver-viewer-title-wrap"
        >

          <span
            class="deliver-viewer-eyebrow"
          >
            FULL RESOLUTION
          </span>


          <strong
            class="deliver-viewer-title"
          >
          </strong>

        </div>


        <button
          type="button"
          class="deliver-viewer-close"
          aria-label="Close full resolution viewer"
        >

          <span
            aria-hidden="true"
          >
            ×
          </span>

        </button>

      </header>


      <main
        class="deliver-viewer-stage"
      >

        <div
          class="deliver-viewer-loading"
          role="status"
          aria-live="polite"
        >

          <span
            class="deliver-viewer-spinner"
            aria-hidden="true"
          >
          </span>


          <span>
            Loading full-resolution image…
          </span>

        </div>


        <img
          class="deliver-viewer-image"
          alt=""
          hidden
        />


        <div
          class="deliver-viewer-error"
          hidden
        >

          <div
            class="deliver-viewer-error-icon"
            aria-hidden="true"
          >
            !
          </div>


          <strong>
            Unable to load the image
          </strong>


          <span>
            The original file is still available
            for download.
          </span>


          <button
            type="button"
            class="deliver-viewer-retry"
          >
            Try Again
          </button>

        </div>

      </main>


      <footer
        class="deliver-viewer-footer"
      >

        <div
          class="deliver-viewer-footer-info"
        >

          <span>
            Full-resolution preview
          </span>

        </div>


        <button
          type="button"
          class="deliver-viewer-download"
        >

          <span
            aria-hidden="true"
          >
            ↓
          </span>

          <span>
            Download
          </span>

        </button>

      </footer>

    </div>

  `;


  document.body.appendChild(
    fullResolutionViewer
  );


  /*
    Cache the elements.
  */

  fullResolutionImage =
    fullResolutionViewer.querySelector(
      ".deliver-viewer-image"
    );


  fullResolutionTitle =
    fullResolutionViewer.querySelector(
      ".deliver-viewer-title"
    );


  fullResolutionLoading =
    fullResolutionViewer.querySelector(
      ".deliver-viewer-loading"
    );


  fullResolutionError =
    fullResolutionViewer.querySelector(
      ".deliver-viewer-error"
    );


  fullResolutionRetry =
    fullResolutionViewer.querySelector(
      ".deliver-viewer-retry"
    );


  fullResolutionDownload =
    fullResolutionViewer.querySelector(
      ".deliver-viewer-download"
    );


  fullResolutionClose =
    fullResolutionViewer.querySelector(
      ".deliver-viewer-close"
    );


  /* =======================================================
     CLOSE BUTTON
  ======================================================= */

  fullResolutionClose?.addEventListener(
    "click",
    () => {

      closeFullResolutionViewer();

    }
  );


  /* =======================================================
     RETRY BUTTON
  ======================================================= */

  fullResolutionRetry?.addEventListener(
    "click",
    () => {

      if (
        activeViewerFile
      ) {

        loadFullResolutionImage(
          activeViewerFile,
          true
        );

      }

    }
  );


  /* =======================================================
     DOWNLOAD BUTTON
  ======================================================= */

  fullResolutionDownload?.addEventListener(
    "click",
    () => {

      if (
        activeViewerFile
      ) {

        download(
          activeViewerFile,
          fullResolutionDownload
        );

      }

    }
  );


  /* =======================================================
     IMAGE LOAD SUCCESS
  ======================================================= */

  fullResolutionImage?.addEventListener(
    "load",
    () => {

      /*
        Make sure the viewer is still showing an
        active image.
      */

      if (
        !activeViewerFile
      ) {

        return;

      }


      if (
        fullResolutionLoading
      ) {

        fullResolutionLoading.hidden =
          true;

      }


      if (
        fullResolutionError
      ) {

        fullResolutionError.hidden =
          true;

      }


      if (
        fullResolutionImage
      ) {

        fullResolutionImage.hidden =
          false;

      }

    }
  );


  /* =======================================================
     IMAGE LOAD FAILURE
  ======================================================= */

  fullResolutionImage?.addEventListener(
    "error",
    () => {

      console.error(
        "[Boztik Deliver] Full-resolution image failed:",
        activeViewerFile?.file_name
      );


      if (
        fullResolutionLoading
      ) {

        fullResolutionLoading.hidden =
          true;

      }


      if (
        fullResolutionImage
      ) {

        fullResolutionImage.hidden =
          true;

      }


      if (
        fullResolutionError
      ) {

        fullResolutionError.hidden =
          false;

      }

    }
  );


  /* =======================================================
     BACKDROP CLICK
  ======================================================= */

  fullResolutionViewer.addEventListener(
    "click",
    event => {

      if (
        event.target ===
        fullResolutionViewer
      ) {

        closeFullResolutionViewer();

      }

    }
  );


  /* =======================================================
     ESCAPE KEY
  ======================================================= */

  fullResolutionViewer.addEventListener(
    "cancel",
    event => {

      event.preventDefault();

      closeFullResolutionViewer();

    }
  );


  /* =======================================================
     CLEANUP WHEN CLOSED
  ======================================================= */

  fullResolutionViewer.addEventListener(
    "close",
    () => {

      if (
        fullResolutionImage
      ) {

        fullResolutionImage.removeAttribute(
          "src"
        );

        fullResolutionImage.hidden =
          true;

      }


      activeViewerFile =
        null;


      /*
        Return keyboard focus to the button that
        opened the viewer.
      */

      if (
        activeViewerTrigger
      ) {

        try {

          activeViewerTrigger.focus();

        } catch {

          /*
            Focus restoration is non-critical.
          */

        }

      }


      activeViewerTrigger =
        null;

    }
  );

}


/* =========================================================
   LOAD FULL RESOLUTION IMAGE
========================================================= */

async function loadFullResolutionImage(
  file,
  forceRefresh = false
) {

  createFullResolutionViewer();


  activeViewerFile =
    file;


  /*
    Reset viewer state.
  */

  if (
    fullResolutionLoading
  ) {

    fullResolutionLoading.hidden =
      false;

  }


  if (
    fullResolutionError
  ) {

    fullResolutionError.hidden =
      true;

  }


  if (
    fullResolutionImage
  ) {

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


  try {

    /*
      Get a fresh or cached signed preview URL.
    */

    const url =
      await getPreviewUrl(
        file,
        forceRefresh
      );


    /*
      The user may have clicked another file while
      this request was running.

      Do not apply an old URL to the new viewer.
    */

    if (
      activeViewerFile !==
      file
    ) {

      return;

    }


    if (
      !fullResolutionImage
    ) {

      throw new Error(
        "Full-resolution image viewer is unavailable."
      );

    }


    /*
      Set src only after the viewer and image element
      already exist.
    */

    fullResolutionImage.src =
      url;


  } catch (
    error
  ) {

    console.error(
      "[Boztik Deliver] Full-resolution preview request failed:",
      error
    );


    if (
      fullResolutionLoading
    ) {

      fullResolutionLoading.hidden =
        true;

    }


    if (
      fullResolutionError
    ) {

      fullResolutionError.hidden =
        false;

    }

  }

}


/* =========================================================
   OPEN FULL RESOLUTION VIEWER
========================================================= */

function openFullResolutionViewer(
  file,
  trigger = null
) {

  createFullResolutionViewer();


  activeViewerFile =
    file;


  activeViewerTrigger =
    trigger ||
    document.activeElement ||
    null;


  if (
    fullResolutionTitle
  ) {

    fullResolutionTitle.textContent =
      file.file_name ||
      "Image";

  }


  /*
    Reset the viewer before opening.
  */

  if (
    fullResolutionLoading
  ) {

    fullResolutionLoading.hidden =
      false;

  }


  if (
    fullResolutionError
  ) {

    fullResolutionError.hidden =
      true;

  }


  if (
    fullResolutionImage
  ) {

    fullResolutionImage.hidden =
      true;

    fullResolutionImage.removeAttribute(
      "src"
    );

  }


  if (
    !fullResolutionViewer.open
  ) {

    fullResolutionViewer.showModal();

  }


  loadFullResolutionImage(
    file
  );

}


/* =========================================================
   CLOSE FULL RESOLUTION VIEWER
========================================================= */

function closeFullResolutionViewer() {

  if (
    fullResolutionViewer &&
    fullResolutionViewer.open
  ) {

    fullResolutionViewer.close();

  }

}


/* =========================================================
   PREVIEW FALLBACK
========================================================= */

function buildPreviewFallbackHTML(
  file
) {

  const extension =
    getFileExtension(
      file?.file_name
    );


  return `

    <div
      class="deliver-preview-fallback"
    >

      <div
        class="deliver-preview-fallback-icon"
        aria-hidden="true"
      >
        !
      </div>


      <strong>
        Preview unavailable
      </strong>


      <span>
        Your original file is still
        available to download.
      </span>


      <small>
        ${escapeHTML(extension)}
      </small>

    </div>

  `;

}


/* =========================================================
   LOAD IMAGE PREVIEW
========================================================= */

async function loadImagePreview(
  file,
  previewContainer
) {

  if (
    !file ||
    !previewContainer
  ) {

    return;

  }


  try {

    /*
      Obtain the signed URL.

      Because getPreviewUrl() uses the cache, the
      file-information system can reuse this URL.
    */

    const url =
      await getPreviewUrl(
        file
      );


    /*
      Create a button around the image.

      Clicking the preview opens the full-resolution
      viewer instead of navigating the client away
      from the delivery page.
    */

    const previewButton =
      document.createElement(
        "button"
      );


    previewButton.type =
      "button";


    previewButton.className =
      "deliver-preview-button";


    previewButton.setAttribute(
      "aria-label",
      `View ${
        file.file_name || "image"
      } in full resolution`
    );


    /*
      Create the actual image element.
    */

    const image =
      document.createElement(
        "img"
      );


    image.className =
      "deliver-preview-image";


    image.alt =
      `Preview of ${
        file.file_name || "image"
      }`;


    /*
      These are the primary images on the delivery
      page, so eager loading is preferable to lazy
      loading.
    */

    image.loading =
      "eager";


    image.decoding =
      "async";


    image.draggable =
      false;


    /*
      Insert the image into the button first.
    */

    previewButton.appendChild(
      image
    );


    /*
      Replace the temporary loading state.
    */

    previewContainer.innerHTML =
      "";


    previewContainer.appendChild(
      previewButton
    );


    /*
      Mark the container as currently loading.
    */

    previewContainer.classList.add(
      "preview-loading"
    );


    previewContainer.classList.remove(
      "preview-loaded"
    );


    previewContainer.classList.remove(
      "preview-error"
    );


    /* =====================================================
       IMAGE SUCCESS
    ===================================================== */

    image.addEventListener(
      "load",
      () => {

        console.log(
          "[Boztik Deliver] Preview loaded:",
          file.file_name
        );


        previewContainer.classList.remove(
          "preview-loading"
        );


        previewContainer.classList.remove(
          "preview-error"
        );


        previewContainer.classList.add(
          "preview-loaded"
        );


        /*
          Give the browser one animation frame before
          showing the final image. This allows CSS
          transitions to work smoothly.
        */

        requestAnimationFrame(
          () => {

            image.classList.add(
              "is-loaded"
            );

          }
        );

      },
      {
        once: true
      }
    );


    /* =====================================================
       IMAGE FAILURE
    ===================================================== */

    image.addEventListener(
      "error",
      async () => {

        console.warn(
          "[Boztik Deliver] Preview failed. Requesting fresh signed URL:",
          file.file_name
        );


        /*
          Remove the cached URL because the browser
          rejected it.
        */

        invalidatePreviewUrl(
          file
        );


        try {

          const freshUrl =
            await getPreviewUrl(
              file,
              true
            );


          /*
            Make sure the preview container is still
            attached to the page.
          */

          if (
            !previewContainer.isConnected
          ) {

            return;

          }


          /*
            Reset state.
          */

          previewContainer.classList.remove(
            "preview-error"
          );


          previewContainer.classList.add(
            "preview-loading"
          );


          /*
            Retry with the new signed URL.
          */

          image.src =
            freshUrl;


        } catch (
          retryError
        ) {

          console.error(
            "[Boztik Deliver] Preview retry failed:",
            file.file_name,
            retryError
          );


          previewContainer.classList.remove(
            "preview-loading"
          );


          previewContainer.classList.add(
            "preview-error"
          );


          previewContainer.innerHTML =
            buildPreviewFallbackHTML(
              file
            );

        }

      },
      {
        once: true
      }
    );


    /* =====================================================
       OPEN FULL RESOLUTION
    ===================================================== */

    previewButton.addEventListener(
      "click",
      () => {

        openFullResolutionViewer(
          file,
          previewButton
        );

      }
    );


    /*
      IMPORTANT:
      Set the image source only after the image has
      already been placed into the DOM.
    */

    image.src =
      url;


  } catch (
    error
  ) {

    console.error(
      "[Boztik Deliver] Could not prepare preview:",
      file.file_name,
      error
    );


    previewContainer.classList.remove(
      "preview-loading"
    );


    previewContainer.classList.add(
      "preview-error"
    );


    previewContainer.innerHTML =
      buildPreviewFallbackHTML(
        file
      );

  }

}


/* =========================================================
   BUILD FILE CARD
========================================================= */

function buildFileCardHTML(
  file,
  index
) {

  const previewable =
    isPreviewable(
      file.file_name
    );


  const extension =
    getFileExtension(
      file.file_name
    );


  const safeFileName =
    escapeHTML(
      file.file_name
    );


  const safeExtension =
    escapeHTML(
      extension
    );


  const safeSize =
    escapeHTML(
      formatBytes(
        file.file_size
      )
    );


  return `

    <article
      class="deliver-file-card"
      data-file-card="${index}"
    >

      ${
        previewable

          ? `

            <div
              class="deliver-file-preview"
              data-preview="${index}"
            >

              <div
                class="deliver-preview-loading"
              >

                <span
                  class="deliver-preview-spinner"
                  aria-hidden="true"
                >
                </span>


                <span>
                  Loading preview…
                </span>

              </div>

            </div>

          `

          : `

            <div
              class="deliver-file-preview deliver-file-preview-generic"
            >

              <div
                class="deliver-file-icon"
                aria-hidden="true"
              >

                <span>
                  ${safeExtension}
                </span>

              </div>

            </div>

          `
      }


      <div
        class="deliver-file-content"
      >

        <div
          class="deliver-file-heading"
        >

          <span
            class="deliver-file-eyebrow"
          >
            DELIVERED FILE
          </span>


          <strong
            class="deliver-file-name"
            title="${safeFileName}"
          >
            ${safeFileName}
          </strong>


          <div
            class="deliver-file-basic-meta"
          >

            <span>
              ${safeSize}
            </span>


            <span
              aria-hidden="true"
            >
              •
            </span>


            <span>
              ${safeExtension}
            </span>

          </div>

        </div>


        <div
          class="fileinfo-slot"
          data-info="${index}"
        >

          <div
            class="deliver-fileinfo-loading"
          >
            Preparing file details…
          </div>

        </div>


        <div
          class="deliver-file-actions"
        >

          ${
            previewable

              ? `

                <button
                  type="button"
                  class="deliver-file-view"
                  data-view="${index}"
                  aria-label="View ${safeFileName} in full resolution"
                >

                  <span
                    class="deliver-button-icon"
                    aria-hidden="true"
                  >

                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >

                      <path
                        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linejoin="round"
                      />

                      <circle
                        cx="12"
                        cy="12"
                        r="2.75"
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
            type="button"
            class="deliver-file-download"
            data-download="${index}"
            aria-label="Download ${safeFileName}"
          >

            <span
              class="deliver-button-icon"
              aria-hidden="true"
            >

              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
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


/* =========================================================
   RENDER FILES
========================================================= */

function renderFiles(
  files
) {

  if (
    !els.gallery
  ) {

    console.error(
      "[Boztik Deliver] Gallery element not found."
    );


    return;

  }


  /*
    A new delivery render starts with a clean preview cache.
  */

  previewUrlCache.clear();


  if (
    !Array.isArray(files) ||
    files.length === 0
  ) {

    els.gallery.innerHTML = `

      <div
        class="deliver-empty-files"
      >

        <strong>
          No files are available.
        </strong>


        <span>
          Please contact me if you believe
          something is missing.
        </span>

      </div>

    `;


    return;

  }


  /*
    Render all file cards immediately.

    Preview images and metadata are loaded independently
    afterwards.

    This is important because a slow image must never make
    the entire delivery page appear to be stuck loading.
  */

  els.gallery.innerHTML =
    files
      .map(
        (file, index) =>
          buildFileCardHTML(
            file,
            index
          )
      )
      .join("");


  /*
    A single delivered file gets the large "hero" preview
    treatment instead of the compact multi-file grid card.
  */

  els.gallery.classList.toggle(
    "single-file",
    files.length === 1
  );


  /* =======================================================
     DOWNLOAD BUTTONS
  ======================================================= */

  els.gallery
    .querySelectorAll(
      "[data-download]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const index =
              Number(
                button.dataset.download
              );


            const file =
              files[index];


            if (
              !file
            ) {

              return;

            }


            download(
              file,
              button
            );

          }
        );

      }
    );


  /* =======================================================
     VIEW FULL RESOLUTION BUTTONS
  ======================================================= */

  els.gallery
    .querySelectorAll(
      "[data-view]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const index =
              Number(
                button.dataset.view
              );


            const file =
              files[index];


            if (
              !file
            ) {

              return;

            }


            openFullResolutionViewer(
              file,
              button
            );

          }
        );

      }
    );


  /* =======================================================
     IMAGE PREVIEWS
  ======================================================= */

  els.gallery
    .querySelectorAll(
      "[data-preview]"
    )
    .forEach(
      previewContainer => {

        const index =
          Number(
            previewContainer.dataset.preview
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


        /*
          Fire and forget.

          loadImagePreview() catches its own errors,
          so a preview problem cannot break the delivery.
        */

        loadImagePreview(
          file,
          previewContainer
        );

      }
    );


  /* =======================================================
     FILE INFORMATION
  ======================================================= */

  els.gallery
    .querySelectorAll(
      "[data-info]"
    )
    .forEach(
      slot => {

        const index =
          Number(
            slot.dataset.info
          );


        const file =
          files[index];


        if (
          !file
        ) {

          return;

        }


        renderFileInfo(
          file,
          slot
        );

      }
    );

}


/* =========================================================
   FILE INFORMATION
========================================================= */

async function renderFileInfo(
  file,
  slot
) {

  if (
    !file ||
    !slot
  ) {

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


  const imageFile =
    isPreviewable(
      file.file_name
    );


  try {

    /* =====================================================
       IMAGE INFORMATION
    ===================================================== */

    if (
      imageFile
    ) {

      /*
        IMPORTANT:

        Reuse the same signed preview URL that the
        visual preview uses.

        This is one of the main changes from the old
        implementation.
      */

      const url =
        await getPreviewUrl(
          file
        );


      const dimensions =
        await getImageDimensions(
          url
        );


      let exif =
        null;


      /*
        EXIF is optional.

        If it fails, the image information still
        displays normally.
      */

      if (
        mimeType ===
        "image/jpeg"
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

        } catch (
          exifError
        ) {

          console.warn(
            "[Boztik Deliver] EXIF unavailable:",
            file.file_name,
            exifError
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
            dimensions.width,

          height:
            dimensions.height,

          exif

        });


      return;

    }


    /* =====================================================
       GENERIC FILE INFORMATION
    ===================================================== */

    let pageCount =
      null;


    /*
      PDFs get a best-effort page count.
    */

    if (
      file.file_name
        ?.toLowerCase()
        .endsWith(
          ".pdf"
        )
    ) {

      try {

        const url =
          await getPreviewUrl(
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

      } catch (
        pdfError
      ) {

        console.warn(
          "[Boztik Deliver] PDF page count unavailable:",
          file.file_name,
          pdfError
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


  } catch (
    error
  ) {

    /*
      File metadata is non-critical.

      Never allow metadata failure to cause the
      entire delivery page to fail.
    */

    console.warn(
      "[Boztik Deliver] File information could not be loaded:",
      file.file_name,
      error
    );


    slot.innerHTML = `

      <div
        class="deliver-fileinfo-fallback"
      >

        <span>
          File information
        </span>


        <strong>
          ${escapeHTML(
            format
          )}
          ·
          ${escapeHTML(
            sizeLabel
          )}
        </strong>

      </div>

    `;

  }

}
/* =========================================================
   COUNTDOWN
========================================================= */

function updateCountdown() {

  /*
    Do nothing if the delivery has not been loaded yet.

    This prevents the countdown from throwing an error
    during the initial page load.
  */

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


  if (
    value.expired
  ) {

    /*
      Stop the timer immediately.

      The delivery is no longer available and the
      client should see the expiry state.
    */

    if (
      timer
    ) {

      clearInterval(
        timer
      );

      timer =
        null;

    }


    state(
      "expired"
    );


    return;

  }


  if (
    els.count
  ) {

    els.count.textContent =
      value.label;

  }

}


/* =========================================================
   DOWNLOAD
========================================================= */

function triggerFileSave(
  url,
  fileName
) {

  /*
    Use a temporary anchor so the browser handles
    the signed Supabase URL as a download.

    The anchor is removed immediately afterwards.
  */

  const a =
    document.createElement(
      "a"
    );


  a.href =
    url;


  a.download =
    fileName ||
    "download";


  a.rel =
    "noopener";


  a.style.display =
    "none";


  document.body.appendChild(
    a
  );


  a.click();


  a.remove();


  toast(
    "Download started."
  );

}


/* =========================================================
   DOWNLOAD SINGLE FILE
========================================================= */

async function download(
  file,
  button
) {

  /*
    Do not allow the same button to be clicked twice
    while a signed download URL is being generated.
  */

  if (
    button?.disabled
  ) {

    return;

  }


  const originalHTML =
    button?.innerHTML;


  const originalText =
    button?.textContent;


  if (
    button
  ) {

    button.disabled =
      true;


    /*
      Preserve the button's icon by changing only the
      visible text when possible.

      If the button has a more complex structure,
      temporarily show a simple preparing state.
    */

    button.setAttribute(
      "aria-busy",
      "true"
    );


    const label =
      button.querySelector(
        "span:last-child"
      );


    if (
      label
    ) {

      label.textContent =
        "Preparing…";

    } else {

      button.textContent =
        "Preparing…";

    }

  }


  try {

    /*
      Never attempt a download without a valid file.
    */

    if (
      !file ||
      !file.file_path
    ) {

      throw new Error(
        "This file does not have a valid download path."
      );

    }


    /*
      Get the secure, short-lived download URL.

      The original file remains protected in storage;
      the client only receives the signed URL needed
      for this download.
    */

    const url =
      await signedDownload(
        file
      );


    if (
      !url ||
      typeof url !== "string"
    ) {

      throw new Error(
        "The server returned an invalid download URL."
      );

    }


    console.log(
      "[Boztik Deliver] Download URL obtained:",
      file.file_name
    );


    /* =====================================================
       RECORD DOWNLOAD ANALYTICS
    ===================================================== */

    /*
      Analytics are deliberately fire-and-forget.

      If the analytics request fails, the client must
      still receive the file.
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


    /* =====================================================
       OPTIONAL SUPPORT MESSAGE
    ===================================================== */

    /*
      The support message is shown only after the
      secure download URL has already been generated.

      Therefore it cannot interfere with:
      
      - expiry validation
      - file access
      - signed URL generation
      - download errors
    */

    triggerFileSave(
      url,
      file.file_name
    );

    /*
      Keep the delivery action focused. Support remains available below the
      files, but never interrupts or competes with a client's download.
    */

    return true;


  } catch (
    error
  ) {

    console.error(
      "[Boztik Deliver] Download failed:",
      file?.file_name,
      error
    );


    /*
      Do not expose raw Supabase/database errors to
      the client.

      The developer console retains the technical error.
    */

    toast(
      "The download could not be prepared. Please refresh and try again.",
      "error"
    );

    return false;


  } finally {

    if (
      button
    ) {

      button.disabled =
        false;


      button.removeAttribute(
        "aria-busy"
      );


      /*
        Restore the original button structure.

        This is safer than trying to reconstruct an SVG
        or other markup manually.
      */

      if (
        originalHTML !== undefined
      ) {

        button.innerHTML =
          originalHTML;

      } else if (
        originalText !== undefined
      ) {

        button.textContent =
          originalText;

      }

    }

  }

}


/* =========================================================
   INITIALIZE CLIENT DELIVERY
========================================================= */

async function init() {

  /*
    The delivery ID is supplied in the URL:

      client.html?id=BZ-XXXXXXXX

    Normalize it once.
  */

  const id =
    new URLSearchParams(
      location.search
    )
      .get(
        "id"
      )
      ?.trim()
      .toUpperCase();


  /*
    Invalid IDs should behave exactly like an unavailable
    delivery.

    Do not expose internal database information.
  */

  if (
    !id ||
    !/^BZ-[A-Z2-9-]+$/.test(
      id
    )
  ) {

    state(
      "expired"
    );


    return;

  }


  try {

    /*
      Ask the API layer for the public delivery.

      This is the only request that determines whether
      the delivery itself exists.
    */

    delivery =
      await getPublicDelivery(
        id
      );


    /*
      If the API returned nothing, treat the delivery
      as unavailable.
    */

    if (
      !delivery
    ) {

      state(
        "expired"
      );


      return;

    }


    /*
      IMPORTANT:

      Check expiry immediately after retrieving the
      delivery.

      Do not render client content or attempt preview
      requests for an expired delivery.
    */

    const expiry =
      countdown(
        delivery.expires_at
      );


    if (
      expiry.expired
    ) {

      state(
        "expired"
      );


      return;

    }


    /* =====================================================
       DELIVERY HEADER
    ===================================================== */

    if (
      els.title
    ) {

      els.title.textContent =
        delivery.project_name ||
        "Your delivery";

    }


    if (
      els.projectNameDisplay
    ) {

      els.projectNameDisplay.textContent =
        delivery.project_name ||
        "-";

    }


    if (
      els.client
    ) {

      els.client.textContent =
        delivery.client_name
          ? `Prepared for ${delivery.client_name}`
          : "";

    }


    if (
      els.id
    ) {

      els.id.textContent =
        delivery.id;

    }


    if (
      els.size
    ) {

      els.size.textContent =
        formatBytes(
          delivery.file_size
        );

    }


    if (
      els.date
    ) {

      els.date.textContent =
        formatDate(
          delivery.created_at
        );

    }


    /* =====================================================
       EXPIRY DATE
    ===================================================== */

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


    /* =====================================================
       CLIENT NOTES
    ===================================================== */

    if (
      els.notes &&
      els.notesWrap
    ) {

      if (
        delivery.notes
      ) {

        els.notes.textContent =
          delivery.notes;


        els.notesWrap.hidden =
          false;

      } else {

        els.notes.textContent =
          "";


        els.notesWrap.hidden =
          true;

      }

    }


    /* =====================================================
       ORIGINAL SOURCE (Reddit)
       Only rendered when this delivery has reddit_source attached.
       Never shown, and never affects anything else on the page,
       when it's absent (the normal case).
    ===================================================== */

    if (
      els.sourceWrap
    ) {

      const source =
        delivery.reddit_source;

      const canonicalUrl =
        source?.canonicalUrl ||
        source?.url ||
        "";

      const isSafeHttpUrl =
        /^https?:\/\//i.test(
          canonicalUrl
        );

      if (
        source &&
        isSafeHttpUrl
      ) {

        if (els.sourceSub) {
          els.sourceSub.textContent =
            source.subreddit
              ? `r/${source.subreddit}`
              : "Reddit";
        }

        if (els.sourceAuthor) {
          els.sourceAuthor.textContent =
            source.author
              ? `Posted by u/${source.author}`
              : "";

          els.sourceAuthor.hidden =
            !source.author;
        }

        if (els.sourceTitle) {
          els.sourceTitle.textContent =
            source.title || "";

          els.sourceTitle.hidden =
            !source.title;
        }

        if (els.sourceLink) {
          els.sourceLink.href =
            canonicalUrl;
        }

        els.sourceWrap.hidden =
          false;

      } else {

        els.sourceWrap.hidden =
          true;

      }

    }


    /* =====================================================
       RECORD DELIVERY VIEW
    ===================================================== */

    /*
      Analytics must NEVER block the delivery.

      The client can receive their files even if the
      analytics endpoint is unavailable.

      Admin previews opened from the Command Centre (see
      isAdminPreview above) are skipped entirely so they never
      reach the database — this is not just hidden in the UI,
      the view_count / delivery_analytics rows are never touched
      for these opens.
    */

    if (
      delivery.id &&
      !isAdminPreview
    ) {

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

    }


    /* =====================================================
       BUILD FILE LIST
    ===================================================== */

    /*
      Newer deliveries can contain multiple files in
      delivery_files.

      Older deliveries may still use the original
      single-file columns.

      Support both structures.
    */

    const files =
      Array.isArray(
        delivery.delivery_files
      ) &&
      delivery.delivery_files.length
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
                delivery.file_size,

              file_type:
                delivery.file_type ||
                null
            }
          ];


    /*
      Filter out malformed records.

      A single bad row should not destroy the entire
      delivery page.
    */

    const validFiles =
      files.filter(
        file =>
          file &&
          file.file_path &&
          file.file_name
      );


    if (
      validFiles.length === 0
    ) {

      throw new Error(
        "No downloadable files were found for this delivery."
      );

    }


    /* =====================================================
       RENDER FILES
    ===================================================== */

    /*
      IMPORTANT:

      renderFiles() does not wait for previews.

      This means the delivery itself becomes interactive
      immediately while individual previews load in the
      background.
    */

    renderFiles(
      validFiles
    );


    /* =====================================================
       DOWNLOAD ALL FILES
    ===================================================== */

    if (
      els.all
    ) {

      /*
        Prevent duplicate listeners if init() is ever
        accidentally called more than once.
      */

      if (
        els.all.dataset.bound !== "true"
      ) {

        els.all.dataset.bound =
          "true";


        els.all.addEventListener(
          "click",
          async () => {

            if (
              els.all.disabled
            ) {

              return;

            }


            /*
              Re-check expiry immediately before starting
              a bulk download.
            */

            const currentExpiry =
              countdown(
                delivery.expires_at
              );


            if (
              currentExpiry.expired
            ) {

              updateCountdown();


              return;

            }


            els.all.disabled =
              true;


            els.all.setAttribute(
              "aria-busy",
              "true"
            );


            const originalHTML =
              els.all.innerHTML;


            /*
              Preserve the button icon and change the
              visible label where possible.
            */

            const label =
              els.all.querySelector(
                "span:last-child"
              );


            if (
              label
            ) {

              label.textContent =
                "Preparing…";

            } else {

              els.all.textContent =
                "Preparing…";

            }


            try {

              /*
                Download sequentially.

                Sequential downloads are intentional:
                they reduce the chance of browsers blocking
                multiple simultaneous downloads.
              */

              let succeeded = 0;

              for (
                const file of validFiles
              ) {

                const downloaded = await download(
                  file
                );

                if (downloaded) {
                  succeeded += 1;
                }

              }

              if (succeeded === validFiles.length) {
                toast(`Preparing ${succeeded} file${succeeded === 1 ? "" : "s"} for download.`);
              } else if (succeeded > 0) {
                toast(`${succeeded} of ${validFiles.length} files were prepared. Please retry the remaining files individually.`, "error");
              }


            } catch (
              error
            ) {

              /*
                Individual download() calls already handle
                their own failures.

                Keep this as a final safety net.
              */

              console.error(
                "[Boztik Deliver] Download-all failed:",
                error
              );


              toast(
                "Some files could not be downloaded. Please try them individually.",
                "error"
              );


            } finally {

              els.all.disabled =
                false;


              els.all.removeAttribute(
                "aria-busy"
              );


              /*
                Restore the original button markup.
              */

              els.all.innerHTML =
                originalHTML;

            }

          }
        );

      }

    }


    /* =====================================================
       COUNTDOWN
    ===================================================== */

    updateCountdown();


    /*
      Update every 30 seconds.

      The countdown function itself determines whether
      the delivery has expired.
    */

    if (
      timer
    ) {

      clearInterval(
        timer
      );

    }


    timer =
      setInterval(
        updateCountdown,
        30000
      );


    /* =====================================================
       DELIVERY IS READY
    ===================================================== */

    initializationComplete =
      true;


    state(
      "active"
    );


  } catch (
    error
  ) {

    console.error(
      "[Boztik Deliver] Client initialization failed:",
      error
    );


    /*
      Only initialization failures reach the full-page
      error state.

      Individual preview failures, metadata failures,
      analytics failures, and download failures are
      handled independently.
    */

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

  /*
    Do not reveal sensitive backend information to the
    client.

    The browser console retains the detailed error for
    debugging.
  */

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
   SAFETY NET — UNCAUGHT JAVASCRIPT ERRORS
========================================================= */

window.addEventListener(
  "error",
  event => {

    console.error(
      "[Boztik Deliver] Uncaught error:",
      event.error ||
        event.message
    );


    /*
      IMPORTANT:

      Only show the full-page error if the delivery is
      still in its initial loading state.

      Once the delivery is active, a random UI error,
      image error, browser extension error, or other
      non-critical exception should NOT replace the
      working delivery page with an error screen.
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
              event.message ||
              "Unknown script error"
            )
        }
      );

    }

  }
);

document.querySelector("[data-delivery-retry]")?.addEventListener("click", () => location.reload());


/* =========================================================
   SAFETY NET — UNHANDLED PROMISE REJECTIONS
========================================================= */

window.addEventListener(
  "unhandledrejection",
  event => {

    console.error(
      "[Boztik Deliver] Unhandled promise rejection:",
      event.reason
    );


    /*
      Again, do NOT destroy an already-working delivery
      because some unrelated promise failed.

      Only initialization failures before the delivery
      becomes active should use the full-page error state.
    */

    if (
      els.loading &&
      !els.loading.hidden &&
      !initializationComplete
    ) {

      showError(
        event.reason || {
          message:
            "Unknown unhandled rejection"
        }
      );

    }

  }
);


/* =========================================================
   PAGE CLEANUP
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    /*
      Stop the countdown timer when the page is
      being unloaded.
    */

    if (
      timer
    ) {

      clearInterval(
        timer
      );


      timer =
        null;

    }


    /*
      Remove the temporary full-resolution image URL
      reference from the DOM.

      The signed URL itself will naturally expire.
    */

    if (
      fullResolutionImage
    ) {

      fullResolutionImage.removeAttribute(
        "src"
      );

    }

  }
);


/* =========================================================
   START DELIVERY
========================================================= */

init();
