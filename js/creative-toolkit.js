/**
 * Boztik Creative Toolkit page: lightweight scroll reveals + FAQ accordion.
 *
 * - No libraries. One IntersectionObserver adds .is-in to .tk-reveal elements.
 * - Content is visible by default; hiding only happens when <html> has .js
 *   (set by an inline script in <head>) and motion is allowed. If this file
 *   fails to load, an inline timer in <head> adds .tk-all-visible so nothing
 *   stays hidden.
 * - Respects prefers-reduced-motion (reveals are applied instantly).
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var items = document.querySelectorAll('.tk-reveal');

  function showAll() {
    for (var i = 0; i < items.length; i++) items[i].classList.add('is-in');
    root.classList.add('tk-all-visible');
  }

  if (items.length) {
    if (reduced || !('IntersectionObserver' in window)) {
      showAll();
    } else {
      var observer = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            obs.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      items.forEach(function (item) { observer.observe(item); });
      // Tell the head-level safety timer the script is alive.
      root.setAttribute('data-tk-ready', 'true');
    }
  }

  // FAQ accordion (same markup/behaviour as the previous inline script).
  document.querySelectorAll('#toolkit-faq .accordion-trigger').forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      var item = trigger.closest('.accordion-item');
      var isOpen = item.getAttribute('data-open') === 'true';
      item.setAttribute('data-open', String(!isOpen));
      trigger.setAttribute('aria-expanded', String(!isOpen));
    });
  });
})();
