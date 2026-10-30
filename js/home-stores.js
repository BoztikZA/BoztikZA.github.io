/**
 * Boztik Stores showcase on the homepage (index.html only).
 *
 * Source of truth: the existing public promotions API that already powers the Stores page
 * and the Command Centre ("featured" = published AND marked for the homepage). This file
 * only READS that public endpoint. It never calls an admin endpoint and has no second list
 * of products.
 *
 * States, set on [data-shop][data-state]:
 *   loading   waiting for the API (the static fallback is hidden only while JS is running)
 *   live      the API answered with at least one valid featured item
 *   empty     the API answered, but nothing is featured right now (no invented products)
 *   fallback  the API could not be reached: the static fallback in index.html stays visible
 *             (approved repo images linked to the Stores page and the real Ko-fi shop)
 *
 * Safety rules for every API record before it is shown:
 *   - the store must be one of redbubble / teepublic / kofi
 *   - the destination must be https and on that store's own domain, so a wallpaper can never
 *     be passed off as Redbubble/TeePublic merchandise and no javascript:/data: link renders
 *   - the image must be a same-site path, an /api/ path on the Boztik API, or https
 *   - text is only ever written with textContent
 * Records that fail are skipped (and logged to the console), never "repaired".
 *
 * Click tracking: links carry the same data-store-* attributes the old homepage block used,
 * so js/store-clicks.js keeps working without changes.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-shop]');
  if (!root) return;

  var API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8787' : 'https://deliver-api.boztik.com';
  var LABEL = { redbubble: 'Redbubble', teepublic: 'TeePublic', kofi: 'Ko-fi wallpapers' };
  var HOST = {
    redbubble: /(^|\.)redbubble\.com$/i,
    teepublic: /(^|\.)teepublic\.com$/i,
    kofi: /(^|\.)ko-fi\.com$/i
  };
  var MAX_ITEMS = 8;
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var carousel = root.querySelector('[data-carousel]');
  var stage = carousel.querySelector('[data-stage]');
  var rail = carousel.querySelector('[data-rail]');
  var statusEl = root.querySelector('[data-status]');
  var filterBar = root.querySelector('[data-filter]');
  var filterButtons = [].slice.call(root.querySelectorAll('[data-filter-value]'));

  var all = [];
  var currentList = [];
  var deck = null;
  var railButtons = [];

  function setState(state) { root.setAttribute('data-state', state); }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function safeDestination(item) {
    try {
      var url = new URL(String(item.destination_url));
      var pattern = HOST[item.store];
      if (url.protocol !== 'https:' || !pattern || !pattern.test(url.hostname)) return null;
      return url.href;
    } catch (e) { return null; }
  }

  function safeImage(item) {
    var src = String(item.image_url || '');
    if (src.indexOf('/api/') === 0) return API + src;
    if (src.charAt(0) === '/' && src.charAt(1) !== '/') return src;
    if (/^https:\/\//i.test(src)) return src;
    return null;
  }

  function normalise(data) {
    var out = [];
    data.items.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var store = String(item.store || '');
      var title = typeof item.title === 'string' ? item.title.trim() : '';
      var destination = LABEL[store] ? safeDestination(item) : null;
      var image = safeImage(item);
      if (!title || !destination || !image) {
        if (window.console && console.warn) console.warn('[boztik] skipped a store item that failed validation:', item && item.id);
        return;
      }
      out.push({
        id: String(item.id || out.length),
        store: store,
        title: title,
        description: typeof item.description === 'string' ? item.description.trim() : '',
        cta: (typeof item.cta_label === 'string' && item.cta_label.trim()) || 'View design',
        destination: destination,
        image: image
      });
    });
    return out.slice(0, MAX_ITEMS);
  }

  function cssUrl(src) {
    return 'url("' + src.replace(/["\\\r\n]/g, function (c) { return encodeURIComponent(c); }) + '")';
  }

  function buildSlide(item, position) {
    var track = { 'data-store-destination': item.store, 'data-store-placement': 'new_releases' };
    var linkAttrs = function (extra) {
      var attrs = { href: item.destination, target: '_blank', rel: 'noopener noreferrer' };
      Object.keys(track).forEach(function (k) { attrs[k] = track[k]; });
      Object.keys(extra || {}).forEach(function (k) { attrs[k] = extra[k]; });
      return attrs;
    };

    var slide = el('article', { 'class': 'hm-pslide', 'data-active': 'false' });

    // The picture is a second route to the same destination; keyboard and screen-reader users get the labelled link below.
    var media = el('a', linkAttrs({ 'class': 'hm-pslide__media', tabindex: '-1', 'aria-hidden': 'true' }));
    media.style.setProperty('--img', cssUrl(item.image));
    media.appendChild(el('img', {
      src: item.image, alt: '', decoding: 'async',
      loading: position === 0 ? 'eager' : 'lazy'
    }));

    var info = el('div', { 'class': 'hm-pslide__info' });
    info.appendChild(el('span', { 'class': 'hm-chip' }, LABEL[item.store]));
    info.appendChild(el('h3', null, item.title));
    if (item.description) info.appendChild(el('p', null, item.description));
    info.appendChild(el('a', linkAttrs({
      'class': 'hm-link hm-ext',
      'aria-label': item.cta + ': ' + item.title + ' on ' + LABEL[item.store] + ' (opens in a new tab)'
    }), item.cta));

    slide.appendChild(media);
    slide.appendChild(info);
    return slide;
  }

  function onChange(i) {
    railButtons.forEach(function (button, n) {
      if (n === i) {
        button.setAttribute('aria-current', 'true');
        var left = button.offsetLeft - (rail.clientWidth - button.offsetWidth) / 2;
        if (rail.scrollTo) rail.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? 'auto' : 'smooth' });
      } else {
        button.removeAttribute('aria-current');
      }
    });
  }

  function build(list) {
    currentList = list;
    stage.textContent = '';
    rail.textContent = '';
    railButtons = list.map(function (item, i) {
      stage.appendChild(buildSlide(item, i));
      var button = el('button', { type: 'button', 'aria-label': 'Show ' + item.title + ' (' + LABEL[item.store] + ')' });
      button.appendChild(el('img', { src: item.image, alt: '', loading: 'lazy', decoding: 'async' }));
      button.addEventListener('click', function () { deck.go(i, true); });
      rail.appendChild(button);
      return button;
    });
    if (!deck) {
      deck = window.BzDeck(carousel, {
        status: statusEl,
        onChange: onChange,
        describe: function (i) {
          var item = currentList[i];
          return 'Showing design ' + (i + 1) + ' of ' + currentList.length + ': ' + item.title + ', ' + LABEL[item.store] + '.';
        }
      });
    }
    deck.refresh();
  }

  function render(list, animate) {
    if (animate && !reduceMotion) {
      stage.classList.add('is-swapping');
      window.setTimeout(function () {
        build(list);
        window.requestAnimationFrame(function () { stage.classList.remove('is-swapping'); });
      }, 230);
    } else {
      build(list);
    }
  }

  function setupFilters(list) {
    var present = {};
    list.forEach(function (item) { present[item.store] = true; });
    var stores = Object.keys(present);
    if (stores.length < 2) { filterBar.hidden = true; return; }
    filterButtons.forEach(function (button) {
      var value = button.getAttribute('data-filter-value');
      button.hidden = value !== 'all' && !present[value];
      button.addEventListener('click', function () {
        filterButtons.forEach(function (b) { b.setAttribute('aria-pressed', b === button ? 'true' : 'false'); });
        var filtered = value === 'all' ? all : all.filter(function (item) { return item.store === value; });
        render(filtered, true);
      });
    });
    filterBar.hidden = false;
  }

  function useFallback() { setState('fallback'); }

  if (!window.BzDeck || !window.fetch) { useFallback(); return; }

  var settled = false;
  var controller = 'AbortController' in window ? new AbortController() : null;
  var timer = window.setTimeout(function () {
    if (settled) return;
    settled = true;
    if (controller) controller.abort();
    useFallback();
  }, 7000);

  fetch(API + '/api/public/promotions?featured=1', controller ? { signal: controller.signal } : undefined)
    .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error('HTTP ' + response.status)); })
    .then(function (data) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (!data || !Array.isArray(data.items)) throw new Error('Unexpected response');
      all = normalise(data);
      if (!all.length) { setState('empty'); return; }
      setupFilters(all);
      build(all);
      setState('live');
    })
    .catch(function () {
      if (settled && root.getAttribute('data-state') !== 'loading') return;
      settled = true;
      window.clearTimeout(timer);
      useFallback();
    });
})();
