// LedgerAI Self-Destructing / Cache Purge Service Worker
// Automatically purges stale cache storage and unregisters any legacy service workers
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => {
      return self.registration.unregister();
    }).then(() => {
      return self.clients.matchAll();
    }).then((clients) => {
      clients.forEach((client) => {
        if (client.url && 'navigate' in client) {
          client.navigate(client.url);
        }
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Pass-through all requests directly to the network; never intercept or cache
  event.respondWith(fetch(event.request));
});
