// Boztik — one quiet discovery card per browsing session, shared across Home,
// Support and active Deliver pages. A manual dismissal is respected site-wide for 14 days.

const SESSION_KEY = "boztik-discovery-sequence-v4";
const DISMISS_KEY = "boztik-discovery-dismissed-until-v1";
const DISMISS_DAYS = 14;
const AUTO_HIDE_MS = 11500;
const EXIT_MS = 360;
const PROMO = {
  id: "spotlight",
  eyebrow: "Boztik Spotlight · Creator discovery",
  title: "Your next discovery could start here.",
  description: "Meet independent creators, makers, small businesses and developers. Have a project of your own? Introduce your work to the Boztik community.",
  action: "Explore Spotlight",
  secondary: { label: "Apply to be featured", href: "https://www.boztik.com/spotlight/submit/" },
  href: "https://www.boztik.com/spotlight/",
  icon: '<path d="m12 2 2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2Z"/><path d="M19 16v4M17 18h4"/>'
};

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}


function hasRecentDismissal() {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY));
    if (Number.isFinite(until) && until > Date.now()) return true;
    if (until) localStorage.removeItem(DISMISS_KEY);
  } catch { /* Storage is optional; session-level suppression still applies. */ }
  return false;
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000));
  } catch { /* Storage is optional. */ }
}

function readSequence() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved.stopped === "boolean" && typeof saved.shown === "boolean") return saved;
    }
  } catch { /* Session storage is optional. */ }
  const fresh = { stopped: false, shown: false };
  saveSequence(fresh);
  return fresh;
}

function saveSequence(sequence) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(sequence)); } catch { /* Storage is optional. */ }
}

function addStyles() {
  if (document.getElementById("boztik-discovery-promo-style")) return;
  const style = document.createElement("style");
  style.id = "boztik-discovery-promo-style";
  style.textContent = `
    .boztik-discovery-promo {
      position:fixed; z-index:9998; right:max(22px,env(safe-area-inset-right));
      bottom:max(22px,env(safe-area-inset-bottom)); display:grid;
      grid-template-columns:44px minmax(0,1fr) 30px; gap:13px;
      width:min(420px,calc(100vw - 32px)); padding:18px 17px 16px;
      border:1px solid rgba(142,255,61,.24); border-radius:18px;
      background:linear-gradient(145deg,rgba(19,27,20,.985),rgba(8,12,10,.99));
      color:#f2f7ef; box-shadow:0 22px 64px rgba(0,0,0,.44),0 0 28px rgba(142,255,61,.07),inset 0 1px rgba(255,255,255,.045);
      opacity:0; transform:translate3d(0,13px,0) scale(.975); filter:blur(2px);
      pointer-events:none; transition:opacity 380ms cubic-bezier(.2,.7,.25,1),transform 420ms cubic-bezier(.2,.7,.25,1),filter 380ms ease;
      isolation:isolate;
    }
    .boztik-discovery-promo::before{position:absolute;z-index:-1;top:0;left:20px;right:20px;height:1px;background:linear-gradient(90deg,transparent,rgba(142,255,61,.7),transparent);content:""}
    .boztik-discovery-promo.is-visible{opacity:1;transform:translate3d(0,0,0) scale(1);filter:none;pointer-events:auto}
    .boztik-discovery-promo.is-leaving{opacity:0;transform:translate3d(0,8px,0) scale(.985);filter:blur(1px);pointer-events:none}
    .boztik-discovery-promo__icon{display:grid;width:44px;height:44px;place-items:center;border:1px solid rgba(142,255,61,.25);border-radius:14px;background:rgba(142,255,61,.085);color:#adff7a}
    .boztik-discovery-promo__icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
    .boztik-discovery-promo__body{min-width:0}
    .boztik-discovery-promo__eyebrow{display:block;margin:1px 0 6px;color:#a5f56e;font-size:9px;font-weight:800;letter-spacing:.14em;line-height:1.4;text-transform:uppercase}
    .boztik-discovery-promo__title{margin:0 0 6px;color:#f4f8f1;font:750 15px/1.32 Inter,system-ui,sans-serif;letter-spacing:-.025em}
    .boztik-discovery-promo__description{margin:0;color:#bac5b7;font:400 11.7px/1.6 Inter,system-ui,sans-serif}
    .boztik-discovery-promo__links{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;margin-top:11px}
    .boztik-discovery-promo__action{display:inline-flex;align-items:center;gap:7px;color:#b1ff80;font:750 11px/1.45 Inter,system-ui,sans-serif;text-decoration:none}
    .boztik-discovery-promo__secondary{color:#c2cec0;font:600 10.5px/1.45 Inter,system-ui,sans-serif;text-decoration:underline;text-decoration-color:rgba(194,206,192,.4);text-underline-offset:3px}
    .boztik-discovery-promo__action:hover,.boztik-discovery-promo__secondary:hover{color:#e0ffd0}
    .boztik-discovery-promo__close{display:grid;width:29px;height:29px;place-items:center;border:1px solid rgba(255,255,255,.12);border-radius:50%;background:rgba(255,255,255,.04);color:#c0cabb;font:400 17px/1 Arial,sans-serif;cursor:pointer;transition:background 160ms ease,color 160ms ease,border-color 160ms ease}
    .boztik-discovery-promo__close:hover{border-color:rgba(142,255,61,.42);background:rgba(142,255,61,.1);color:#d5ffc0}
    .boztik-discovery-promo a:focus-visible,.boztik-discovery-promo button:focus-visible{outline:2px solid #8eff3d;outline-offset:3px}
    @media(max-width:520px){.boztik-discovery-promo{right:12px;bottom:max(12px,env(safe-area-inset-bottom));width:calc(100vw - 24px);grid-template-columns:36px minmax(0,1fr) 27px;gap:10px;padding:14px 12px;border-radius:15px}.boztik-discovery-promo__icon{width:36px;height:36px;border-radius:11px}.boztik-discovery-promo__title{font-size:14px}.boztik-discovery-promo__description{font-size:11px}}
    @media(prefers-reduced-motion:reduce){.boztik-discovery-promo,.boztik-discovery-promo.is-visible,.boztik-discovery-promo.is-leaving{transition:none;transform:none;filter:none}}
  `;
  document.head.appendChild(style);
}

