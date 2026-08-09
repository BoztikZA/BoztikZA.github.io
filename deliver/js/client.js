import { countdown, formatBytes, formatDate, toast, guessMimeType, isPreviewable } from "./shared.js";
import { getPublicDelivery, recordDownload, signedDownload, signedPreview } from "./api.js";
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
  client: $("deliver-client-name"),
  id: $("deliver-id-value"),
  size: $("deliver-file-size"),
  date: $("deliver-upload-date"),
  notes: $("deliver-notes"),
  notesWrap: $("deliver-notes-wrap"),
  count: $("deliver-countdown-label"),
  gallery: $("deliver-gallery"),
  all: $("deliver-download-all"),
  discover: $("deliver-discover"),
  explore: $("deliver-explore"),
  adSlot: $("deliver-adsense-slot")
};

let delivery;
let timer;

function state(name) {
  ["loading", "active", "expired", "error"].forEach(key => {
    if (els[key]) {
      els[key].hidden = key !== name;
    }
  });

  const showPromo = name === "active";

  if (els.discover) {
    els.discover.hidden = !showPromo;
  }

  if (els.explore) {
    els.explore.hidden = !showPromo;
  }

  if (els.adSlot) {
    els.adSlot.hidden = !showPromo;

    if (showPromo) {
      loadAd();
    }
  }
}

let adLoaded = false;

function loadAd() {
  if (adLoaded) return;

  adLoaded = true;

  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch (error) {
    console.error(
      "Boztik Deliver: AdSense failed to load:",
      error
    );
  }
}

function renderFiles(files) {
  els.gallery.innerHTML = files.map((file, index) => {
    const previewable = isPreviewable(file.file_name);

    return `
      <article class="deliver-file-card">
        ${
          previewable
            ? `
              <div
                class="deliver-file-preview"
                data-preview="${index}"
              >
                <span>Loading preview…</span>
              </div>
            `
            : `
              <div class="deliver-file-icon">
                ${file.file_name.split(".").pop().toUpperCase()}
              </div>
            `
        }

        <div>
          <strong>${file.file_name}</strong>
          <small>${formatBytes(file.file_size)}</small>
        </div>

        <div
          class="fileinfo-slot"
          data-info="${index}"
        ></div>

        <button
          type="button"
          data-download="${index}"
        >
          Download
        </button>
      </article>
    `;
  }).join("");

  /*
   * DOWNLOAD BUTTONS
   */
  els.gallery
    .querySelectorAll("[data-download]")
    .forEach(button => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.download);
        download(files[index], button);
      });
    });

  /*
   * IMAGE PREVIEWS
   */
  els.gallery
    .querySelectorAll("[data-preview]")
    .forEach(async preview => {
      const file = files[Number(preview.dataset.preview)];

      try {
        /*
         * IMPORTANT:
         * signedPreview() now expects ONLY the file object.
         */
        const url = await signedPreview(file);

        console.log(
          "[Boztik Deliver] Preview URL for",
          file.file_name,
          ":",
          url
        );

        const img = new Image();

        img.alt = `Preview of ${file.file_name}`;
        img.loading = "lazy";

        img.onload = () => {
          console.log(
            "[Boztik Deliver] Preview image loaded successfully:",
            file.file_name
          );
        };

        img.onerror = () => {
          console.error(
            "[Boztik Deliver] Preview image failed to load:",
            {
              fileName: file.file_name,
              url
            }
          );

          preview.innerHTML =
            "<span>Preview unavailable</span>";
        };

        img.src = url;

        const link = document.createElement("a");

        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        link.setAttribute(
          "aria-label",
          `Open larger preview of ${file.file_name}`
        );

        link.appendChild(img);

        preview.innerHTML = "";
        preview.appendChild(link);

      } catch (error) {
        console.error(
          "[Boztik Deliver] signedPreview() failed:",
          file.file_name,
          error
        );

        preview.innerHTML =
          "<span>Preview unavailable</span>";
      }
    });

  /*
   * FILE INFORMATION
   */
  els.gallery
    .querySelectorAll("[data-info]")
    .forEach(slot => {
      const index = Number(slot.dataset.info);

      renderFileInfo(
        files[index],
        slot
      );
    });
}

