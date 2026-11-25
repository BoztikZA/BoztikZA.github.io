const LEGACY_CACHE_PREFIX = 'boztik-creative-studio-';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(LEGACY_CACHE_PREFIX))
      .map(key => caches.delete(key)));

    await self.registration.unregister();

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clients.map(client => {
      try {
        const url = new URL(client.url);
        if (url.origin === self.location.origin &&
            /\/(?:creative-studio|image-inspector|creative-assistant)\.html$/i.test(url.pathname)) {
          return client.navigate('/creative-toolkit.html');
        }
      } catch (error) { /* Ignore clients that cannot be navigated. */ }
      return Promise.resolve();
    }));
  })());
});
