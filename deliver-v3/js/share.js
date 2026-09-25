// Boztik Deliver — share button & share-event tracking.
//
// Privacy note: nothing here stores or reads a visitor identity. Each click only
// increments one aggregate counter on the Worker (method / day / page type), which
// already decides whether the delivery is active and whether the page is a normal
// delivery or a Photoshop Battles page. There is no per-visitor stream.
//
//   native / copy            -> "completed" (we can verify it happened)
//   whatsapp / facebook / x  -> "attempted" (an external share sheet was opened;
//   / reddit                    whether the person actually posted can't be known)
import { recordShare } from "./api.js";
import { toast } from "./shared.js";

const SOCIAL_METHODS = Object.freeze(["whatsapp", "facebook", "x", "reddit"]);

/* ---------------------------------------------------------------- helpers */

/** The clean, canonical delivery URL to hand out (id only, no extraneous params). */
function canonicalShareUrl(deliveryId) {
  const url = new URL(window.location.href);
  url.search = `id=${encodeURIComponent(deliveryId)}`;
  return url.toString();
}

function sharePayload(delivery, shareUrl) {
  const title = delivery.project_name || "Boztik Deliver";
  return { title, text: `Here's my secure delivery from Boztik: ${shareUrl}`, url: shareUrl };
}

/** Build the external share-sheet URL for a social method. */
function socialUrl(method, title, shareUrl) {
  const u = encodeURIComponent(shareUrl);
  switch (method) {
    case "whatsapp": return `https://wa.me/?text=${encodeURIComponent(`${title} `)}${u}`;
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case "x": return `https://x.com/intent/tweet?url=${u}&text=${encodeURIComponent(title)}`;
    case "reddit": return `https://www.reddit.com/submit?url=${u}&title=${encodeURIComponent(title)}`;
    default: return "";
  }
}

/* --------------------------------------------------------------- state */

let deliveryId = null;
let shareUrl = "";
let payload = { title: "", text: "", url: "" };
let buttonEl = null;
let menuEl = null;
let backdropEl = null;

function setOpen(open) {
  if (!menuEl || !buttonEl) return;
  menuEl.hidden = !open;
  buttonEl.setAttribute("aria-expanded", String(open));
  if (open && menuEl.querySelector(".deliver-share-action")) {
    menuEl.querySelector(".deliver-share-action").focus();
  }
  if (backdropEl) backdropEl.hidden = !open;
}

function closeMenu() { setOpen(false); }

/** Fire-and-forget analytics; a share must never be blocked by the network. */
function track(method) {
  if (!deliveryId) return;
  recordShare(deliveryId, method).catch(() => {});
}

/* ---------------------------------------------------------------- actions */

async function doNative() {
  closeMenu();
  try {
    await navigator.share(payload);
    track("native");
    toast("Shared");
  } catch (error) {
    // User cancelled the native sheet (or it is unsupported) — offer the menu instead.
    if (error?.name !== "AbortError") console.warn("[Boztik Deliver] navigator.share failed:", error);
    setOpen(true);
  }
}

async function doCopy() {
  closeMenu();
  try {
    await navigator.clipboard.writeText(shareUrl);
    track("copy");
    toast("Link copied to clipboard");
  } catch (error) {
    console.error("[Boztik Deliver] clipboard failed:", error);
    toast("Could not copy the link — copy it from the address bar instead.", "error");
  }
}

function doSocial(method) {
  closeMenu();
  const url = socialUrl(method, payload.title, shareUrl);
  if (!url) return;
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (win) win.opener = null;
  // Opening the sheet is the only thing we can observe — recorded as "attempted".
  track(method);
}

/* ---------------------------------------------------------------- wiring */

function onShareButtonClick() {
  // Use the native share sheet when the browser has one; otherwise open the menu.
  if (typeof navigator.share === "function") { doNative(); return; }
  setOpen(!menuEl?.hidden);
}

export function initShare(delivery) {
  // Only wire sharing for a valid, live delivery that actually has files.
  if (!delivery || !delivery.id || !(delivery.delivery_files?.length > 0)) return;

  buttonEl = document.getElementById("deliver-share");
  menuEl = document.getElementById("deliver-share-menu");
  if (!buttonEl || !menuEl) return;

  deliveryId = delivery.id;
  shareUrl = canonicalShareUrl(delivery.id);
  payload = sharePayload(delivery, shareUrl);

  buttonEl.hidden = false;
  buttonEl.addEventListener("click", onShareButtonClick);

  // Backdrop: one tap anywhere else closes the menu.
  backdropEl = document.createElement("div");
  backdropEl.id = "deliver-share-backdrop";
  backdropEl.className = "deliver-share-backdrop";
  backdropEl.hidden = true;
  backdropEl.addEventListener("click", closeMenu);
  document.body.append(backdropEl);

  menuEl.querySelectorAll(".deliver-share-action").forEach((item) => {
    const method = item.getAttribute("data-share") || "";
    item.addEventListener("click", () => {
      if (method === "native") { doNative(); return; }
      if (method === "copy") { doCopy(); return; }
      if (SOCIAL_METHODS.includes(method)) { doSocial(method); return; }
      closeMenu();
    });
  });

  const closeBtn = menuEl.querySelector(".deliver-share-menu__close");
  if (closeBtn) closeBtn.addEventListener("click", closeMenu);

  // Close on Escape.
  menuEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
  });
}