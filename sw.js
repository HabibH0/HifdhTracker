// Retires the previous app's service worker (vite-plugin-pwa registered /HifdhTracker/sw.js).
// Browsers keep an old worker while its script 404s, so this replacement takes over, deletes the
// old caches, unregisters itself and reloads any open pages onto the current site.
// Keep this file published so devices that haven't opened the app in a while are cleaned up too.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).map(key => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach(client => client.navigate(client.url));
  })());
});
