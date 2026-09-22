/**
 * Boztik — first-party page-view counter.
 *
 * What this does: on a real page load, sends one POST with the page's key
 * (e.g. "homepage") to the Boztik Deliver Worker, which increments one
 * per-day, per-page counter (see /deliver-v3/js/api.js → fetchPageAnalytics,
 * shown in the Command Centre → Analytics → "Which pages people open").
 *
 * What this deliberately does NOT do:
 *  - no cookies, no localStorage/sessionStorage fingerprint, no client ID
 *  - no IP address is read or stored by this script (the Worker does not
 *    log request IPs for this endpoint)
 *  - no third-party request of any kind
 *  - nothing is sent if the browser has Do Not Track or Global Privacy
 *    Control enabled, or if this is a Command Centre / admin page
 *
 * Failure is always silent: analytics must never be able to break a page.
 */
(function () {
  "use strict";

  try {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;

    var PAGE_KEYS = {
      "/": "homepage",
      "/index.html": "homepage",
      "/services.html": "services",
      "/portfolio.html": "portfolio",
      "/image-inspector.html": "tools",
      "/creative-assistant.html": "tools",
      "/guides.html": "guides",
      "/guide-photo-restoration.html": "guides",
      "/guide-object-removal.html": "guides",
      "/guide-overedited-look.html": "guides",
      "/guide-ai-vs-professional-editing.html": "guides",
      "/about.html": "about",
      "/support.html": "support",
      "/contact.html": "contact"
    };
    var path = location.pathname.replace(/\/index\.html$/, "/");
    var page = PAGE_KEYS[path];
    if (!page) return; // unlisted / private pages are never counted

    var host = location.hostname;
    var apiBaseUrl = (host === "localhost" || host === "127.0.0.1") ? "http://localhost:8787" : "https://deliver-api.boztik.com";
    var body = JSON.stringify({ page: page });
    var url = apiBaseUrl + "/api/public/pageview";

    var send = function () {
      if (navigator.sendBeacon) {
        var ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        if (ok) return;
      }
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true, mode: "cors" }).catch(function () {});
    };

    if (document.readyState === "complete") send();
    else window.addEventListener("load", send, { once: true });
  } catch (e) {
    /* analytics must never break the page */
  }
})();
