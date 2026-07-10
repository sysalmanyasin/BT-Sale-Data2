# HANDOFF — BT Sales App Restructuring & Rebuild

*Read this first in any new session. It's the map to the other three
documents and the current real state of the app.*

---

## 1. What this app is

A personal, single-user PWA for running a pharmacy branch (Bahria Town
Sales IC) — sales data entry, dashboards, manager/staff tools, ledgers,
AI assistant. Built solo, in continuous use for 76+ months of real
sales data. Deployed at `bt.duapharma.com`, backed by Supabase, with
Google Drive backup and a service worker for offline/PWA use.

**This is a live production tool the user runs their business on.**
Every change in this project has been held to that standard: verify
before shipping, don't guess, prefer real tests (Node execution, jsdom)
over "looks right."

## 2. The four documents, and what each one is for

- **This file (`HANDOFF.md`)** — orientation. Read this first.
- **`BLUEPRINT.md`** — the detailed engineering log. Every fix, every
  file conversion, every bug found and how, every lesson learned,
  written as it happened. This is where you look for "why was this
  file left bare" or "what exactly did the notify-loop bug do." Has a
  KPI table and two subjective progress scores at the top, updated
  each session.
- **`V2-PLAN.md`** — the forward-looking plan: Cover Dashboard, Sales/
  Manager/Notes&Sheets as peer dashboards, the Ledger, Dropbox-fed
  Inventory Audit/Cash Closing. This is where you look for "what's the
  plan for X" or "what's the Ledger's data model and why."
  **Decision already made and recorded here: evolve this app in place,
  not a parallel rewrite** (§0) — new features get built as real ES
  modules inside the current app; old files get modernized as real
  feature work touches them, not as a separate cleanup pass.
- **`TEST-CHECKLIST.md`** — the actual test pass, organized by page/
  feature, with what's confirmed working and what's new/pending.

## 3. Current real state (as of this handoff)

**Architecture:**
- Floor 1–3 (`config.js`, `event-bus.js`, `repository.js`, `actions.js`)
  — fully real ES modules, no legacy compromise.
- Floor 4–5 — 32 of 41 files properly namespaced (globals hidden,
  monkey-patches traced and handled correctly). Remaining 9 bare files
  are ALL deliberate deferrals with stated reasons (see §12 of
  `BLUEPRINT.md`) — nothing was skipped by accident.
- The Ledger (`ledger-store.js`, `ledger-actions.js`,
  `ledger-migration.js`, `ledger-page.js`) — real ES modules, **LIVE**,
  wired into Manager's "Patty/Expenses" and "New Sections" tabs, and now
  Jazz Cash's Daily Ledger sub-tab too (see below).

**What's LIVE (real, in-use, not dormant):**
- Ledger-based Expense tracking (replaces the old rich-columns Expense
  tab that had the data-loss bug)
- Ledger-based "Other Sections" (replaces old month-scoped Custom
  Sections — new sections can be created from the UI with custom
  categories, and are continuous/not month-bound)
- Ledger-based Jazz Cash Daily Ledger (`ledgerType: 'jazzcash'`) — real
  historical data exists here (unlike Expense/Custom Sections, which had
  none), so this did NOT auto-migrate. `jazz-cash.js`'s `_renderLedger()`
  shows a one-time banner + confirm-gated button when old
  `bt_jazzcash_v2` data is detected and hasn't been moved over yet;
  `migrateJazzCashToLedger()` runs once the user clicks it. **Not yet
  confirmed against the real production data — verify the migrated
  balance matches the old ledger's balance before trusting it fully.**
- `ai-bridge.js`'s Jazz Cash chat commands (`addJazzCashEntry`,
  `editJazzCashEntry`, `deleteJazzCashEntry`) — rewired to
  `LedgerActions` this session; the params contract (`amount`/`type`/
  `desc`/`shift`) is unchanged so the Groq system prompt didn't need
  updating, only the executor bodies.

**What's RETIRED (genuinely deleted, not just deprecated):**
- Old Expense tab: `renderExpenseTable`, `loadExpenseMonth`,
  `expRowChange`, `addExpenseRow`, `saveExpenseData`,
  `printExpenseReport` — all gone from `manager.js`
