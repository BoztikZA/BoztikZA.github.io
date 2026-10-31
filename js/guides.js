/**
 * Boztik Guides enhancements (guides.html and guide-*.html only).
 *
 *  1. Reveal: staggers cards, steps and section rules in as they enter the viewport.
 *     Content is never hidden unless JavaScript runs (CSS keys off html.js) and a timer
 *     reveals anything an observer has not reached.
 *  2. Hub: working search and category filters over the static cards. The controls are
 *     in the HTML as [hidden] and only appear here, so they never show without JS.
 *  3. Article: reading-progress bar and "you are here" highlighting in the contents list.
 *
 * No libraries, no network requests, no storage, no analytics calls.
 */
(function () {
  'use strict';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- 1. Reveal ---------- */
  (function reveal() {
    var items = [].slice.call(document.querySelectorAll('[data-reveal]'));
    if (!items.length) return;
    function show(el) { el.classList.add('is-in'); }
    if (reduceMotion || !('IntersectionObserver' in window)) { items.forEach(show); return; }
    var queue = [];
    var flushTimer = null;
    function flush() {
      // Cards that arrive together are staggered; a lone card appears immediately.
      queue.forEach(function (el, i) { el.style.setProperty('--d', Math.min(i, 6) * 80 + 'ms'); show(el); });
      queue = []; flushTimer = null;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        // Items scrolled straight past (e.g. by an anchor jump) are revealed, never left blank.
        if (!entry.isIntersecting && entry.boundingClientRect.bottom >= 0) return;
        observer.unobserve(entry.target);
        queue.push(entry.target);
      });
      if (queue.length && !flushTimer) flushTimer = window.setTimeout(flush, 30);
    }, { rootMargin: '0px 0px -8%', threshold: 0.12 });
    items.forEach(function (el) { observer.observe(el); });
    window.setTimeout(function () { items.forEach(show); }, 4500); // failsafe
  })();

  /* ---------- 2. Hub: search + filters ---------- */
  (function hub() {
    var grid = document.querySelector('[data-guide-grid]');
    var tools = document.querySelector('[data-guide-tools]');
    if (!grid || !tools) return;

    var cards = [].slice.call(grid.querySelectorAll('[data-guide]'));
    var input = tools.querySelector('input[type="search"]');
    var filterWrap = tools.querySelector('[data-filters]');
    var status = document.querySelector('[data-guide-status]');
    var empty = document.querySelector('[data-guide-empty]');
    var clear = empty && empty.querySelector('[data-clear]');
    var category = 'all';
    var query = '';

    function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

    // Build the filter buttons only from categories that actually have guides.
    var counts = {};
    var labels = {};
    cards.forEach(function (card) {
      var key = card.getAttribute('data-category');
      counts[key] = (counts[key] || 0) + 1;
      labels[key] = card.getAttribute('data-category-label') || key;
    });
    var keys = Object.keys(counts);
    function addButton(key, label, count) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-filter', key);
      button.setAttribute('aria-pressed', key === 'all' ? 'true' : 'false');
      button.appendChild(document.createTextNode(label + ' '));
      var span = document.createElement('span');
      span.textContent = String(count);
      span.setAttribute('aria-hidden', 'true');
      button.appendChild(span);
      button.setAttribute('aria-label', label + ', ' + count + (count === 1 ? ' guide' : ' guides'));
      filterWrap.appendChild(button);
    }
    addButton('all', 'All guides', cards.length);
    keys.forEach(function (key) { addButton(key, labels[key], counts[key]); });

    function apply(announce) {
      var q = norm(query).trim();
      var words = q ? q.split(/\s+/) : [];
      var shown = 0;
      cards.forEach(function (card) {
        var hay = norm(card.getAttribute('data-search'));
        var match = (category === 'all' || card.getAttribute('data-category') === category) &&
          words.every(function (w) { return hay.indexOf(w) !== -1; });
        var wasHidden = card.hidden;
        card.hidden = !match;
        if (match) {
          shown++;
          if (wasHidden || announce) {
            card.classList.remove('is-refiltered');
            void card.offsetWidth; // restart the short fade-in
            card.style.setProperty('--d', Math.min(shown - 1, 6) * 50 + 'ms');
            card.classList.add('is-refiltered');
            card.classList.add('is-in'); // never leave a matching card unrevealed
          }
        }
      });
      // The featured layout only applies while the featured guide is the first visible card.
      var first = cards.filter(function (c) { return !c.hidden; })[0];
      cards.forEach(function (c) { c.classList.toggle('gh-card--feature', c === first && c.hasAttribute('data-feature') && category === 'all' && !q); });
      if (empty) empty.hidden = shown !== 0;
      if (status) {
        status.textContent = shown === 0 ? 'No guides match.' :
          'Showing ' + shown + (shown === 1 ? ' guide' : ' guides') +
          (category !== 'all' ? ' in ' + labels[category] : '') + (q ? ' matching "' + query.trim() + '"' : '') + '.';
      }
    }

    filterWrap.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-filter]');
      if (!button) return;
      category = button.getAttribute('data-filter');
      [].forEach.call(filterWrap.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', b === button ? 'true' : 'false');
      });
      apply(true);
    });
    input.addEventListener('input', function () { query = input.value; apply(false); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && input.value) { input.value = ''; query = ''; apply(false); }
    });
    if (clear) clear.addEventListener('click', function () {
      input.value = ''; query = ''; category = 'all';
      [].forEach.call(filterWrap.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-filter') === 'all' ? 'true' : 'false');
      });
      apply(true); input.focus();
    });

    // Allow links such as guides.html?q=scan or guides.html#photo-restoration to land on a filter.
    try {
      var params = new URLSearchParams(location.search);
      var q = params.get('q');
      if (q) { input.value = q; query = q; }
      var wanted = (params.get('category') || '').toLowerCase();
      if (wanted && counts[wanted]) {
        category = wanted;
        [].forEach.call(filterWrap.querySelectorAll('button'), function (b) {
          b.setAttribute('aria-pressed', b.getAttribute('data-filter') === wanted ? 'true' : 'false');
        });
      }
    } catch (e) { /* ignore malformed query strings */ }

    tools.hidden = false;
    apply(false);
  })();

  /* ---------- 3. Article: progress + contents highlight ---------- */
  (function article() {
    var body = document.querySelector('[data-guide-body]');
    if (!body) return;

    // Reading progress
    var wrap = document.createElement('div');
    wrap.className = 'gd-progress';
    wrap.setAttribute('aria-hidden', 'true');
    var bar = document.createElement('i');
    wrap.appendChild(bar);
    document.body.appendChild(wrap);
    var ticking = false;
    function update() {
      ticking = false;
      var rect = body.getBoundingClientRect();
      var total = rect.height - window.innerHeight * 0.6;
      var done = total > 0 ? Math.min(1, Math.max(0, (-rect.top + window.innerHeight * 0.2) / total)) : 1;
      bar.style.transform = 'scaleX(' + done.toFixed(4) + ')';
    }
    function onScroll() { if (!ticking) { ticking = true; window.requestAnimationFrame(update); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();

    // Contents: collapsed on narrow screens, open (and sticky) on wide ones
    var toc = document.querySelector('[data-toc]');
    if (toc && window.matchMedia && !window.matchMedia('(min-width: 1100px)').matches) toc.removeAttribute('open');

    // Highlight the section being read
    if (toc && 'IntersectionObserver' in window) {
      var links = [].slice.call(toc.querySelectorAll('a[href^="#"]'));
      var map = {};
      links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
      var current = null;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var link = map[entry.target.id];
          if (!link || link === current) return;
          if (current) current.removeAttribute('aria-current');
          link.setAttribute('aria-current', 'true');
          current = link;
        });
      }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
      [].forEach.call(body.querySelectorAll('h2[id]'), function (h) { io.observe(h); });
    }
  })();
})();
