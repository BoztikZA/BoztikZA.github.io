/* Lightweight enhancement for the homepage: optional, pointer-safe, and motion-aware. */
(function () {
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hero = document.querySelector('.home-hero');
  var art = document.querySelector('.home-hero-art');
  var cards = document.querySelectorAll('.home-path-card, .home-discover-card');

  if (!reduced && hero && art) {
    hero.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return;
      var rect = hero.getBoundingClientRect();
      var x = (event.clientX - rect.left) / rect.width - .5;
      var y = (event.clientY - rect.top) / rect.height - .5;
      art.style.setProperty('--hero-art-y', (y * -7) + 'px');
      art.style.setProperty('--hero-art-tilt', (x * 1.1) + 'deg');
    });
    hero.addEventListener('pointerleave', function () { art.style.removeProperty('--hero-art-y'); art.style.removeProperty('--hero-art-tilt'); });
  }

  cards.forEach(function (card) {
    card.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return;
      var rect = card.getBoundingClientRect();
      card.style.setProperty('--pointer-x', (event.clientX - rect.left) + 'px');
      card.style.setProperty('--pointer-y', (event.clientY - rect.top) + 'px');
    });
  });

  if (!reduced && 'IntersectionObserver' in window) {
    var candidates = document.querySelectorAll('.home-section-heading, .home-path-card, .home-discover-card, .hm-toolkit__shot, .hm-toolkit__copy, .home-learning__copy, .home-learning__courses, .home-services__grid, .home-about__inner');
    candidates.forEach(function (element, index) { element.style.setProperty('--signature-order', index % 5); });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) { entry.target.classList.add('signature-in'); observer.unobserve(entry.target); } });
    }, { threshold: .1, rootMargin: '0px 0px -7% 0px' });
    candidates.forEach(function (element) { observer.observe(element); });
  }

  if (!reduced) {
    var light = document.querySelector('.home-learning');
    if (light) window.addEventListener('scroll', function () { light.style.setProperty('--learning-light-y', ((light.getBoundingClientRect().top - window.innerHeight) * -.035) + 'px'); }, { passive:true });
  }
})();

