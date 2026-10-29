/* ═══════════════════════════════════════════════════════════════
   BT Sales IC — Service Worker  (version = CACHE_NAME below)
   Strategy: Network-first for same-origin app shell (fresh on connect,
   cached fallback offline). CDN libs use stale-while-revalidate.
   Data (Supabase / Drive / Groq API calls) always go to network.
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'bt-sales-v11.193'; // v11.193: auto-bumped by npm run build (content hash 2fd11b5533e9). Previously v11.192: 
// Release history lives in CHANGELOG.md (keep this file small: every device downloads and parses it on each update).
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
  './css/emergency-billing.css',
  './css/audit-native.css',
  './css/inventory-native.css',
  './css/stockledger.css',
  './css/excess-working.css',
  './css/reorder-report.css',
  './css/inventory-health-dashboard.css',
  './css/str-report.css',
  './css/pdf-library.css',
  './css/mail-briefing.css',
  './css/cover-mail-strip.css',
  './css/activity-log.css',
  './css/cash-deposit-report.css',
  './css/daily-checklist.css',
  './css/sale-payments.css',
  './css/sheets-app.css',
  './css/attendance.css',
  './css/components.css',
  './css/modals.css',
  './css/pages.css',
  './css/cover-dashboard.css',
  './css/cover-onescreen.css',
  './css/herald.css',
  './css/agent.css',
  './css/ai-center.css',
  './css/ai-center-theme.css',
  './css/mobile-dashboard.css',
  './css/layout-v2.css',
  './css/mobile.css',

  /* ── JS — shared service layer ── */
  './js/lib/bt-format.js',
  './js/lib/print.js',
  './js/lib/gmail-send.js',
  './js/lib/bt-date.js',
  './js/lib/bt-search.js',

  /* ── JS — core app ── */
  './js/platform/config.js',
  './js/platform/auth.js',
  './js/platform/storage.js',
  './js/ui/ui.js',

  /* ── JS — sync / repository / actions (strict load order) ── */
  './js/platform/event-bus.js',
  './js/platform/sync-center.js',
  './js/platform/repository.js',
  './js/platform/actions.js',
  './js/platform/sync-tombstones.js',
  './js/ledger/ledger-store.js',
  './js/ledger/ledger-actions.js',
  './js/ledger/ledger-page.js',
  './js/platform/conflict-ui.js',
  './js/platform/supabase.js',
  './js/lib/pdf-library.js',
  './js/mail/mail-briefing.js',
  './js/mail/cover-mail-strip.js',
  './js/platform/activity-log.js',
  './js/cover/cover-dashboard.js',
  './js/herald/herald-engine.js',
  './js/herald/herald-page.js',
  './js/ui/status-bar.js',
  './js/sales/record-day.js',
  './js/manager/staff-notes.js',
  './js/shared/credit-alerts.js',
  './js/shared/inventory-metrics.js',
  './js/shared/backend-config.js', // statically imported by supabase/auth/bridges (single Supabase URL+anon key)
  './js/shared/dom-actions.js', // delegated event dispatcher (loaded first by index.html)
  './js/shared/html.js', // statically imported by many pages (single escapeHtml)
  './js/shared/mail-compose.js', // pure helpers for Send via Gmail (MIME, To/Cc lists)
  './js/shared/summary-calc.js', // statically imported by cover-dashboard.js + herald-engine.js
  './js/shared/chart-theme.js', // statically imported by cover-dashboard.js + inventory-health-dashboard.js
  './js/shared/agent-shared.js',
  './js/agent/index.js',
  './js/agent/core/tool-registry.js',
  './js/agent/core/agent-client.js',
  './js/agent/core/markdown-lite.js',
  './js/agent/core/audit.js',
  './js/agent/core/undo.js',
  './js/agent/core/guard.js',
  './js/agent/core/prefs.js',
  './js/agent/core/after-write.js',
  './js/agent/core/router.js',
  './js/agent/core/specialists.js',
  './js/agent/core/page-suggestions.js',
  './js/agent/core/auditor.js',
  './js/agent/core/session-log.js',
  './js/agent/core/briefing-badge.js',
  './js/agent/core/server.js',
  './js/agent/core/kill-switch.js',
  './js/agent/core/hard-blocks.js',
  './js/agent/core/undo-store.js',
  './js/agent/core/usage-stats.js',
  './js/agent/core/instant.js',
  './js/agent/core/memory.js',
  './js/agent/core/history.js',
  './js/agent/core/knowledge.js',
  './js/agent/core/orchestrator.js',
  './js/agent/core/telemetry.js',
  './js/agent/core/telemetry-store.js',
  './js/ai-center/index.js',
  './js/ai-center/ui.js',
  './js/ai-center/avatar.js',
  './js/ai-center/deck-model.js',
  './js/ai-center/deck-icons.js',
  './js/agent/ui/voice.js',
  './js/ai-center/model.js',
  './js/ai-center/copilot.js',
  './js/ai-center/adapters.js',
  './js/ai-center/repo-intel.js',
  './js/ai-center/repo-index.json',
  './js/agent/tools/_util.js',
  './js/agent/tools/_names.js',
  './js/agent/tools/app.js',
  './js/agent/tools/sales.js',
  './js/agent/tools/manager.js',
  './js/agent/tools/inventory.js',
  './js/agent/tools/writes.js',
  './js/agent/tools/briefing.js',
  './js/agent/tools/credit.js',
  './js/agent/tools/deletes.js',
  './js/agent/tools/str.js',
  './js/agent/tools/audit.js',
  './js/agent/tools/forecast.js',
  './js/ai-center/forecast-game.js',
  './js/shared/today-forecast.js',
  './js/agent/tools/planning.js',
  './js/shared/planning-metrics.js',
  './js/agent/tools/closing.js',
  './js/agent/tools/billing.js',
  './js/agent/tools/documents.js',
  './js/agent/tools/mail.js',
  './js/agent/tools/memory-tool.js',
  './js/agent/tools/verify.js',
  './js/agent/tools/manager-intelligence-v2.js',
  './js/agent/ui/agent-panel.js',
  './js/closing/closing-bridge.js',
  './js/closing/closing-ledger-marks.js',
  './js/ledger/ledger-quick-add.js',
  './js/closing/closing-native.js',
  './js/audit/audit-bridge.js',
  './js/audit/audit-native.js',
  './js/inventory/inventory-bridge.js',
  './js/inventory/inventory-native.js',
  './js/str/str-bridge.js',
  './js/str/str-shared.js',
  './js/str/str-native.js',
  './js/str/str-report-native.js',
  './js/str/str-zero-dispatch.js',
  './js/sales/sale-payments-bridge.js',
  './js/sales/sale-payments-native.js',
  './js/inventory/stockledger.js',
  './js/inventory/excess-working.js',
  './js/inventory/reorder-report.js',
  './js/inventory/inventory-health-dashboard.js',

  /* ── JS — features ── */
  './js/sales/targets.js',
  './js/sales/analytics.js',
  './js/sales/dashboard-controls.js',
  './js/sales/dashboard.js',
  './js/sales/dashboard-heatmap.js',
  './js/sales/dashboard-race.js',
  './js/lib/rules-engine.js',
  './js/lib/rules-registrations.js',
  './js/sales/dashboard-insights.js',
  './js/sales/index-page.js',
  './js/sales/reports.js',
  './js/sales/cash-deposit-report.js',
  './js/sales/daily-checklist.js',
  './js/ui/icons.js',
  './js/ui/subtab-strip.js',
  './js/sales/data-page.js',
  './js/sales/entry-prefill.js',
  './js/sales/diff-report.js',
  './js/sales/reports-print.js',
  './js/manager/manager-export.js',
  './js/sheets/sheets-api.js',
  './js/sheets/sheets-sync.js',
  './js/sheets/sheets-picker.js',
  './js/sheets/sheets-app.js',
  './js/sheets/notes-sheets.js',
  './js/sheets/sheets-patch.js',
  './js/manager/manager-shared.js',
  './js/manager/attendance-bridge.js',
  './js/manager/manager-attendance.js',
  './js/manager/manager-staff.js',
  './js/manager/manager-salary.js',
  './js/manager/manager-generic.js',
  './js/manager/manager-credit.js',
  './js/manager/manager-payslip.js',
  './js/manager/manager-unmatched.js',
  './js/manager/manager-reports.js',
  './js/manager/manager-petty.js',
  './js/manager/manager-incentive.js',
  './js/manager/manager-page.js',
  './js/platform/early-prefs.js',
  './js/platform/sw-register.js',
  './js/platform/gauth-preload.js',
  './js/platform/app-init.js',
  './js/platform/boot-guard.js',
  './js/manager/custom-sections.js',
  './js/ledger/jazz-cash.js',
  './js/ledger/quick-add.js',
  './js/ui/ui-extras.js',
  './js/ui/nav-sections.js',
  './js/ui/global-search.js',
  './js/sales/fields.js',
  './js/platform/drive.js',
  './js/emergency-billing/emergency-billing-bridge.js',
  './js/emergency-billing/emergency-billing-native.js',

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
  'https://gmail.googleapis.com', // Mail Briefing: authorised mail data must never be cached
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