async function renderFileInfo(file, slot) {
  const sizeLabel = formatBytes(file.file_size);
  const mimeType = guessMimeType(file.file_name);
  const format = formatLabelFor(
    file.file_name,
    mimeType
  );

  const isImage = isPreviewable(
    file.file_name
  );

  try {
    if (isImage) {

      /*
       * IMPORTANT:
       * signedPreview() expects ONLY the file.
       */
      const url = await signedPreview(file);

      const dims = await getImageDimensions(url);

      let exif = null;

      if (mimeType === "image/jpeg") {
        try {
          const response = await fetch(url);
          const buffer = await response.arrayBuffer();

          exif = await parseExif(buffer);
        } catch {
          /*
           * EXIF is optional.
           */
        }
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

      if (
        file.file_name
          .toLowerCase()
          .endsWith(".pdf")
      ) {
        try {
          const url = await signedPreview(file);

          const response = await fetch(url);
          const buffer = await response.arrayBuffer();

          pageCount =
            await estimatePdfPageCount(buffer);

        } catch {
          /*
           * PDF page count is best effort.
           */
        }
      }

      slot.innerHTML = buildGenericInfoHTML({
        fileName: file.file_name,
        sizeLabel,
        format,
        mimeType,
        pageCount
      });
    }

  } catch {
    /*
     * File information is non-critical.
     */
  }
}

function updateCountdown() {
  const value = countdown(
    delivery.expires_at
  );

  if (value.expired) {
    clearInterval(timer);
    state("expired");
    return;
  }

  els.count.textContent = value.label;
}

async function download(file, button) {
  if (button?.disabled) {
    return;
  }

  const originalLabel =
    button?.textContent;

  if (button) {
    button.disabled = true;
    button.textContent = "Preparing…";
  }

  try {

    /*
     * IMPORTANT:
     * signedDownload() expects ONLY the file.
     */
    const url = await signedDownload(file);

    console.log(
      "[Boztik Deliver] Download URL obtained:",
      file.file_name
    );

    recordDownload(
      delivery.id
    ).catch(error => {
      console.error(
        "[Boztik Deliver] recordDownload failed:",
        error
      );
    });

    const a = document.createElement("a");

    a.href = url;
    a.download = file.file_name;

    document.body.appendChild(a);
    a.click();
    a.remove();

    toast("Download started.");

  } catch (error) {

    console.error(
      "[Boztik Deliver] Download failed:",
      file.file_name,
      error
    );

    toast(
      "The download could not be prepared. Please refresh and try again.",
      "error"
    );

  } finally {

    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

async function init() {
  const id =
    new URLSearchParams(location.search)
      .get("id")
      ?.trim()
      .toUpperCase();

  if (
    !id ||
    !/^BZ-[A-Z2-9-]+$/.test(id)
  ) {
    return state("expired");
  }

  try {

    delivery =
      await getPublicDelivery(id);

    if (!delivery) {
      return state("expired");
    }

    if (
      countdown(
        delivery.expires_at
      ).expired
    ) {
      return state("expired");
    }

    els.title.textContent =
      delivery.project_name ||
      "Your delivery";

    els.client.textContent =
      delivery.client_name
        ? `Prepared for ${delivery.client_name}`
        : "";

    els.id.textContent =
      delivery.id;

    els.size.textContent =
      formatBytes(
        delivery.file_size
      );

    els.date.textContent =
      formatDate(
        delivery.created_at
      );

    if (delivery.notes) {
      els.notes.textContent =
        delivery.notes;

      els.notesWrap.hidden = false;
    }

    /*
     * Make sure every fallback file has
     * the delivery ID as well as its path.
     */
    const files =
      delivery.delivery_files?.length
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

    /*
     * DOWNLOAD ALL
     */
    els.all.addEventListener(
      "click",
      async () => {

        if (els.all.disabled) {
          return;
        }

        els.all.disabled = true;

        const original =
          els.all.textContent;

        els.all.textContent =
          "Preparing…";

        try {

          for (const file of files) {
            await download(file);
          }

        } finally {

          els.all.disabled = false;
          els.all.textContent =
            original;
        }
      }
    );

    updateCountdown();

    timer =
      setInterval(
        updateCountdown,
        30000
      );

    state("active");

  } catch (error) {

    console.error(
      "Boztik Deliver client initialization failed:",
      error
    );

    showError(error);
  }
}

function showError(error) {
  if (els.errorDetail) {

    const parts = [];

    if (error?.message) {
      parts.push(error.message);
    }

    if (error?.code) {
      parts.push(
        `(code: ${error.code})`
      );
    }

    els.errorDetail.textContent =
      parts.length
        ? `Diagnostic: ${parts.join(" ")}`
        : "Diagnostic: no error details were available.";

    els.errorDetail.hidden = false;
  }

  state("error");
}

/*
 * Safety net for unexpected JavaScript errors.
 */
window.addEventListener(
  "error",
  event => {

    console.error(
      "Boztik Deliver: uncaught error:",
      event.error ||
        event.message
    );

    if (
      els.loading &&
      !els.loading.hidden
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

window.addEventListener(
  "unhandledrejection",
  event => {

    console.error(
      "Boztik Deliver: unhandled rejection:",
      event.reason
    );

    if (
      els.loading &&
      !els.loading.hidden
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

init();