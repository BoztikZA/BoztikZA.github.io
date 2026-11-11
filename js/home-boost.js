/**
 * Boztik homepage boost (index.html only). Purely additive.
 *
 *  1. Scroll-reveal: adds .bz-reveal to selected existing blocks and reveals
 *     everything as it enters the viewport. Content is only hidden by CSS when
 *     JavaScript is running and the visitor has not asked for reduced motion,
 *     and a failsafe timer reveals anything the observer never reached.
 *  2. Sticky mobile CTA: appears after the hero, hides again near the closing
 *     call-to-action so the two never stack.
 */
(function () {
  'use strict';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var hasIO = 'IntersectionObserver' in window;

  /* ---------- 1. Scroll-reveal ---------- */
  (function reveal() {
    // Tag existing blocks so they animate in without touching their markup.
    var extra = document.querySelectorAll(
      '.hm-offers li, .hm-guide-list li, .hm-also__list li, .bz-strip__list li, .hm-toolkit__copy, .hm-toolkit__shot, .hm-shop__intro, .hm-spotlight-head'
    );
    [].forEach.call(extra, function (el) { el.classList.add('bz-reveal'); });

    var items = [].slice.call(document.querySelectorAll('.bz-reveal'));
    if (!items.length) return;

    // Stagger siblings slightly (capped so long lists don't feel slow).
    items.forEach(function (el) {
      var siblings = el.parentElement ? [].slice.call(el.parentElement.children) : [];
      var i = Math.max(0, siblings.indexOf(el));
      el.style.setProperty('--bz-i', String(Math.min(i, 5)));
    });

    function show(el) { el.classList.add('is-in'); }

    if (reduceMotion || !hasIO) {
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
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    items.forEach(function (el) { observer.observe(el); });

    // Failsafe: never leave anything hidden if the observer does not fire.
    window.setTimeout(function () { items.forEach(show); }, 5000);
  })();

  /* ---------- 2. Sticky mobile CTA ---------- */
  (function stickyCta() {
    var bar = document.querySelector('[data-bz-sticky]');
    var hero = document.querySelector('.hm-hero');
    var closing = document.querySelector('[data-bz-close-cta]') || document.querySelector('.hm-close');
    if (!bar || !hero || !hasIO) return;

    var heroGone = false;
    var closingVisible = false;

    function update() {
      var show = heroGone && !closingVisible;
      bar.classList.toggle('is-visible', show);
      document.body.classList.toggle('has-bz-sticky', heroGone);
    }

    bar.hidden = false;

    new IntersectionObserver(function (entries) {
      heroGone = !entries[0].isIntersecting && entries[0].boundingClientRect.top < 0;
      update();
    }, { threshold: 0 }).observe(hero);

    if (closing) {
      new IntersectionObserver(function (entries) {
        closingVisible = entries[0].isIntersecting;
        update();
      }, { threshold: 0.2 }).observe(closing);
    }
  })();
})();
