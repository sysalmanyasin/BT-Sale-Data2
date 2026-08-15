# Bahria Town Sales Intelligence Centre

A personal, single-user Progressive Web App for running a pharmacy end
to end — daily sales entry and reporting, a full manager suite, a
spreadsheet tool, a cross-device PDF archive, and native read-only
views into two sibling apps (Closing, Pharmacy Audit Hub). Google
Sign-In gated, offline-capable via service worker, synced across
devices with Supabase, deployed at `bt.duapharma.com` (see `CNAME`).
Alongside the PWA, `android-widget/` is a separate native Android app
providing 19 home-screen widgets (Closing, Sales, Credit, Inventory)
— see [Android home-screen widgets](#android-home-screen-widgets).

This is intentionally a **single-user app, permanently** — there's no
multi-tenant support and no roles/permissions system. That constraint
keeps everything else simpler; don't add access-control complexity
speculatively.

> **AI has been fully removed from the client app** (as of v10.32).
> Every AI-facing feature — chat, AI settings, the Context Engine, the
> AI Daily Briefing — is gone. See [Known gaps](#known-gaps) for the
> one place AI narration still survives (a server-side Edge Function)..

---

## Contents

- [Tech stack](#tech-stack)
- [Navigation model](#navigation-model)
- [Section-by-section guide](#section-by-section-guide)
- [Android home-screen widgets](#android-home-screen-widgets)
- [Architecture](#architecture--5-floors-golden-rules)
- [File layout](#file-layout)
- [Known gaps](#known-gaps)
- [Working conventions for future sessions](#working-conventions-for-future-sessions)

---

## Tech stack

- **Vanilla JS**, ES modules where possible, a handful of classic
  `<script defer>` files bridged via `window.X` for legacy inline
  handlers — no framework, no build step.
- **Supabase** — Postgres + Storage + realtime-ish polling sync,
  backing multi-device sync, the PDF Library, Sync Center's device
  coordination, and the Audit/Inventory bridges.
- **Google Drive** — an independent daily backup, separate from
  Supabase sync.
- **Service worker** (`sw.js`) for offline install + caching.
- **jsPDF + autoTable** for print/PDF generation; Chart.js for the
  dashboards.
- No server-rendered backend of its own — this is a static site
  (GitHub Pages) talking directly to Supabase from the client.

---

## Navigation model

**Cover is the hub.** The top nav only ever shows Cover + Tools plus
whichever domain you're currently inside — never a long row of
always-visible icons. You pick a domain from a tile on Cover, and the
nav re-themes itself with that domain's accent color the moment you're
in it.

| Domain       | Pages                                                                             | Accent      |
| ------------ | ---------------------------------------------------------------------------------- | ----------- |
| `sales`      | Dashboard, Sale Data (Index / Daily Data / Add Entry / Report / DIFF / Cash Deposit) | blue (base) |
| `manager`    | Manager (Staff, Ledger, Targets, Salary/Petty/Credit/Incentive), Overview           | sky blue    |
| `notesheets` | Notes & Sheets                                                                      | green       |
| `closing`    | Closing Book, Credit Ledger                                                        | teal        |
| `audit`      | Assignments                                                                        | amber       |
| `inventory`  | BT Inventory, Stock Ledger, Excess Working, Reorder Report, Inventory Health        | pink        |

Cross-domain utilities, never hidden and never owned by a domain:
**Cover**, **Tools** (settings/sync), the **PDF Library**, and the
**Activity Log** (all three reached from the top nav / All Sections
drawer's Utility group).

Three fully separate, standalone apps live *outside* this codebase and
are only ever linked to from Cover: Closing (`closing.duapharma.com`),
Audit (`random.duapharma.com`), and Fazal Din's Pharma Plus's toolset
(`reports.duapharma.com`). Don't confuse those links with the native
`closing`/`audit`/`inventory` domains above — the native domains
re-implement a read-only view of (part of) the same underlying data
inside *this* app; the Cover links open the other apps directly.

Getting around also means three complementary nav pieces layered on
top of the tab bar: a real pushState-based back button, a **Recents**
drawer of whatever you've actually visited this session, and an **All
Sections** directory (long-press Cover, or the ☰ Menu item) that lists
every page and sub-page in the app in one collapsible tree, with a
live fuzzy search box pinned to the top.

---

## Section-by-section guide

### 🏠 Cover
The home hub and the only screen that shows every domain at once, as
a grid of tiles you drag-reorder yourself. Also the exit point to the
three external standalone apps (Closing, Audit, Fazal Din's toolset)
and the entry point to the PDF Library. Long-pressing Cover (or
tapping ☰ Menu) opens the All Sections drawer described above.

### 📊 Dashboard (Home)
The Sales domain's landing page. A pure renderer (`dashboard.js`) on
top of `analytics.js`, which owns every KPI aggregation, MTD/YTD
comparison, and forecast calculation — pages never contain business
logic themselves. On top of the standard KPI row, `dashboard-insights.js`
adds a **Daily Briefing** card (rotates on whichever signal is
strongest that day — plain computed data, not AI-generated), a
**Target Pace** card, and a rotating insight strip (weekday
comparisons, staff outlier detection, and similar).

### 🗂️ Sale Data
Daily sales entry and every report built on top of it, reached via its
own sub-nav:
- **Index** — a collapsible year → month directory of every day on
  record.
- **Daily Data** — the raw day-by-day ledger.
- **Add Entry** — the daily sales entry form.
- **Report** — the standard sales report.
- **DIFF** — a diff/reconciliation report between two data points.
- **Cash Deposit Report** — computed fresh for every day as
  `Cash Sale − Cash Returns + FDPP POS + FDPP Consumer`, deliberately
  kept separate from the manually-typed "Cash to be Deposited" field
  elsewhere in the app, which just reflects whatever was typed in.
  Prints via a vector jsPDF + autoTable thermal-receipt renderer, not
  `html2canvas`.

### 👔 Manager
The staff and money-movement suite:
- **Staff Registry** — full CRUD on employee records, always routed
  through Actions (`addEmployee`/`updateEmployee`/`removeEmployee`),
  never raw state mutation. Each staff card has its own **Notes** tab
  for simple timestamped per-employee notes (not a messaging system).
- **Ledger** — a generalized replacement for what used to be separate
  Jazz Cash / Expense / Petty / custom-section implementations, now
  unified behind one store with date-range filtering and
  group-by-category (Petty/Expenses, Jazz Cash, custom sections
  alike).
- **Targets** — staff/store performance targets feeding the
  Dashboard's Target Pace card.
- **Reports** — Salary, Petty, Credit, and Incentive reports, each its
  own manager sub-tab.

Every free-typing sub-tab here (Staff Registry, Salary, Generic
Working, Petty Detail, Staff Credit — sheet and Staff Card views —,
Incentive, Jazz Cash's Balance Tally) autosaves: `mgrAutosave()`
(`js/manager-shared.js`) debounces ~700ms after the last keystroke and
then calls that sub-tab's own `save*Data()` — no click needed. Each
Save button stays as an explicit "save right now" fallback (it briefly
flashes "✓ Saved" when an autosave commits instead) rather than being
removed. Deliberately excluded: the generalized Ledger's inline
per-row edit (`ledger-page.js`) keeps its explicit ✓/✕ Save/Cancel —
that's a genuine back-out-before-committing safeguard for a ledger,
not friction to remove.

### 📊 Overview (Manager Overview)
A dedicated Manager-domain dashboard, separate from the Sales
Dashboard, giving a manager-focused summary view across staff, ledger,
and targets.

### 📑 Notes & Sheets
A lightweight, multi-file spreadsheet tool living entirely inside the
app — no separate backend, synced through the same pipeline as
everything else. Each file is an independent workbook with its own
sheet tabs. Its standout feature is the **🔗 Data tab**, which can
materialize any live table from Sales, Manager, or Inventory straight
into a new, fully editable grid.

### 📖 Closing Book & 💳 Credit Ledger
Native, read-only ports of the standalone Closing app's own pages,
fed by a local cache of a Dropbox export (`closing-bridge.js`) rather
than app business data — so they deliberately sit outside the
Actions/Event Bus pipeline the rest of the app uses.

### 🧾 Assignments
A native, read-only port of the standalone Pharmacy Audit Hub's own
page, fed directly from the shared Supabase project the two apps have
in common (`audit-bridge.js`).

### 📦 Inventory suite
Five native pages sharing one already-loaded dataset
(`window.StockLedgerApp.getRawRows()`), read-only from the **separate
Pharmacy Audit Hub Supabase project** (`inventory-bridge.js`) rather
than the main BT Sale Data project — but each page is a small app in
its own right, not a plain table view:
- **BT Inventory** — the native inventory home page
  (`inventory-native.js`): search, group-by-Manufacturer/Supplier,
  paged 100 rows at a time (built for 5,000+ SKU inventories), and a
  toggleable optional-column picker exposing every column on
  `inventory_products`, not just the base 6 shown by default.
- **Stock Ledger** — not one flat table but **5 panels**
  (`neverSold`, `deadStock`, `excess`, `packIssues`, `zeroStock`),
  each with its own independent sort/search/filter state.
- **Excess Working** — flags stock sitting too high relative to sales
  (90+ days of cover by default) across **4 sub-tabs**: the flagged
  Working list; a persistent per-device **Retain List** (items always
  excluded from Excess regardless of pack quantity); **Adjustments**
  (an optional reported-HO-value reconciliation with a live variance
  calculation); and **Export** (Top-N Excel export with preset
  buttons).
- **Reorder Report** — the inverse: flags stock running out too soon
  and ranks the shortfall by sale value, across **Top N / All**
  sub-tabs, each independently configurable — sale-value window
  (30/60/90 day), cover-days threshold, an "include today's live
  sales" toggle, group-by-supplier, and a per-column hide picker that
  also affects print output.
- **Inventory Health** — a standalone health dashboard: 4 separate
  Chart.js charts (health classification, movers, trend, supplier
  breakdown), a KPI row, and a searchable table. Adds one metric none
  of the others track: a local day-by-day trend of total reorder
  value, since the underlying table is a live snapshot rather than a
  time series.

Inventory isn't confined to these 5 pages, either:
- **Automated alerts** — `rules-registrations.js` registers 3 rules
  (low-cover-value, excess-item, dead-stock-aggregate) into the Cover
  dashboard's alert engine, so a reorder or excess-stock warning can
  surface without anyone opening an inventory page.
- **9 of the Android app's 19 home-screen widgets** are inventory
  widgets, running a Kotlin port of this same math so they stay
  correct without either app open — see
  [Android home-screen widgets](#android-home-screen-widgets).
- **The Inventory Search companion PWA** (`/inventory-search/`) is a
  separate, standalone one-tap lookup tool over the same dataset — see
  [below](#-inventory-search-standalone-companion-pwa).

### ⚙️ Tools
Settings and cross-cutting utilities, most notably:
- **Sync Center** — a "single active device" architecture (device ID +
  activity tracking + a priority lock over a Supabase `bt_sessions`
  table) so two devices editing at once don't silently clobber each
  other, plus its own Session / Devices / Controls / Health / Logs /
  Settings sub-tabs. `conflict-ui.js` owns the actual dialog for
  resolving a flagged conflict when one comes up.

### 📄 PDF Library
A cross-device archive of every PDF the app has ever generated, fed
directly from the one place every report already funnels through:
the instant a print is requested, a "Generating…" popup appears; once
the PDF blob exists, that same popup swaps to View / Download /
Save-to-Library, with no forced new tab and no silent download.
Backed by Supabase Storage, with a silent expiry sweep run on every
unlock.

### 🕒 Activity Log
A cross-device, Supabase-synced feed of what changed, where, and
when — date/time, section, and add / edit / delete — for a single-user
app running on more than one device. Fed passively off the EventBus
(`js/event-bus.js`) that every real data mutation already announces
itself on (`repository.js`'s daily/monthly/staff/generic-item writes,
`actions.js`'s staff:added/updated/removed, `ledger-store.js`'s
ledger:changed, diffed by id since that event carries the full entries
array rather than a verb) — no existing Action had to change to wire
this up. Table is `bt_activity_log` (`supabase/activity_log/schema.sql`);
not to be confused with the sibling standalone Closing app's own,
differently-shaped `activity_log` table that `closing-bridge.js` reads
read-only (`{ts, actor, key, action, changes}`) — the two are
deliberately separate tables in the same Supabase project.

### 🕘 Recents & 🔍 Global Search
Two navigation aids that live in drawers rather than pages: **Recents**
lists whatever sections you've actually visited this session; the
**All Sections** drawer lists the entire app as a collapsible tree,
with a fuzzy search box at the top that filters the tree live and also
fuzzy-ranks the Staff registry, so searching an employee's name jumps
straight to their Staff Card.

### 🔒 Auth
A Google Sign-In gate, which has to run *before* the rest of the app's
data layer loads — the one deliberate exception to "nothing touches
storage directly." Also triggers the PDF Library's expiry sweep on
every unlock. There used to be a PIN/password offline fallback; it's
been removed (see comments in `auth.js`) — Google Sign-In with an
authorised email is now the only way in. Real access control happens
server-side: the Google `id_token` establishes a genuine Supabase
session (`signInWithIdToken`), so `auth.uid()` is real for RLS — the
client-side authorised-email check is a fast-fail UX gate, not the
actual security boundary.

---

## 🔍 Inventory Search (standalone companion PWA)

`/inventory-search/` is a deliberately separate, lightweight PWA — not
a page inside the main app — for one-tap medicine lookup: type a
product/generic/code, tap a result for a detail sheet (stock, price,
company, supplier, tax, movement stats), and optionally hit "Ask AI"
for a free-tier AI-generated overview of that medicine.

- **Why separate:** installs to the home screen as its own icon
  (`Inv Search`, no login screen, no nav chrome) so it opens instantly —
  the closest practical thing to a native search widget without native
  Android development. Has its own `manifest.json` and its own
  `sw.js`, scoped to `/inventory-search/` only, so it doesn't collide
  with the main app's root-scoped service worker.
- **Data:** reads `inventory_products` directly — same Supabase
  project, same anon/publishable key as `inventory-bridge.js`,
  read-only, RLS-scoped (not key-secrecy-scoped). Reuses `BTFormat`
  and `BTSearch` from the main app's `js/` folder rather than
  reimplementing currency formatting or fuzzy ranking.
  Full product list is cached in `localStorage` and refreshed at most
  once a minute, so search itself is instant and works offline on
  stale data if there's no connection.
- **AI info:** calls the `medicine-ai-info` Supabase Edge Function
  (`supabase/functions/medicine-ai-info/`) — Groq primary, Gemini
  fallback, both free-tier, with a `medicine_ai_cache` table so the
  same medicine isn't re-asked of the AI provider more than once every
  30 days. **Deployed and live** in the BT SALE DATA / Closing project
  (`wetbugzzchkghpzmowod`) — the cache table there too. The one
  remaining step is setting `GROQ_API_KEY` (and optionally
  `GEMINI_API_KEY`) as secrets on that project, since those need your
  own free account — see that function's `DEPLOY.md`.
- **AI chat:** a separate floating chat assistant, calling a second
  Edge Function (`supabase/functions/inventory-chat/`). Answers
  inventory questions only from the search-result context the client
  already has locally (no server-side inventory access by design) and
  general medicine questions from the model's own knowledge — same
  "reference only, not patient-specific advice" framing as the
  `medicine-ai-info` lookup above.

---

## Android home-screen widgets

`android-widget/` is a **separate native Android app** (Kotlin, its
own Gradle project — not part of the PWA's build or deploy) whose only
purpose is **19 home-screen widgets**: Closing (summary, sales/target
pace, aggregated final closing, latest month total, today's live POS
sale, last-3-shifts), Credit (total outstanding, section breakdown,
per-staff), Misc/Ongoing Ledger aging, and nine Inventory widgets
(total stock, health, reorder-urgency, excess/top-running/negative/
dead/never-sold rankings, plus a tap-shortcut into a native product
search screen). Every number is either read straight from the same
Supabase tables the web app writes to, or computed via a line-for-line
Kotlin port of the web app's own math (`InventoryRepository.kt`
mirrors `stockledger.js`/`excess-working.js`/`reorder-report.js`;
`MonthSaleRepository.kt` mirrors `js/cover-dashboard.js`), so the
widgets stay correct without either app needing to be open. Auth is a
dedicated read-only "widget service" Supabase account, not a user's
own Google sign-in. Built via GitHub Actions on every push touching
`android-widget/**`; full widget list, data sources, and install
instructions in [`android-widget/README.md`](android-widget/README.md).

---

## Architecture — 5 floors, Golden Rules

```
User → Action → Repository → Data → State → Event Bus → Pages → Components
```

- **Floor 1 (Repository)** — `repository.js`, `config.js`. The only
  place raw storage is touched for real business data (a short list of
  named, deliberate exceptions — see [Known gaps](#known-gaps)).
- **Floor 2 (State)** — the in-memory arrays/objects (`DAILY`/
  `MONTHLY`/`STAFF`), guarded by a write-detection Proxy.
- **Floor 3 (Actions/Event Bus)** — `actions.js`, `event-bus.js`.
  Every data *change* goes through an Action; every mutating Action
  calls `EventBus.notify(...)`.
- **Floor 4 (Components)** — reusable, UI-agnostic building blocks:
  `print.js` (the only place `window.print()`/`document.write()` are
  touched), `pdf-library.js`, the generalized Ledger, `conflict-ui.js`.
- **Floor 5 (Pages)** — one file per domain page. Never touch the
  Repository directly; always go through Actions.

**Golden rules** (verified against the code, not just claimed): pages
never touch the database directly; components never contain business
logic; business modules never know about UI; state is never modified
directly; every data change goes through an Action; every storage
operation goes through the Repository; every update is announced
through the Event Bus.

---

## File layout

- `index.html` — every page, the nav, and all modals in one file.
  `<script type="module">` for real ES modules, `<script defer>` for
  classic scripts.
- `js/` — one file per feature/page, generally namespaced as an IIFE
  with a `window.X` bridge so both module- and classic-script
  consumers can reach it. `js/shared/` holds code only ever reached via
  `import`, never its own `<script>` tag.
- `css/` — `variables.css` (design tokens, including each domain's
  accent color and a shared spacing scale), `nav.css` (domain
  isolation + re-theming), `components.css`/`pages.css`/`modals.css`/
  `mobile.css` (shared UI), plus one feature-specific sheet per major
  page/domain.
- `sw.js` — the service worker; bump `CACHE_NAME` and keep
  `APP_SHELL` in sync with `index.html` whenever a `<script>`/`<link>`
  tag changes, or offline/flaky-connection loads silently break.
- `android-widget/` — separate native Android app (19 home-screen
  widgets), its own Gradle project — see
  [Android home-screen widgets](#android-home-screen-widgets) and
  `android-widget/README.md`.
- `.github/workflows/build-widget-apk.yml` — builds a debug APK on
  every push touching `android-widget/**`.
- `supabase/functions/` — Edge Functions, including the daily
  WhatsApp briefing generator.
- `supabase/pdf_library/` — schema + deploy notes for the PDF
  Library's Storage bucket and metadata table.
- `scripts/generate-icons.ps1` — one-off PWA icon generator.
- `manifest.json` — PWA manifest (home-screen shortcuts: Add Daily
  Entry, Dashboard, Daily Data, Sale Report).
- `CNAME` — GitHub Pages custom-domain file, points the deploy at
  `bt.duapharma.com`.

---

## Known gaps

- `localStorage` is touched directly outside the Repository in these
  files (verified via `grep -rl "localStorage\." js` — this list has
  drifted before, re-run that grep before trusting it):
  `auth.js` (must run before the Repository loads — a load-order
  constraint), the three read-only bridges (`closing-bridge.js`,
  `audit-bridge.js`, `inventory-bridge.js`) plus a fourth,
  `sale-payments-bridge.js`, following the same read-only pattern,
  `activity-log.js` (its local cache mirrors `bt_activity_log`, whose
  authoritative copy lives in Supabase — also sidesteps a feedback
  loop, since going through Repository would re-fire the very
  EventBus event this file listens to), `drive.js` (caches the Google
  Drive OAuth access token + expiry), `closing-ledger-marks.js`
  (a small pending-marks map, UI-local), `fields.js` (theme
  preference only), and a Repository-with-`localStorage`-fallback
  pattern in `inventory-native.js` / `inventory-health-dashboard.js`
  (`stockledger.js`, `excess-working.js`, `reorder-report.js`,
  `reports.js`, `closing-native.js`, `ui-extras.js` also fall into
  this UI-local-state bucket) — none of it is business data, so it
  doesn't violate the spirit of the rule.
- `bt-search.js` was dead code post-AI-removal; it's now back in use,
  powering Global Search.
- AI narration survives in **two** places, not one: the daily
  WhatsApp briefing Edge Function (Groq, Cerebras fallback) covered
  above, and the Inventory Search PWA's floating chat assistant
  (`supabase/functions/inventory-chat/`, wired up in
  `inventory-search/app.js` via `CHAT_FUNCTION_URL`) — answers
  inventory questions strictly from client-supplied search-result
  context (no server-side inventory access) and general medicine
  questions from the model's own knowledge. Everything in the *main*
  app (this README's primary subject) is still AI-free; both AI
  surfaces live in the separate Inventory Search companion PWA /
  its Edge Functions.
- All CDN library `<script>` tags in `index.html` are now pinned to
  an exact version and SRI-hashed (`integrity` + `crossorigin`
  attributes) — the Chart.js and Supabase Edge Function
  script tags used to float on an unpinned `@2`, and none had a
  hash. Chart.js is served from jsDelivr's `dist/chart.umd.js`
  (unminified — the exact minified `chart.umd.min.js` cdnjs used to
  serve isn't published to npm, so there's no way to hash-verify that
  specific minified build against its source; the unminified npm
  build is byte-verifiable and was preferred over shipping an
  unverifiable hash). Google's GSI client (`accounts.google.com/gsi/client`)
  is deliberately left unpinned/unhashed — Google doesn't support SRI
  on it and rotates it without notice. **When bumping any pinned
  library version, regenerate its hash from the matching npm package
  — don't hand-edit the `integrity` attribute.**

---

## Working conventions for future sessions

- **Verify claims against the actual code**, not against what a
  comment or this README says — module counts, file names, and
  "was this deleted?" claims have all drifted from reality before.
  Trust `grep`/`find`.
- Any change to a live storage format needs a **lossless migration
  that never deletes the old key** — every migration in this app so
  far follows that pattern.
- Verify structural changes with a real test before calling something
  done — this app holds real financial data.
- Converting a classic script to a real ES module isn't just adding
  `import`/`export` — check every inline `onclick`/`onchange`/
  `oninput` handler in `index.html` that assigns to that file's
  top-level variables; those handlers run in global scope and will
  silently create a disconnected `window.*` global once the file
  becomes a module. Route through a small bridged setter instead.
  Also bump `sw.js`'s `CACHE_NAME` and add the file to `APP_SHELL`.
- Test printing (`Print.render`/`renderNewTab`) on a real Android
  device before release — `window.print()` doesn't block JS execution
  there the way it does on desktop, which has caused a real bug once
  already.
