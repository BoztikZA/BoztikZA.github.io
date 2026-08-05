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

  const init = () => {
    createFloatingButton();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
