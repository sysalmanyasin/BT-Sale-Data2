/* ═══════════════════════════════════════════════════════════════
   BT Sales IC — Service Worker  v10.74
   Strategy: Network-first for same-origin app shell (fresh on connect,
   cached fallback offline). CDN libs use stale-while-revalidate.
   Data (Supabase / Drive / Groq API calls) always go to network.
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'bt-sales-v10.97'; // v10.97: Manager Dashboard — removed the redundant standalone add-form above the Jazz Cash and Expense ledger tables (js/ledger-page.js). Both already have a "Quick Add" panel above them that writes into the same ledger via the same LedgerActions.addEntry() door, so renderLedgerView() now skips that form (and its submit wiring) specifically for ledgerType 'jazzcash' and 'expense'. Every other ledger view (custom Other Sections) is unchanged. Bumped js/ledger-page.js's query string to ?v=20260831b (index.html) plus this CACHE_NAME. // v10.96: DIFF Report — day-wise expandable sub-report per month (js/diff-report.js). Clicking a month row now expands a nested day-by-day table (Date / Total Sale / COMP SALE / Difference / Running Total) beneath it, reusing the existing .mon-group/.mon-chevron expand pattern from the Daily Data page (css/components.css) rather than inventing new styles. Per-day running total resets to 0 at the start of each month's sub-report (the top-level monthly running total is unaffected). Bumped js/diff-report.js's query string to ?v=20260831a (index.html) plus this CACHE_NAME so the service worker's own precache picks up the real content too. v10.95: CACHE-BUSTING FIX — every CSS edit from today's branding pass
// (nav strip on desktop, dot-grid page texture, real logo in nav, domain hero
// tinting, hero/login/empty-state watermarks, then the full-color logo swap)
// touched css/variables.css, auth.css, nav.css, components.css, pages.css,
// cover-dashboard.css, and mobile.css but never bumped their own ?v= query
// strings in index.html — so despite every commit landing on GitHub, live
// devices kept serving the old cached bytes under the same unchanged URL and
// none of it was actually visible (confirmed live: Cover hero still showed
// the old plain-white watermark after the colorful-logo commit). This is the
// exact same lesson v10.90/91 already learned and documented right above —
// should have bumped these the first time. Bumped all seven files' query
// strings to ?v=20260824a (index.html) plus this CACHE_NAME so the service
// worker's own precache picks up the real content too. v10.92: Reorder Report — added an "In Transit" column (js/reorder-report.js), qty already Dispatched and inbound to BT per product code, joined from StrBridge (str_headers/str_line_items) via a new buildInTransitMap() — counts only STRs where direction='in' and stage is Dispatched (not yet Received); Awaited STRs deliberately excluded since nothing's physically moved yet. Rows with In Transit > 0 get a light-green highlight (css/reorder-report.css, new .row-intransit rule using the --glt token). Column sits in BASE_COLS so it also appears in Excel/PDF export and Print (unaffected by the Columns show/hide toggle's existing behavior — same as every other base column). Bumped reorder-report.js to ?v=20260823a and reorder-report.css to ?v=20260823a (index.html). v10.91: Renamed the All Sections drawer header from "Search & Sections" to "BT Navigation Panel" and restyled its background — was a flat single gradient, now layered (two radial glows over the base --grad-header gradient) with a slim tri-color accent line along the bottom edge (echoes Cover hero's own segmented progress bar), bolder/letter-spaced h2 with a subtle text-shadow, and a close button with a proper hover/active state. Bumped nav.css to ?v=20260822d (index.html) — same cache-busting lesson as v10.90, a content change needs a new query string to guarantee a fresh fetch. v10.90: v10.89's header-background fix never actually reached users — nav.css's own cache-busting query string (?v=20260822b) was left unchanged by that commit, so any browser/CDN cache that already had that exact URL cached kept serving the pre-fix bytes (missing background rule, white-on-white header) indefinitely; confirmed live via console (`#sectionsbg .mhdr` had backgroundImage:none / backgroundColor:transparent even though --grad-header/--accent-dk both resolved fine and the deployed stylesheet's own cssRules only contained the h2{color} rule, not the background rule). Fixed by bumping nav.css's own query to ?v=20260822c (index.html) — a new URL guarantees a fresh fetch regardless of any cache layer's TTL — plus this CACHE_NAME bump so the service worker's own precache picks it up too. v10.89: All Sections drawer follow-up — (1) header background now declares a solid var(--accent-dk) fallback before the var(--grad-header) gradient, so it can never render as an invisible white-on-white bar if a gradient value fails to apply for any reason; (2) card recipe replaced with the exact same --g-accent/--g-bg wash+radial-glow pattern css/cover-dashboard.css's .cover-group already uses, and the domain→color assignments now match Cover's exactly (closing=amber, audit=red, str=purple, reports=teal — previously a different, hand-picked set) so the drawer reads as the same visual language as Cover instead of a similar-but-different one. See css/nav.css's "Colorful design pass" block.
// v10.86: Nav bar redesign (css/nav.css) — was a flat near-white bar with no visual identity of its own. Now a light navy-blue tinted wash (radial glows + linear gradient, same hue family as the dark status-bar/hero gradient above it) with a tonal navy underline echoing the Cover hero card's segmented progress bar, plus a richer --grad-header logo badge. Iterated through a fully dark navy fill and a pastel rainbow wash first; settled on this lighter, single-hue-family version — text stayed on var(--text)/var(--muted) throughout since the background never went dark.
// v10.85: body had explicit overflow-x:hidden/overflow-y:auto in variables.css, which made body (not the viewport) the nearest scroll-container ancestor for #status-bar/nav's position:sticky — but body never actually overflows itself (min-height:100vh grows to fit content), so the real scrolling happens on html and the sticky bars just scrolled away with the page instead of staying pinned. Removed overflow from body; html's own overflow-x:hidden/overflow-y:auto (already present) is now the sole scroll context, matching what sticky is computed against.
// v10.80: Fix entry-prefill.js bug — picking a date auto-selected TODAY on load (autoFillEntryDate), which prefilled COMP SALE/credit fields from partial same-day Sale Payments data; switching to an earlier complete date then left those two fields stuck on the wrong day's numbers because "only fill empty fields" couldn't tell that apart from real manual input. Now every prefill-set field is marked data-prefillOwned, cleared the instant a person actually types into it — so a later prefill run can safely refresh anything it owns, while never touching anything hand-typed, across any number of date changes.
// v10.79: Add Entry auto-prefill (js/entry-prefill.js). Picking a date in #page-entry now pulls Cash Sale/Bank Alfalah/custom Bank Alfalah 2/Cash Returns from Closing's synced 'sheets' rows (Evening shift = full day's cumulative POS reading, verified against real 16/17/18 Aug data; Cash Returns summed across all 3 shifts since System Return is entered per-shift, not cumulative) and COMP SALE (Total Sale) + matched credit-customer columns from Sale Payments' live bridge (js/sale-payments-bridge.js, project vtcrdkqhuvxatclobsby — same source the Payments tab itself reads). Customers/FDPP/FDPP Con have no live source anywhere and stay manual; credit customers with no matching column are named in the toast instead of silently dropped. Only fills empty fields, never overwrites manual input.
// v10.78: Cover gets a new "STR Report" hero group (js/cover-dashboard.js) — the domain existed (nav, pages, bridge) but was never surfaced on Cover. Four cards, all built off the existing StrBridge.getFullData()/str-shared.js stage+direction helpers, no new data source: (1) Stock Received Value — yesterday's headline figure (retail price × receive qty for STRs Received at BT) plus a per-day breakdown for every day in the bridge's rolling 7-day window that actually has received stock; (2) Awaited — STR #/date/comment for STRs dispatched FROM Bahria Town that haven't been dispatched yet; (3) Dispatched — same direction, dispatched but not yet received; (4) Inbound — STRs dispatched from a warehouse/other branch (BT is the receiving side) that haven't been received at BT yet, with source branch shown. Tapping a row jumps to the real STR page and opens that STR's detail modal (strOpenDetail); "FULL LIST" jumps to the STR page pre-filtered by stage. Hero-only, same pattern as Sales/Manager/Closing/Inventory — no new CSS, reuses .card/.ctitle/.cover-hero-row.
// v10.76: new "Zero Dispatch" 3rd sub-tab under STR (js/str-zero-dispatch.js, #page-str-zero-dispatch) — same branch>STR>supplier flattened nesting as the existing Report tab (str-shared.js's filterHeaders/groupedLineItems), but line-item filtered to only STR Qty > 0 & Dispatch Qty = 0 rows (per line item, not per whole STR — a partially-dispatched STR can still surface its own zero-dispatch lines); STRs/supplier groups with no surviving lines are dropped from the page entirely. New: a checkbox per STR block (unchecked by default, not persisted — this is a "what am I printing right now" pick, not a saved preference), Select All/None, and print only includes checked STRs (warns if none are ticked). Wired into js/ui.js's _strDomainPages + str domain page-show hook, js/nav-sections.js's strKids, css/str-report.css (.str-zd-* rules). New file: js/str-zero-dispatch.js.
// v10.75: removed the fixed desktop app-rail (css/app-nav.js, js/app-nav.js) and every reference to it — the app now has exactly one nav system, the Search & All Sections drawer (js/nav-sections.js), opened by a single ☰ Menu button in the top #nav bar (desktop) / bottom .bnav (mobile) instead of duplicating that trigger across a collapsible rail, the bottom bar, and (previously) a top-bar search icon. Deleted css/app-nav.css and js/app-nav.js outright; stripped the .app-rail markup, its body padding-left/#nav margin compensation, and the .rail-* CSS from index.html; removed js/app-nav.js's rail-only source from nav-sections.js's _flatFromBnav (drawer tree is unaffected — #bnav-index already carried full parity independent of the rail) and the now-dead .rail-item selectors from js/ui.js's active-state bookkeeping. v10.74: fix v10.73's left-alignment not actually taking effect — css/components.css has a global, unscoped base style (table{...} th{text-align:right} td{text-align:right} td:first-child{text-align:left}) built for the app's original numeric-heavy tables, applying to every <table> in the app with no class scoping. v10.73 only added explicit text-align:left to the specific cells it touched (qty/price/diff columns); every STR cell that had never been explicitly styled — Product name, Date, From→To, Comments on the list page; Product name in the detail modal and both print views; every value cell past the first in the print detail's From/To/Media/etc field-row table — silently kept inheriting that global right-align, which is what the report screenshot showed (ragged-left, flush-right product names). Fixed at the source: a new `.str-table th/td, .str-detail-table th/td, .str-rpt-table th/td { text-align: left }` base rule in css/str-report.css (class selector beats components.css's bare `td`/`th` on specificity regardless of load order) for every on-screen STR table, plus explicit inline text-align:left on the handful of print-only cells that render outside those classes (print output reuses the live page's loaded CSS via a bare, class-less capture host — see print.js).
// v10.73: STR Report readability pass — all three STR views (list detail modal, print, and the flattened Report page) had every qty/price/difference cell + the detail modal's From/To/etc field grid right-aligned; switched to left-aligned throughout (only the print header's decorative top-right STR#/Master block and "N STR(s) in this report" summary line stayed right-aligned, since those are page-header layout, not tabular data). Also: (1) the flattened Report page's per-STR blocks were only separated by a thin border, easy to misread as one continuous table when a supplier group ended right where the next STR's comments began — each STR is now its own bordered/shadowed card with real margin around it (css/str-report.css .str-rpt-str-block), same treatment carried into the print output (each STR wrapped in its own bordered card with page-break-inside:avoid so a page break can't split an STR's header from its own line-item table); (2) added zebra striping to line-item rows across all three views for easier row-tracking on wide tables; (3) the Report page's per-STR table wasn't in its own horizontal-scroll container (str-rpt-table-wrap), so on a narrow phone it could get clipped instead of scrolling.
// v10.72: STR Report reworked — (1) pulled out of the Inventory domain into its own standalone top-level "STR" domain/group (was nested under Inventory in the Search & All Sections drawer, the desktop rail, and body[data-domain] theming — now a peer of Sales/Manager/Inventory/etc, see js/nav-sections.js, js/ui.js, css/nav.css); (2) new flattened "Report" sub-tab (js/str-report-native.js, #page-str-report) showing every STR currently matching the filters at once, nested Dispatch Branch → STR # (+ its Comments) → Supplier (product code ascending) → line items, with the same search/stage/branch/date filters as the list page, a manageable-columns picker (persisted to localStorage under bt_str_report_cols_v1), and a printable version via print.js's Print.render(); (3) shared formatting/stage/pack/grouping/filter logic factored out of js/str-native.js into a new js/str-shared.js module so the list page and the new Report page can't drift on what "Awaited" or "pack qty" means; (4) list page's "Issued By" column replaced with STR Comments (search still matches issuedBy too, just no longer displayed); (5) STR Qty/Dispatch Qty/Receive Qty (detail modal, print view, and the new Report page) now show pack quantities (floor(loose qty / inventory_products.conversion_factor), same down-rounding excess-working.js already uses, factor defaults to 1 — i.e. loose qty — when a code has no reliable conversion_factor) instead of raw loose units; Difference is now a pack-qty difference to match. str-bridge.js's product-meta fetch extended to pull conversion_factor alongside supplier for this. (6) detail modal gets Prev/Next buttons that step through the same filtered/sorted list currently on screen. New files: js/str-shared.js, js/str-report-native.js.
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
  './css/sheets-app.css',
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
  './js/status-bar.js',
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
  './js/str-zero-dispatch.js',
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
  './js/icons.js',
  './js/subtab-strip.js',
  './js/data-page.js',
  './js/entry-prefill.js',
  './js/diff-report.js',
  './js/reports-print.js',
  './js/manager-export.js',
  './js/sheets-api.js',
  './js/sheets-sync.js',
  './js/sheets-picker.js',
  './js/sheets-app.js',
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
