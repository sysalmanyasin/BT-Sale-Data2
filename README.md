# Bahria Town Sales Intelligence Centre

A personal, single-user PWA for running a pharmacy: daily sales entry
and reporting, a manager suite (staff, ledger, targets), a spreadsheet
tool, an AI assistant (CommandHub) with its own domain-registry
architecture, and read-only bridges into two sibling apps (Closing,
Pharmacy Audit Hub — the latter also feeding a native Inventory
domain). Google Sign-In gate, offline-capable via service worker,
Supabase for multi-device sync, deployed at `bt.duapharma.com` (see
`CNAME`).

No multi-tenant, no roles/permissions system — this stays a
single-user app permanently. That decision simplifies everything else
here; don't add access-control complexity speculatively.

## Navigation model

**Cover is the hub.** The nav bar shows only Cover + CommandHub + Tools
plus whichever domain you're currently inside — nothing else. Domains
are picked via Cover's tiles, not by scanning a row of always-visible
icons. Six domains today, each a first-class peer dashboard with its
own accent color:

| Domain | Pages | Accent |
|---|---|---|
| `sales` | Dashboard, Sale Data (+ sub-nav: Index/Daily Data/Add Entry/Report/DIFF) | blue (base, `--accent`/`--alt`) |
| `manager` | Manager (Staff, Ledger, Targets, Salary/Petty/Credit reports) | sky blue (`--mgrblue` `#0369a1`) |
| `notesheets` | Notes & Sheets | green (`--green` `#059669`) |
| `closing` | Closing Book, Credit Ledger (native ports of the standalone Closing app) | teal (`--teal` `#0d9488`) |
| `audit` | Assignments (native port of Pharmacy Audit Hub) | amber (`--amber` `#d97706`) |
| `inventory` | BT Inventory, Stock Ledger, Excess Working, Reorder Report (native ports over Pharmacy Audit Hub's shared, Supabase-synced inventory) | pink (`--pink` `#db2777`) |

Cross-domain utilities (never hidden): Cover, CommandHub (AI
assistant), Tools (settings/sync).

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
  `Print.render()`/`Print.renderNewTab()`), the generalized Ledger
  (`ledger-store.js`/`ledger-actions.js`/`ledger-page.js`).
- **Floor 5 (Pages)** — one file per domain's page(s). Never touch
  Repository directly; go through Actions.

**Golden Rules** (verified against the code — see "Known gaps" below
for the small, documented exceptions): Pages never touch the database
directly. Components never contain business logic. Business modules
never know about UI. State is never modified directly. Every data
change goes through Actions. Every storage operation goes through the
Repository. Every update is announced through the Event Bus. A
direct `grep` for `STAFF[` assignment/mutation outside
`actions.js`/`repository.js` currently finds only read accesses —
zero mutation hits.

## File layout

- `index.html` — all pages, nav, modals. `<script type="module">` for
  real ES modules, plain `<script defer>` for classic scripts.
- `js/` — 80 files (verified via `find js -name "*.js" | wc -l`). 45
  are real ES modules: 38 are directly `<script type="module">`-tagged
  in `index.html`, plus 7 more that are only ever reached by `import`
  from another module and never get their own `<script>` tag
  (`js/ai/core/ai-client.js`, `ai-datetime.js`,
  `ai-providers.config.js`, `registry.js`, `js/ai/domains/
  sales-domain.js`, `manager-domain.js`, `js/shared/
  summary-calc.js` — the last is also reused, via relative import,
  by the Supabase Edge Function in `supabase/functions/`). The
  remaining 35 are classic `<script defer>` files, most
  IIFE-namespaced with a `window.X = X` bridge at the bottom so
  module-scope consumers and classic-script consumers can both reach
  them.
  - Recount if this drifts:
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
- **AI subsystem** (`js/ai-bridge.js` + `js/ai/`) went through a
  domain-registry split (`js/ai/core/registry.js`): `ai-bridge.js`
  (1,955 lines, still the largest file in the app) owns intent
  parsing/routing and the provider-agnostic chat loop, while
  `js/ai/domains/sales-domain.js`, `manager-domain.js`, and
  `inventory-domain.js` each own one domain's handlers, registered via
  `registerDomain()`. `js/ai/core/ai-client.js` +
  `ai-providers.config.js` are the single place an AI model/provider
  ID is ever configured — `callAI()` loops the configured provider
  list with automatic fallback on retryable failures (HTTP 400/429,
  `model_decommissioned`), so callers never know which provider
  actually served a request. See "Key subsystems" below for the rest
  of the AI file set (context, instructions, memory, intent groups).
