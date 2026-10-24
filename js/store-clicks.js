/**
 * Boztik — store-link click tracking (first-party, privacy-respecting).
 *
 * Counts activations of links to Boztik's four store destinations:
 *   boztik_store  -> the Boztik Store tab (stores.html)
 *   redbubble     -> https://www.redbubble.com/people/Boztik-Designs/shop
 *   teepublic     -> https://www.teepublic.com/user/boztik-designs
 *   kofi          -> https://ko-fi.com/boztik/shop
 *
 * Each link activation sends one event to the Boztik Deliver Worker
 * (POST /api/public/store-click), which validates the destination id and
 * stores it idempotently by client-generated event id.
 *
 * Rules this file keeps (same contract as js/pageview.js):
 *   - No names, emails, IPs or free text. The session id is the same anonymous
 *     first-party session cookie (boztik_anon_session, 180 days) the page-view
 *     counter already uses; it never identifies a person.
 *   - Honours Do Not Track / Global Privacy Control: nothing is sent.
 *   - Destination ids come from explicit data attributes or the site's own
 *     configured URLs only — never fragile URL substring matching.
 *   - Records a link activation, not a page view, and not a completed visit
 *     to the external site.
 *   - Never prevents or delays navigation; failures are silent and can never
 *     break a link.
 *   - Not loaded on Command Centre / Deliver pages.
 */
(function () {
  "use strict";

  try {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;

    var API = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
      ? "http://localhost:8787" : "https://deliver-api.boztik.com";
    var EVENT_VERSION = 1;

    var DESTINATIONS = {
      "https://ko-fi.com/boztik/shop": "kofi",
      "https://www.redbubble.com/people/Boztik-Designs/shop": "redbubble",
      "https://www.teepublic.com/user/boztik-designs": "teepublic",
    };

    var PAGE_KEYS = {
      "/": "homepage", "/index.html": "homepage",
      "/stores.html": "stores",
    };

    var sentIds = {};
    var sessionId = "";

    function readCookie(name) {
      var match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
      return match ? decodeURIComponent(match[1]) : "";
    }
    function writeCookie(name, value, days) {
      var expires = new Date(Date.now() + days * 86400000).toUTCString();
      var secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/; SameSite=Lax" + secure;
    }
    function makeSessionId() {
      if (window.crypto && typeof window.crypto.getRandomValues === "function") {
        var bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      }
      return (Date.now().toString(16) + Math.random().toString(16).slice(2) + "0000000000000000").slice(0, 32);
    }
    function getSessionId() {
      var id = readCookie("boztik_anon_session");
      if (!id || !/^[a-f0-9]{32}$/.test(id)) {
        id = makeSessionId();
        writeCookie("boztik_anon_session", id, 180);
      }
      return id;
    }
    function normalizeDestination(a) {
      var explicit = a.getAttribute("data-store-destination");
      if (explicit === "boztik_store" || explicit === "redbubble" || explicit === "teepublic" || explicit === "kofi") return explicit;
      var href = a.getAttribute("href");
      if (!href) return null;
      try {
        var url = new URL(href, location.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        var own = url.hostname.replace(/^www\./, "") === location.hostname.replace(/^www\./, "");
        if (own && url.pathname === "/stores.html") return "boztik_store";
        return DESTINATIONS[url.toString()] || null;
      } catch (e) { return null; }
    }
    function pageKey() {
      var path = location.pathname.replace(/\/index\.html$/, "/");
      return PAGE_KEYS[path] || "other";
    }
    function placementOf(a) {
      var p = a.getAttribute("data-store-placement");
      if (p) return p;
      return pageKey();
    }
    function alreadySent(id) { return !!sentIds[id]; }
    function markSent(id) {
      sentIds[id] = true;
      var keys = Object.keys(sentIds);
      if (keys.length > 100) delete sentIds[keys[0]];
      try { sessionStorage.setItem("boztik_store_click_events", JSON.stringify(sentIds)); } catch (e) { /* ignore */ }
    }
    function loadSent() {
      try { var raw = sessionStorage.getItem("boztik_store_click_events"); if (raw) sentIds = JSON.parse(raw) || {}; } catch (e) { sentIds = {}; }
    }
    function sendClick(destination, source) {
      var id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      if (alreadySent(id)) return;
      var body = JSON.stringify({
        event_id: id,
        destination: destination,
        source_placement: source,
        session_id: sessionId,
        event_version: EVENT_VERSION,
      });
      var url = API + "/api/public/store-click";
      var sent = false;
      if (navigator.sendBeacon) {
        sent = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      }
      if (!sent) {
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true, mode: "cors" }).catch(function () {});
      }
      markSent(id);
    }
    function handle(event) {
      try {
        if (event.type === "auxclick" && event.button !== 1) return;
        var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
        if (!a) return;
        var destination = normalizeDestination(a);
        if (!destination) return;
        sendClick(destination, placementOf(a));
      } catch (e) { /* tracking must never break a link */ }
    }

    sessionId = getSessionId();
    loadSent();
    document.addEventListener("click", handle, true);
    document.addEventListener("auxclick", handle, true);
  } catch (e) { /* tracking must never break the page */ }
})();