- Old Custom Sections: `_csecLoad`, `loadCustomSections`,
  `saveAllCustomSections`, `promptAddCustomSection`,
  `deleteCustomSection`, `renderAllCustomSections`, `csecAddRow`,
  `csecDelRow`, `csecLiveTotal` — all gone from `custom-sections.js`
  (which now only contains 2 unrelated helper functions,
  `salaryNextMonth`/`pettyNextMonth`, kept because they don't belong to
  the retired feature)
- Old Jazz Cash Daily Ledger: `jcLoad`, `jcSave`, `_jcType`,
  `_jcRunningBalances`, `_jcFilteredEntries`, `_jcMonthOf`, `JC_TYPES`,
  `_jcBuildLedgerTable`, `jcAddEntry`, `jcDeleteEntry`, `jcEditEntry`,
  `jcSetOpening`, `jcClearAll`, `jcToggleForm`, `jcTypeChange`,
  `jcAiCommand` (the in-panel free-text Groq add box) — all gone from
  `jazz-cash.js`, which now only contains Balance Tally (a genuinely
  different feature — wallet reconciliation/snapshots, not a
  transaction ledger, so it has no Ledger equivalent) plus a thin
  `_renderLedger()` wrapper around `renderLedgerView`. `JC_KEY`
  (`bt_jazzcash_v2`) is kept as a frozen, no-longer-written-to constant
  so drive.js/supabase.js can keep backing up the old blob and the
  migration button can still read it — same pattern as `CSEC_KEY`.

**What's UNTOUCHED (deliberately, not overlooked):**
- The separate, simpler "Petty Detail" tab (`data-mtab="petty"`) —
  different feature, was never named for removal
- `ai-bridge.js`'s AI-chat commands for the old Expense/Custom Sections
  features — still `typeof`-guarded so they fail silently rather than
  crash, but currently do nothing if invoked via chat. **Known gap, not
  fixed** (Jazz Cash's chat commands *were* rewired this session — see
  above — but Expense/Custom Sections' were not; same fix, just not
  done yet).
- `supabase.js`/`sync-center.js` — deliberately not namespaced, real
  multi-device sync mechanism, judged too risky to touch without real
  device testing (see `BLUEPRINT.md` for the full reasoning). This
  session added new payload keys (`ledger`/`ledgerCustomTypes`) using
  the exact same merge convention already proven for `jazzcash`/
  `jcTally`, additive-only — the core sync engine itself wasn't touched.

