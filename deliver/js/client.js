import { countdown, formatBytes, formatDate, toast } from "./shared.js";
import { getPublicDelivery, recordDownload, signedDownload } from "./api.js";
import { getImageDimensions, parseExif, estimatePdfPageCount, buildImageInfoHTML, buildGenericInfoHTML, formatLabelFor } from "./fileinfo.js";

const $ = id => document.getElementById(id); const els = { loading: $("deliver-loading"), active: $("deliver-active"), expired: $("deliver-expired"), title: $("deliver-project-name"), client: $("deliver-client-name"), id: $("deliver-id-value"), size: $("deliver-file-size"), date: $("deliver-upload-date"), notes: $("deliver-notes"), notesWrap: $("deliver-notes-wrap"), count: $("deliver-countdown-label"), gallery: $("deliver-gallery"), all: $("deliver-download-all"), discover: $("deliver-discover"), adSlot: $("deliver-adsense-slot") }; let delivery, timer;
function state(name) { ["loading","active","expired"].forEach(key => els[key].hidden = key !== name); const showPromo = name === "active"; if (els.discover) els.discover.hidden = !showPromo; if (els.adSlot) els.adSlot.hidden = !showPromo; }
function renderFiles(files) { els.gallery.innerHTML = files.map((file, index) => { const image = file.content_type?.startsWith("image/"); return `<article class="deliver-file-card">${image ? `<div class="deliver-file-preview" data-preview="${index}">Image preview</div>` : `<div class="deliver-file-icon">${file.file_name.split(".").pop().toUpperCase()}</div>`}<div><strong>${file.file_name}</strong><small>${formatBytes(file.file_size)}</small></div><div class="fileinfo-slot" data-info="${index}"></div><button type="button" data-download="${index}">Download</button></article>`; }).join(""); els.gallery.querySelectorAll("[data-download]").forEach(button => button.addEventListener("click", () => download(files[Number(button.dataset.download)]))); els.gallery.querySelectorAll("[data-preview]").forEach(async preview => { const file = files[Number(preview.dataset.preview)]; try { const url = await signedDownload(file); preview.innerHTML = `<img src="${url}" alt="Preview of ${file.file_name}">`; } catch { preview.textContent = "Preview unavailable"; } }); els.gallery.querySelectorAll("[data-info]").forEach(slot => renderFileInfo(files[Number(slot.dataset.info)], slot)); }

async function renderFileInfo(file, slot) {
  const sizeLabel = formatBytes(file.file_size);
  const format = formatLabelFor(file.file_name, file.content_type);
  const isImage = file.content_type?.startsWith("image/");
  try {
    if (isImage) {
      const url = await signedDownload(file);
      const dims = await getImageDimensions(url);
      let exif = null;
      if (file.content_type === "image/jpeg") {
        try { const buffer = await (await fetch(url)).arrayBuffer(); exif = await parseExif(buffer); } catch { /* EXIF is best-effort only */ }
      }
      slot.innerHTML = buildImageInfoHTML({ fileName: file.file_name, sizeLabel, format, mimeType: file.content_type, width: dims.width, height: dims.height, exif });
    } else {
      let pageCount = null;
      if (file.file_name.toLowerCase().endsWith(".pdf")) {
        try { const url = await signedDownload(file); const buffer = await (await fetch(url)).arrayBuffer(); pageCount = await estimatePdfPageCount(buffer); } catch { /* page count is best-effort only */ }
      }
      slot.innerHTML = buildGenericInfoHTML({ fileName: file.file_name, sizeLabel, format, mimeType: file.content_type, pageCount });
    }
  } catch { /* file information is a non-critical enhancement — leave the slot empty on failure */ }
}
function updateCountdown() { const value = countdown(delivery.expires_at); if (value.expired) { clearInterval(timer); state("expired"); return; } els.count.textContent = value.label; }
async function download(file) { try { const url = await signedDownload(file); recordDownload(delivery.id); const a = Object.assign(document.createElement("a"), { href: url, download: file.file_name }); document.body.append(a); a.click(); a.remove(); toast("Download started."); } catch { toast("The download could not be prepared. Please refresh and try again.", "error"); } }
async function init() { const id = new URLSearchParams(location.search).get("id")?.trim().toUpperCase(); if (!/^BZ-[A-Z2-9-]+$/.test(id || "")) return state("expired"); try { delivery = await getPublicDelivery(id); if (!delivery || countdown(delivery.expires_at).expired) return state("expired"); els.title.textContent = delivery.project_name || "Your delivery"; els.client.textContent = delivery.client_name ? `Prepared for ${delivery.client_name}` : ""; els.id.textContent = delivery.id; els.size.textContent = formatBytes(delivery.file_size); els.date.textContent = formatDate(delivery.created_at); if (delivery.notes) { els.notes.textContent = delivery.notes; els.notesWrap.hidden = false; } const files = delivery.delivery_files?.length ? delivery.delivery_files : [{ file_path: delivery.file_path, file_name: delivery.file_name, file_size: delivery.file_size, content_type: null }]; renderFiles(files); els.all.addEventListener("click", async () => { for (const file of files) await download(file); }); updateCountdown(); timer = setInterval(updateCountdown, 30000); state("active"); } catch (error) { console.error(error); state("expired"); } }
init();