/* ═══════════════════════════════════════════════════════════════
   BT Sales IC — Service Worker
   Strategy: Cache-first for all app shell assets.
   Data (GitHub / Drive API calls) always go to network.
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'bt-sales-v1.65';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  /* CSS */
  './css/variables.css',
  './css/auth.css',
  './css/nav.css',
  './css/components.css',
  './css/modals.css',
  './css/pages.css',
  './css/mobile.css',
  /* JS modules */
  './js/data-base.js',
  './js/config.js',
  './js/auth.js',
  './js/storage.js',
  './js/ui.js',
  './js/github.js',
  './js/targets.js',
  './js/dashboard.js',
  './js/index-page.js',
  './js/reports.js',
  './js/data-page.js',
  './js/manager.js',
  './js/custom-sections.js',
  './js/fields.js',
  './js/drive.js',
  /* Icons */
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

/* ── External CDN resources cached on first use ── */
const CDN_ORIGINS = [
  'https://cdnjs.cloudflare.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

/* ── API / sync origins — always network, never cache ── */
const NETWORK_ONLY_ORIGINS = [
  'https://api.github.com',
  'https://www.googleapis.com',
  'https://accounts.google.com',
  'https://oauth2.googleapis.com',
];

/* ────────────────────────────────────────────────
   INSTALL — pre-cache the entire app shell
   ──────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        APP_SHELL.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Failed to cache:', url, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ────────────────────────────────────────────────
   ACTIVATE — delete old caches
   ──────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ────────────────────────────────────────────────
   FETCH — routing strategy
   ──────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* 1. Non-GET requests: always network */
  if (request.method !== 'GET') return;

  /* 2. Network-only API origins: skip SW entirely */
  if (NETWORK_ONLY_ORIGINS.some(o => request.url.startsWith(o))) return;

  /* 3. CDN resources: stale-while-revalidate */
  if (CDN_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* 4. App shell (same origin): cache-first */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* 5. Everything else: network with cache fallback */
  event.respondWith(networkWithCacheFallback(request));
});

/* ── Strategy helpers ── */

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkWithCacheFallback(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

/* ────────────────────────────────────────────────
   MESSAGE — force update from client
   ──────────────────────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CACHE_CLEAR') {
    caches.delete(CACHE_NAME).then(() => {
      event.source.postMessage('CACHE_CLEARED');
    });
  }
});
