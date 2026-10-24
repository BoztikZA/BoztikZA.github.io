const API = (location.hostname === "localhost" || location.hostname === "127.0.0.1") ? "http://localhost:8787" : "https://deliver-api.boztik.com";
const root = document.querySelector("#new-releases");

if (root) {
  const stage = root.querySelector(".new-releases__stage");
  const previous = root.querySelector("[data-release-prev]");
  const next = root.querySelector("[data-release-next]");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let items = [], current = 0, timer, pointerStart = null;
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character]));
  const imageUrl = item => item.image_url.startsWith("/api/") ? API + item.image_url : item.image_url;
  const card = item => `<article class="release-card" aria-live="polite"><img src="${escape(imageUrl(item))}" alt=""><div><span>${escape(item.store === "redbubble" ? "Redbubble" : "TeePublic")}</span><h2>${escape(item.title)}</h2><p>${escape(item.description)}</p><a class="support-button cta-green" href="${escape(item.destination_url)}" target="_blank" rel="noopener noreferrer">${escape(item.cta_label)}</a></div></article>`;
  function show(index, immediate = false) {
    if (!items.length) return;
    current = (index + items.length) % items.length;
    const incoming = document.createRange().createContextualFragment(card(items[current])).firstElementChild;
    const outgoing = stage.querySelector(".release-card.is-current");
    incoming.classList.add("is-current", "is-entering"); stage.append(incoming);
    if (immediate || reducedMotion) { outgoing?.remove(); incoming.classList.remove("is-entering"); incoming.classList.add("is-visible"); return; }
    requestAnimationFrame(() => incoming.classList.add("is-visible"));
    if (outgoing) { outgoing.classList.remove("is-visible"); outgoing.classList.add("is-leaving"); setTimeout(() => outgoing.remove(), 720); }
    setTimeout(() => incoming.classList.remove("is-entering"), 720);
  }
  function pause() { clearInterval(timer); }
  function play() { pause(); if (!reducedMotion && items.length > 1) timer = setInterval(() => show(current + 1), 6500); }
  function empty(message) { root.hidden = false; previous.hidden = next.hidden = true; stage.innerHTML = `<div class="new-releases__empty"><span>Boztik Stores</span><h2>${message}</h2><p>New pieces selected in Command Centre will appear here.</p><a href="stores.html">Explore the collection <b>→</b></a></div>`; }
  previous.addEventListener("click", () => { show(current - 1); pause(); }); next.addEventListener("click", () => { show(current + 1); pause(); });
  root.addEventListener("mouseenter", pause); root.addEventListener("mouseleave", play); root.addEventListener("focusin", pause); root.addEventListener("focusout", play);
  root.addEventListener("keydown", event => { if (event.key === "ArrowLeft") { show(current - 1); pause(); } if (event.key === "ArrowRight") { show(current + 1); pause(); } });
  stage.addEventListener("pointerdown", event => { pointerStart = event.clientX; }); stage.addEventListener("pointerup", event => { if (pointerStart === null) return; const distance = event.clientX - pointerStart; pointerStart = null; if (Math.abs(distance) > 42) { show(current + (distance < 0 ? 1 : -1)); pause(); } });
  fetch(`${API}/api/public/promotions?featured=1`).then(response => response.ok ? response.json() : Promise.reject()).then(data => { items = Array.isArray(data.items) ? data.items : []; if (!items.length) return empty("The next drop is being curated."); root.hidden = false; show(0, true); play(); }).catch(() => empty("New releases are on their way."));
}
