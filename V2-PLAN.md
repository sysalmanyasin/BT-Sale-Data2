# BT Sales App v2 — Planning Document

*Status: DRAFT. Decision made: evolve the current app in place, not a
parallel rewrite — see §0.*

## 0. Rewrite vs. evolve — decision and reasoning

Considered a full parallel rewrite; decided against it. Reasoning:

- The current app already has the exact foundation this vision needs:
  5-floor architecture intact, Floor 1–3 (`config`/`event-bus`/
  `repository`/`actions`) are real ES modules with zero legacy
  compromise, and most of Floor 4/5 is properly namespaced. This isn't
  a legacy mess anymore — it's most of the way to done.
- A parallel rewrite would re-risk a large amount of proven business
  logic (returns-sign handling, credit/petty tracking, gap-fill/conflict
  resolution, branch scoring) for a benefit that's achievable
  incrementally instead.
- The growth pattern that's emerged through planning — Sales stays the
  same, Manager stays close to the same, Notes/Sheets grows into its
  own peer dashboard, Closing/Inventory join as new peer dashboards —
  is "add more first-class domains over time," which the 5-floor
  architecture is designed to absorb cheaply, especially once each new
  domain reuses the same Repository/Actions/EventBus/Ledger/Print
  patterns instead of rebuilding them.
- Confirmed permanently single-user/personal — no multi-tenant,
  no roles/permissions complexity ever needed, which removes the one
  class of change that might have justified a different foundation.

**The plan going forward:** each new feature (generalized Ledger,
Dropbox integration, Notes/Sheets expansion) is built as a clean, real
ES module from day one *inside* the current app — new code never
touches the old window-bridge pattern, only imports properly from
`Actions`/`Repository`. When new feature work touches an old file (e.g.
building the generalized Ledger means rewriting `jazz-cash.js` anyway),
that's the natural moment it gets properly modularized too — modernization
happens as a side effect of real feature work, not a separate cleanup
project.

## 1. What "clean architecture" means now that we're evolving, not rewriting

The 5-floor blueprint and Golden Rules stay exactly as they are. The
goal is still zero window-bridges and no circular dependencies for
every *new* domain built from here — the difference from a rewrite is
just that old files earn their way to that standard as real feature
work touches them, rather than all at once on day one.

The rule for new code: Pages only ever call Actions, never each other
directly. This is what prevented the `ui.js`↔`manager.js` circular mess
in the old code, and it's enforceable for anything new starting today
without needing a fresh repo to do it.

---

## 2. Navigation structure

Confirmed: this stays a **personal, single-user app permanently** — no
multi-tenant, no roles/permissions system ever needed. That simplifies
auth for every future domain (same Google Sign-In gate, no per-domain
access control to design).

The shape that's emerged through planning: Cover Dashboard routes to
**peer dashboards**, each a first-class domain with its own state,
Actions, and Analytics — not nested tabs bolted onto Manager.

**Cover Dashboard** (new) — landing page, concise summary only:
- Today's sales headline, target pace, one-line status per domain
- Tiles, one per peer dashboard below

**Sales Dashboard** — unchanged from today: dashboard, insights,
charts, data entry, index/monthly views.

**Manager Dashboard** — rebuilt around the generalized Ledger (§3) and
Staff Registry (§4). Scope stays close to today's Manager tab otherwise.

**Notes & Sheets Dashboard** (elevated — was originally planned as a
Manager sub-feature, now a full peer dashboard in its own right, since
this is where the most feature growth is expected). Multi-sheet
workbook model (§5), its own page, its own tile on the Cover Dashboard.

**Closing / Inventory Dashboard(s)** — Cash Closing and Inventory Audit
(§6), Dropbox-fed. Open question: one combined dashboard with two
sections, or two separate dashboards/tiles? Given their schemas are
confirmed separate (§6), leaning toward two separate tiles for now,
but worth confirming once the Inventory Audit sample is in hand and its
actual size/complexity is known.

This is expected to keep expanding — new peer dashboards are the
pattern going forward, not a fixed final set. The architecture's job is
to make each new one cheap: new Floor 2 state + Floor 1 Repository +
Floor 3 Actions + reused Floor 4 components (`Ledger`, `Print`, chart
components) + one Floor 5 page + one Cover Dashboard tile.

