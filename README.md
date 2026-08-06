# Bahria Town Sales Intelligence Centre

A personal, single-user Progressive Web App for running a pharmacy end
to end — daily sales entry and reporting, a full manager suite, a
spreadsheet tool, a cross-device PDF archive, and native read-only
views into two sibling apps (Closing, Pharmacy Audit Hub). Google
Sign-In gated, offline-capable via service worker, synced across
devices with Supabase, deployed at `bt.duapharma.com` (see `CNAME`).

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
**Cover**, **Tools** (settings/sync), and the **PDF Library** (opened
as a Cover shortcut).

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
Five pages sharing one already-loaded dataset
(`window.StockLedgerApp.getRawRows()`), each a different lens on the
same shared, Supabase-synced inventory:
- **BT Inventory** — the native inventory home page.
- **Stock Ledger** — the full inventory ledger, one row per product.
- **Excess Working** — flags stock sitting too high relative to sales
  (90+ days of cover by default) and quantifies how much is tied up.
- **Reorder Report** — the inverse: flags stock running out too soon,
  ranks the shortfall by sale value, and estimates how much to buy.
- **Inventory Health** — a standalone health dashboard (health
  classification, reorder/velocity math, Chart.js charts, a searchable
  table) that adds one metric none of the others track: a local
  day-by-day trend of total reorder value, since the underlying table
  is a live snapshot rather than a time series.

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

### 🕘 Recents & 🔍 Global Search
Two navigation aids that live in drawers rather than pages: **Recents**
lists whatever sections you've actually visited this session; the
**All Sections** drawer lists the entire app as a collapsible tree,
with a fuzzy search box at the top that filters the tree live and also
fuzzy-ranks the Staff registry, so searching an employee's name jumps
straight to their Staff Card.

### 🔒 Auth
A Google Sign-In gate with a PIN fallback, which has to run *before*
the rest of the app's data layer loads — the one deliberate exception
to "nothing touches storage directly." Also triggers the PDF Library's
expiry sweep on every unlock.

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
- **Not yet built:** a true native Android home-screen widget (the
  resizable live tile). That needs an Android Studio / Kotlin project,
  which is a separate build from this repo.

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

- `localStorage` is touched directly outside the Repository in a
  handful of files: `auth.js` (must run before the Repository loads —
  a load-order constraint), the three read-only bridges
  (`closing-bridge.js`, `audit-bridge.js`, `inventory-bridge.js`), and
  a few files storing UI-local state only (`stockledger.js`,
  `excess-working.js`, `reorder-report.js`, `reports.js`,
  `closing-native.js`, `ui-extras.js`) — none of it is business data,
  so it doesn't violate the spirit of the rule.
- `bt-search.js` was dead code post-AI-removal; it's now back in use,
  powering Global Search.
- The daily WhatsApp briefing Edge Function still calls Groq (Cerebras
  fallback) to narrate the briefing text — the one place AI still runs
  anywhere in this project. Everything client-side is AI-free.

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
