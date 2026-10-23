const CACHE = 'music-muse-shell-v2.3.1';
const ASSETS = ['/', '/index.html', '/style.css', '/shorts.css', '/creator-promo.css', '/app.js', '/core.js', '/discovery.js', '/feed-order.js', '/fullscreen.js', '/search.js', '/interface.css', '/youtube.js', '/watch-feed.js', '/watch-feed.css', '/storage.js', '/tiktok.js', '/shorts.js', '/creator-promo.js', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('music-muse-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache API responses, music previews, covers, YouTube traffic, secrets or media.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || !ASSETS.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(url.pathname, copy)); } return response; }).catch(async () => (await caches.match(url.pathname)) || (event.request.mode === 'navigate' ? await caches.match('/index.html') : Response.error())));
});