**Status: LIVE — Sales/Manager domain isolation.** `showPage()` now
classifies every page into a domain (`sales`: Dashboard + all Sale Data
pages, `manager`: Manager, or `''` for the cross-domain utilities —
Cover/CommandHub/Tools) and sets `body[data-domain]`. `nav.css` uses
that attribute to hide the other domain's nav tabs entirely — while on
a Manager page the Dashboard/Sale Data tabs don't exist in the nav at
all, and vice versa; the only way across is through Cover (or
CommandHub/Tools, which stay visible everywhere as cross-domain
utilities, not owned by either dashboard). Manager also gets its own
`--accent`/`--alt` re-theme (reuses the existing `--purple` token) that
cascades to every button/tab/hover state already written against those
variables — no per-component changes needed. The nav brand subtitle
swaps between "Sales Dashboard" / "Manager Dashboard" / "Intelligence
Centre" to reinforce which domain you're in. Verified with a real
jsdom test against the actual `index.html` markup and `ui.js` logic —
domain classification, brand-label swap, and the presence of the
CSS hiding/retheme rules.

---

## 3. The generalized Ledger (replaces Jazz Cash + Expense/Petty/Other Sections as separate builds)

**Important correction:** the user's actual day-to-day "Patty"
tracking is the **Expense tab** (`_expRows_cur` in `manager.js` — Bill
Amt / Fuel-HO / Soap-Tissue / Refreshment / Extra / Patty H/O), not the
tab literally called "Petty" in the code (simple grouped rows, single
amount, no running balance). Different feature. The Ledger now targets
Expense as the real priority; the old "Petty" tab's migration path
still exists in `ledger-migration.js` but is no longer the main focus.

**A real, separate bug was found while investigating:** the Expense
tab (and Salary/Generic/Credit/old-Petty, which share the same pattern)
only persist on an explicit "Save" click — any background rebuild in
the meantime silently discards unsaved edits or new rows. Confirmed as
the cause of reported data loss. **Not being fixed in the old system**
— the user has this data backed up externally and would rather the
effort go toward finishing the replacement. The new Ledger avoids this
bug class entirely by design: every write persists immediately, there's
no separate unsaved-in-memory state for a background event to wipe.

**Status: LIVE.** `ledger-store.js` (Floor 1/2), `ledger-actions.js`
(Floor 3), `ledger-migration.js`, and `ledger-page.js` (Floor 4/5) are
real ES modules, wired into Manager's Expense and Custom Sections tabs
via `switchMgrTab`. The old implementations of both are **fully
removed** — `renderExpenseTable`/`loadExpenseMonth`/`expRowChange`/
`saveExpenseData`/`printExpenseReport` and `custom-sections.js`'s
`_csecLoad`/`loadCustomSections`/`saveAllCustomSections`/
`promptAddCustomSection`/`deleteCustomSection`/`renderAllCustomSections`/
`csecAddRow`/`csecDelRow` no longer exist in the codebase, not just
deprecated. Built out:
- A built-in `expense` ledger type with the real six categories
  currently in use.
- A **persisted** custom-ledger-type registry (`createCustomLedgerType`,
  `deleteCustomLedgerType`, `getAllLedgerTypes`) for "Other Sections" —
  confirmed there are 3-6 of these, each needing its own custom
  categories, not a generic amount+description. Definitions survive a
  reload.
