/**
 * Boztik — important-action tracking for GA4.
 *
 * ONE event, four low-cardinality parameters, only for the links that matter to the business:
 *
 *   gtag('event', 'boztik_action', { action, destination, position, page_key })
 *
 *   action       e.g. chrome_web_store, edge_store, kofi, paypal, contact_email, contact_page,
 *                portfolio_page, external_portfolio, creative_toolkit, image_inspector, services_page,
 *                creative_assistant, launchzone_listing, social_link, deliver
 *   destination  a hostname (external links) or a path (internal links). Never a full URL, never a query
 *                string, never an email address.
 *   position     nav | hero | footer | content
 *   page_key     which Boztik page the click happened on (same keys as js/pageview.js)
 *
 * Rules this file keeps:
 *   - It only talks to the gtag() that the page already loads for the existing GA4 property. It adds no
 *     tag, no provider, no cookie and no request of its own; if gtag is missing it does nothing.
 *   - It is loaded only on the public pages that already carry GA4 — never on Deliver pages.
 *   - No personal data: no names, e-mail addresses, IPs, form content or free text.
 *   - Failure is always silent: analytics must never be able to break a page or a link.
 *
 * To read these in GA4: Reports > Engagement > Events > boztik_action. To break them down by parameter,
 * register action / destination / position / page_key as event-scoped custom dimensions
 * (Admin > Custom definitions). See the Command Centre Analytics page for the full note.
 */
(function () {
  "use strict";

  try {
    var PAGE_KEYS = {
      "/": "homepage",
      "/index.html": "homepage",
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
      "/contact.html": "contact",
      "/privacy.html": "privacy",
      "/terms.html": "terms"
    };
    var pageKey = PAGE_KEYS[location.pathname.replace(/\/index\.html$/, "/")] || "other";

    var EXTERNAL = {
      "chromewebstore.google.com": "chrome_web_store",
      "microsoftedge.microsoft.com": "edge_store",
      "ko-fi.com": "kofi",
      "paypal.me": "paypal",
      "launchzone.co": "launchzone_listing",
      "x.com": "social_link",
      "linkedin.com": "social_link",
      "reddit.com": "social_link",
      "github.com": "social_link"
    };
    var INTERNAL = {
      "/contact.html": "contact_page",
      "/portfolio.html": "portfolio_page",
      "/services.html": "services_page",
      "/creative-toolkit.html": "creative_toolkit",
      "/image-inspector.html": "image_inspector",
      "/creative-assistant.html": "creative_assistant"
    };

    var classify = function (a) {
      var href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#") return null;
      var url;
      try { url = new URL(href, location.href); } catch (e) { return null; }

      if (url.protocol === "mailto:") return { action: "contact_email", destination: "email" }; // never the address itself
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;

      var host = url.hostname.replace(/^www\./, "");
      var own = host === location.hostname.replace(/^www\./, "") || host === "boztik.com";
      if (own) {
        var path = url.pathname.replace(/\/index\.html$/, "/");
        if (path.indexOf("/deliver") === 0) return { action: "deliver", destination: "/deliver" };
        var internal = INTERNAL[path];
        return internal ? { action: internal, destination: path } : null;
      }
      if (/(^|\.)myportfolio\.com$/.test(host)) return { action: "external_portfolio", destination: host };
      var external = EXTERNAL[host];
      return external ? { action: external, destination: host } : null;
    };

    var positionOf = function (a) {
      if (a.closest(".navbar, nav")) return "nav";
      if (a.closest("footer")) return "footer";
      if (a.closest('[class*="hero"]')) return "hero";
      return "content";
    };

    var handle = function (event) {
      try {
        if (typeof window.gtag !== "function") return;
        if (event.type === "auxclick" && event.button !== 1) return; // middle-click opens a new tab; ignore right-click
        var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
        if (!a) return;
        var info = classify(a);
        if (!info) return;
        window.gtag("event", "boztik_action", {
          action: info.action,
          destination: info.destination,
          position: positionOf(a),
          page_key: pageKey,
          transport_type: "beacon" // survives the page unloading as the link is followed
        });
      } catch (e) {
        /* analytics must never break a link */
      }
    };

    document.addEventListener("click", handle, true);
    document.addEventListener("auxclick", handle, true);
  } catch (e) {
    /* analytics must never break the page */
  }
})();
