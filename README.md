# Bahria Town Sales Intelligence Centre

A personal, single-user PWA for running a pharmacy: daily sales entry
and reporting, a manager suite (staff, ledger, targets), a spreadsheet
tool, and read-only bridges into two sibling apps (Closing, Pharmacy
Audit Hub). Google Sign-In gate, offline-capable via service worker,
Supabase for multi-device sync.

No multi-tenant, no roles/permissions system — this stays a
single-user app permanently. That decision simplifies everything else
here; don't add access-control complexity speculatively.

## Navigation model

**Cover is the hub.** The nav bar shows only Cover + CommandHub + Tools
plus whichever domain you're currently inside — nothing else. Domains
are picked via Cover's tiles, not by scanning a row of always-visible
icons. Five domains today, each a first-class peer dashboard with its
own accent color:

| Domain | Pages | Accent |
|---|---|---|
| `sales` | Dashboard, Sale Data (+ sub-nav: Index/Daily Data/Add Entry/Report/DIFF) | blue (base) |
| `manager` | Manager (Staff, Ledger, Targets, Salary/Petty/Credit reports) | purple |
| `notesheets` | Notes & Sheets | green |
| `closing` | Closing Book, Credit Ledger (native ports of the standalone Closing app) | teal |
| `audit` | Assignments (native port of Pharmacy Audit Hub) | amber |

Cross-domain utilities (never hidden): Cover, CommandHub (AI
assistant), Tools (settings/sync).

`showPage(id)` (`ui.js`) classifies every page id into a domain and
sets `body[data-domain]`; `nav.css` does the actual hide/show off that
attribute. Adding a new domain = one entry in `showPage()`'s
classification, one CSS line, one Cover tile.

## Architecture — 5 floors, Golden Rules

```
User → Action → Repository → Data → State → Event Bus → Pages → Components
```

- **Floor 1 (Repository)** — `repository.js`, `config.js`. Owns
  `localStorage`/IndexedDB. The only place raw storage is touched
  (a few named, deliberate exceptions: `closing-bridge.js`/
  `audit-bridge.js`/`inventory-bridge.js` for local-only external
  caches/secrets — not app business data. All three read-only bridges
  into sibling apps' own Supabase-backed data follow the same pattern;
  see each file's own header comment for its specific reasoning).
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
  `Print.render()`/`Print.renderNewTab()`), the generalized Ledger
  (`ledger-store.js`/`ledger-actions.js`/`ledger-page.js`).
- **Floor 5 (Pages)** — one file per domain's page(s). Never touch
  Repository directly; go through Actions.

**Golden Rules** (audited, holds — see "Known gaps" below for the small,
documented exceptions): Pages never touch
the database directly. Components never contain business logic.
Business modules never know about UI. State is never modified
directly. Every data change goes through Actions. Every storage
operation goes through the Repository. Every update is announced
through the Event Bus.

## File layout

- `index.html` — all pages, nav, modals. `<script type="module">` for
  real ES modules, plain `<script defer>` for classic scripts.
- `js/` — 71 files. 36 are real ES modules (`config.js`, `repository.js`,
  `actions.js`, `event-bus.js`, `print.js`, the Ledger set, Cover
  Dashboard, Staff Notes, Closing/Audit/Inventory bridges+natives, the
  9-file Manager split, `bt-format.js`/`bt-date.js`/`bt-search.js`,
  `app-init.js`, `app-context.js`, `commandhub.js`, `ai-bridge.js`,
  `manager-page.js`, `jazz-cash.js`, `notes-sheets.js`). The other 35
  are classic scripts; most are IIFE-namespaced with a `window.X = X`
  bridge at the bottom.
- `manager-page.js`/`jazz-cash.js`/`notes-sheets.js` used to mutually
  block each other's module conversion — jazz-cash.js monkey-patched
  `loadManagerPage`, notes-sheets.js monkey-patched `switchMgrTab`, both
  relying on sloppy-mode global-function semantics that only classic
  scripts have. Untangled: `manager-page.js` now calls
  `renderJazzCash()`/`renderNotesSheets()` directly (guarded, same
  style as its other cross-file calls), and all three are real modules.
  Converting `notes-sheets.js` also surfaced 6 real bugs that this
  conversion would otherwise have *introduced*: several of its inline
  `onchange`/`oninput` handlers assigned straight to a module-scoped
  `var` (e.g. `onchange="_nsDataSource=this.value;..."`), which stops
  working silently once a module's top-level declarations aren't
  implicitly global anymore. Each now routes through a small bridged
  setter instead — see notes-sheets.js's and jazz-cash.js's header
  comments for the full list.
