(function () {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('.navbar');
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');

  if (nav && links && !links.querySelector('a[href*="spotlight/"]')) {
    const spotlightLink = document.createElement('a');
    spotlightLink.href = '/spotlight/';
    spotlightLink.textContent = 'Spotlight';
    const deliverLink = Array.from(links.querySelectorAll('a')).find(link => /deliver/i.test(link.textContent));
    if (deliverLink) deliverLink.insertAdjacentElement('afterend', spotlightLink);
    else links.append(spotlightLink);
  }

  /*
   * Grouped desktop navigation (progressive enhancement).
   * The full flat link list stays in the HTML, so without JavaScript nothing changes.
   * With JavaScript the 13 links are regrouped into: Home, Services, Portfolio,
   * Guides, Stores, Tools menu, More menu and a Contact button. The same <a>
   * elements are moved (not cloned), so aria-current and other pages' scripts
   * keep working. On phones the groups are flattened back into the original list.
   */
  if (nav && links && !links.querySelector('.nav-group')) {
    try {
      const norm = (href) => (href || '').replace(/^https?:\/\/[^/]+/i, '').replace(/^\.?\//, '').replace(/[?#].*$/, '') || 'index.html';
      const anchors = Array.from(links.querySelectorAll(':scope > a'));
      const byHref = new Map(anchors.map((a) => [norm(a.getAttribute('href')), a]));
      const used = new Set();
      const take = (key) => {
        const a = byHref.get(key);
        if (a && !used.has(a)) { used.add(a); return a; }
        return null;
      };

      const plan = [
        'index.html', 'services.html', 'portfolio.html', 'guides.html', 'stores.html',
        { label: 'Tools', items: ['creative-toolkit.html', 'creative-studio.html', 'deliver.html', 'spotlight/', 'discover.html'] },
        { label: 'More', items: ['support.html', 'about.html'] },
        'contact.html'
      ];

      const style = document.createElement('style');
      style.textContent = [
        '.nav-group{position:relative}',
        '.nav-group__btn{display:inline-flex;align-items:center;gap:7px;padding:0;border:0;background:none;color:var(--text-muted);font:inherit;font-weight:600;cursor:pointer;transition:color .2s ease}',
        '.nav-group__btn::after{content:"";width:6px;height:6px;margin-top:-3px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);transition:transform .2s ease}',
        '.nav-group:hover .nav-group__btn,.nav-group:focus-within .nav-group__btn,.nav-group.is-open .nav-group__btn,.nav-group__btn.is-current{color:var(--primary)}',
        '.nav-group:hover .nav-group__btn::after,.nav-group.is-open .nav-group__btn::after{transform:rotate(225deg);margin-top:3px}',
        '.nav-group__menu{position:absolute;top:100%;left:-14px;z-index:60;display:none;min-width:220px;padding-top:16px}',
        '.nav-group:hover .nav-group__menu,.nav-group:focus-within .nav-group__menu,.nav-group.is-open .nav-group__menu{display:block}',
        '.nav-group__panel{display:grid;gap:2px;padding:8px;border:1px solid var(--border);border-radius:14px;background:rgba(7,12,8,.98);box-shadow:0 22px 55px rgba(0,0,0,.45)}',
        '.nav-group__panel a{display:block;padding:10px 14px;border-radius:9px;white-space:nowrap}',
        '.nav-group__panel a::after{display:none}',
        '.nav-group__panel a:hover,.nav-group__panel a[aria-current="page"]{background:rgba(142,255,61,.1)}',
        '.nav-links a.nav-cta{padding:8px 18px;border:1px solid rgba(142,255,61,.5);border-radius:999px;color:var(--primary);transition:background-color .2s ease,color .2s ease}',
        '.nav-links a.nav-cta::after{display:none}',
        '.nav-links a.nav-cta:hover,.nav-links a.nav-cta[aria-current="page"]{background:var(--primary);color:#041107}',
        '@media (min-width:821px){.nav-links{gap:20px}}',
        '@media (min-width:821px) and (max-width:1120px){.logo-area .logo-subtitle{display:none}}',
        '@media (max-width:820px){.nav-group__btn{display:none}.nav-group,.nav-group__menu,.nav-group__panel{display:contents}.nav-group__panel a{white-space:normal;padding:11px 12px;border-radius:10px}.nav-links a.nav-cta{border:0;border-radius:10px;padding:11px 12px}.nav-links a.nav-cta:hover,.nav-links a.nav-cta[aria-current="page"]{background:rgba(142,255,61,.1);color:var(--primary)}}'
      ].join('\n');
      document.head.appendChild(style);

      const fragment = document.createDocumentFragment();
      let groupCount = 0;
      plan.forEach((entry) => {
        if (typeof entry === 'string') {
          const a = take(entry);
          if (a) {
            if (entry === 'contact.html') a.classList.add('nav-cta');
            fragment.appendChild(a);
          }
          return;
        }
        const members = entry.items.map(take).filter(Boolean);
        if (!members.length) return;
        groupCount += 1;
        const id = 'nav-group-' + groupCount;
        const group = document.createElement('div');
        group.className = 'nav-group';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-group__btn';
        btn.textContent = entry.label;
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', id);
        if (members.some((a) => a.getAttribute('aria-current') === 'page')) btn.classList.add('is-current');
        const menu = document.createElement('div');
        menu.className = 'nav-group__menu';
        menu.id = id;
        const panel = document.createElement('div');
        panel.className = 'nav-group__panel';
        members.forEach((a) => panel.appendChild(a));
        menu.appendChild(panel);
        group.append(btn, menu);
        fragment.appendChild(group);
      });
      // Any link not covered by the plan is kept, in its original order, before the final button.
      anchors.filter((a) => !used.has(a)).forEach((a) => fragment.insertBefore(a, fragment.lastChild));
      links.replaceChildren(fragment);

      const groups = Array.from(links.querySelectorAll('.nav-group'));
      const closeGroups = (except) => groups.forEach((g) => {
        if (g === except) return;
        g.classList.remove('is-open');
        g.querySelector('.nav-group__btn').setAttribute('aria-expanded', 'false');
      });
      groups.forEach((g) => {
        const btn = g.querySelector('.nav-group__btn');
        btn.addEventListener('click', () => {
          const open = !g.classList.contains('is-open');
          closeGroups(g);
          g.classList.toggle('is-open', open);
          btn.setAttribute('aria-expanded', String(open));
        });
      });
      document.addEventListener('click', (event) => { if (!event.target.closest('.nav-group')) closeGroups(); });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeGroups(); });
    } catch (err) {
      /* If anything goes wrong the original flat navigation is left as it was. */
      if (window.console) console.warn('Navigation grouping skipped:', err);
    }
  }

  if (nav && toggle && links) {
    const closeMenu = () => {
      nav.classList.remove('is-menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation menu');
    };

    toggle.addEventListener('click', () => {
      const opening = !nav.classList.contains('is-menu-open');
      nav.classList.toggle('is-menu-open', opening);
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.setAttribute('aria-label', opening ? 'Close navigation menu' : 'Open navigation menu');
    });

    links.addEventListener('click', (event) => {
      if (event.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
        toggle.focus();
      }
    });
  }

  const revealItems = document.querySelectorAll('.reveal');
  if (revealItems.length) {
    if (reducedMotion || !('IntersectionObserver' in window)) {
      revealItems.forEach((item) => item.classList.add('is-visible'));
    } else {
      const observer = new IntersectionObserver((entries, currentObserver) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            currentObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8%', threshold: 0.08 });
      revealItems.forEach((item) => observer.observe(item));
    }
  }
})();
