(function () {
  const SUPPORT_URL = 'https://ko-fi.com/boztik';

  const isReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    if (!isReducedMotion()) {
      button.classList.add('is-ready');
    }
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
