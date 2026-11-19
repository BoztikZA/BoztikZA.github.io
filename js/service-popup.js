/**
 * Lightweight, shared invitation to explore Boztik's services.
 * Each page opts in explicitly so the component has no page-wide side effects.
 */

const DISMISSAL_KEY = "boztik-services-popup-dismissed-at";
const DISMISSAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const EXIT_DURATION_MS = 180;

function hasRecentDismissal() {
  try {
    const dismissedAt = Number(localStorage.getItem(DISMISSAL_KEY));
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISSAL_WINDOW_MS;
  } catch {
    // If storage is unavailable, leave the experience undisturbed rather than
    // showing a prompt that cannot remember a visitor's dismissal.
    return true;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISSAL_KEY, String(Date.now()));
  } catch {
    // Dismissal is still immediate when browser storage is unavailable.
  }
}

function createPopup(servicesUrl) {
  const dialog = document.createElement("dialog");
  dialog.className = "boztik-services-popup";
  dialog.setAttribute("aria-labelledby", "boztik-services-popup-title");
  dialog.innerHTML = `
    <div class="boztik-services-popup__panel">
      <button class="boztik-services-popup__close" type="button" aria-label="Close services invitation">
        <span aria-hidden="true">×</span>
      </button>
      <span class="boztik-services-popup__eyebrow"><i aria-hidden="true"></i> BOZTIK SERVICES</span>
      <div class="boztik-services-popup__mark" aria-hidden="true">✦</div>
      <h2 id="boztik-services-popup-title">Thoughtful edits for the images that matter.</h2>
      <p>Explore Boztik's professional photo editing, restoration and creative image services.</p>
      <a class="boztik-services-popup__cta" href="${servicesUrl}">Explore services <span aria-hidden="true">→</span></a>
      <button class="boztik-services-popup__dismiss" type="button">Not right now</button>
    </div>`;
  document.body.appendChild(dialog);
  return dialog;
}

/**
 * Schedules the shared popup once per page. A dismissal is respected across
 * every participating page for fourteen days.
 */
export function initServicePopup({ delay = 12000, servicesUrl = "services.html" } = {}) {
  if (hasRecentDismissal() || typeof HTMLDialogElement === "undefined") return null;

  let dialog = null;
  let closing = false;
  let returnFocus = null;

  const dismiss = () => {
    if (!dialog || !dialog.open || closing) return;
    closing = true;
    dialog.classList.add("is-closing");
    window.setTimeout(() => dialog.close(), EXIT_DURATION_MS);
  };

  const open = () => {
    if (dialog || hasRecentDismissal()) return;
    dialog = createPopup(servicesUrl);
    const closeButton = dialog.querySelector(".boztik-services-popup__close");
    const dismissButton = dialog.querySelector(".boztik-services-popup__dismiss");
    const cta = dialog.querySelector(".boztik-services-popup__cta");

    closeButton.addEventListener("click", dismiss);
    dismissButton.addEventListener("click", dismiss);
    cta.addEventListener("click", rememberDismissal);
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dismiss();
    });
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      dismiss();
    });
    dialog.addEventListener("close", () => {
      rememberDismissal();
      dialog.remove();
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    }, { once: true });

    returnFocus = document.activeElement;
    dialog.showModal();
    window.requestAnimationFrame(() => {
      dialog.classList.add("is-open");
      closeButton.focus();
    });
  };

  const timer = window.setTimeout(open, Math.max(0, delay));
  return { open, cancel: () => window.clearTimeout(timer) };
}