**Two real bugs found and fixed this session (not pre-existing on
purpose — worth knowing about even though they're already fixed):**
- `migrateJazzCashToLedger()` was hardcoding `shift: null` instead of
  copying `e.shift` from the source entry — would have silently dropped
  every entry's Morning/Evening/Night/Both/Off shift on migration. Found
  via jsdom smoke test before this was ever run on real data.
- The generalized Ledger (`bt_ledger_v1` / `bt_ledger_custom_types_v1`)
  was **entirely missing** from `drive.js`'s Drive backup and
  `supabase.js`'s multi-device sync payloads — meaning live Expense/
  Other-Sections financial data (already LIVE since the prior session)
  had zero backup/sync coverage. Fixed additively in both files, same
  merge convention as the existing `jazzcash`/`jcTally` blocks.

**Known open bugs:**
- **Print still produces a blank page on Android** (confirmed via
  screenshots — even "Save as PDF" is blank on mobile). Two defensive
  fixes applied (`print-color-adjust`, CSS Grid→flex fallback), neither
  verified against the real failure. **The single most useful next
  diagnostic: test the same print action on desktop Chrome.** If it
  works there, the issue is Android-print-pipeline-specific and we keep
  iterating on Android-safe CSS. If it's also blank on desktop, the
  diagnosis so far has been wrong and needs to restart from scratch.
  This is genuinely still open — don't assume either fix resolved it
  without the user confirming.
- **Jazz Cash migration hasn't run against real production data yet** —
  logic is smoke-tested (jsdom, sample data) but not verified against
  the user's actual `bt_jazzcash_v2` blob. Before trusting it: click
  Migrate, then compare the new Ledger balance to whatever the old
  balance was (screenshot it first if possible).

## 4. The methodology that's been established — use it, don't skip it

This isn't optional process for its own sake — several real bugs were
only caught because of this discipline, and several near-misses were
caught the same way:

**Before wrapping/touching any file's globals:**
1. Check every declaration for external use: cross-file references,
   `index.html` references, references in generated HTML (`onclick=`,
   `onchange=`, etc. — check the *broad* set of event attributes, not
   just `onclick`, and check within the *same file* too, not just
   across files)
2. Check for reassignment in **both** forms:
   `identifierName = ...` (bare) AND `window.identifierName = ...`
   (the second form was missed early on and cost real near-misses —
   `ui-extras.js` patches `window.showPage` directly, not via bare
   assignment)
3. Check for `async function` declarations specifically — an early
   version of the dependency-scanning regex missed these entirely
4. If something is reassigned/monkey-patched, trace what it calls
   internally — anything it calls that would otherwise be hidden needs
   to travel with it (stay bare / not get wrapped), or the patch will
   silently only affect a stale copy

**Before shipping anything:**
1. `node -c` / `node --check` for syntax (modules need `--check`, not
   `-c`, or copy to a `.mjs` file first)
2. Actually run the code — Node with a minimal shim for simple logic,
   **jsdom for anything touching the DOM**. Syntax checks alone missed
   real bugs multiple times this session.
3. When testing code that spans a classic script (like `manager.js`,
   run via indirect `eval`) and a real ES module (like `ledger-page.js`,
   run via `import`) together: make sure `window` and `globalThis` are
   made genuinely identical in the test harness, not just cross-
   referenced — this exact mismatch produced a false test failure once.
4. Programmatic verification over eyeballing: write a script that
   checks every expected bridge is actually present, and every intended
   private name has zero references anywhere else in the codebase —
   don't just read the diff and assume it's right.

**A recurring bug class worth knowing about:** background events
(sync pulls, any `EventBus` notify) can trigger a full re-render that
silently wipes out either (a) unsaved in-memory state that was never
persisted, or (b) UI state (expanded/collapsed) that a fresh render
resets to defaults. Both have bitten this app for real. The fix for
(a) is: don't have an "unsaved in-memory, explicit Save button"
pattern at all — write immediately (this is why the Ledger doesn't
have this bug). The fix for (b) is either preserving state across
rebuilds explicitly, or event delegation on a stable ancestor instead
of per-element handlers that don't survive a DOM replacement.

## 5. Sensible next steps, roughly in order of value

1. **Get the print bug resolved** — it's the one confirmed-open bug
   affecting daily use. Needs the desktop-vs-mobile diagnostic first.
2. **Verify the Jazz Cash migration against real data** — click the
   Migrate button in the Daily Ledger tab (with real production data
   present), then compare the resulting balance to the old ledger's
   balance before trusting it. Logic is smoke-tested against sample
   data only, not the user's real `bt_jazzcash_v2` blob.
3. **Wire `ai-bridge.js`'s Expense/Custom Sections AI-chat commands to
   the Ledger** — same fix Jazz Cash's chat commands just got this
   session (route through `LedgerActions` instead of the retired
   per-feature functions), just not done for these two yet.
4. **`ui.js`/`manager.js` full ES-module conversion** — currently
   Stage-A namespaced (globals hidden) but not real `import`/`export`
   modules, because of circular dependencies between them. Revisit only
   if a real need arises; not blocking anything today.
5. Whenever it's convenient: get the Inventory Audit JSON sample
   (Cash Closing's was already analyzed, see `V2-PLAN.md` §6) so that
   domain can be scoped the same way.
6. Continue the Stage-A namespacing sweep on whatever's left, letting
   real feature work modernize files as a side effect rather than
   pre-namespacing speculatively (established pattern, `V2-PLAN.md` §1)
   — this is how `jazz-cash.js` got modernized this session, as a side
   effect of the Ledger migration rather than a standalone pass.

## 6. One thing to hold onto across sessions

The user has been clear, more than once: **structural correctness
first, features can wait, but "it'll resolve itself" is not an
acceptable answer for an actual bug.** When something looks broken,
find the real root cause — even if the fix turns out to be a full
redesign (like the Ledger) rather than a patch. Don't fold a real bug
into "this will get fixed when we modularize" unless it genuinely will,
and say so explicitly when it won't.
