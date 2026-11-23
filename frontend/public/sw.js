const CACHE = 'home-os-public-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('home-os-public-') && key !== CACHE).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // Never intercept API/SSE, cache authenticated pages, or retain household snapshots.
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname.startsWith('/api') || request.mode !== 'navigate') return;
  event.respondWith(fetch(request).catch(async () =>
    (await caches.open(CACHE)).match(OFFLINE).then(response => response || Response.error())));
});
