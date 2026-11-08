// Boztik Deliver — lightweight Spotlight invitation for live client deliveries.
// Delayed until the delivery data is ready, then shown briefly without scroll listeners,
// gallery measurements, tracking requests, or server-side visitor storage.

const STORAGE_KEY_PREFIX = "boztik-spotlight-invite-v3:";

function storageKey(contextKey) {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(contextKey)}`;
}
const SHOW_DELAY_MS = 3000;
const VISIBLE_MS = 12000;
const FADE_MS = 420;
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
      position: fixed;
      z-index: 80;
      right: max(22px, env(safe-area-inset-right));
      bottom: max(22px, env(safe-area-inset-bottom));
      width: min(354px, calc(100vw - 32px));
      pointer-events: none;
      opacity: 0;
      transform: translate3d(0, 10px, 0);
      transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms cubic-bezier(.2,.75,.25,1);
    }
    .boztik-spotlight-invite-wrap.is-visible {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
    .boztik-spotlight-invite {
      position: relative;
      display: flex;
      align-items: center;
      gap: 13px;
      min-height: 82px;
      padding: 15px 42px 15px 15px;
      overflow: hidden;
      border: 1px solid rgba(142,255,61,.28);
      border-radius: 17px;
      background:
        radial-gradient(ellipse at 0% 0%, rgba(142,255,61,.13), transparent 58%),
        linear-gradient(145deg, rgba(23,29,35,.98), rgba(9,13,17,.985));
      box-shadow: 0 18px 48px rgba(0,0,0,.42), 0 0 24px rgba(142,255,61,.07), inset 0 1px 0 rgba(255,255,255,.07);
      color: #fff;
      text-decoration: none;
      pointer-events: auto;
      -webkit-tap-highlight-color: transparent;
      transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
    }
    .boztik-spotlight-invite::before {
      content: "";
      position: absolute;
      left: 0;
      top: 14px;
      bottom: 14px;
      width: 3px;
      border-radius: 0 4px 4px 0;
      background: #8eff3d;
      box-shadow: 0 0 13px rgba(142,255,61,.5);
    }
    .boztik-spotlight-invite:hover {
      transform: translateY(-2px);
      border-color: rgba(142,255,61,.52);
      box-shadow: 0 22px 54px rgba(0,0,0,.48), 0 0 28px rgba(142,255,61,.12), inset 0 1px 0 rgba(255,255,255,.08);
    }
    .boztik-spotlight-invite:focus-visible,
    .boztik-spotlight-invite-close:focus-visible {
      outline: 2px solid #8eff3d;
      outline-offset: 4px;
    }
    .boztik-spotlight-invite-mark {
      display: grid;
      flex: 0 0 43px;
      width: 43px;
      height: 43px;
      place-items: center;
      border: 1px solid rgba(142,255,61,.25);
      border-radius: 13px;
      background: rgba(142,255,61,.09);
      color: #a5ff69;
    }
    .boztik-spotlight-invite-mark svg { width: 22px; height: 22px; }
    .boztik-spotlight-invite-copy { min-width: 0; display: block; }
    .boztik-spotlight-invite-kicker {
      display: block;
      margin-bottom: 4px;
      color: #a5ff69;
      font-size: 9px;
      font-weight: 850;
      letter-spacing: .16em;
      line-height: 1.2;
      text-transform: uppercase;
    }
    .boztik-spotlight-invite-title {
      display: block;
      color: #fff;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.3;
      letter-spacing: -.01em;
    }
    .boztik-spotlight-invite-sub {
      display: block;
      margin-top: 3px;
      color: rgba(226,232,240,.72);
      font-size: 10.5px;
      font-weight: 550;
      line-height: 1.4;
    }
    .boztik-spotlight-invite-arrow {
      position: absolute;
      right: 15px;
      bottom: 14px;
      color: #a5ff69;
      font-size: 15px;
      line-height: 1;
      transition: transform 180ms ease;
    }
    .boztik-spotlight-invite:hover .boztik-spotlight-invite-arrow { transform: translate(2px,-2px); }
    .boztik-spotlight-invite-close {
      position: absolute;
      z-index: 2;
      top: 7px;
      right: 7px;
      display: grid;
      width: 25px;
      height: 25px;
      padding: 0;
      place-items: center;
      border: 1px solid rgba(255,255,255,.11);
      border-radius: 50%;
      background: rgba(5,7,10,.72);
      color: rgba(255,255,255,.72);
      font: inherit;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      pointer-events: auto;
      transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .boztik-spotlight-invite-close:hover {
      color: #fff;
      border-color: rgba(142,255,61,.38);
      background: rgba(142,255,61,.1);
    }
    @media (max-width: 600px) {
      .boztik-spotlight-invite-wrap {
        right: max(12px, env(safe-area-inset-right));
        bottom: max(12px, env(safe-area-inset-bottom));
        width: min(350px, calc(100vw - 24px));
        left: 50%;
        transform: translate3d(-50%, 10px, 0);
      }
      .boztik-spotlight-invite-wrap.is-visible { transform: translate3d(-50%, 0, 0); }
      .boztik-spotlight-invite {
        min-height: 76px;
        gap: 11px;
        padding: 13px 40px 13px 13px;
        border-radius: 15px;
      }
      .boztik-spotlight-invite-mark { flex-basis: 39px; width: 39px; height: 39px; border-radius: 11px; }
      .boztik-spotlight-invite-title { font-size: 12.5px; }
      .boztik-spotlight-invite-sub { font-size: 10px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .boztik-spotlight-invite-wrap,
      .boztik-spotlight-invite,
      .boztik-spotlight-invite-arrow { transition: none !important; }
    }
  `;
  document.head.appendChild(style);
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
  let shown = false;
  let wrap;

  const hide = (dismissed = false) => {
    if (!shown || !wrap) return;
    shown = false;
    window.clearTimeout(hideTimer);
    wrap.classList.remove("is-visible");
    saveSuppression(dismissed ? REMIND_AFTER_DISMISS_MS : REMIND_AFTER_AUTO_HIDE_MS, contextKey);
    window.setTimeout(() => {
      if (!shown && wrap?.isConnected) wrap.remove();
    }, FADE_MS + 40);
  };

  const show = () => {
    if (readSuppressionUntil(contextKey) > Date.now()) return;
    addStyles();

    wrap = document.createElement("div");
    wrap.id = "boztik-spotlight-invite-wrap";
    wrap.className = "boztik-spotlight-invite-wrap";
    wrap.innerHTML = `
      <a class="boztik-spotlight-invite" href="https://www.boztik.com/spotlight/" aria-label="Visit Boztik Spotlight and apply for a free feature">
        <span class="boztik-spotlight-invite-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 2 2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2Z"/>
            <path d="m19 14 1.1 3.1L23 18l-2.9.9L19 22l-.9-3.1L15 18l3.1-.9L19 14Z"/>
          </svg>
        </span>
        <span class="boztik-spotlight-invite-copy">
          <span class="boztik-spotlight-invite-kicker">Boztik Spotlight</span>
          <span class="boztik-spotlight-invite-title">Own a business or creative brand?</span>
          <span class="boztik-spotlight-invite-sub">Apply for a free feature on Boztik</span>
        </span>
        <span class="boztik-spotlight-invite-arrow" aria-hidden="true">↗</span>
      </a>
      <button class="boztik-spotlight-invite-close" type="button" aria-label="Dismiss Spotlight invitation">×</button>
    `;

    document.body.appendChild(wrap);
    wrap.querySelector(".boztik-spotlight-invite-close")?.addEventListener("click", () => hide(true));
    wrap.querySelector(".boztik-spotlight-invite")?.addEventListener("click", () => {
      saveSuppression(REMIND_AFTER_DISMISS_MS, contextKey);
    });

    shown = true;
    window.requestAnimationFrame(() => wrap?.classList.add("is-visible"));
    hideTimer = window.setTimeout(() => hide(false), VISIBLE_MS);
  };

  // Start only after the delivery has loaded and been initialized. No scroll or
  // resize handlers are needed, so the invitation adds almost no page-start work.
  window.setTimeout(show, SHOW_DELAY_MS);
}