function createPromo(promo, onClose, onAction) {
  const card = document.createElement("aside");
  card.className = "boztik-discovery-promo";
  card.setAttribute("aria-label", "Discover more from Boztik");
  card.setAttribute("role", "region");
  card.setAttribute("aria-live", "polite");
  card.setAttribute("tabindex", "-1");
  const secondary = promo.secondary
    ? `<a class="boztik-discovery-promo__secondary" href="${promo.secondary.href}">${promo.secondary.label}</a>`
    : "";
  card.innerHTML = `
    <span class="boztik-discovery-promo__icon" aria-hidden="true"><svg viewBox="0 0 24 24">${promo.icon}</svg></span>
    <div class="boztik-discovery-promo__body">
      <span class="boztik-discovery-promo__eyebrow">${promo.eyebrow}</span>
      <h2 class="boztik-discovery-promo__title">${promo.title}</h2>
      <p class="boztik-discovery-promo__description">${promo.description}</p>
      <div class="boztik-discovery-promo__links">
        <a class="boztik-discovery-promo__action" href="${promo.href}">${promo.action} <span aria-hidden="true">↗</span></a>
        ${secondary}
      </div>
    </div>
    <button class="boztik-discovery-promo__close" type="button" aria-label="Dismiss Boztik suggestion for 14 days" title="Not now">×</button>`;
  card.querySelector("button").addEventListener("click", onClose);
  card.querySelectorAll("a").forEach(link => link.addEventListener("click", onAction));
  return card;
}

export function initSpotlightInvitation(delivery, options = {}) {
  const pageType = options.pageType || "delivery";
  const isSupportPage = pageType === "support";
  const isHomePage = pageType === "home";
  const hasMultiFileDelivery = Array.isArray(delivery?.delivery_files) &&
    delivery.delivery_files.some(file => file?.file_path && file?.file_name);
  const hasLegacySingleFile = Boolean(delivery?.file_path && delivery?.file_name);

  if (!isSupportPage && !isHomePage && (!delivery?.id || (!hasMultiFileDelivery && !hasLegacySingleFile))) return;
  if (document.getElementById("boztik-discovery-promo") || hasRecentDismissal()) return;

  const sequence = readSequence();
  if (sequence.stopped || sequence.shown) return;

  let card = null;
  let showTimer = 0;
  let hideTimer = 0;
  let removeTimer = 0;
  let disposed = false;

  const clearCard = () => {
    window.clearTimeout(hideTimer);
    if (!card) return;
    const oldCard = card;
    card = null;
    oldCard.classList.remove("is-visible");
    oldCard.classList.add("is-leaving");
    removeTimer = window.setTimeout(() => oldCard.remove(), EXIT_MS);
  };

  const cleanup = () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", onOutsidePointer);
  };

  const stop = (remember = false) => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    window.clearTimeout(removeTimer);
    cleanup();
    sequence.stopped = true;
    saveSequence(sequence);
    if (remember) rememberDismissal();
    clearCard();
  };

  const onKeyDown = event => {
    if (event.key === "Escape" && card) {
      event.preventDefault();
      stop(true);
    }
  };

  const onOutsidePointer = event => {
    if (card && !card.contains(event.target)) stop(true);
  };

  const delay = isHomePage ? randomBetween(17000, 23000)
    : isSupportPage ? randomBetween(11000, 16000)
      : randomBetween(13000, 18000);

  const show = () => {
    if (disposed || sequence.stopped || !document.body) return;
    if (document.visibilityState !== "visible") {
      showTimer = window.setTimeout(show, 5000);
      return;
    }
    const promo = PROMO;
    sequence.shown = true;
    saveSequence(sequence);
    addStyles();
    card = createPromo(promo, () => stop(true), () => stop(false));
    card.id = "boztik-discovery-promo";
    document.body.appendChild(card);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onOutsidePointer);
    window.requestAnimationFrame(() => card?.classList.add("is-visible"));
    hideTimer = window.setTimeout(() => stop(false), AUTO_HIDE_MS);
  };

  showTimer = window.setTimeout(show, delay);

  return { cancel: () => stop(false) };
}
