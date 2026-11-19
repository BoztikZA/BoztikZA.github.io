// Boztik Deliver — lightweight Spotlight invitation for live client deliveries.
// Delayed until the delivery data is ready, then shown briefly without scroll listeners,
// gallery measurements, tracking requests, or server-side visitor storage.

const STORAGE_KEY_PREFIX = "boztik-spotlight-invite-v3:";

function storageKey(contextKey) {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(contextKey)}`;
}
const SHOW_DELAY_MS = 3000;
const VISIBLE_MS = 12000;
const EXIT_DURATION_MS = 260;
const REMIND_AFTER_AUTO_HIDE_MS = 24 * 60 * 60 * 1000;
const REMIND_AFTER_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function readSuppressionUntil(contextKey) {
  try {
    const value = Number(localStorage.getItem(storageKey(contextKey)) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function saveSuppression(duration, contextKey) {
  try {
    localStorage.setItem(storageKey(contextKey), String(Date.now() + duration));
  } catch {
    // Storage restrictions must never affect delivery.
  }
}

function addStyles() {
  if (document.getElementById("boztik-spotlight-invite-styles")) return;

  const style = document.createElement("style");
  style.id = "boztik-spotlight-invite-styles";
  style.textContent = `
    .boztik-spotlight-invite-wrap {
      width: min(calc(100vw - 32px), 540px);
      max-width: 540px;
      max-height: min(720px, calc(100vh - 32px));
      margin: auto;
      padding: 0;
      overflow: auto;
      border: 1px solid rgba(142,255,61,.25);
      border-radius: 24px;
      background: #0b100d;
      color: #f4f7f1;
      box-shadow: 0 30px 90px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.025) inset;
      opacity: 0;
      transform: translateY(12px) scale(.975);
      transition: opacity 280ms cubic-bezier(.2,.75,.25,1), transform 280ms cubic-bezier(.2,.75,.25,1);
    }
    .boztik-spotlight-invite-wrap.is-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .boztik-spotlight-invite-wrap.is-closing {
      opacity: 0;
      transform: translateY(-8px) scale(.985);
      pointer-events: none;
    }
    .boztik-spotlight-invite-wrap::backdrop {
      background: rgba(2,5,3,0);
      transition: background 280ms ease;
    }
    .boztik-spotlight-invite-wrap.is-visible::backdrop { background: rgba(2,5,3,.72); }
    .boztik-spotlight-invite-wrap.is-closing::backdrop { background: rgba(2,5,3,0); }
    .boztik-spotlight-invite-panel {
      position: relative;
      overflow: hidden;
      padding: 35px 40px 30px;
      border-radius: inherit;
      text-align: center;
      background: radial-gradient(ellipse at 50% -18%, rgba(142,255,61,.13), transparent 46%), linear-gradient(145deg, rgba(255,255,255,.035), transparent 58%);
    }
    .boztik-spotlight-invite-panel::after {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(120deg, rgba(255,255,255,.045), transparent 25%);
      content: "";
      pointer-events: none;
    }
    .boztik-spotlight-invite-close {
      position: absolute;
      z-index: 1;
      top: 14px;
      right: 14px;
      display: grid;
      width: 34px;
      height: 34px;
      padding: 0;
      place-items: center;
      border: 1px solid rgba(255,255,255,.13);
      border-radius: 50%;
      background: rgba(255,255,255,.035);
      color: #dfe6dc;
      font: 400 1.4rem/1 Arial, sans-serif;
      cursor: pointer;
      transition: border-color 180ms ease, background 180ms ease, color 180ms ease, transform 180ms ease;
    }
    .boztik-spotlight-invite-close:hover {
      border-color: rgba(142,255,61,.48);
      background: rgba(142,255,61,.08);
      color: #8eff3d;
      transform: rotate(5deg);
    }
    .boztik-spotlight-invite-kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #a5ff69;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .16em;
      line-height: 1.3;
      text-transform: uppercase;
    }
    .boztik-spotlight-invite-kicker::before {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 12px rgba(142,255,61,.58);
      content: "";
    }
    .boztik-spotlight-invite-mark {
      display: grid;
      width: 48px;
      height: 48px;
      margin: 18px auto 16px;
      place-items: center;
      border: 1px solid rgba(142,255,61,.28);
      border-radius: 16px;
      background: rgba(142,255,61,.07);
      color: #a5ff69;
      box-shadow: 0 12px 30px rgba(142,255,61,.08);
    }
    .boztik-spotlight-invite-mark svg { width: 23px; height: 23px; }
    .boztik-spotlight-invite-title {
      max-width: 430px;
      margin: 0 auto 11px;
      color: #f4f7f1;
      font: 800 clamp(1.65rem, 4vw, 2.05rem)/1.13 "Plus Jakarta Sans", Inter, sans-serif;
      letter-spacing: -.045em;
    }
    .boztik-spotlight-invite-intro {
      max-width: 430px;
      margin: 0 auto;
      color: #bac4b8;
      font-size: 14px;
      line-height: 1.65;
    }
    .boztik-spotlight-invite-benefits {
      display: grid;
      gap: 9px;
      margin: 22px 0 0;
      padding: 0;
      list-style: none;
      text-align: left;
    }
    .boztik-spotlight-invite-benefits li {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      padding: 12px 14px;
      border: 1px solid rgba(255,255,255,.07);
      border-radius: 13px;
      background: rgba(255,255,255,.025);
    }
    .boztik-spotlight-invite-check {
      display: grid;
      flex: 0 0 20px;
      width: 20px;
      height: 20px;
      margin-top: 1px;
      place-items: center;
      border-radius: 50%;
      background: rgba(142,255,61,.1);
      color: #a5ff69;
      font-size: 12px;
      font-weight: 800;
    }
    .boztik-spotlight-invite-benefits strong {
      display: block;
      color: #eef4ea;
      font-size: 12px;
      font-weight: 750;
      line-height: 1.4;
    }
    .boztik-spotlight-invite-benefits small {
      display: block;
      margin-top: 2px;
      color: #a9b4a7;
      font-size: 11px;
      line-height: 1.45;
    }
    .boztik-spotlight-invite-cta {
      position: relative;
      z-index: 1;
      display: inline-flex;
      min-height: 48px;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-top: 21px;
      padding: 0 21px;
      border: 1px solid transparent;
      border-radius: 999px;
      background: #8eff3d;
      color: #0b1108;
      font-size: 13px;
      font-weight: 800;
      text-decoration: none;
      box-shadow: 0 10px 24px rgba(142,255,61,.14);
      transition: background 180ms ease, box-shadow 180ms ease, transform 180ms ease;
      pointer-events: auto;
      -webkit-tap-highlight-color: transparent;
    }
    .boztik-spotlight-invite-cta:hover {
      background: #b0ff75;
      box-shadow: 0 14px 28px rgba(142,255,61,.23);
      transform: translateY(-1px);
    }
    .boztik-spotlight-invite-cta:active { transform: translateY(0) scale(.985); }
    .boztik-spotlight-invite-note {
      margin: 12px 0 0;
      color: #a5ff69;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .015em;
    }
    .boztik-spotlight-invite-honesty {
      margin: 7px 0 0;
      color: #879287;
      font-size: 10px;
      line-height: 1.45;
    }
    .boztik-spotlight-invite-dismiss {
      display: block;
      margin: 10px auto 0;
      padding: 5px 8px;
      border: 0;
      background: transparent;
      color: #aab4a7;
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
      transition: color 180ms ease;
    }
    .boztik-spotlight-invite-dismiss:hover { color: #f4f7f1; }
    .boztik-spotlight-invite-wrap :focus-visible {
      outline: 2px solid #8eff3d;
      outline-offset: 3px;
    }
    @media (max-width: 600px) {
      .boztik-spotlight-invite-wrap {
        width: min(calc(100vw - 24px), 540px);
        max-height: calc(100vh - 24px);
        border-radius: 20px;
      }
      .boztik-spotlight-invite-panel { padding: 31px 20px 24px; }
      .boztik-spotlight-invite-close { top: 10px; right: 10px; }
      .boztik-spotlight-invite-mark { margin-top: 15px; }
      .boztik-spotlight-invite-intro { font-size: 13px; }
      .boztik-spotlight-invite-benefits { gap: 7px; margin-top: 18px; }
      .boztik-spotlight-invite-benefits li { padding: 10px 11px; }
    }
    @media (max-height: 700px) {
      .boztik-spotlight-invite-panel { padding-top: 22px; padding-bottom: 14px; }
      .boztik-spotlight-invite-mark { width: 42px; height: 42px; margin: 12px auto 10px; }
      .boztik-spotlight-invite-title { margin-bottom: 8px; }
      .boztik-spotlight-invite-intro { font-size: 12px; line-height: 1.45; }
      .boztik-spotlight-invite-benefits { gap: 5px; margin-top: 12px; }
      .boztik-spotlight-invite-benefits li { padding: 7px 9px; }
      .boztik-spotlight-invite-benefits small { font-size: 10px; line-height: 1.3; }
      .boztik-spotlight-invite-cta { min-height: 44px; margin-top: 14px; }
      .boztik-spotlight-invite-note { margin-top: 7px; }
      .boztik-spotlight-invite-honesty { margin-top: 4px; font-size: 9px; }
      .boztik-spotlight-invite-dismiss { margin-top: 4px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .boztik-spotlight-invite-wrap,
      .boztik-spotlight-invite-wrap::backdrop,
      .boztik-spotlight-invite-close,
      .boztik-spotlight-invite-cta,
      .boztik-spotlight-invite-dismiss { transition: none !important; }
      .boztik-spotlight-invite-wrap { transform: none; }
      .boztik-spotlight-invite-wrap.is-closing { transform: none; }
    }
  `;
  document.head.appendChild(style);
}

function createInvitation() {
  const dialog = document.createElement("dialog");
  dialog.id = "boztik-spotlight-invite-wrap";
  dialog.className = "boztik-spotlight-invite-wrap";
  dialog.setAttribute("aria-labelledby", "boztik-spotlight-invite-title");
  dialog.setAttribute("aria-describedby", "boztik-spotlight-invite-intro");
  dialog.innerHTML = `
    <div class="boztik-spotlight-invite-panel">
      <button class="boztik-spotlight-invite-close" type="button" aria-label="Close Spotlight invitation">×</button>
      <span class="boztik-spotlight-invite-kicker">Boztik Spotlight</span>
      <span class="boztik-spotlight-invite-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="m12 2 2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2Z"/>
        </svg>
      </span>
      <h2 class="boztik-spotlight-invite-title" id="boztik-spotlight-invite-title">Your work deserves to be discovered.</h2>
      <p class="boztik-spotlight-invite-intro" id="boztik-spotlight-invite-intro">Spotlight is a free place for independent creators and small businesses to share projects, products and creative work.</p>
      <ul class="boztik-spotlight-invite-benefits">
        <li><span class="boztik-spotlight-invite-check" aria-hidden="true">✓</span><span><strong>Show what you create</strong><small>Projects, products and creative work.</small></span></li>
        <li><span class="boztik-spotlight-invite-check" aria-hidden="true">✓</span><span><strong>Bring your links together</strong><small>Website and social media profiles.</small></span></li>
        <li><span class="boztik-spotlight-invite-check" aria-hidden="true">✓</span><span><strong>Be discoverable on Boztik</strong><small>Visitors browsing Spotlight can find your work.</small></span></li>
      </ul>
      <a class="boztik-spotlight-invite-cta" href="https://www.boztik.com/spotlight/">Explore Spotlight <span aria-hidden="true">↗</span></a>
      <p class="boztik-spotlight-invite-note">Free to apply · No payment or obligation</p>
      <p class="boztik-spotlight-invite-honesty">An opportunity to be discovered—not a promise of traffic or results.</p>
      <button class="boztik-spotlight-invite-dismiss" type="button">Maybe later</button>
    </div>`;
  document.body.appendChild(dialog);
  return dialog;
}

export function initSpotlightInvitation(delivery, options = {}) {
  // Every active delivery gets its own reminder window, so viewing one delivery
  // does not suppress the invitation on a different delivery. The public
  // Support page uses a separate, page-scoped reminder key.
  const isSupportPage = options.pageType === "support";

  // Support both current multi-file deliveries and legacy single-file records.
  // Photoshop Battles deliveries use the same invitation path; their separate
  // non-commercial presentation rules must not suppress this Spotlight prompt.
  const hasMultiFileDelivery =
    Array.isArray(delivery?.delivery_files) &&
    delivery.delivery_files.some(file => file?.file_path && file?.file_name);

  const hasLegacySingleFile =
    Boolean(delivery?.file_path && delivery?.file_name);

  if (!isSupportPage && (!delivery?.id || (!hasMultiFileDelivery && !hasLegacySingleFile))) return;
  if (!isSupportPage && new URLSearchParams(location.search).get("preview") === "1") return;

  const contextKey = isSupportPage ? "support-page" : `delivery:${delivery.id}`;
  if (readSuppressionUntil(contextKey) > Date.now()) return;
  if (document.getElementById("boztik-spotlight-invite-wrap")) return;

  let hideTimer = 0;
  let closeTimer = 0;
  let shown = false;
  let closing = false;
  let dialog;
  let returnFocus;

  const hide = (dismissed = false) => {
    if (!shown || closing || !dialog?.open) return;
    shown = false;
    closing = true;
    window.clearTimeout(hideTimer);
    saveSuppression(dismissed ? REMIND_AFTER_DISMISS_MS : REMIND_AFTER_AUTO_HIDE_MS, contextKey);
    dialog.classList.remove("is-visible");
    dialog.classList.add("is-closing");
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : EXIT_DURATION_MS;
    closeTimer = window.setTimeout(() => {
      if (dialog?.open) dialog.close();
    }, duration);
  };

  const show = () => {
    if (dialog?.open) return;
    if (readSuppressionUntil(contextKey) > Date.now()) return;
    addStyles();

    dialog = createInvitation();
    const closeButton = dialog.querySelector(".boztik-spotlight-invite-close");
    const dismissButton = dialog.querySelector(".boztik-spotlight-invite-dismiss");
    const cta = dialog.querySelector(".boztik-spotlight-invite-cta");

    closeButton.addEventListener("click", () => hide(true));
    dismissButton.addEventListener("click", () => hide(true));
    cta.addEventListener("click", () => {
      saveSuppression(REMIND_AFTER_DISMISS_MS, contextKey);
    });
    dialog.addEventListener("click", event => {
      if (event.target === dialog) hide(true);
    });
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      hide(true);
    });
    dialog.addEventListener("close", () => {
      window.clearTimeout(closeTimer);
      dialog.remove();
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    }, { once: true });

    returnFocus = document.activeElement;
    dialog.showModal();
    window.requestAnimationFrame(() => {
      if (!dialog?.open) return;
      dialog.classList.add("is-visible");
      closeButton.focus();
    });
    shown = true;
    hideTimer = window.setTimeout(() => hide(false), VISIBLE_MS);
  };

  const timer = window.setTimeout(show, SHOW_DELAY_MS);
  return { open: show, cancel: () => window.clearTimeout(timer) };
}
