/**
 * Boztik — first-party page-view and traffic-source counters.
 *
 * What this does: on a real page load, sends one POST with the page's key
 * (e.g. "homepage") to the Boztik Deliver Worker, which increments one
 * per-day, per-page counter (see /deliver-v3/js/api.js → fetchPageAnalytics,
 * shown in the Command Centre → Analytics → "Which pages people open").
 *
 * What this deliberately does NOT do:
 *  - no names, emails, personal data, or localStorage fingerprint
 *  - this script does not read or send IP addresses; the Worker uses the
 *    proxy-provided address only for in-memory public rate limiting and does
 *    not store it in either analytics dataset
 *  - the existing page-view counter keeps its first-party session cookie to
 *    understand page flow; traffic-source attribution uses a separate,
 *    sessionStorage-only identifier
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
      "/stores.html": "stores",
      "/services.html": "services",
      "/portfolio.html": "portfolio",
      "/image-inspector.html": "tools",
      "/creative-assistant.html": "tools",
      "/creative-toolkit.html": "toolkit",
      "/deliver.html": "deliver",
      "/guides.html": "guides",
      "/guide-photo-restoration.html": "guides",
      "/guide-object-removal.html": "guides",
      "/guide-overedited-look.html": "guides",
      "/guide-ai-vs-professional-editing.html": "guides",
      "/about.html": "about",
      "/support.html": "support",
      "/contact.html": "contact"
    };
    var COOKIE_NAME = "boztik_anon_session";
    var SESSION_TTL_DAYS = 180;
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
        return Array.prototype.map.call(bytes, function (b) {
          return b.toString(16).padStart(2, "0");
        }).join("");
      }
      return (Date.now().toString(16) + Math.random().toString(16).slice(2) + "0000000000000000").slice(0, 32);
    }
    function trafficSessionId() {
      var idKey = "boztik_traffic_session";
      var activityKey = "boztik_traffic_last_activity";
      var now = Date.now();
      var id = "";
      var lastActivity = 0;
      try {
        id = sessionStorage.getItem(idKey) || "";
        lastActivity = Number(sessionStorage.getItem(activityKey)) || 0;
        if (!/^[a-f0-9]{32}$/.test(id) || now - lastActivity >= 30 * 60 * 1000 || now < lastActivity) {
          if (!window.crypto || typeof window.crypto.getRandomValues !== "function") return "";
          var bytes = new Uint8Array(16);
          window.crypto.getRandomValues(bytes);
          id = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
          sessionStorage.setItem(idKey, id);
        }
        sessionStorage.setItem(activityKey, String(now));
      } catch (e) {
        return "";
      }
      return id;
    }
    function watchTrafficActivity() {
      var activityKey = "boztik_traffic_last_activity";
      var lastWrite = Date.now();
      var mark = function () {
        var now = Date.now();
        if (now - lastWrite < 10000) return;
        try {
          sessionStorage.setItem(activityKey, String(now));
          lastWrite = now;
        } catch (e) {
          /* storage restrictions must not affect page behaviour */
        }
      };
      ["pointerdown", "keydown", "scroll", "touchstart"].forEach(function (eventName) {
        window.addEventListener(eventName, mark, { passive: true });
      });
    }
    function sendTrafficSource(apiBaseUrl) {
      try {
        var id = trafficSessionId();
        if (!id) return;
        watchTrafficActivity();
        var referrerHost = "";
        var searchReferrer = false;
        if (document.referrer) {
          var referrer = new URL(document.referrer);
          referrerHost = referrer.hostname.toLowerCase();
          searchReferrer = ["q", "query", "p", "text"].some(function (key) {
            return referrer.searchParams.has(key);
          });
        }
        var currentParams = new URLSearchParams(location.search);
        var body = JSON.stringify({
          session_id: id,
          referrer_host: referrerHost,
          search_referrer: searchReferrer,
          utm_source: currentParams.get("utm_source"),
          utm_medium: currentParams.get("utm_medium"),
          utm_campaign: currentParams.get("utm_campaign")
        });
        var url = apiBaseUrl + "/api/public/traffic-source";
        if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) return;
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true, mode: "cors" }).catch(function () {});
      } catch (e) {
        /* attribution must never be able to break a page */
      }
    }

    var path = location.pathname.replace(/\/index\.html$/, "/");
    var page = PAGE_KEYS[path];
    if (!page) return; // unlisted / private pages are never counted

    var sessionId = readCookie(COOKIE_NAME);
    if (!sessionId) {
      sessionId = makeSessionId();
      writeCookie(COOKIE_NAME, sessionId, SESSION_TTL_DAYS);
    }

    var host = location.hostname;
    var apiBaseUrl = (host === "localhost" || host === "127.0.0.1") ? "http://localhost:8787" : "https://deliver-api.boztik.com";
    var body = JSON.stringify({ page: page, session_id: sessionId });
    var url = apiBaseUrl + "/api/public/pageview";

    var send = function () {
      if (navigator.sendBeacon) {
        var ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        if (ok) return;
      }
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true, mode: "cors" }).catch(function () {});
    };

    sendTrafficSource(apiBaseUrl);
    if (document.readyState === "complete") send();
    else window.addEventListener("load", send, { once: true });
  } catch (e) {
    /* analytics must never break the page */
  }
})();
