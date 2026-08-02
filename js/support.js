(function () {
  const SUPPORT_URL = 'https://ko-fi.com/boztik';
  const WIDGET_SCRIPT_URL = 'https://storage.ko-fi.com/cdn/widget/Widget_2.js';
  const WIDGET_CONFIG = {
    label: 'Support me on Ko-fi',
    color: '#00b321',
    id: 'W7W8HSU5A'
  };

  const isReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ensureWidgetScript = () => new Promise((resolve, reject) => {
    if (window.kofiwidget2) {
      resolve();
      return;
    }

    if (document.querySelector('script[data-kofi-widget-script]')) {
      const existing = document.querySelector('script[data-kofi-widget-script]');
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Ko-fi script failed to load')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = WIDGET_SCRIPT_URL;
    script.async = true;
    script.setAttribute('data-kofi-widget-script', 'true');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Ko-fi script failed to load')), { once: true });
    document.head.appendChild(script);
  });

  const initWidget = async () => {
    const widgetRoot = document.getElementById('kofi-widget-root');
    const placeholder = document.querySelector('[data-kofi-placeholder]');

    if (!widgetRoot || !placeholder) return;

    try {
      await ensureWidgetScript();
      if (window.kofiwidget2 && typeof window.kofiwidget2.init === 'function') {
        if (!widgetRoot.querySelector('.kofi-widget')) {
          window.kofiwidget2.init(WIDGET_CONFIG.label, WIDGET_CONFIG.color, WIDGET_CONFIG.id);
          window.kofiwidget2.draw();
        }
        placeholder.style.display = 'none';
      }
    } catch (error) {
      placeholder.innerHTML = '<p>Ko-fi is unavailable right now.</p><a class="support-button" href="' + SUPPORT_URL + '" target="_blank" rel="noopener noreferrer">Open Ko-fi directly</a>';
      if (!window.location.pathname.includes('support.html')) {
        window.setTimeout(() => {
          window.location.assign('support.html');
        }, 350);
      }
      console.warn('Ko-fi widget failed to load, redirected to support link.', error);
    }
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
    button.innerHTML = '<span class="support-float__icon" aria-hidden="true">❤️</span><span class="support-float__label">Support Boztik</span>';
    document.body.appendChild(button);

    if (!isReducedMotion()) {
      button.classList.add('is-ready');
    }
  };

  const handleReveal = () => {
    const revealItems = document.querySelectorAll('.reveal');
    const triggerPoint = window.innerHeight - 90;
    revealItems.forEach((item) => {
      if (item.getBoundingClientRect().top < triggerPoint) {
        item.classList.add('is-visible');
      }
    });
  };

  const init = () => {
    createFloatingButton();
    handleReveal();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        handleReveal();
        window.requestAnimationFrame(() => {
          initWidget();
        });
      }, { once: true });
    } else {
      window.requestAnimationFrame(() => {
        initWidget();
      });
    }

    window.addEventListener('scroll', handleReveal, { passive: true });
    window.addEventListener('resize', handleReveal);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
