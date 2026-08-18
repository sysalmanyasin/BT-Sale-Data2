/* ═══════════════════════════════════════════════════════════════
   BT Sales IC — Service Worker  v10.72
   Strategy: Network-first for same-origin app shell (fresh on connect,
   cached fallback offline). CDN libs use stale-while-revalidate.
   Data (Supabase / Drive / Groq API calls) always go to network.
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'bt-sales-v10.72'; // v10.72: STR Report reworked — (1) pulled out of the Inventory domain into its own standalone top-level "STR" domain/group (was nested under Inventory in the Search & All Sections drawer, the desktop rail, and body[data-domain] theming — now a peer of Sales/Manager/Inventory/etc, see js/nav-sections.js, js/ui.js, css/nav.css); (2) new flattened "Report" sub-tab (js/str-report-native.js, #page-str-report) showing every STR currently matching the filters at once, nested Dispatch Branch → STR # (+ its Comments) → Supplier (product code ascending) → line items, with the same search/stage/branch/date filters as the list page, a manageable-columns picker (persisted to localStorage under bt_str_report_cols_v1), and a printable version via print.js's Print.render(); (3) shared formatting/stage/pack/grouping/filter logic factored out of js/str-native.js into a new js/str-shared.js module so the list page and the new Report page can't drift on what "Awaited" or "pack qty" means; (4) list page's "Issued By" column replaced with STR Comments (search still matches issuedBy too, just no longer displayed); (5) STR Qty/Dispatch Qty/Receive Qty (detail modal, print view, and the new Report page) now show pack quantities (floor(loose qty / inventory_products.conversion_factor), same down-rounding excess-working.js already uses, factor defaults to 1 — i.e. loose qty — when a code has no reliable conversion_factor) instead of raw loose units; Difference is now a pack-qty difference to match. str-bridge.js's product-meta fetch extended to pull conversion_factor alongside supplier for this. (6) detail modal gets Prev/Next buttons that step through the same filtered/sorted list currently on screen. New files: js/str-shared.js, js/str-report-native.js.
// v10.71: new STR Report page under the Inventory domain — read-only list + tap-a-row detail over Supabase's str_headers/str_line_items (synced from inventory.json's strLast7Days/strLineItemsLast7Days, rolling last-7-days window only, see js/str-bridge.js's header note). Sub-heading chips double as filters ("Dispatched: N (Dispatch branch: Bahria Town)" / "Received: N (Received branch: Bahria Town)", driven by the direction column), plus a derived 3-stage Awaited/Dispatched/Received filter (str_status itself is only Open/Close — the three stages instead come from dispatch_status + receive_status) and a date range on str_date. Detail view reproduces the source system's own printed Stock Transfer Report, minus the warranty/signature block (not applicable to a read-only digital view) and with line items grouped by supplier — joined client-side from inventory_products since str_line_items has no supplier column — sorted by product code ascending within each group, both differences from the original printout by request. New files: js/str-bridge.js, js/str-native.js, css/str-report.css. v10.70: fix desktop app-rail layout bug — #nav and .status-bar are position:sticky (in-flow), not position:fixed like .app-rail, so they were still inheriting the body{padding-left:64/208px} reserved for the rail and getting shoved rightward, leaving a blank 64–208px-wide gap in the top-left corner above the rail (nav's logo/sync/clock/Sign Out and the status pills all rendered off to the right of where they should). Fixed in css/app-nav.css by canceling the inherited padding on #nav/.status-bar with a matching negative margin-left + compensating padding-left, same collapsed/expanded split as the rail itself. v10.69: app-rail sub-tabs — each domain rail item (Sales/Manager/Notes & Sheets/Closing/Audit/Inventory/Tools) is now a .rail-group with a ▸ toggle that expands an inline sub-tab list, built by js/app-nav.js from the exact same tree js/nav-sections.js already builds for the Search & All Sections drawer (window.BTNavSections.getTree()). Also restores Sale Data's own sub-pages (Daily Data/Add Entry/Sale Report/Cash Deposit/Payments/DIFF Report) via a new hidden #saledata-sub-index (index.html) — those had zero discoverable DOM entries anywhere since the nav redesign deleted the old subnav strips with nothing put in their place, so they were unreachable from any nav surface, not just the rail. v10.68: harden js/nav-sections.js's _buildTree — the four _customGroup(...) call sites (Inventory/Closing/Audit/Notes&Sheets/Reports) called Object.assign(null, {...}) directly whenever a group's kids all resolved to nothing, which throws and aborts openSectionsDrawer() before it opens (this is the exact failure mode v10.67 just fixed for the current DOM, but it could recur if any single domain's DOM entries go missing again). Routed through a new _pushGroup() helper that just omits an empty group instead of crashing the whole drawer. v10.67: fix v10.66 nav redesign regression — the drawer's tree builder (js/nav-sections.js _flatFromBnav) only ever read #bnav, so once bnav got trimmed to 5 items, every page id it no longer carried (dashboard, manager-dashboard, notesheets, closing-book, credit-ledger, assignments, stockledger, excess, reorder, inv-health, tools) resolved to undefined; the Closing group in particular ended up with zero kids, hit Object.assign(null, {...}), threw, and silently killed openSectionsDrawer() before it ever reached bg.classList.add('on') — Menu tapped/clicked and nothing happened, on both shells. Fix: _flatFromBnav now merges #bnav + .app-rail + a new hidden #bnav-index (index.html) covering every id neither visible shell carries anymore, first match wins. v10.66: nav redesign — top .ntabs row (15 always-visible tabs) and the old .bnav (13 items, unusable on a phone) replaced by a shared "one tree, two shells" nav: a collapsible desktop rail (css/app-nav.css + js/app-nav.js, defaults collapsed) + a trimmed 5-item mobile bottom bar, both opening the same Search & All Sections drawer for the full ~30-item directory. Recents drawer (js/nav-recents.js) and the Sale Data sub-nav strips retired as redundant with that directory. Full version history: see CHANGELOG.md (moved out of this file — it had grown to ~70KB of inline comments, all downloaded/parsed on every SW update check).
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
  './css/app-nav.css',
  './css/closing-native.css',
  './css/closing-book-print.css',
  './css/audit-native.css',
  './css/inventory-native.css',
  './css/stockledger.css',
  './css/excess-working.css',
  './css/reorder-report.css',
  './css/inventory-health-dashboard.css',
  './css/str-report.css',
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
  './js/str-bridge.js',
  './js/str-shared.js',
  './js/str-native.js',
  './js/str-report-native.js',
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
  './js/global-search.js',
  './js/app-nav.js',
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