- **Remaining classic-script candidates for a future pass:** none
  urgent — the two largest classic files left are `sync-center.js`
  (1,008 lines) and `commandhub-page.js` (1,049 lines); neither blocks
  anything the way the trio above did.
- `css/` — `variables.css` (design tokens, incl. per-domain accent
  colors), `nav.css` (domain isolation + accent re-theming),
  `mobile.css`, feature-specific sheets (one per major page/domain,
  e.g. `cover-dashboard.css`, `stockledger.css`, `excess-working.css`,
  `reorder-report.css`, `closing-native.css`,
  `closing-book-print.css`, `audit-native.css`,
  `inventory-native.css`).
- `sw.js` — service worker; cache-bust by bumping `CACHE_NAME`
  whenever any cached file changes (`APP_SHELL` list must stay in
  sync with every real `<script>`/`<link>` in `index.html`, or that
  file silently fails offline/on a flaky connection instead of
  erroring). The versioned comment on that line is the de facto
  changelog — read it first when picking up a stale thread.
- `supabase/functions/send-daily-whatsapp-briefing/` — a Supabase Edge
  Function (`index.ts`) that generates and sends a daily WhatsApp
  briefing via the Meta Graph API, reusing `js/shared/
  summary-calc.js` for the actual numbers. Not deployable from a
  sandboxed environment (no network access to supabase.com/Meta's
  API) — see that folder's `DEPLOY.md` for the manual deploy steps,
  including the one-time WhatsApp template approval and the Supabase
  secrets it needs (`GROQ_API_KEY`, optional `CEREBRAS_API_KEY`
  fallback, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_RECIPIENT`, `WHATSAPP_TEMPLATE_NAME`).
- `scripts/generate-icons.ps1` — one-off PowerShell script that
  generates the PWA icon set in `icons/` from a source image.
- `manifest.json` — PWA manifest; declares `Add Daily Entry`,
  `Dashboard`, and `Daily Data` as home-screen shortcuts.
- `CNAME` — GitHub Pages custom-domain file, points this deploy at
  `bt.duapharma.com`.

## Key subsystems, briefly

- **AI Assistant / CommandHub** — the largest subsystem in the app,
  spread across ~15 files:
  - `ai-bridge.js` + `js/ai/core/` + `js/ai/domains/` — intent
    parsing/execution and the provider-agnostic AI call layer (see
    "File layout" above).
  - `ai-context.js` / `ai-context-ui.js` — the Context Engine: remembers
    the user's working context (current employee/section/page/month)
    across messages so a bare `"2500"` can resolve to "credit 2500 for
    Kashif" once that staff member is already in focus.
  - `ai-instructions.js` / `ai-instructions-ui.js` — lets the owner
    teach the assistant standing instructions about how the business
    works; stored in `localStorage` and marked for Supabase sync.
  - `js/ai/core/ai-memory.js` — deliberately narrow scope: a one-
    paragraph plain-language narration of the app's current state
    (`aimBriefingGenerate`), cached, plus a read-only panel showing the
    last briefing and saved instructions. Explicitly *not* an operator
    and has no facts/rules/corrections/voice-log system.
  - `intent-groups.js` — organizes every intent into business groups
    and exposes usage-tracked "suggested shortcuts."
  - `ai-helpers.js`, `commandhub.js`, `commandhub-page.js`,
    `knowledge-sheet.js` — the chat UI itself, quick-shortcut rendering,
    and a knowledge-sheet reference panel.
- **Ledger** (`ledger-*.js`) — generalized replacement for what used
  to be separate Jazz Cash / Expense / Petty / Other Sections
  implementations. That migration has already run; the Jazz Cash
  migration UI and its one-time migration function were removed once
  it was no longer needed — the old `bt_jazzcash_v2` key is kept only
  as a backup safety net for `drive.js`/`supabase.js`, nothing reads it
  as a migration source anymore. Petty's equivalent
  (`migratePettyToLedger`) is still in place and callable, not yet
  triggered from any UI.
- **Staff Registry** — CRUD goes through `Actions.addEmployee`/
  `updateEmployee`/`removeEmployee`, never raw `STAFF[i]` mutation —
  verified via direct grep for `STAFF[` assignment/push/splice outside
  `actions.js`/`repository.js`: currently zero hits (every other
  reference is a read).
- **Notes & Sheets** — multi-file workbook model
  (`bt_sheet_workbooks_v1`): each file is an independent workbook with
  its own sheet-tabs. Migrated losslessly from the old single-workbook
  + snapshot model; old keys kept untouched as a safety net.
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
- **Auth** (`auth.js`) — Google Sign-In gate with a PIN fallback. Must
  run before the Repository loads, which is why it's one of the
  handful of files allowed to touch `localStorage` directly (see
  "Known gaps").
- **Sync** — `sync-center.js` implements a "single active device"
  architecture (UDID + activity tracking + priority lock) against a
  `bt_sessions` Supabase table, so two devices editing at once don't
  silently clobber each other. `supabase.js` is the Supabase client
  setup + pull/push sync; `drive.js` is a separate, independent daily
  backup to Google Drive (auto-runs after unlock).

## Known gaps (small, documented, non-urgent)

- `localStorage` is touched directly in a handful of files beyond the
  three read-only bridges above (`closing-bridge.js`,
  `audit-bridge.js`, `inventory-bridge.js`): `ai-bridge.js` and
  `js/ai/core/ai-client.js` (provider API keys), `js/ai/core/
  ai-memory.js` (cached briefing text), `auth.js` (must run before
  Repository loads — load-order constraint, commented in place),
  `stockledger.js`, `excess-working.js`, `reorder-report.js`,
  `reports.js`, `closing-native.js`, `ui-extras.js`. All checked
  directly (`grep -rl "localStorage\." js`) — these are UI-local state
  (FAB position, hidden report rows, last page viewed), cached
  AI output, or a Repository-with-fallback pattern, not app business
  data, so they don't violate the spirit of the rule.
- `jazz-cash.js` and `notes-sheets.js` used to monkey-patch
  `manager-page.js`'s globals; this has been untangled (see "File
  layout" above) and all three are real ES modules now — noting it
  here in case a future change reintroduces the pattern.
- Dead code is removed as it's found, not left in place. The service
  worker's changelog comment (`sw.js`, top of file) records several
  cases where an earlier session's changelog entry claimed a file was
  deleted but it actually wasn't (`js/manager.js`'s 1,906-line
  monolith, `js/data-base.js`, `js/bt-calc.js`) — all three are
  confirmed actually gone now, but this is a reminder to verify with
  `find`/`grep`, not trust a prior changelog entry at face value.

## Working conventions for future sessions

- Before touching any file, check whether a `SKILL.md`-style
  convention already covers it — this repo has none of its own, but
  the housekeeping habit that matters here: **verify claims against
  the actual code, not against what a comment (or this README) says.**
  Several stale/wrong claims have been found this way in past
  passes — module counts drifting from the real `index.html`, a
  comment naming the wrong file as a monkey-patcher, a changelog entry
  claiming a file was deleted when it wasn't. Trust `grep`/`find`, and
  when you fix a stale claim, fix it in place here rather than
  pointing to a separate tracking doc that can itself go stale.
- Any change to a live storage format needs a **lossless migration
  that never deletes the old key** — every migration in this app so
  far follows that pattern; keep it up.
- Verify structural changes with a real test (Node + jsdom for
  DOM/nav logic, plain Node with a Repository/Actions shim for
  storage/migration logic) before calling something done — this app
  has real financial data in it.
- Converting a classic script to a real ES module is not just adding
  `import`/`export` — check every inline `onclick`/`onchange`/`oninput`
  handler in `index.html` that assigns straight to that file's
  top-level `var`/`let`/`const`. Those handlers always execute in
  global scope; once the file becomes a module, its top-level
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
