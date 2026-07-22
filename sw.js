/* ═══════════════════════════════════════════════════════════════
   BT Sales IC — Service Worker  v10.3
   Strategy: Network-first for same-origin app shell (fresh on connect,
   cached fallback offline). CDN libs use stale-while-revalidate.
   Data (Supabase / Drive / Groq API calls) always go to network.
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'bt-sales-v10.11'; // v10.11: added Reorder Report (Audit domain) — js/reorder-report.js + css/reorder-report.css, both missing from APP_SHELL below (same "silently missing offline / never actually updates on already-installed clients" class of bug as v10.1/v10.2/v10.3's fixes — this file's own CACHE_NAME is the only thing that makes an already-installed client notice new/changed same-origin files at all, since networkFirst still needs a controlling SW that knows to run it; a content change to sw.js with no version bump doesn't reliably trigger the browser's SW update check on every client). Root symptom this fixes: Reorder Report showed "0 items pulled" from Stock Ledger on an already-installed client even after redeploying js/stockledger.js's new getRawRows() bridge — the already-running SW/tab never re-fetched it. index.html's own script/link tags also got a `?v=` query param in this same deploy as a second, independent safety net (browser HTTP cache, distinct from this file's CacheStorage) — both are needed since either one alone can serve stale files. v10.10: fixed "JC_KEY is not defined" breaking Supabase Pull and Google Drive Backup on every run. Root cause: jazz-cash.js was converted to a real ES module in v10.9's batch-4 migration, which made its top-level `const JC_KEY` module-scoped instead of implicitly global — but drive.js and supabase.js are still classic (non-module) scripts that reference the bare identifier JC_KEY directly, expecting it on window. Same class of bug as the six pre-existing ones called out in v10.8/v10.9 (a classic-script consumer relying on sloppy-mode global semantics that module scripts don't have), just missed for this specific constant during the batch-4 pass. Fix: added `window.JC_KEY = JC_KEY;` right after its declaration in jazz-cash.js, matching the existing window-bridge pattern used for LEDGER_KEY/CUSTOM_TYPES_KEY etc in ledger-store.js. No other files changed. v10.9: two sessions' worth of changes, neither had bumped this file yet. (a) Housekeeping pass: README.md's stale module-count claims fixed (now sourced by literally grepping index.html rather than hand-counted); js/data-base.js deleted (dead code — MONTHLY_BASE/DAILY_BASE, loaded by no <script> tag, already correctly excluded from APP_SHELL below since v10.3 but never actually deleted from disk); Jazz Cash's one-time migration-into-Ledger UI (banner/button in jazz-cash.js) and its migrateJazzCashToLedger() function (ledger-migration.js) removed now that the migration has actually been run — bt_jazzcash_v2 (JC_KEY) is kept only as drive.js/supabase.js's backup safety net, nothing reads it as a migration source anymore. (b) Module-migration Stage B, batch 4 — the three files that were mutually blocking each other's conversion (manager-page.js, jazz-cash.js, notes-sheets.js) are untangled and all three converted to real ES modules together. The blocker: jazz-cash.js monkey-patched loadManagerPage and notes-sheets.js monkey-patched switchMgrTab, both relying on sloppy-mode global-function semantics that only classic scripts have. Fix: both patches removed; manager-page.js now calls renderJazzCash()/renderNotesSheets() directly instead (guarded with `typeof X === 'function'`, matching its existing style for renderLedgerView etc). [Also corrects a stray claim in the v10.8 note above: custom-sections.js was never actually a patcher of loadManagerPage — checked directly via grep, it doesn't touch it — that was a documentation error carried from an even earlier pass, not a real behavior.] Real bugs found and fixed during this conversion, none pre-existing (i.e. this migration would have introduced all six, not uncovered them): _nsMgsSearch/_nsMgsSort/_nsMgsGroup/_nsNoteSearch/_nsDataSource/_nsDataSearch (all in notes-sheets.js) and _jcTallyDate (jazz-cash.js, 2 call sites) were all assigned directly from inline onclick/onchange/oninput handlers — that HTML always executes in global scope, so once these files' top-level `var`s stopped being implicitly global (module scope instead), those direct assignments would have silently created disconnected `window.*` globals instead of updating the real module state, breaking search/sort/filter UI with no error. Each now routes through a small bridged setter function instead (e.g. `_nsSetDataSource`, `_jcSelectTallyDate`). ai-bridge.js (largest file in the app) also converted in this pass — no patching involved, just needed real imports for Repository/BTDate/LedgerStore/LedgerActions/STAFF/MONTHLY in place of their `typeof` guards; its 3 external consumers (ai-context.js, ai-helpers.js, commandhub-page.js) are unaffected since they call it via bare identifiers backed by its existing window bridges, unchanged. All four newly-converted files' `<script>` tags flipped to type="module" in index.html; no APP_SHELL changes needed (same files, same paths, just a different `type` attribute — the entries below already had these paths correct). v10.8: manager.js (1906-line monolith) split into 9 real ES modules (manager-shared/staff/salary/generic/credit/unmatched/reports/petty/incentive.js) + app-init.js (module — was misplaced inside manager.js despite being the whole app's bootstrap, unrelated to Manager) + manager-page.js (deliberately kept classic — jazz-cash.js/custom-sections.js/notes-sheets.js monkey-patch its functions and rely on sloppy-mode global semantics to do it; see manager-page.js's own header comment). Also added boot-guard.js, which was added to index.html in a previous pass but never added here — same "silently missing offline" risk as every other entry in this changelog. Six real pre-existing bugs found and fixed during the split, none introduced by it: genRowChange/recalcGenRow and recalcCrdEmp were called from inline oninput handlers (Generic Working row edits, 3 Credit Ledger fields) but were never bridged to window at all, throwing ReferenceError on every edit; _salRows_cur/_genRows_cur/_pettyData/_pettyMonth had their window bridge set only once, before any month was ever loaded, so ai-bridge.js's AI-assistant edit commands (and custom-sections.js's petty "copy to next month") silently operated on a stale/empty snapshot after the first real load — same class of bug _crdData_cur had already correctly avoided by re-syncing its bridge on every load, now applied consistently everywhere else. v10.7: module-migration Stage B, batch 3 — app-context.js converted to a real ES module. This one needed three real fixes first, not just imports: (1) getTgts (targets.js) was never bridged to window — also fixed a genuine pre-existing bug in the process, since app-context.js used to check `window.getTgts` specifically, which nothing ever assigned, so ctx.targets silently returned {} always, meaning the AI Assistant's context summary never actually saw real sales targets; every other consumer (analytics.js, hub-actions.js, reports.js, reports-print.js) correctly used the bare identifier and was unaffected. (2) _curPage (storage.js) is deliberately never bridged to window since ui.js reassigns it directly — added a read-only getCurrentPage() getter instead, bridged to window, which doesn't touch that reassignment concern. (3) _nsSFLoad (notes-sheets.js) was never bridged either — fixing this also fixes an identical already-live silent-fallback bug in cover-dashboard.js (converted to a module in an earlier session, same `typeof _nsSFLoad` check, same silent failure). Also replaced app-context.js's `LedgerStore.getAllLedgerTypes()` etc (against a window-only grouped object with no real ES export) with direct imports of the underlying named functions, which do have real exports. v10.6: module-migration Stage B, batch 2 — commandhub.js converted to a real ES module (zero external consumers verified via grep, so this only had to get its own dependencies right). typeof BTSearch/BTFormat/BTDate 'undefined' guards replaced with real imports from those three modules; their duplicate inline fallback implementations (dead code once import is guaranteed to resolve) removed. Actions/Repository already had real module exports, no change needed there. getAppContext (app-context.js, still classic) left as a bare identifier — resolves via that file's existing window bridge. v10.5: module-migration Stage B, batch 1 (bt-format.js, bt-date.js, bt-search.js converted to real ES modules; bt-calc.js deleted — verified zero consumers anywhere in the repo, dead code fully superseded by config.js's own cashSales/creditSales/branchScore/yearlyCAGR). Removed bt-calc.js from APP_SHELL below and from index.html's script tags. Version bumped so already-installed clients drop the now-404 file from cache instead of holding onto it. v10.4: index.html script-order fix — supabase-js CDN tag was loading AFTER the module scripts (cover-dashboard.js/closing-bridge.js/closing-native.js/audit-bridge.js) that call supabase.createClient() at module-load time. Module scripts + defer scripts execute in strict document order regardless of network speed, so `typeof supabase` was 'undefined' on every page load until the 5-min setInterval retry happened to land after the CDN script finally executed — this is why "Waiting for Closing…" kept coming back even after the RLS/Data-API fixes confirmed the data itself was reachable. Moved the supabase-js <script> tag up above those modules. Version bumped (same reason as v10.1/v10.2/v10.3 note below) so already-installed clients actually fetch the corrected index.html instead of keeping the old one cached forever. v10.3: APP_SHELL was missing 8 more real, actively-loaded files — 6 CSS (closing-native.css, closing-book-print.css, audit-native.css, inventory-native.css, excess-working.css, cover-dashboard.css — all real <link> tags in index.html) and 2 JS (excess-working.js, quick-add.js — both real <script defer> tags). Same "reports/features silently do nothing offline or on a flaky connection" symptom as v10.1's fix, just a different batch of files that had been added to index.html without ever being added here. (js/data-base.js was checked too and correctly left out — it defines MONTHLY_BASE/DAILY_BASE but isn't loaded by any <script> tag; it's dead code, not a missing shell file.) v10.2: added Stock Ledger (Audit domain) — css/stockledger.css + js/stockledger.js — a self-contained never-sold/dead-stock/excess-stock analysis tool with its own Supabase panel + JSON upload fallback, deliberately not wired to inventory-bridge.js's inventory_products table (schema mismatch — see index.html's comment above #page-stockledger). v10.1: APP_SHELL was missing 11 files that index.html actually loads, including js/print.js, the ONE print engine every report in the app now funnels through (Sale/Monthly/Yearly/Manager/CommandHub reports all call Print.render()/renderNewTab()). Same-origin requests use networkFirst, so this only broke offline/flaky-connection printing (no cached fallback when the live fetch for print.js failed), matching the "reports just silently do nothing" symptom. Also missing: cover-dashboard.js, closing-bridge.js, closing-native.js, audit-bridge.js, audit-native.js, inventory-bridge.js, inventory-native.js, staff-notes.js, sheets-patch.js, ui-extras.js. All 11 added below, and the version bumped so already-installed clients actually pick up the corrected shell list instead of keeping the old one cached forever.

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
  './css/components.css',
  './css/modals.css',
  './css/pages.css',
  './css/cover-dashboard.css',
  './css/mobile.css',
  './css/assistant.css',
  './css/assistant-fixes.css',
  './css/intent-groups.css',
  './css/ai-instructions.css',
  './css/ai-context.css',

  /* ── JS — shared service layer ── */
  './js/bt-format.js',
  './js/print.js',
  './js/bt-date.js',
  './js/bt-search.js',
  './js/app-context.js',

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
  './js/ledger-migration.js',
  './js/ledger-page.js',
  './js/conflict-ui.js',
  './js/supabase.js',
  './js/cover-dashboard.js',
  './js/staff-notes.js',
  './js/closing-bridge.js',
  './js/closing-native.js',
  './js/audit-bridge.js',
  './js/audit-native.js',
  './js/inventory-bridge.js',
  './js/inventory-native.js',
  './js/stockledger.js',
  './js/excess-working.js',
  './js/reorder-report.js',

  /* ── JS — features ── */
  './js/targets.js',
  './js/analytics.js',
  './js/dashboard.js',
  './js/dashboard-insights.js',
  './js/index-page.js',
  './js/reports.js',
  './js/data-page.js',
  './js/diff-report.js',
  './js/commandhub-page.js',
  './js/commandhub.js',
  './js/reports-print.js',
  './js/manager-export.js',
  './js/ai-helpers.js',
  './js/notes-sheets.js',
  './js/sheets-patch.js',
  './js/manager-shared.js',
  './js/manager-staff.js',
  './js/manager-salary.js',
  './js/manager-generic.js',
  './js/manager-credit.js',
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
  './js/hub-actions.js',
  './js/ui-extras.js',
  './js/fields.js',
  './js/drive.js',

  /* ── JS — AI assistant ── */
  './js/ai-memory.js',
  './js/ai-instructions.js',
  './js/ai-instructions-ui.js',
  './js/knowledge-sheet.js',
  './js/ai-context.js',
  './js/ai-context-ui.js',
  './js/intent-groups.js',
  './js/ai-bridge.js',

  /* ── Icons ── */
  './icons/icon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',

  /* ── External CDN — precached for offline Chart / Excel / Supabase client ── */
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
];

/* ── External CDN origins — cached on first use (stale-while-revalidate) ── */
const CDN_ORIGINS = [
  'https://cdnjs.cloudflare.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdn.jsdelivr.net',
];

/* ── API / data origins — always network, never cache ── */
const NETWORK_ONLY_ORIGINS = [
  'https://wetbugzzchkghpzmowod.supabase.co',
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
