(function () {
  const SUPPORT_URL = 'https://ko-fi.com/boztik';

  // Keeps the floating button away from advertisements: while any ad unit is on screen (or about to be), the
  // button is hidden, so it never covers an ad or sits where a tap could land on either one.
  const pauseWhileAdsAreVisible = (button) => {
    const ads = document.querySelectorAll('.adsense-section');
    if (!ads.length || !('IntersectionObserver' in window)) return;

    const onScreen = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
      });
      button.classList.toggle('is-paused', onScreen.size > 0);
    }, { rootMargin: '0px 0px 80px 0px' });

    ads.forEach((ad) => observer.observe(ad));
  };

  const createFloatingButton = () => {
    if (document.getElementById('boztik-support-float')) return;

    const button = document.createElement('a');
    button.id = 'boztik-support-float';
    button.className = 'support-float';
    button.href = SUPPORT_URL;
    button.target = '_blank';
    button.rel = 'noopener noreferrer';
    button.setAttribute('aria-label', 'Support Boztik on Ko-fi');
    button.innerHTML = '<span class="support-float__icon" aria-hidden="true">\u2764\ufe0f</span><span class="support-float__label">Support Boztik</span>';
    document.body.appendChild(button);

    // Always show the button. The global prefers-reduced-motion rule in styles-premium.css already removes the
    // fade-in, so visitors who ask for less motion get the button without the animation. Before, it was left at
    // opacity 0 for them: invisible, yet still clickable.
    button.classList.add('is-ready');

    pauseWhileAdsAreVisible(button);
  };

  const setupFooterCollapse = () => {
    const footer = document.querySelector('.support-site-footer');
    const toggle = document.getElementById('boztik-footer-toggle');
    const label = toggle && toggle.querySelector('.support-site-footer__toggle-label');

    if (!footer || !toggle) return;

    toggle.addEventListener('click', () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      footer.classList.toggle('is-collapsed', isExpanded);
      toggle.setAttribute('aria-expanded', String(!isExpanded));

      if (label) {
        label.textContent = isExpanded ? 'Expand footer' : 'Collapse footer';
      }
    });
  };

  const init = () => {
    if (!document.body.hasAttribute('data-no-support-float')) {
      createFloatingButton();
    }
    setupFooterCollapse();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
