# Bahria Town Sales Intelligence Centre

A personal, single-user PWA for running a pharmacy: daily sales entry
and reporting, a manager suite (staff, ledger, targets), a spreadsheet
tool, a cross-device PDF library, and read-only bridges into two
sibling apps (Closing, Pharmacy Audit Hub — the latter also feeding a
native Inventory domain). Google Sign-In gate, offline-capable via
service worker, Supabase for multi-device sync, deployed at
`bt.duapharma.com` (see `CNAME`).

No multi-tenant, no roles/permissions system — this stays a
single-user app permanently. That decision simplifies everything else
here; don't add access-control complexity speculatively.

**AI has been removed from the client app entirely** (v10.32) — see
"AI removal" below for what that took out and what it deliberately
left alone.

## Navigation model

**Cover is the hub.** The nav bar shows only Cover + Tools plus
whichever domain you're currently inside — nothing else. Domains are
picked via Cover's tiles, not by scanning a row of always-visible
icons. Six domains today, each a first-class peer dashboard with its
own accent color:

| Domain       | Pages                                                                                                                                 | Accent                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `sales`      | Dashboard, Sale Data (+ sub-nav: Index/Daily Data/Add Entry/Report/DIFF/Cash Deposit)                                                 | blue (base, `--accent`/`--alt`)   |
| `manager`    | Manager (Staff, Ledger, Targets, Salary/Petty/Credit/Incentive reports)                                                               | sky blue (`--mgrblue` `#0369a1`)  |
| `notesheets` | Notes & Sheets                                                                                                                         | green (`--green` `#059669`)       |
| `closing`    | Closing Book, Credit Ledger (native ports of the standalone Closing app)                                                              | teal (`--teal` `#0d9488`)         |
| `audit`      | Assignments (native port of Pharmacy Audit Hub)                                                                                       | amber (`--amber` `#d97706`)       |
| `inventory`  | BT Inventory, Stock Ledger, Excess Working, Reorder Report (native ports over Pharmacy Audit Hub's shared, Supabase-synced inventory) | pink (`--pink` `#db2777`)         |

Cross-domain utilities (never hidden, don't belong to any domain):
Cover, Tools (settings/sync), **PDF Library** (cross-device archive of
every generated PDF — see "Key subsystems" below).

Cover also links out to three fully separate, standalone apps that
live outside this codebase — Closing (`closing.duapharma.com`), Audit
(`random.duapharma.com`), and Fazal Din's Pharma Plus's Daily Check
List / Excess Stock Control / Branch Invoice Desk tools
(`reports.duapharma.com`). Don't confuse these external tile links
with the native `closing`/`audit`/`inventory` domains above — the
native domains re-implement a read-only view of (part of) the same
data inside this app; the external links open the other apps directly.

`showPage(id)` (`ui.js`) classifies every page id into a domain and
sets `body[data-domain]`; `nav.css` does the actual hide/show and
re-themes off that attribute. Adding a new domain = one entry in
`showPage()`'s classification, one CSS block in `nav.css`, one Cover
tile.

**Nav v2** (three complementary pieces, none replacing the others):
the bottom tab bar, a pushState-based back button (`ui.js`'s
`showPage()`), a "recently used sections" drawer fed by the Event
Bus's `nav:changed` event (`nav-recents.js`), and a long-press-Cover
"all sections" directory read straight from the DOM (`nav-sections.js`).

## Architecture — 5 floors, Golden Rules

```
User → Action → Repository → Data → State → Event Bus → Pages → Components
```

- **Floor 1 (Repository)** — `repository.js`, `config.js`. Owns
  `localStorage`/IndexedDB. The only place raw storage is touched for
  real app business data (a few named, deliberate exceptions listed
  under "Known gaps" below — mostly UI-local state or read-only
  external caches, not business data).
- **Floor 2 (State)** — the actual in-memory arrays/objects
  (`DAILY`/`MONTHLY`/`STAFF`), guarded by a write-detection Proxy in
  `config.js` (catches raw mutation on the array itself — not on a
  property of an already-referenced element; know that gap exists).
- **Floor 3 (Actions/EventBus)** — `actions.js`, `event-bus.js`. Every
  data *change* goes through an Action; every Action that mutates
  calls `EventBus.notify(...)`.
- **Floor 4 (Components)** — reusable, UI-agnostic-ish building blocks:
  `print.js` (the *only* place `window.print()`/`document.write()`/
  `#print-area` are touched — every report funnels through
  `Print.render()`/`Print.renderNewTab()`), `pdf-library.js` (hooks
  into `print.js`'s delivery step to archive every generated PDF), the
  generalized Ledger (`ledger-store.js`/`ledger-actions.js`/
  `ledger-page.js`), the conflict-resolution UI (`conflict-ui.js`).
- **Floor 5 (Pages)** — one file per domain's page(s). Never touch
  Repository directly; go through Actions.

**Golden Rules** (verified against the code — see "Known gaps" below
for the small, documented exceptions): Pages never touch the database
directly. Components never contain business logic. Business modules
never know about UI. State is never modified directly. Every data
change goes through Actions. Every storage operation goes through the
Repository. Every update is announced through the Event Bus. A direct
`grep` for `STAFF[` assignment/mutation outside `actions.js`/
`repository.js` currently finds only read accesses — zero mutation
hits.

## File layout

- `index.html` — all pages, nav, modals. `<script type="module">` for
  real ES modules, plain `<script defer>` for classic scripts.
- `js/` — 65 files (verified via `find js -name "*.js" | wc -l`; ~24.7k
  lines total). 34 are tagged directly `<script type="module">` in
  `index.html`, 30 are classic `<script defer>` files (most
  IIFE-namespaced with a `window.X = X` bridge at the bottom so
  module-scope consumers and classic-script consumers can both reach
  them), and the remainder (e.g. `js/shared/summary-calc.js`) are only
  ever reached via `import` from another module and never get their
  own `<script>` tag.
  * Recount if this drifts:
    `grep -c 'type="module" src="js/' index.html`,
    `grep -c 'defer src="js/' index.html`,
    `find js -name "*.js" | wc -l`.
- `manager-page.js`/`jazz-cash.js`/`notes-sheets.js` used to mutually
  block each other's module conversion — jazz-cash.js monkey-patched
  `loadManagerPage`, notes-sheets.js monkey-patched `switchMgrTab`,
  both relying on sloppy-mode global-function semantics that only
  classic scripts have. Untangled: `manager-page.js` now calls
  `renderJazzCash()`/`renderNotesSheets()` directly (guarded, same
  style as its other cross-file calls), and all three are real
  modules today.
- **AI removal (v10.32):** every AI-facing feature is gone from the
  client — the Hub/CommandHub chat page and its nav entry, AI Settings
  (Groq/Gemini/Cerebras keys), Instructions & Memory, the Context
  Engine, the AI Daily Briefing card on Cover, and the whole
  `js/ai/` provider+domain-registry subsystem underneath it. 20 JS + 5
  CSS files were deleted outright (`ai-bridge.js`, `ai-context.js`,
  `ai-context-ui.js`, `ai-helpers.js`, `ai-instructions.js`,
  `ai-instructions-ui.js`, `commandhub.js`, `commandhub-page.js`,
  `hub-actions.js`, `knowledge-sheet.js`, `app-context.js`,
  `intent-groups.js`, the entire `js/ai/` folder, plus 5 CSS files).
  A handful of surviving files (`bt-date.js`, `bt-format.js`,
  `bt-search.js`, `index-page.js`, `ledger-actions.js`, several
  `manager-*.js`, `notes-sheets.js`, `print.js`, `targets.js`) still
  carry comments/window-bridges naming the now-deleted AI files as
  historical consumers — confirmed inert (the dependency direction was
  always AI reading *from* these files, never the reverse), just not
  yet reworded. **`bt-search.js` (the fuzzy-search engine) is now dead
  code** — it was written for CommandHub and has zero remaining
  consumers anywhere in the repo; candidate for deletion or reuse.
  **One AI dependency was left untouched because it's server-side, not
  client:** `supabase/functions/send-daily-whatsapp-briefing/index.ts`
  still calls Groq (with a Cerebras fallback) to narrate the daily
  WhatsApp briefing text. If the intent was to remove AI everywhere,
  this Edge Function is the one remaining piece — it wasn't part of
  the v10.32 client-side removal and would need a separate pass
  (either a plain-data template, or deletion) to go AI-free end to end.
- `css/` — 17 sheets: `variables.css` (design tokens, incl. per-domain
  accent colors), `nav.css` (domain isolation + accent re-theming),
  `mobile.css`, `components.css`, `modals.css`, `pages.css`, `auth.css`,
  `pdf-library.css`, and feature-specific sheets (one per major
  page/domain, e.g. `cover-dashboard.css`, `stockledger.css`,
  `excess-working.css`, `reorder-report.css`, `closing-native.css`,
  `closing-book-print.css`, `audit-native.css`, `inventory-native.css`,
  `cash-deposit-report.css`). The five AI-specific sheets were deleted
  in the v10.32 removal.
- `sw.js` — service worker; cache-bust by bumping `CACHE_NAME` whenever
  any cached file changes (`APP_SHELL` list must stay in sync with
  every real `<script>`/`<link>` in `index.html`, or that file silently
  fails offline/on a flaky connection instead of erroring). The
  versioned comment on that line is the de facto changelog — read it
  first when picking up a stale thread.
- `supabase/functions/send-daily-whatsapp-briefing/` — a Supabase Edge
  Function (`index.ts`) that generates and sends a daily WhatsApp
  briefing via the Meta Graph API, reusing `js/shared/summary-calc.js`
  for the actual numbers. Still AI-narrated (see "AI removal" above).
  Not deployable from a sandboxed environment (no network access to
  supabase.com/Meta's API) — see that folder's `DEPLOY.md` for the
  manual deploy steps.
- `supabase/pdf_library/` — schema + deploy notes for the PDF Library's
  Supabase Storage bucket and `bt_pdf_library` metadata table.
- `scripts/generate-icons.ps1` — one-off PowerShell script that
  generates the PWA icon set in `icons/` from a source image.
- `manifest.json` — PWA manifest; declares `Add Daily Entry`,
  `Dashboard`, `Daily Data`, and `Sale Report` as home-screen shortcuts.
- `CNAME` — GitHub Pages custom-domain file, points this deploy at
  `bt.duapharma.com`.

## Key subsystems, briefly

- **PDF Library** (`pdf-library.js` + `css/pdf-library.css`) — an
  in-app, cross-device library of every PDF the app generates, fed
  directly from the one central hook every report already funnels
  through: `print.js`'s `_generateAndDeliver()` calls
  `PdfLibrary.beginPrint()` the instant a print is requested (shows a
  popup immediately, "Generating…" state) then
  `PdfLibrary.finishPrint({blob, filename, title})` once the blob
  exists (swaps the same popup to View / Download / Save-to-Library —
  no forced tab, no silent download). `failPrint(err)` closes the
  popup instead of leaving it stuck if generation throws. Backed by
  Supabase Storage + a `bt_pdf_library` metadata row per saved PDF,
  with a silent expiry sweep on boot (`auth.js`'s `unlockApp()`).
- **Ledger** (`ledger-*.js`) — generalized replacement for what used
  to be separate Jazz Cash / Expense / Petty / Other Sections
  implementations. That migration has already run; the Jazz Cash
  migration UI and its one-time migration function were removed once
  it was no longer needed — the old `bt_jazzcash_v2` key is kept only
  as a backup safety net for `drive.js`/`supabase.js`, nothing reads it
  as a migration source anymore. Petty's equivalent
  (`migratePettyToLedger`) is still in place and callable, not yet
  triggered from any UI. Ledger views support a date-range filter and
  group-by-category (Petty/Expenses, Jazz Cash, custom sections alike).
- **Dashboard / Analytics** — `dashboard.js` is a pure renderer;
  `analytics.js` owns all KPI aggregation, MTD/YTD comparisons, and
  forecast calculations, so pages never contain business logic
  (Floor 3/5 split). `dashboard-insights.js` adds a Daily Briefing
  card (rotates on strongest signal — plain computed data, not
  AI-generated), a Target Pace card, and a rotating insight strip
  (weekday comparison / staff outlier detection / etc.) above the
  existing KPI row.
- **Cash Deposit Report** — a Sale Data report computing
  `Cash Sale − Cash Returns + FDPP POS + FDPP Consumer` fresh for every
  day on record; deliberately separate from the manually-typed "Cash
  to be Deposited" field elsewhere in the app (`fields.js`/
  `reports.js`), which just reflects whatever was typed in. Prints via
  a vector jsPDF + autoTable thermal-receipt renderer
  (`Print.renderThermalTable()`), not `html2canvas` — that path was
  patched repeatedly for clipping bugs before being replaced outright.
- **Staff Registry** — CRUD goes through `Actions.addEmployee`/
  `updateEmployee`/`removeEmployee`, never raw `STAFF[i]` mutation —
  verified via direct grep for `STAFF[` assignment/push/splice outside
  `actions.js`/`repository.js`: currently zero hits (every other
  reference is a read). Staff cards have a Notes tab
  (`staff-notes.js`) — simple timestamped per-employee notes, synced
  via the same generic feature-data path as Notes & Sheets, not
  staff-facing and not a messaging system.
- **Notes & Sheets** — multi-file workbook model
  (`bt_sheet_workbooks_v1`): each file is an independent workbook with
  its own sheet-tabs. A "🔗 Data" tab can materialize any live table
  from any of the three domains (Sales/Manager/Inventory) into a new
  editable grid — no separate backend, rides entirely on the existing
  sync. Migrated losslessly from the old single-workbook snapshot
  model; old keys kept untouched as a safety net.
- **Print** — one engine (`print.js`), every report is a caller into
  it, never a reimplementation. Android's `window.print()` doesn't
  block JS execution the way desktop does, which caused a real bug
  once — test printing on a real device before release, not just
  desktop.
- **Closing / Audit / Inventory bridges** — read-only, local-only
  caches of sibling apps' data: `closing-bridge.js` reads a Dropbox
  export, `audit-bridge.js` and `inventory-bridge.js` read directly
  from Supabase (they share one Supabase project, different tables).
  `closing-native.js`, `audit-native.js`, and `inventory-native.js`
  are the pages built on top of those bridges (Closing Book/Credit
  Ledger, Assignments, and BT Inventory/Stock Ledger/Excess
  Working/Reorder Report respectively). Not app business data; by
  design these don't route through Actions/EventBus.
- **Reorder Report** — the inverse of Excess Working: flags stock
  running out too soon relative to sales (instead of stock sitting too
  high), ranks the shortfall by sale value, and estimates how much to
  buy. Reads live off Stock Ledger's already-loaded inventory
  (`StockLedgerApp.getRawRows()`) — one inventory load per session,
  one source of truth, same pattern Excess Working uses.
  `getFlaggedRows()` exposes the actual rows (not just summary stats)
  for Notes & Sheets' Data tab to consume.
- **Auth** (`auth.js`) — Google Sign-In gate with a PIN fallback. Must
  run before the Repository loads, which is why it's one of the
  handful of files allowed to touch `localStorage` directly (see
  "Known gaps"). Also runs the PDF Library's expiry sweep on unlock.
- **Sync** — `sync-center.js` implements a "single active device"
  architecture (UDID + activity tracking + priority lock) against a
  `bt_sessions` Supabase table, so two devices editing at once don't
  silently clobber each other; `conflict-ui.js` owns the DOM for
  resolving a flagged conflict (kept out of `actions.js`, a Floor 3
  business module, per the Golden Rules). `supabase.js` is the
  Supabase client setup + pull/push sync; `drive.js` is a separate,
  independent daily backup to Google Drive (auto-runs after unlock).

## Known gaps (small, documented, non-urgent)

- `localStorage` is touched directly in a handful of files beyond the
  three read-only bridges above (`closing-bridge.js`,
  `audit-bridge.js`, `inventory-bridge.js`): `auth.js` (must run
  before Repository loads — load-order constraint, commented in
  place), `stockledger.js`, `excess-working.js`, `reorder-report.js`,
  `reports.js`, `closing-native.js`, `ui-extras.js`. All checked
  directly (`grep -rl "localStorage\." js`) — these are UI-local state
  (FAB position, hidden report rows, last page viewed) or a
  Repository-with-fallback pattern, not app business data, so they
  don't violate the spirit of the rule.
- `jazz-cash.js` and `notes-sheets.js` used to monkey-patch
  `manager-page.js`'s globals; this has been untangled (see "File
  layout" above) and all three are real ES modules now — noting it
  here in case a future change reintroduces the pattern.
- `bt-search.js` is dead code post-AI-removal (see "AI removal"
  above) — not deleted yet, zero consumers.
- The WhatsApp briefing Edge Function still calls out to Groq/Cerebras
  for AI-generated narration text — the one place AI still runs
  anywhere in this project (see "AI removal" above).
- Dead code is removed as it's found, not left in place. The service
  worker's changelog comment (`sw.js`, top of file) records several
  cases where an earlier session's changelog entry claimed a file was
  deleted but it actually wasn't — a reminder to verify with
  `find`/`grep`, not trust a prior changelog entry at face value.

## Working conventions for future sessions

- Before touching any file, check whether a `SKILL.md`-style
  convention already covers it — this repo has none of its own, but
  the housekeeping habit that matters here: **verify claims against
  the actual code, not against what a comment (or this README) says.**
  Several stale/wrong claims have been found this way in past passes —
  module counts drifting from the real `index.html`, a comment naming
  the wrong file as a monkey-patcher, a changelog entry claiming a
  file was deleted when it wasn't. Trust `grep`/`find`, and when you
  fix a stale claim, fix it in place here rather than pointing to a
  separate tracking doc that can itself go stale.
- Any change to a live storage format needs a **lossless migration
  that never deletes the old key** — every migration in this app so
  far follows that pattern; keep it up.
- Verify structural changes with a real test (Node + jsdom for
  DOM/nav logic, plain Node with a Repository/Actions shim for
  storage/migration logic) before calling something done — this app
  has real financial data in it.
- Converting a classic script to a real ES module is not just adding
  `import`/`export` — check every inline `onclick`/`onchange`/
  `oninput` handler in `index.html` that assigns straight to that
  file's top-level `var`/`let`/`const`. Those handlers always execute
  in global scope; once the file becomes a module, its top-level
  declarations stop being implicitly global, and the assignment
  silently creates a disconnected `window.*` global instead of
  updating real module state. Route it through a small bridged setter
  instead (see `notes-sheets.js`/`jazz-cash.js` for worked examples).
  Bump `sw.js`'s `CACHE_NAME` and add any new file to `APP_SHELL`
  whenever a `<script>`/`<link>` tag is added to `index.html` — an
  already-installed client won't otherwise notice it exists.
- Full test pass before a release should include a real device check
  for anything touching printing (`Print.render`/`renderNewTab`) —
  Android's `window.print()` doesn't block JS execution the way
  desktop does, which caused a real bug once already.
