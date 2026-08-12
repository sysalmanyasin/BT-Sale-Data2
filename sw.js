/* ═══════════════════════════════════════════════════════════════
   BT Sales IC — Service Worker  v10.61
   Strategy: Network-first for same-origin app shell (fresh on connect,
   cached fallback offline). CDN libs use stale-while-revalidate.
   Data (Supabase / Drive / Groq API calls) always go to network.
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'bt-sales-v10.65'; // v10.65: index.html's CDN <script> tags moved cdnjs → jsDelivr + gained SRI integrity hashes (Chart.js, xlsx, html2canvas, jsPDF, jsPDF-autotable, Supabase JS — the last two also newly version-pinned instead of floating). Precached CDN URLs above updated to match. Full version history: see CHANGELOG.md (moved out of this file — it had grown to ~70KB of inline comments, all downloaded/parsed on every SW update check).
// v10.64: Manager section instant autosave — no "click Save" needed. See CHANGELOG.md.
// v10.63: added Utility → Activity Log (js/activity-log.js, css/activity-log.css) — see README's Navigation model / Key subsystems.
// v10.62: NETWORK_ONLY_ORIGINS was missing vtcrdkqhuvxatclobsby.supabase.co
// (the BTpharmacyAudit@2026 project — inventory_products, sales_payment_summary,
// sales_credit_by_customer, engagements/rounds/assignments/submissions used by
// Stock Ledger, audit-bridge.js, inventory-bridge.js, sale-payments-bridge.js).
// That let networkWithCacheFallback() cache those responses; a single
// incomplete-but-200 response on a weak connection could then get replayed on
// later hiccups instead of surfacing a fresh error, causing intermittent
// "returned no rows" failures even when the server was answering fine. Bumping
// CACHE_NAME also purges whatever's already cached under the old version.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',

  /* ── CSS (index.html load order) ── */
  './css/variables.css',
  './css/auth.css',
  './css/nav.css',
  './css/closing-native.css',
  './css/closing-book-print.css',
  './css/audit-native.css',
  './css/inventory-native.css',
  './css/stockledger.css',
  './css/excess-working.css',
  './css/reorder-report.css',
  './css/inventory-health-dashboard.css',
  './css/pdf-library.css',
  './css/activity-log.css',
  './css/cash-deposit-report.css',
  './css/sale-payments.css',
  './css/components.css',
  './css/modals.css',
  './css/pages.css',
  './css/cover-dashboard.css',
  './css/mobile.css',

  /* ── JS — shared service layer ── */
  './js/bt-format.js',
  './js/print.js',
  './js/bt-date.js',
  './js/bt-search.js',

  /* ── JS — core app ── */
  './js/config.js',
  './js/auth.js',
  './js/storage.js',
  './js/ui.js',

  /* ── JS — sync / repository / actions (strict load order) ── */
  './js/event-bus.js',
  './js/sync-center.js',
  './js/repository.js',
  './js/actions.js',
  './js/ledger-store.js',
  './js/ledger-actions.js',
  './js/ledger-page.js',
  './js/conflict-ui.js',
  './js/supabase.js',
  './js/pdf-library.js',
  './js/activity-log.js',
  './js/cover-dashboard.js',
  './js/record-day.js',
  './js/staff-notes.js',
  './js/closing-bridge.js',
  './js/closing-ledger-marks.js',
  './js/ledger-quick-add.js',
  './js/closing-native.js',
  './js/audit-bridge.js',
  './js/audit-native.js',
  './js/inventory-bridge.js',
  './js/inventory-native.js',
  './js/sale-payments-bridge.js',
  './js/sale-payments-native.js',
  './js/stockledger.js',
  './js/excess-working.js',
  './js/reorder-report.js',
  './js/inventory-health-dashboard.js',

  /* ── JS — features ── */
  './js/targets.js',
  './js/analytics.js',
  './js/dashboard-controls.js',
  './js/dashboard.js',
  './js/rules-engine.js',
  './js/rules-registrations.js',
  './js/dashboard-insights.js',
  './js/index-page.js',
  './js/reports.js',
  './js/cash-deposit-report.js',
  './js/data-page.js',
  './js/diff-report.js',
  './js/reports-print.js',
  './js/manager-export.js',
  './js/notes-sheets.js',
  './js/sheets-patch.js',
  './js/manager-shared.js',
  './js/manager-staff.js',
  './js/manager-salary.js',
  './js/manager-generic.js',
  './js/manager-credit.js',
  './js/manager-payslip.js',
  './js/manager-unmatched.js',
  './js/manager-reports.js',
  './js/manager-petty.js',
  './js/manager-incentive.js',
  './js/manager-page.js',
  './js/app-init.js',
  './js/boot-guard.js',
  './js/custom-sections.js',
  './js/jazz-cash.js',
  './js/quick-add.js',
  './js/ui-extras.js',
  './js/nav-sections.js',
  './js/nav-recents.js',
  './js/global-search.js',
  './js/fields.js',
  './js/drive.js',

  /* ── Icons ── */
  './icons/icon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',

  /* ── External CDN — precached for offline Chart / Excel / Supabase client ──
     Moved from cdnjs to jsDelivr + pinned to exact versions when SRI hashes
     were added to index.html — these URLs must stay byte-identical to the
     <script src> in index.html or the SW will precache a resource the page
     never actually requests. Update both together. */
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.js',
];

/* ── External CDN origins — cached on first use (stale-while-revalidate) ──
   cdnjs.cloudflare.com removed: index.html no longer loads anything from
   it (all CDN libraries moved to jsDelivr, see CACHE_NAME comment above). */
const CDN_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdn.jsdelivr.net',
];

/* ── API / data origins — always network, never cache ── */
const NETWORK_ONLY_ORIGINS = [
  'https://wetbugzzchkghpzmowod.supabase.co',
  'https://vtcrdkqhuvxatclobsby.supabase.co',
  'https://api.anthropic.com',
  'https://api.groq.com',
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
   ACTIVATE — delete old caches, then self-heal
   ──────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => caches.open(CACHE_NAME))
      .then(async cache => {
        const missing = [];
        for (const url of APP_SHELL) {
          const hit = await cache.match(url);
          if (!hit) missing.push(url);
        }
        if (missing.length) {
          console.warn('[SW] Self-healing missing shell files:', missing);
          await Promise.allSettled(
            missing.map(url =>
              fetch(url, { cache: 'no-store' }).then(res => {
                if (res.ok) return cache.put(url, res);
              }).catch(err => console.warn('[SW] Self-heal failed for', url, err.message))
            )
          );
        }
      })
      .then(() => self.clients.claim())
  );
});

/* ────────────────────────────────────────────────
   FETCH — routing strategy
   ──────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (NETWORK_ONLY_ORIGINS.some(o => request.url.startsWith(o))) return;

  if (CDN_ORIGINS.some(o => request.url.startsWith(o))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkWithCacheFallback(request));
});

/* ── Strategy helpers ── */
const NETWORK_TIMEOUT_MS = 6000;

function fetchWithTimeout(request, options, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetchWithTimeout(request, { cache: 'no-store' });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetchWithTimeout(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' }));
  return cached || fetchPromise;
}

async function networkWithCacheFallback(request) {
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/* ────────────────────────────────────────────────
   MESSAGE — commands from the client page
   ──────────────────────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();

  if (event.data === 'CACHE_CLEAR') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      event.source.postMessage('CACHE_CLEARED');
    });
  }

  if (event.data === 'DATA_CHANGED_RELOAD') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(async () => {
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      clients.forEach(c => c.postMessage('SW_RELOAD'));
    });
  }
});