- `ledger-page.js`: generalized rendering for any ledger type (add
  entry form, running-balance table, delete) plus a full Other Sections
  manager (list existing sections, create new ones with a
  category-builder UI, drill into any section's ledger view).

Verified with real Node execution (balance math, custom-type creation/
duplicate-rejection/delete-guard, persistence across a simulated
restart) AND real jsdom end-to-end integration tests: actually calling
`switchMgrTab('expense')`/`switchMgrTab('custom')` and confirming the
real UI renders into the real DOM containers, plus the full Other
Sections create→view→back navigation flow.

**Two real bugs caught before/during this going live** (both in
`BLUEPRINT.md`'s detailed log): `drive.js`/`supabase.js` needed the
`CSEC_KEY` constant restored after the rest of Custom Sections was
removed (they back up/sync that key directly), and `ledger-page.js` had
no `<script>` tag in `index.html` at all — would have been a
completely silent failure (nothing renders, no error anywhere).

**Deliberately not touched:** the separate, simpler "Petty Detail" tab
(different feature, wasn't named for removal). *(Correction: the note
that used to be here — "`ai-bridge.js`'s AI-chat commands for the old
Expense/Custom Sections features are still `typeof`-guarded dead code,
logged as a follow-up" — is stale. That follow-up was done in a later
session: `_aiAddExpenseRow`, `_aiResolveCustomSection`, and the rest of
the Expense/Custom Sections AI-chat commands were rewired onto the
Ledger, not left dead. See `BLUEPRINT.md`'s "Inline Ledger edit +
Expense/Custom Sections AI-chat rewiring" session entry for the full
list and the real date-format bug found while doing it. This section
of the plan just wasn't updated to match at the time.)*

No migration of old Expense/Custom-Sections data was run — user
confirmed backups exist outside the app and preferred a clean start
over migrating from a system with a known data-loss bug.

### Current shapes (for reference, confirmed from the existing app)
- Jazz Cash: `{ openingBalance, entries: [{id, date, shift, type, amount, desc}] }` — continuous, running balance, never resets.
- Expense (the real "Patty"): `{date, desc, bill, fuel, soap, refresh, extra, pattyHO}` per row, month-scoped, opening balance per month, no running balance across months, unsaved edits vulnerable to the data-loss bug above.
- Old "Petty" tab (different feature, lower priority now): `{ groups: [...] }` — month-scoped, resets every month, grouped rows, no running balance.

### v2 unified model
One `LEDGER_ENTRIES` array (Floor 2 state), each entry:

```js
{
  id,
  ledgerType,     // 'jazzcash' | 'petty' | 'custom:<sectionId>'
  date,           // ISO date
  shift,          // optional, only meaningful for some ledger types
  category,       // free-form or from a per-ledgerType category list
  amount,         // signed: +inflow, -outflow
  desc,
  groupLabel,     // optional — preserves Petty's "grouped rows" display
  createdAt, updatedAt, _source
}
```

One `Ledger` component (Floor 4) renders any `ledgerType`: running
balance, filtering, grouping-by-`groupLabel` when present, add/edit/
delete — all through `Actions.addLedgerEntry/updateLedgerEntry/
removeLedgerEntry`, one Repository method set, one set of Print
templates. Adding a brand new ledger ("Other Sections") is a config
entry (label + category list), not new code — this is what makes
"add features without breaking existing code" actually true this time.

**Migration mapping:** Jazz Cash's `entries[]` → `LEDGER_ENTRIES` with
`ledgerType:'jazzcash'`, `openingBalance` becomes a per-ledgerType
config value, not per-entry. Petty's `groups[].rows[]` → flattened into
`LEDGER_ENTRIES` with `ledgerType:'petty'` and `groupLabel` set from the
group name — **this changes Petty from month-scoped to continuous**,
matching what you asked for, and is the one migration step that needs
your sign-off since it changes Petty's actual behavior, not just its
storage shape.

---

## 4. Staff Registry

Existing fields/CRUD stay as-is. Each staff card gains a **3rd tab**:
- Tab 1: Details (existing)
- Tab 2: Credit (existing)
- Tab 3: **Notes** — simple timestamped notes log per staff member,
  Supabase-backed, no messaging/external API. Purely a personal record
  ("met about attendance on 3 July", etc.), not staff-facing.

**Status: LIVE.** `staff-notes.js` (Floor 1/2/3/5) is a real ES module —
notes keyed by `emp.id` (stable since creation, falls back to
`staffId`/name for older records), stored under `bt_staff_notes_v1`,
persisted through a new `Actions.saveStaffNotes` verb. Wired into the
staff card's 3rd tab (`sc-panel-notes`) via `switchStaffCardTab`, add/
delete both re-render immediately. Included in the Supabase push/pull
payload (`staffNotes` key) with the same id-based merge convention as
the Notes & Sheets `notes` key — remote wins on pull, local wins on
push (gap-fill only). Verified with a real jsdom test against the
actual staff-card markup: add → render → per-staff isolation →
persistence → delete.

---

## 5. Sheets & Notes — elevated to its own peer dashboard

This is where the most feature growth is expected, so it's no longer a
Manager sub-feature — it gets its own tile on the Cover Dashboard and
its own page, same standing as Sales/Manager.

Core model: expand from one flat sheet to a real multi-sheet workbook
per file — same mental model as an actual spreadsheet, one file, many
named sheets, switchable via tabs. Exact feature scope beyond that is
intentionally left open — this is the domain expected to grow the most
over the "100x" timeframe, so the architecture goal here is specifically
to make adding new sheet types/views cheap later, not to lock in a
final feature list now.

**Status: structural elevation LIVE, multi-sheet workbook model LIVE.**
Notes & Sheets is a genuine peer dashboard: own top/bottom nav tab, own
page (`#page-notesheets`), own domain in the Sales/Manager
domain-isolation system (§2/§1) — while inside it, the Sales and
Manager tabs are hidden, and it gets its own accent color (green) that
cascades through every button/tab already written against
`var(--accent)`. The Cover Dashboard tile now links straight to it with
real stats (note/sheet-file counts) instead of the old "inside Manager
for now" placeholder.

The 2600+/500+ lines of `notes-sheets.js`/`sheets-patch.js` were left
completely untouched for the *elevation* step — both hardcode the
`#mgr-sheets` container id throughout, so the container was *relocated*
into the new page rather than renamed, reusing all of that proven logic
with zero risk. Every call site that used to route through
`showPage('manager')` + `switchMgrTab('sheets')` (CommandHub's quick
actions, all 4 of ai-bridge's AI-chat intents, the AI's own page/tab
keyword router) was updated to route straight to
`showPage('notesheets')` instead — grepped clean of any remaining
`switchMgrTab('sheets')` references. Verified with a real jsdom test
against the actual `index.html`/`ui.js`: the container's new DOM
parent, the old Manager tab button's removal, the domain
classification, brand-label swap, and `renderNotesSheets()` actually
firing through the `showPage()` dispatch.

**The multi-sheet workbook model itself was a separate, later session.**
Turned out the multi-sheet-*tab* mechanism already existed and worked —
`_nsSpAddSheet`/`_nsSpSwitchSheet`/`_nsSpRenameSheet`/`_nsSpDeleteSheet`,
a real tab bar, right-click menu. The actual gap was one level up:
there was only ONE such workbook globally (`bt_sheets_v2`, shared by
the whole app), and what was called "Sheet Files" (`bt_sheet_files_v1`)
was a different, older feature — named snapshots that each captured
one sheet's cells at a point in time, and loading one *destructively
overwrote* whatever was on screen. User's call on reconciling the two:
**convert each existing Sheet File into its own workbook** (one file =
one sheet to start, more tabs addable afterward), rather than keeping
snapshots as a separate concept.

New `bt_sheet_workbooks_v1` key holds `{ activeFileId, files }` — each
file is an independent workbook with its own `grids` dict, using the
exact same grid shape and exact same sheet-tab CRUD functions above,
completely unchanged. Only the storage underneath `_nsGetSheets()`/
`_nsSheetsSave()` changed — same signature, now resolves to the active
file's grids instead of one global set, so none of the ~15 existing
call sites needed touching. One-time, lossless migration: the old
global workbook becomes "My Workbook" (keeping every existing tab
exactly as it was), each old Sheet File snapshot becomes its own
one-sheet file. Old keys (`bt_sheets_v2`, `bt_sheet_files_v1`) are read
once for migration and never written again — an untouched safety net,
nothing deleted. Verified with an 18-scenario Node test against
realistic legacy data (multi-tab workbook + snapshots, migration
correctness, idempotency, file-isolation on edit, brand-new-install
bootstrap) — see `BLUEPRINT.md`'s "Multi-file workbook model" session
entry for the full list and everything else that had to be found and
fixed along the way (two AI-chat functions and the Cover Dashboard tile
were reading the legacy key directly and would have silently gone
stale after migration).

---

## 6. Inventory Audit & Cash Closing (Dropbox-fed)

Both apps already exist independently and keep running independently —
this is a **read + re-analyze** integration, not a merge, not a data
migration of those apps themselves.

**Status: Cash Closing LIVE, both layers.** Analyzed the real
`Closing-main` codebase (own 5-floor ES-module architecture, same
philosophy as this app) and confirmed it's genuinely safe to integrate
two ways at once, with zero shared code:

- **Shell embed** — a new `closing` peer dashboard (own nav tab, own
  domain in the isolation system, own teal accent matching the
  standalone app's real theme-color) iframes the *live*
  `closing.duapharma.com` directly. Nothing of Closing's code or data
  lives in this repo — different subdomain means the browser gives it
  a completely separate storage bucket automatically, no key collision
  possible even in principle. The iframe is lazy-loaded (only fetches
  on first visit, not on every app boot) with an "↗ New Tab" escape
  hatch, since Dropbox's own login page can't be framed — needed only
  if the Dropbox connection ever has to be re-authenticated from here.
- **Read-only Dropbox data bridge** (`closing-bridge.js`) — reads the
  same `pharmpos_sync_data.json` blob Closing already pushes to
  Dropbox after every save, using the same "Export Connection" token
  Closing's own Settings page generates for moving devices (no new
  Dropbox app registration needed). Surfaces today's Night/Morning/
  Evening status (pending/draft/closed) plus each closed shift's
  already-computed `outNetSale`/`finalNetSale` on the Cover Dashboard
  tile. Deliberately reads only already-computed fields off the
  record — never recomputes Closing's own variance/target-pace math,
  so this app can never quietly drift out of sync with how Closing
  actually calculates something. Rate-limited to one Dropbox fetch per
  5 minutes; the access-token exchange and file download were both
  verified against a mocked Dropbox API (correct refresh-token grant,
  correct bearer/path headers, correct shift-status derivation,
  rate-limiting, forced-refresh, and disconnect-clears-cache).

Inventory Audit is unstarted — still waiting on a real data sample the
same way Cash Closing was, per the note below.

### Cash Closing — confirmed real schema (from `pharmapos_backup_2026-07-04.json`)

This is a **shift-based** reconciliation app (Morning/Evening/Night —
not day-based like Sales), which changes the state-array design:
Cash Closing needs its own `SHIFT_CLOSINGS` array keyed by
`{date}_{shift}`, not reused DAILY/MONTHLY shape.

**Top level:**
- `settings` — app config: `namedCredits[]` (label templates),
  `subTiers[]` (staff grouped by shift, e.g. "Morning Staff": [names]),
  `strips[]` (quick-sale item catalog: name/price/group — water,
  juice, Nescafé etc.), `stripGroups[]`, `finalEveryN` (a full
  reconciliation checkpoint every N shifts), `managerPinHash`.
- `sheets` — dict of `{date}_{shift}` → one shift's closing record
  (~49 fields): cash inputs (`inSysCash`, `inCompSale`, `inAlfalah`,
  `inKeenu`, `inBook1/2`...), POS returns, derived outputs
  (`outNetSale`, `outTotalCash`, `outNetCash`, `outCust`...), and —
  only meaningful when `profileMode:'final'` — a full reconciliation
  block (`finalNetSale`, `finalDiff`, `finalDiffLabel:'Plus'|'Less'`,
  matching the same over/short concept as the current app's DIFF).
  Sub-arrays per shift: `hsRows` (doctor/staff consultation fees —
  "Dr Hamza", "Dr Zeeshan" etc.), `stripQtys`/`stripPrices` (parallel
  to `settings.strips`), `tillValues`/`vaultValues` (8-value cash
  denomination breakdowns), `namedCredits`/`tierCredits`/`auxCredits`
  (named and staff-tiered credit allocations), `deposits`, `miscRows`
  (ad-hoc items with a `status` field), `draft`/`locked` flags.
- `auditLog` — change history (`{ts, action, target, result}`).
- `creditLedger` — **this is the interesting one**: array of
  `{key, date, shift, mode, savedAt, openingCredit, creditAdj,
  totalCredit, lines:[{category:'named'|'tier', lbl, val}]}` — a
  running-balance credit ledger, derived from each shift's named+tier
  credits. **Structurally this is close enough to the unified Ledger
  model in §3 that it's worth designing the Ledger component to serve
  three consumers (Jazz Cash, Petty/Expenses, and this credit ledger)
  instead of two** — same `openingBalance → entries → runningBalance`
  shape, just add a `category` field to the entry (which the Ledger
  model in §3 already has).

**Still open:** which of this needs the "re-chart/analyze" treatment —
likely the shift-level financials (`outNetSale`/`outTotalCash`/`outCust`
over time, same shape as Sales' daily trend) and the credit ledger, but
the strips/quick-sale data and denomination breakdowns may just need
display, not analytics. Worth confirming before designing the
Analytics module for this domain.

### Inventory Audit — still needed
No sample yet. Once available, same treatment as above: confirmed
schema → state design → note any Ledger-reuse opportunity.

### Integration mechanics (unchanged from before)
- Confirmed: JSON exports, **separate schemas** from each other (now
  proven true — Cash Closing's shape above is nothing like a generic
  ledger export).
- Integration pattern: same shape as the current app's Google Drive
  backup (`drive.js`) — OAuth, list files, fetch content — just a second
  provider (Dropbox API v2) and a pull instead of a push.
- Cash Closing becomes its own Floor 2 state (`SHIFT_CLOSINGS`) + Floor 1
  Repository methods + Floor 3 Actions + its own Analytics module,
  mirroring how `DAILY`/`MONTHLY`/`Analytics` work for Sales today —
  except shift-keyed, not day-keyed.

---

## 7. Print — one module ✅ Done (engine consolidation; see below for exact scope)

Original plan: `Print.render(reportType, data, opts)` — one Floor-4
component, every report type is a template *registered* with it,
rather than a copy-pasted `btPrint()`-style function per feature.

**What actually shipped, and how it differs from that description:**
`print.js` is real and is the one place `window.print()`,
`document.write()`, and `#print-area` are touched — `Print.render(html,
opts)` (in-page) and `Print.renderNewTab(html, opts)` (new-tab). That
consolidates the part that was genuinely duplicated and risky: four
places independently reimplemented the print *trigger*, with two of
them missing the race-condition fix the other two already had (see
`BLUEPRINT.md`'s "Print consolidation" session entry for the full
list). What it does *not* do is a template registry keyed by
`reportType` — each report's HTML-building logic stays where it lives
today (`manager.js`, `reports.js`, `reports-print.js`, `hub-actions.js`,
etc.), now just calling `Print.render`/`Print.renderNewTab` instead of
reimplementing the trigger. A true template registry would mean
relocating ~15 report-builder functions and their DOM-read/validation
glue into one file — a larger, purely organizational move with no
correctness payoff, since the actual duplication (and the actual bugs)
lived in the trigger mechanism, not in having many report builders.

---

## 8. Architecture (Floors 1–5, applied to every new domain)

Same 5 floors, same Golden Rules, applied fresh to each new domain as
it's built, inside the current app:

- **Floor 1/2 (Repository/State):** real ES module, `export`, following
  the pattern already proven this migration (`config.js`/`repository.js`)
  — no Proxy hack needed for brand-new domains, since there's no legacy
  code bypassing it to guard against; the Proxy stays where it already
  is, protecting `MONTHLY`/`DAILY`/`STAFF`.
- **Floor 3 (Actions/EventBus):** real modules, real imports — same
  pattern as the already-converted `actions.js`/`event-bus.js`.
- **Floor 4 (Components):** `Ledger`, `Print`, `StaffCard`, chart
  components — genuinely reusable, imported wherever needed, shared
  across domains instead of rebuilt per-domain.
- **Floor 5 (Pages):** only ever call Actions, never each other directly
  — the one rule that prevents a repeat of the `ui.js`↔`manager.js`
  circular mess. Every new page (Notes & Sheets, Closing, Inventory)
  follows this from its first line of code.

---

## 9. Data migration

Only applies to genuine format/behavior changes, not the app itself
(there's no old-app/new-app split to migrate between):

- Jazz Cash → Ledger: mechanical, low risk (see §3).
- Petty → Ledger: mechanical but **changes behavior** (month-scoped →
  continuous) — needs your explicit sign-off before running.
- Inventory Audit / Cash Closing: blocked on real JSON sample for
  Inventory Audit, and on deciding what's chart-worthy vs. display-only
  for Cash Closing (§6).
- Sales data itself: **no migration at all** — it stays exactly as-is,
  this was only ever a rewrite concern.

---

## 10. Delivery order (proposed — not started)

Each phase is real feature work inside the current app, not a separate
build:

1. Generalized Ledger — rewrite `jazz-cash.js` + `manager.js`'s Petty
   handling as the new shared Ledger component; this modernizes both
   files as a side effect of the feature work itself
2. Staff Notes tab (3rd tab on staff cards)
3. Notes & Sheets elevated to its own peer dashboard + multi-sheet model
4. Dropbox integration + Cash Closing domain (Inventory Audit once its
   sample is available)
5. Cover Dashboard (once there are enough peer dashboards to make a
   "concise summary + tiles" landing page actually worth building)

Ongoing, throughout: as each phase touches an old file, that file gets
properly modularized (real `export`, no window-bridge) rather than
staying in its current Stage-A-namespaced form — this is how the
remaining large files (`ui.js`, `manager.js`, etc.) eventually get
fully modernized, paid for by feature work instead of a separate pass.

---

## 11. Open questions (blocking full scope-out)

1. ~~Real JSON sample from Cash Closing app~~ — **received and analyzed, see §6.**
2. **Real JSON sample from Inventory Audit app** — still needed.
3. Which parts of Cash Closing need real analytics vs. just display (see §6 "still open")?
4. New Supabase tables in the existing project, or a separate one for the new domains?
5. Any rough sense of which phase (§10) to start with first?
6. Notes & Sheets exact feature scope — intentionally left open (§5) until closer to that phase, given it's expected to grow the most.
