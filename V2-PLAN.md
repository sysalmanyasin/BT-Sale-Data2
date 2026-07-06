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

---

## 3. The generalized Ledger (replaces Jazz Cash + Petty as separate builds)

**Status: core module built and tested, dormant.** `ledger-store.js`
(Floor 1/2), `ledger-actions.js` (Floor 3), and `ledger-migration.js`
exist as real ES modules, loaded by `index.html`/cached by `sw.js`, but
nothing in the UI calls into them yet — no Page or Action references
them. Verified with real Node execution (add/balance math, opening
balance, ledger-type isolation, invalid-category rejection,
update/remove, persistence across a simulated restart) and both
migration functions tested against realistic sample data matching the
actual `jazz-cash.js`/`manager.js` storage shapes. One real bug was
found and fixed during this testing (`getCategory()`'s fallback
silently accepted invalid category ids instead of rejecting them).

**Still needed before this goes live:** the actual Ledger UI component
(Floor 4) that Jazz Cash and Petty's tabs would be rebuilt to use, and
running the migrations for real (currently only tested against
synthetic sample data, not your actual stored data) — with your
explicit go-ahead first, especially for Petty, since that migration is
a genuine behavior change (month-scoped → continuous), not just a
reshape.

### Current shapes (for reference, confirmed from the existing app)
- Jazz Cash: `{ openingBalance, entries: [{id, date, shift, type, amount, desc}] }` — continuous, running balance, never resets.
- Petty: `{ groups: [...] }` — **month-scoped**, resets every month, grouped rows, no running balance.

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

---

## 6. Inventory Audit & Cash Closing (Dropbox-fed)

Both apps already exist independently and keep running independently —
this is a **read + re-analyze** integration, not a merge, not a data
migration of those apps themselves.

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

## 7. Print — one module

`Print.render(reportType, data, opts)` — one Floor-4 component, every
report type (daily, monthly, yearly, ledger statement, cash closing,
inventory audit) is a template registered with it, not a copy-pasted
`btPrint()`-style function per feature like today.

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
