/**
 * Boztik homepage behaviour (index.html only).
 *
 *  1. Hairline reveal: draws each section rule once. Content is never hidden by this;
 *     the CSS only hides rules when JS is running and motion is welcome, and a timer
 *     reveals anything an observer has not reached.
 *  2. BzDeck: a small, accessible "one item at a time" component (manual controls,
 *     arrow keys, swipe, screen-reader announcements). No auto-rotation, by design.
 *  3. Portfolio gallery: progressive enhancement of the static project list.
 *
 * Without JavaScript the portfolio stays a readable list of projects.
 */
(function () {
  'use strict';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- 1. Reveal ---------- */
  (function reveal() {
    var items = [].slice.call(document.querySelectorAll('[data-reveal]'));
    if (!items.length) return;
    function show(el) { el.classList.add('is-in'); }
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(show);
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          show(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10%', threshold: 0.2 });
    items.forEach(function (el) { observer.observe(el); });
    // Failsafe: never leave anything hidden if the observer does not fire.
    window.setTimeout(function () { items.forEach(show); }, 4000);
  })();

  /* ---------- 2. Deck ---------- */
  /**
   * @param {Element} root     region that holds the stage and the controls
   * @param {Object}  opts
   *        status   {Element}  polite live region for announcements
   *        describe {Function} (index, slide) => string announced after a manual change
   *        onChange {Function} (index, slide, byUser) called after every change
   */
  function BzDeck(root, opts) {
    opts = opts || {};
    var stage = root.querySelector('[data-stage]');
    var prevBtn = root.querySelector('[data-prev]');
    var nextBtn = root.querySelector('[data-next]');
    var count = root.querySelector('[data-count]');
    var slides = [];
    var index = 0;
    var startX = null;
    var swiped = false;

    function collect() {
      slides = [].slice.call(stage.children);
      slides.forEach(function (slide, i) {
        slide.setAttribute('role', 'group');
        slide.setAttribute('aria-roledescription', 'slide');
        slide.setAttribute('aria-label', (i + 1) + ' of ' + slides.length);
      });
    }

    function go(i, byUser) {
      if (!slides.length) return;
      index = (i + slides.length) % slides.length;
      slides.forEach(function (slide, n) {
        var active = n === index;
        slide.setAttribute('data-active', active ? 'true' : 'false');
        // inert keeps hidden slides (and their links) out of the tab order and the accessibility tree.
        if (active) slide.removeAttribute('inert'); else slide.setAttribute('inert', '');
      });
      if (count) count.textContent = (index + 1) + ' of ' + slides.length;
      if (opts.onChange) opts.onChange(index, slides[index], !!byUser);
      if (byUser && opts.status && opts.describe) opts.status.textContent = opts.describe(index, slides[index]);
    }

    function next() { go(index + 1, true); }
    function prev() { go(index - 1, true); }

    if (prevBtn) prevBtn.addEventListener('click', prev);
    if (nextBtn) nextBtn.addEventListener('click', next);

    root.addEventListener('keydown', function (event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      var tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); prev(); }
      else if (event.key === 'Home') { event.preventDefault(); go(0, true); }
      else if (event.key === 'End') { event.preventDefault(); go(slides.length - 1, true); }
    });

    // Horizontal swipe on touch screens. A swipe never doubles as a link tap.
    stage.addEventListener('pointerdown', function (event) {
      startX = event.pointerType === 'mouse' ? null : event.clientX;
      swiped = false;
    });
    stage.addEventListener('pointerup', function (event) {
      if (startX === null) return;
      var distance = event.clientX - startX;
      startX = null;
      if (Math.abs(distance) > 48) { swiped = true; if (distance < 0) next(); else prev(); }
    });
    stage.addEventListener('pointercancel', function () { startX = null; });
    stage.addEventListener('click', function (event) {
      if (swiped) { event.preventDefault(); event.stopPropagation(); swiped = false; }
    }, true);

    collect();
    return {
      go: go,
      next: next,
      prev: prev,
      refresh: function () { collect(); go(0, false); },
      get index() { return index; }
    };
  }
  window.BzDeck = BzDeck;

  /* ---------- 3. Portfolio gallery ---------- */
  (function gallery() {
    var root = document.querySelector('[data-gallery]');
    if (!root) return;
    var stage = root.querySelector('[data-stage]');
    var side = root.querySelector('[data-side]');
    var list = root.querySelector('[data-index]');
    var slides = [].slice.call(stage.children);
    if (slides.length < 2 || !side || !list) return;

    var buttons = slides.map(function (slide, i) {
      var li = document.createElement('li');
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = slide.getAttribute('data-tag') || ('Project ' + (i + 1));
      button.addEventListener('click', function () { deck.go(i, true); });
      li.appendChild(button);
      list.appendChild(li);
      return button;
    });

    root.classList.add('is-enhanced');
    side.hidden = false;

    var deck = BzDeck(root, {
      status: root.querySelector('[data-status]'),
      describe: function (i, slide) {
        return 'Showing project ' + (i + 1) + ' of ' + slides.length + ': ' + (slide.getAttribute('data-tag') || '');
      },
      onChange: function (i) {
        buttons.forEach(function (button, n) {
          if (n === i) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
        });
      }
    });
    deck.go(0, false);
  })();
})();
