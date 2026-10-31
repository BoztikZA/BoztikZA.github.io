const CACHE_NAME = 'boztik-creative-studio-v1';
const SHELL = [
  './creative-studio.html',
  './creative-studio.css?v=20261031a',
  './js/creative-studio.js?v=20261031a',
  './styles-premium.css?v=20261024a',
  './images/boztik-mark.png',
  './images/boztik-favicon.png',
  './images/creative-studio-icon.svg'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('boztik-creative-studio-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const shellPaths = new Set(SHELL.map(path => new URL(path, self.registration.scope).pathname));
  if (!shellPaths.has(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('./creative-studio.html', response.clone()));
      return response;
    }).catch(() => caches.match('./creative-studio.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});