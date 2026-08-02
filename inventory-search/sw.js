// Minimal service worker, scoped to /inventory-search/ only (default
// scope = the directory this file lives in — does not overlap the main
// app's root-scoped sw.js). Caches just the app shell; product data
// itself always goes to the network (or localStorage cache in app.js),
// never through this cache, so stock figures are never served stale
// from here.
const CACHE = 'inv-search-shell-v7';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache Supabase API calls or the AI function — always fresh.
  if (url.hostname.endsWith('supabase.co')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(res => {
        if (res && res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