- **Remaining classic-script candidates for a future pass:** none
  urgent — the two largest classic files left are `sync-center.js`
  (1,008 lines) and `commandhub-page.js` (1,002 lines), verified via
  `wc -l` against every `defer` script in index.html; neither blocks
  anything the way the trio above did.
- Counts verified directly against `index.html`'s `<script>` tags, not
  carried over from an earlier session — recount with
  `grep -c 'type="module" src="js/' index.html` /
  `grep -c 'defer src="js/' index.html` if this drifts again.
- `css/` — `variables.css` (design tokens, incl. per-domain accent
  colors), `nav.css` (domain isolation), `mobile.css`, feature-specific
  sheets.
- `sw.js` — service worker; cache-bust by bumping `CACHE_NAME` whenever
  any cached file changes. Comment on that line is the de facto
  changelog — read it first when picking up a stale thread.

## Key subsystems, briefly

- **Ledger** (`ledger-*.js`) — generalized replacement for what used
  to be separate Jazz Cash / Expense / Petty / Other Sections
  implementations. Migration from the old systems has been run; the
  Jazz Cash migration UI (banner/button) and its one-time migration
  function have been removed since they're no longer needed — the old
  `bt_jazzcash_v2` key is kept only as a backup safety net for
  drive.js/supabase.js, nothing reads it as a migration source anymore.
  Petty's equivalent (`migratePettyToLedger`) is still in place and
  still callable, not yet triggered from any UI.
- **Staff Registry** — CRUD goes through `Actions.addEmployee`/
  `updateEmployee`/`removeEmployee`, never raw `STAFF[i]` mutation
  (there was one real bug of exactly that kind, found via audit and
  fixed). Verified via direct grep for `STAFF[` assignment/push/splice
  outside actions.js/repository.js — currently zero hits.
- **Notes & Sheets** — multi-file workbook model
  (`bt_sheet_workbooks_v1`): each file is an independent workbook with
  its own sheet-tabs. Migrated losslessly from the old single-workbook
  + snapshot model; old keys kept untouched as a safety net.
- **Print** — one engine (`print.js`), every report is a caller into
  it, never a reimplementation.
- **Closing / Audit / Inventory bridges** — read-only, local-only
  caches of sibling apps' data (Dropbox export for Closing, direct
  Supabase read for Audit and for Inventory — the latter two share one
  Supabase project, different tables). Not app business data; don't
  route through Actions/EventBus by design.

## Known gaps (small, documented, non-urgent)

- `localStorage` is touched directly in a handful of files beyond the
  three named bridges above: `ai-bridge.js` (API key), `auth.js`
  (must run before Repository loads — load-order constraint, commented
  in place), `stockledger.js`, `excess-working.js`, `reports.js`,
  `closing-native.js`, `ui-extras.js`. All checked directly — these are
  UI-local state (FAB position, hidden report rows, last page viewed)
  or a Repository-with-fallback pattern, not app business data, so they
  don't violate the spirit of the rule. Worth naming explicitly here
  rather than letting "Repository is the only place" stand as written.
- `jazz-cash.js` and `notes-sheets.js` monkey-patch `manager-page.js`'s
  globals (see "File layout" above and each file's own guard comment).
  This is the one real architectural wrinkle in an otherwise clean
  layering — fix is known (convert all three together), just not done
  yet.
- Dead code is removed as it's found, not left in place — e.g.
  `data-base.js` (unused `MONTHLY_BASE`/`DAILY_BASE`, loaded by no
  `<script>` tag) and the old Jazz Cash migration banner/button/function
  (migration already ran; see "Key subsystems" above) have both been
  deleted rather than just flagged.

## Working conventions for future sessions

- Before touching any file, check whether a `SKILL.md`-style
  convention already covers it — this repo has none of its own, but
  the housekeeping habit that matters here: **verify claims against
  the actual code, not against what a comment says.** Several stale/
  wrong comments have been found this way (module counts in this file
  drifting from the real `index.html`, a manager-page.js comment that
  named a file as a monkey-patcher when it wasn't) — trust `grep`, not
  prose, and when you fix a stale claim, fix it in place rather than
  pointing to a separate tracking doc that can itself go stale or
  disappear.
- Any change to a live storage format needs a **lossless migration
  that never deletes the old key** — every migration in this app so
  far follows that pattern; keep it up.
- Verify structural changes with a real test (Node + jsdom for
  DOM/nav logic, plain Node with a Repository/Actions shim for
  storage/migration logic) before calling something done — this app
  has real financial data in it.
- Full test pass before a release should include a real device check
  for anything touching printing (`Print.render`/`renderNewTab`) —
  Android's `window.print()` doesn't block JS execution the way
  desktop does, which caused a real bug once already.
