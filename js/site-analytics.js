/* ============================================================================
   BOZTIK — Public-site analytics beacon
   ============================================================================
   Loaded ONLY on public pages (js/site.js pages). Records a lightweight visit
   to the private Site Analytics tables via the `record_site_visit` RPC.

   Deliberately SMALL and fire-and-forget: it never blocks page render, never
   throws, and fails silently if the network/Supabase is unavailable.

   Privacy
   ------- * NO cookies, NO precise geo-location. Location is ESTIMATED from the
     visitor's timezone + language (never IP-derived).
   * Unique visitors are approximated from a random pseudo-id kept in
     localStorage; only a one-way, salted hash of that id is ever transmitted,
     so the server never sees a usable id.
   * All guards below run BEFORE anything is sent.
   ========================================================================== */
(function () {
  'use strict';

  /* Public project credentials (same anon key the /deliver/ pages already
     ship to every visitor in js/config.js — not a secret). */
  var ENDPOINT = 'https://hwcxxotgtqchcriascti.supabase.co/rest/v1/rpc/record_site_visit';
  var API_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3Y3h4b3RndHFjaGNyaWFzY3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NTI5MzMsImV4cCI6MjEwMTUyODkzM30.bLyXIjvw0NcZQsyStPvq6d7nwDrMSycsTKuJkOtd9wU';

  var SESSION_DEDUP_MS = 30 * 60 * 1000; // one count per 30-minute session window
  var SKIP_KEY = 'boztik_skip_site_visit'; // set by the /deliver/ "Go to site" links
  var UID_KEY  = 'boztik_visit_uid';       // random pseudo-id for unique estimates
  var SESSION_KEY = 'boztik_site_session_at';

  var now = function () { return Date.now(); };
  var referrer = function () {
    try { return document.referrer || ''; } catch (e) { return ''; }
  };

  /* ----------------------------------------------------------
     1) Never count /deliver/ navigation back to the public site.
     Either the visitor literally came from a delivery page, or the delivery
     page just dropped a short-lived marker (see client.js bindSiteExitMarker).
     ---------------------------------------------------------- */
  var fromDelivery = false;
  try {
    if (/\/deliver\//i.test(referrer())) fromDelivery = true;
  } catch (e) { /* ignore */ }
  try {
    var raw = sessionStorage.getItem(SKIP_KEY);
    if (raw) {
      var marker = JSON.parse(raw);
      if (marker && typeof marker.t === 'number' && now() - marker.t < 5 * 60 * 1000) {
        fromDelivery = true;
      }
      sessionStorage.removeItem(SKIP_KEY);
    }
  } catch (e) { /* non-persistent context */ }
  if (fromDelivery) return;

  /* This beacon only ever runs on public pages, but guard anyway so a path
     change can never start counting the Command Centre. */
  try {
    if (/\/deliver\//i.test(location.pathname)) return;
  } catch (e) { /* ignore */ }

  /* ----------------------------------------------------------
     2) Bots / crawlers / link previews / automated tools.
     ---------------------------------------------------------- */
  try {
    var ua = (navigator.userAgent || '').toLowerCase();
    var BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|twitterbot|linkedinbot|redditbot|discordbot|telegrambot|whatsapp|snapchat|pinterestbot|ahrefs|semrush|petalbot|uptimerobot|headless|phantomjs|curl|wget|python-requests|go-http-client|postman/i;
    if (BOT_RE.test(ua)) return;
    if (navigator.webdriver) return;
    if (document.visibilityState === 'prerender') return;
  } catch (e) { /* ignore */ }

  /* ----------------------------------------------------------
     3) Command Centre operator (an authenticated admin session exists).
     The deliver pages store their Supabase access token at
     sb-<project-ref>-auth-token. If that token is present on the public site
     in this browser, the visitor is (almost certainly) the owner checking
     their own work — not public traffic. Fail-open to COUNTING if storage is
     unavailable: we must never crash a real visitor's page.
     ---------------------------------------------------------- */
  try {
    if (localStorage.getItem('sb-hwcxxotgtqchcriascti-auth-token')) return;
  } catch (e) { /* ignore */ }

  /* ----------------------------------------------------------
     4) De-duplicate refreshes / same-session page re-loads.
     One count per SESSION_DEDUP_MS window in this tab, so a refresh or a
     quick back/forward isn't a brand-new visit.
     ---------------------------------------------------------- */
  try {
    var last = Number(sessionStorage.getItem(SESSION_KEY) || 0);
    if (last && now() - last < SESSION_DEDUP_MS) return;
    sessionStorage.setItem(SESSION_KEY, String(now()));
  } catch (e) { /* ignore — still count */ }

  /* ----------------------------------------------------------
     5) Unique-visitor estimate. A random id is kept in localStorage (survives
     refresh and rollover for this browser); only a one-way salted hash of it
     is sent, so no usable id ever leaves the browser.
     ---------------------------------------------------------- */
  var uid = '';
  try {
    uid = localStorage.getItem(UID_KEY) || '';
    if (!uid) {
      uid = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('bz-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(UID_KEY, uid);
    }
  } catch (e) { /* ignore — send as anonymous */ }

  /* Stable, one-way FNV-1a(32) hash → opaque 16-hex visitor key. */
  function fnv(input, seed) {
    var h = 2166136261 ^ seed;
    for (var i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = (h * 16777619) & 0xffffffff;
    }
    return h;
  }
  var visitor_key = '';
  if (uid) {
    var hex = function (n) { return ('0000000' + n.toString(16)).slice(-8); };
    visitor_key = 'bz' + hex(fnv(uid, 0x9E37)) + hex(fnv(uid, 0x59B1));
  }

  /* ----------------------------------------------------------
     Detection helpers (all from client signals, never IP). Each returns a
     short, normalised caption the aggregate cache keys on.
     ---------------------------------------------------------- */
  function detectDevice() {
    try {
      var ua2 = navigator.userAgent || '';
      if (/tablet|ipad|playbook|silk/i.test(ua2) || (/(?:android)/i.test(ua2) && !/mobile/i.test(ua2))) return 'tablet';
      if (/mobi|iphone|ipod|android|windows phone/i.test(ua2)) return 'mobile';
    } catch (e) { /* ignore */ }
    return 'desktop';
  }

  function detectBrowser() {
    try {
      var ua3 = navigator.userAgent || '';
      if (/edg\//i.test(ua3)) return 'edge';
      if (/opr\/|opera/i.test(ua3)) return 'opera';
      if (/chrome|crios/i.test(ua3)) return 'chrome';
      if (/firefox|fxios/i.test(ua3)) return 'firefox';
      if (/safari/i.test(ua3)) return 'safari';
    } catch (e) { /* ignore */ }
    return 'other';
  }

  function detectOS() {
    try {
      var ua4 = navigator.userAgent || '';
      if (/windows/i.test(ua4)) return 'windows';
      if (/mac os x|macintosh/i.test(ua4)) return 'macos';
      if (/android/i.test(ua4)) return 'android';
      if (/iphone|ipad|ios/i.test(ua4)) return 'ios';
      if (/linux/i.test(ua4)) return 'linux';
    } catch (e) { /* ignore */ }
    return 'other';
  }

  function detectPage() {
    try {
      var raw = (location.pathname || '/').toLowerCase();
      var seg = raw.split('/').filter(Boolean);
      var file = seg.length ? seg[seg.length - 1] : 'index.html';
      var clean = file.replace(/\.html$/, '');
      if (clean.indexOf('guide-') === 0) return 'guides';
      var map = {
        'index': 'home', '': 'home', 'about': 'about', 'contact': 'contact',
        'services': 'services', 'portfolio': 'portfolio', 'guides': 'guides',
        'support': 'support', 'privacy': 'privacy', 'terms': 'terms',
        'image-inspector': 'image-inspector', 'creative-assistant': 'creative-assistant',
        'portfolio-content-block': 'portfolio'
      };
      return map[clean] || (clean || 'home');
    } catch (e) { /* ignore */ }
    return 'home';
  }

  function detectSource() {
    var ref = referrer();
    if (!ref) return 'direct';
    var host = '';
    try { host = new URL(ref).hostname.toLowerCase().replace(/^www\./, ''); }
    catch (e) { return 'direct'; }
    /* Page-to-page navigation inside the same site is "direct", not a referral. */
    var selfHost = '';
    try { selfHost = (location.hostname || '').toLowerCase().replace(/^www\./, ''); } catch (e2) { selfHost = ''; }
    if (selfHost && host === selfHost) return 'direct';
    if (host === 'reddit.com' || host === 'old.reddit.com' || host === 'redd.it' || /\/r\//i.test(ref)) return 'reddit';
    var rule = [
      [/^google\./, 'google'], [/^bing\./, 'bing'], [/^yahoo\./, 'yahoo'], [/^duckduckgo\./, 'duckduckgo'],
      [/^facebook\./, 'facebook'], [/^instagram\./, 'instagram'], [/^threads\.net/, 'threads'],
      [/^x\.com$/, 'x'], [/^twitter\./, 'x'], [/^t\.co$/, 'x'],
      [/^linkedin\./, 'linkedin'], [/^github\./, 'github'], [/^youtube\./, 'youtube'],
      [/^tiktok\./, 'tiktok'], [/^pinterest\./, 'pinterest'], [/^whatsapp\./, 'whatsapp'],
      [/^discord\./, 'discord'], [/^t\.me$/, 'telegram'], [/^ko-fi\.com/, 'ko-fi'], [/^paypal\./, 'paypal']
    ];
    for (var gi = 0; gi < rule.length; gi++) { if (rule[gi][0].test(host)) return rule[gi][1]; }
    /* Cross-origin referral not matching a social/search rule — a referral of
       some kind, so bucket it generically rather than mislabelling it direct. */
    return 'other';
  }

  /* Estimated country + region from timezone + language (no IP). Flagged in
     the UI as "estimated" to stay honest. */
  function detectLocation() {
    var tz = '';
    try { tz = (new Intl.DateTimeFormat().resolvedOptions().timeZone) || ''; } catch (e) { /* ignore */ }
    var lang = '';
    try { lang = (navigator.language || '').split(/[-_]/)[0].toLowerCase(); } catch (e) { /* ignore */ }

    var TZ_COUNTRY = {
      'Africa/Johannesburg': 'South Africa', 'Africa/Cairo': 'Egypt', 'Africa/Nairobi': 'Kenya',
      'Africa/Lagos': 'Nigeria', 'Africa/Accra': 'Ghana', 'Africa/Casablanca': 'Morocco',
      'Africa/Tunis': 'Tunisia', 'Africa/Algiers': 'Algeria', 'Africa/Addis_Ababa': 'Ethiopia',
      'Africa/Kampala': 'Uganda', 'Africa/Dar_es_Salaam': 'Tanzania', 'Africa/Lusaka': 'Zambia',
      'Africa/Harare': 'Zimbabwe', 'Africa/Gaborone': 'Botswana', 'Africa/Windhoek': 'Namibia',
      'Africa/Maputo': 'Mozambique', 'Africa/Blantyre': 'Malawi',
      'America/New_York': 'United States', 'America/Chicago': 'United States',
      'America/Denver': 'United States', 'America/Los_Angeles': 'United States',
      'America/Toronto': 'Canada', 'America/Vancouver': 'Canada', 'America/Mexico_City': 'Mexico',
      'America/Sao_Paulo': 'Brazil', 'America/Argentina/Buenos_Aires': 'Argentina',
      'Europe/London': 'United Kingdom', 'Europe/Dublin': 'Ireland', 'Europe/Berlin': 'Germany',
      'Europe/Paris': 'France', 'Europe/Amsterdam': 'Netherlands', 'Europe/Brussels': 'Belgium',
      'Europe/Madrid': 'Spain', 'Europe/Lisbon': 'Portugal', 'Europe/Rome': 'Italy',
      'Europe/Zurich': 'Switzerland', 'Europe/Vienna': 'Austria', 'Europe/Oslo': 'Norway',
      'Europe/Stockholm': 'Sweden', 'Europe/Copenhagen': 'Denmark', 'Europe/Helsinki': 'Finland',
      'Europe/Warsaw': 'Poland', 'Europe/Athens': 'Greece', 'Europe/Istanbul': 'Turkey',
      'Europe/Moscow': 'Russia',
      'Asia/Dubai': 'United Arab Emirates', 'Asia/Riyadh': 'Saudi Arabia', 'Asia/Kuwait': 'Kuwait',
      'Asia/Doha': 'Qatar', 'Asia/Tehran': 'Iran', 'Asia/Kolkata': 'India', 'Asia/Karachi': 'Pakistan',
      'Asia/Dhaka': 'Bangladesh', 'Asia/Singapore': 'Singapore', 'Asia/Hong_Kong': 'Hong Kong',
      'Asia/Shanghai': 'China', 'Asia/Tokyo': 'Japan', 'Asia/Seoul': 'South Korea',
      'Asia/Bangkok': 'Thailand', 'Asia/Manila': 'Philippines', 'Asia/Jakarta': 'Indonesia',
      'Asia/Kuala_Lumpur': 'Malaysia',
      'Australia/Sydney': 'Australia', 'Australia/Melbourne': 'Australia',
      'Australia/Brisbane': 'Australia', 'Australia/Perth': 'Australia',
      'Pacific/Auckland': 'New Zealand', 'Pacific/Fiji': 'Fiji'
    };
    var LANG_COUNTRY = { 'af': 'South Africa', 'zu': 'South Africa', 'st': 'South Africa' };

    var country = tz ? (TZ_COUNTRY[tz] || '') : '';
    if (!country) country = LANG_COUNTRY[lang] || '';
    var city = tz && tz.indexOf('/') > -1 ? tz.split('/').pop().replace(/_/g, ' ') : '';
    var region = tz && tz.indexOf('/') > -1 ? tz : '';
    return { country: country || 'Unknown', region: region, city: city || null };
  }

  /* ----------------------------------------------------------
     Compose the payload and fire the (fire-and-forget) beacon.
     ---------------------------------------------------------- */
  var loc = detectLocation();
  var page = detectPage();
  var payload = {
    p_page: page,
    p_source: detectSource(),
    p_device: detectDevice(),
    p_browser: detectBrowser(),
    p_os: detectOS(),
    p_country: loc.country,
    p_region: loc.region,
    p_city: loc.city,
    p_visitor_key: visitor_key || null
  };

  try {
    var request = new Request(ENDPOINT, {
      method: 'POST',
      headers: {
        'apikey': API_KEY,
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      keepalive: true
    });
    void fetch(request).catch(function () { /* never block or surface */ });
  } catch (e) {
    /* Silent: analytics must never break the page. */
  }
})();