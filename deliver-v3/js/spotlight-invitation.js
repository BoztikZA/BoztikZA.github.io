// Boztik — quiet, rotating discovery cards for delivery and Support pages.
// Each browser tab session sees the three promotions once, in shuffled order.
// Cards are non-modal, dismissible, and never interrupt the delivery workflow.

const SESSION_KEY = "boztik-discovery-sequence-v2";
const AUTO_HIDE_MS = 8500;
const FADE_MS = 420;
const FIRST_DELAY_MIN_MS = 6500;
const FIRST_DELAY_MAX_MS = 10500;
const NEXT_DELAY_MIN_MS = 18000;
const NEXT_DELAY_MAX_MS = 24000;
const DISMISS_DELAY_MIN_MS = 9000;
const DISMISS_DELAY_MAX_MS = 13000;

const PROMOS = [
  {
    id: "spotlight",
    eyebrow: "Discover independent talent",
    title: "Find something worth following.",
    description: "Explore Boztik Spotlight to discover independent creators, small businesses and the services they offer — or apply to introduce your own work.",
    action: "Explore Spotlight",
    href: "https://www.boztik.com/spotlight/",
    icon: '<path d="m12 2 2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2Z"/><path d="M19 16v4M17 18h4"/>'
  },
  {
    id: "stores",
    eyebrow: "Explore Boztik Stores",
    title: "Discover useful digital finds.",
    description: "Browse a growing collection of independent games, software, creator tools and interesting digital products in one place.",
    action: "Browse Stores",
    href: "https://www.boztik.com/stores.html",
    icon: '<path d="M3 9h18l-1.5-5h-15L3 9Z"/><path d="M5 9v11h14V9M9 20v-6h6v6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>'
  },
  {
    id: "toolkit",
    eyebrow: "Create with Boztik",
    title: "A little more room to create.",
    description: "Try Boztik Creative Toolkit — a free browser-based workspace for image inspection, editing tools and practical creative workflows.",
    action: "Explore Creative Toolkit",
    href: "https://www.boztik.com/creative-toolkit.html",
    icon: '<path d="m15 5 4 4M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"/><path d="M12 3H5a2 2 0 0 0-2 2v7M21 12v7a2 2 0 0 1-2 2h-7"/>'
  }
];

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function readSequence() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && Array.isArray(saved.order) && Number.isInteger(saved.index)) return saved;
    }
  } catch { /* Session storage is optional. */ }
  const fresh = { order: shuffle(PROMOS.map(promo => promo.id)), index: 0, stopped: false };
  saveSequence(fresh);
  return fresh;
}

function saveSequence(sequence) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(sequence)); } catch { /* Session storage is optional. */ }
}

function addStyles() {
  if (document.getElementById("boztik-discovery-promo-style")) return;
  const style = document.createElement("style");
  style.id = "boztik-discovery-promo-style";
  style.textContent = `
    .boztik-discovery-promo {
      position: fixed;
      z-index: 9998;
      right: max(22px, env(safe-area-inset-right));
      bottom: max(22px, env(safe-area-inset-bottom));
      display: grid;
      grid-template-columns: 42px minmax(0,1fr) 30px;
      gap: 13px;
      width: min(410px, calc(100vw - 32px));
      padding: 17px 16px 16px;
      border: 1px solid rgba(142,255,61,.24);
      border-radius: 17px;
      background: linear-gradient(145deg, rgba(18,25,19,.98), rgba(8,12,10,.985));
      color: #f2f7ef;
      box-shadow: 0 18px 54px rgba(0,0,0,.42), 0 0 28px rgba(142,255,61,.07), inset 0 1px rgba(255,255,255,.045);
      opacity: 0;
      transform: translateY(13px);
      pointer-events: none;
      transition: opacity 420ms cubic-bezier(.2,.7,.2,1), transform 420ms cubic-bezier(.2,.7,.2,1);
      isolation: isolate;
    }
    .boztik-discovery-promo::before {
      position: absolute; z-index: -1; top: 0; left: 18px; right: 18px;
      height: 1px; background: linear-gradient(90deg, transparent, rgba(142,255,61,.7), transparent);
      content: "";
    }
    .boztik-discovery-promo.is-visible { opacity: 1; transform: translateY(0); pointer-events: auto; }
    .boztik-discovery-promo.is-leaving { opacity: 0; transform: translateY(8px); pointer-events: none; }
    .boztik-discovery-promo__icon {
      display: grid; width: 42px; height: 42px; place-items: center;
      border: 1px solid rgba(142,255,61,.25); border-radius: 13px;
      background: rgba(142,255,61,.08); color: #a8ff72;
    }
    .boztik-discovery-promo__icon svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
    .boztik-discovery-promo__body { min-width: 0; }
    .boztik-discovery-promo__eyebrow { display:block; margin:1px 0 5px; color:#a5f56e; font-size:9px; font-weight:800; letter-spacing:.14em; line-height:1.35; text-transform:uppercase; }
    .boztik-discovery-promo__title { margin:0 0 5px; color:#f4f8f1; font:750 15px/1.3 Inter, sans-serif; letter-spacing:-.025em; }
    .boztik-discovery-promo__description { margin:0; color:#b6c1b3; font:400 11.5px/1.55 Inter, sans-serif; }
    .boztik-discovery-promo__action { display:inline-flex; align-items:center; gap:7px; margin-top:10px; color:#aaff79; font:750 11px/1.4 Inter,sans-serif; text-decoration:none; }
    .boztik-discovery-promo__action:hover { color:#d2ffb8; }
    .boztik-discovery-promo__close {
      display:grid; width:28px; height:28px; place-items:center;
      border:1px solid rgba(255,255,255,.1); border-radius:50%;
      background:rgba(255,255,255,.035); color:#aeb9aa;
      font:400 17px/1 Arial,sans-serif; cursor:pointer;
      transition:background 180ms ease,color 180ms ease,border-color 180ms ease;
    }
    .boztik-discovery-promo__close:hover { border-color:rgba(142,255,61,.4); background:rgba(142,255,61,.09); color:#caffad; }
    .boztik-discovery-promo a:focus-visible,.boztik-discovery-promo button:focus-visible { outline:2px solid #8eff3d; outline-offset:3px; }
    @media(max-width:520px) {
      .boztik-discovery-promo { right:12px; bottom:max(12px,env(safe-area-inset-bottom)); width:calc(100vw - 24px); grid-template-columns:36px minmax(0,1fr) 27px; gap:10px; padding:14px 12px; border-radius:15px; }
      .boztik-discovery-promo__icon { width:36px; height:36px; border-radius:11px; }
      .boztik-discovery-promo__title { font-size:14px; }
      .boztik-discovery-promo__description { font-size:11px; }
    }
    @media(prefers-reduced-motion:reduce) { .boztik-discovery-promo { transition:none; transform:none; } }
  `;
  document.head.appendChild(style);
}

function createPromo(promo, onClose, onAction) {
  const card = document.createElement("aside");
  card.className = "boztik-discovery-promo";
  card.setAttribute("aria-label", "Discover more from Boztik");
  card.setAttribute("role", "region");
  card.innerHTML = `
    <span class="boztik-discovery-promo__icon" aria-hidden="true"><svg viewBox="0 0 24 24">${promo.icon}</svg></span>
    <div class="boztik-discovery-promo__body">
      <span class="boztik-discovery-promo__eyebrow">${promo.eyebrow}</span>
      <h2 class="boztik-discovery-promo__title">${promo.title}</h2>
      <p class="boztik-discovery-promo__description">${promo.description}</p>
      <a class="boztik-discovery-promo__action" href="${promo.href}">${promo.action} <span aria-hidden="true">↗</span></a>
    </div>
    <button class="boztik-discovery-promo__close" type="button" aria-label="Dismiss suggestion">×</button>`;
  card.querySelector("button").addEventListener("click", onClose);
  card.querySelector("a").addEventListener("click", onAction);
  return card;
}

export function initSpotlightInvitation(delivery, options = {}) {
  const isSupportPage = options.pageType === "support";
  const hasMultiFileDelivery = Array.isArray(delivery?.delivery_files) &&
    delivery.delivery_files.some(file => file?.file_path && file?.file_name);
  const hasLegacySingleFile = Boolean(delivery?.file_path && delivery?.file_name);

  if (!isSupportPage && (!delivery?.id || (!hasMultiFileDelivery && !hasLegacySingleFile))) return;
  if (!isSupportPage && new URLSearchParams(location.search).get("preview") === "1") return;
  if (document.getElementById("boztik-discovery-promo")) return;

  const sequence = readSequence();
  if (sequence.stopped || sequence.index >= sequence.order.length) return;

  let card = null;
  let showTimer = 0;
  let hideTimer = 0;
  let nextTimer = 0;
  let removeTimer = 0;
  let disposed = false;

  const clearCard = () => {
    window.clearTimeout(hideTimer);
    if (!card) return;
    const oldCard = card;
    card = null;
    oldCard.classList.remove("is-visible");
    oldCard.classList.add("is-leaving");
    removeTimer = window.setTimeout(() => oldCard.remove(), FADE_MS);
  };

  const stop = () => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    window.clearTimeout(nextTimer);
    clearCard();
    sequence.stopped = true;
    saveSequence(sequence);
  };

  const scheduleNext = (delay) => {
    if (disposed || sequence.index >= sequence.order.length) return;
    nextTimer = window.setTimeout(showNext, delay);
  };

  const showNext = () => {
    if (disposed) return;
    if (document.visibilityState !== "visible" || !document.body) {
      scheduleNext(5000);
      return;
    }
    if (sequence.index >= sequence.order.length) return;
    const promo = PROMOS.find(item => item.id === sequence.order[sequence.index]);
    sequence.index += 1;
    saveSequence(sequence);
    if (!promo) {
      scheduleNext(0);
      return;
    }
    addStyles();
    card = createPromo(promo, () => {
      clearCard();
      scheduleNext(randomBetween(DISMISS_DELAY_MIN_MS, DISMISS_DELAY_MAX_MS));
    }, stop);
    card.id = "boztik-discovery-promo";
    document.body.appendChild(card);
    window.requestAnimationFrame(() => card?.classList.add("is-visible"));
    hideTimer = window.setTimeout(() => {
      clearCard();
      scheduleNext(randomBetween(NEXT_DELAY_MIN_MS, NEXT_DELAY_MAX_MS));
    }, AUTO_HIDE_MS);
  };

  showTimer = window.setTimeout(showNext, randomBetween(FIRST_DELAY_MIN_MS, FIRST_DELAY_MAX_MS));
  return { cancel: stop };
}
