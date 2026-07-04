# BT-Sale-Data2 — The Perfect Blueprint

## 5 Layers, One Door

```
┌─────────────────────────────────────────────┐
│  FLOOR 5 — PAGES                            │
│  Reads State → Renders UI → Calls Actions   │
├─────────────────────────────────────────────┤
│  FLOOR 4 — COMPONENTS                       │
│  Pure UI, reusable, no business logic       │
├─────────────────────────────────────────────┤
│  FLOOR 3 — ACTIONS + EVENT BUS              │
│  The only door to change data and notify UI │
├─────────────────────────────────────────────┤
│  FLOOR 2 — STATE STORE                      │
│  One protected AppState, one source of truth│
├─────────────────────────────────────────────┤
│  FLOOR 1 — REPOSITORY + DATA LAYER          │
│  Reads/Writes IndexedDB, LocalStorage, Cloud│
└─────────────────────────────────────────────┘
```

### Golden Rules
- Pages never touch the database.
- Components never contain business logic.
- Business modules never know about the UI.
- State is never modified directly.
- Every data change goes through Actions.
- Every storage operation goes through the Repository.
- Every update is announced through the Event Bus.
- Flow: User → Action → Repository → Data → State → Event Bus → Pages → Components.
- Add or remove features without breaking existing code.
- One Brain. One Door. One Truth.

### Module-migration addendum (added during the cleanup pass)
The 5 layers above describe *data flow*. A separate, orthogonal goal is
**zero global namespace pollution** — every file's functions/vars live
behind a named export, not bare on `window`. This is being done in two
safe stages, file by file:
- **Stage A** — encapsulate into a namespaced object (only needed for
  files not already reachable via dot-notation).
- **Stage B** — convert to a real ES module (`type="module"`,
  `export`/`import`), with a temporary `window` bridge removed once all
  consumers of that file have themselves migrated to `import`.

---

## 📊 KPI Scorecard

*Last updated: this session, device-confirmed clean console (only the
known `ai-memory.js` placeholder issue remains).*

| Metric | Before | After | Change |
|---|---|---|---|
| Dead functions removed | — | **18** | 18 confirmed-unused functions deleted (auth.js, ui.js, supabase.js, manager.js, dashboard.js, dashboard-insights.js, ai-bridge.js, commandhub-page.js) |
| Dead files removed | 46 files | 45 files | `data-base.js` deleted (defined `MONTHLY_BASE`/`DAILY_BASE`, referenced nowhere) |
| Global naming collisions | 1 | **0** | `chpOpenScan` was defined twice (intentional override, but left dead code + a stale comment behind — cleaned up) |
| Total `.js` lines | 22,617 | 22,571 | net **−46** (274 lines removed, 230 added — some removals were bug-fix rewrites, not pure deletion) |
| Architecture violations fixed | 5 categories | | See list below |
| Files converted to real ES modules | 0 of 46 | **4 of 46** | `config.js`, `event-bus.js`, `repository.js`, `actions.js` — entire Floor 1–3 now real modules, no more window-bridge workarounds between them |
| Files namespaced (Stage A, still classic scripts) | 0 of 41 | **26 of 41** | + `ai-instructions-ui.js`, `auth.js` this round |
| Global symbols behind a module export | 0 of ~850 | **38 of ~850** | + `EventBus` |
| Files still 100% bare-global classic scripts | 46 | **15** | |
| Real bugs found via device testing | — | **1** (8 call sites) | `readyState==='loading'` anti-pattern broken by `defer`, fixed in all 8 files |

### Architecture violations fixed this pass
1. **Invisible Page-layer state bypass** — `data-page.js: saveEditModal()` mutated the live `DAILY` record directly instead of going through Actions. Fixed via `Actions.editDailyEntry()` + a new single-source-of-truth `computeDailyTotals()` in `config.js`.
2. **`Repository.setItem`/`removeItem` bypassing Actions** — 65 call sites across 15 files now routed through `Actions.saveFeatureData`/`clearFeatureData`.
3. **Missing EventBus notification** — `recomputeMonthly()` only notified subscribers when creating a new month, not when updating an existing one (the common case). Fixed.
4. **Staff CRUD raw-mutation bypass** — `Actions.addEmployee/updateEmployee/removeEmployee` mutated the protected `STAFF` array outside the write-guard. Fixed with new guarded `Repository.addStaffMember/updateStaffMember/removeStaffMember`.
5. **Duplicated business logic** — daily-record TOTAL/DIFF calculation existed in 3 separate places (`updateTotalPreview`, `editCalcTotal`, `saveEditModal`) with copy-pasted key lists. Now one shared `DAILY_ADD_KEYS`/`DAILY_SUB_KEYS`/`computeDailyTotals()` in `config.js`.

### Known open item
- `js/ai-memory.js` is corrupted in the source (contains only placeholder text, no real code). Left untouched per instruction — not part of these KPIs.

### Lesson learned this pass (now part of the migration process)
When converting a file to `type="module"`, it loses access to *any*
other classic script's top-level `let`/`const`/`class` globals (e.g.
`EventBus`) — those never attach to `window`, only `var` and plain
`function` declarations do. Each conversion now includes an explicit
check: trace every bare identifier the file references back to its
declaring file, and if that file uses `let`/`const`/`class`, add a
one-line `window.X = X` bridge to it (no risk — it stays a classic
script, this is purely additive). Verified this pass with an actual
Node.js execution of the converted files (with a minimal
`window`/`localStorage` shim) rather than syntax-checking alone, which
is what caught the `EventBus` gap before it could reach production.

### 🐛🐛 Second round of device-testing bugs (this was the big one)

**1. The dashboard-reload / dropdown-closing / month-collapsing bug —
a regression I introduced two sessions ago.** Root cause: my earlier
fix made `recomputeMonthly()` notify EventBus on *every* call, including
when nothing actually changed. `manager.js` subscribes to
`monthly:updated` and calls `rebuildAll()` (debounced 300ms) — which
calls `recomputeAllMonths()` — which calls `recomputeMonthly()` for
every month — which (with my old fix) always notified again — which
triggered `rebuildAll()` again. A perpetual ~300ms re-render loop,
which looked exactly like what you saw: cards constantly reloading, any
open `<select>` or expanded row getting wiped out from under you.
**Fix:** `recomputeMonthly()` now computes into a temporary candidate
object, compares it against the existing record, and only calls
`Repository.upsertMonthly()` (which notifies) when something actually
changed or the month is brand new. Verified with an actual notify-count
test: 2nd call with no data change → 0 notifications; a call after a
real data change → 1 notification, as it should be.

**2. `ui.js` still threw `Repository is not defined` after my first
fix.** My earlier fix only deferred *when the DOM got updated* — but
`const mode = Repository.getItem(...)` itself still ran immediately,
outside the deferred callback. Moved that line inside the callback too.

**3. Structural root cause: `auth.js`, `storage.js`, `ui.js` were
positioned in the HTML *before* `event-bus.js`/`repository.js`/
`actions.js`.** This is what made bug #2 possible at all, and made
individually auditing every file for "immediate execution" risk
fragile — proven by the fact that I missed it myself once already.
**Real fix:** reordered `index.html` so `config.js` → `event-bus.js` →
`repository.js` → `actions.js` load as a single foundation block,
before *anything* else. This removes the whole bug class at the root
instead of requiring perfect per-file auditing forever.

**4. Sign-out crash: `_autoHandle is not defined`.** Confirmed via the
original uploaded zip that this one **predates all of this session's
changes** — leftover dead code referencing a variable that was never
declared, from a since-removed auto-refresh feature. Fixed while we
were in there (deleted the dead guard line).

**5. `sw.js` still precached the deleted `data-base.js`.** Cleanup miss
from when that file was deleted earlier — removed the stale reference
and bumped `CACHE_NAME` to `v8.6` so the browser doesn't keep serving
anything cached from before this round of fixes.

**Process note:** bug #1 (the notify loop) is the one that should
reshape how I verify future changes here — it wasn't caught by syntax
checks or even by running the code, because the code was *individually*
correct; it only became a bug in combination with a subscriber
elsewhere in the app. From now on, any change to what EventBus notifies
gets a check for "what listens for this, and could that listener
trigger the same code path again" — not just "does this function work
in isolation."

Adding `defer` to all 45 classic scripts broke a pattern that existed in
**8 files** (`auth.js`, `ui.js`, `commandhub.js`, `drive.js`,
`sheets-patch.js`, `sync-center.js`, `ai-context-ui.js`, `ui-extras.js`):

```js
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fn);
} else {
  fn(); // ← this ran immediately, before Actions/Repository existed
}
```

This pattern assumed the script might still be *mid-parse* when it ran
(true for a plain classic script). Once `defer`'d, the browser
guarantees the script only runs *after* parsing finishes — so
`readyState` is never `'loading'` at that point anymore, and the `else`
branch (immediate call) always fired instead, before `actions.js`/
`repository.js` (later in the document) had executed. Console showed
`ReferenceError: Actions is not defined` / `Repository is not defined`.

**Fix:** since defer/module scripts are guaranteed by spec to complete
before `DOMContentLoaded` fires, the readyState check is no longer
needed at all — unconditionally registering the listener is now always
correct. All 8 occurrences fixed the same way.

**Process gap this exposed:** my Node.js runtime testing (with a
`window`/`localStorage` shim) verified the *modules* work correctly in
isolation, but didn't simulate the actual `defer`/parse-timing behavior
of a real browser loading `index.html` — that's exactly the class of
bug device-testing catches and my test harness can't. Real-browser
testing after each script-loading change stays mandatory, not optional.

### 🐛🐛🐛 Third round — two pre-existing bugs, confirmed via diff, not caused by any session's changes

**1. Months/years collapsing when trying to expand (Sale Data + Index
pages).** Confirmed via `diff` against the original uploaded zip that
`toggleMonGroup`/`renderDataTable` (data-page.js) and the equivalent
index-page.js logic were **byte-for-byte unchanged** — this predates
all of this session's work. Root cause: `manager.js`'s EventBus
subscriber triggers a full `rebuildAll()` on *any* sales write
(`daily:added`, `daily:pulled`, `daily:gapfilled`, etc. — all
legitimate, correctly-guarded notifications, not a repeat of the
earlier notify-loop bug). Each rebuild fully replaces the DOM and
defaulted every month/year back to "only the latest one open," wiping
out whatever the user had manually expanded — and with a live periodic
sync poll running, this could happen often enough to feel like
"continuously collapsing." **Fix:** both `renderDataTable()` and
`renderIndex()` now capture which months/years are open *before*
rebuilding and restore that exact state after, falling back to
"latest open" only on the very first render when nothing has been
opened yet. Verified with a real jsdom-based DOM test (capture → open
state correctly detected → correctly restored across a simulated
rebuild).

**2. Print producing a blank page.** Also confirmed via `diff` — `
bt-format.js`, `reports.js`, `reports-print.js` were all completely
unchanged from the original zip. The print CSS (`@media print` in
`pages.css`) is solid and already has a documented history of one prior
fix for mobile "Save as PDF" pagination. But the screenshot showed
printing to a **physical HP LaserJet driver** on desktop Chrome — a
different combination than what was previously fixed, and possibly a
printer-driver rendering quirk rather than something fixable in the web
app. Made one safe, defensive improvement regardless: `btPrint()` now
waits two animation frames (double-rAF) before calling `window.print()`
instead of one frame + a fixed 60ms guess — a more robust way to ensure
a large report has actually finished laying out before the print
snapshot is taken. **Open question for the user:** does this happen
with "Save as PDF" too, or only the physical printer? That distinguishes
a real web-app bug from a printer-driver limitation outside this
codebase's control.


Dependency analysis showed Floor 4/5 is densely, bidirectionally
interconnected (`ui.js` alone has 658 call sites depending on it across
28 other files) — real ES modules would mean constantly untangling
circular imports for little benefit. Switched to Stage A: wrap each
file's internals in an IIFE, keep it a classic script, bridge onto
`window` only the names other files actually use.

**Discovery: much of Floor 4/5 was already effectively done.** 11 files
(`ai-context.js`, `ai-instructions.js`, `commandhub.js`,
`intent-groups.js`, `sheets-patch.js`, `ui-extras.js`, `bt-calc.js`,
`bt-date.js`, `bt-search.js`, `analytics.js`, `diff-report.js`) were
already namespaced or down to a single well-named global — no work
needed. Real reduction only makes sense where a file has a high ratio
of genuinely-private helpers to externally-used functions; wrapping a
file where almost everything is already called from 3+ other files just
adds a namespace layer without hiding anything.

**This round's wraps:** `app-context.js` (7→2 globals),
`index-page.js` (3→2 globals), `storage.js` (6→5, `_curPage` stays bare
— see below), `hub-actions.js` (8→7 globals). Skipped `knowledge-sheet.js`,
`bt-format.js`, `conflict-ui.js`, `targets.js` — see reasoning above.

**Two new lessons, both caught before shipping:**
1. **My dependency-analysis regex missed `async function` declarations**
   (only matched `function`/`let`/`const`/`class`) — undercounted every
   file with async helpers. `storage.js`'s `idbSet`/`idbGet`/
   `idbSaveData`/`idbLoadData` were invisible to the first pass. Caught
   by manually re-checking for `^async function` before finalizing.
2. **Functions called via a same-file generated `onclick="..."` HTML
   string must stay on `window`, even with zero cross-*file* references.**
   Browser `onclick` attributes always resolve against global scope,
   never an IIFE's local scope. Cost real near-misses: `index-page.js`'s
   `toggleYrGroup` and `knowledge-sheet.js`'s `kshClose` both looked
   "private" by cross-file grep alone but are called from `onclick=`
   strings the same file generates. Now checked explicitly (`grep
   onclick=` in the file itself) before hiding anything, not just
   cross-file references.
3. **A `let` reassigned by another file (not just read) can never be
   hidden in an IIFE** — same class as the `MONTHLY`/`DAILY` check from
   Floor 1-3, but this time within Floor 4/5: `storage.js`'s `_curPage`
   is reassigned directly by `ui.js` (`_curPage = id`), so it stays a
   true bare global outside the IIFE while everything else in the file
   got wrapped normally.


`event-bus.js` converted last — zero dependencies, so it was
low-risk, but still went through the full checklist from the lessons
above: traced every consumer for immediate (non-deferred) top-level
usage (found only `conflict-ui.js`, already correctly positioned after
it), updated `repository.js`/`actions.js` to real `import` instead of
the window-bridge workaround, and ran the full Node.js runtime test
including regression checks for the staff-CRUD and notify-loop fixes
from earlier sessions — all passing through the real import chain now,
not just the bridge. `repository.js` and `actions.js` no longer have
any "can't import yet" workaround comments. Floor 1–3 (state store,
event bus, repository, actions) is now 100% real ES modules with zero
internal window-bridge dependencies between them — only the 41
remaining Floor 4/5 files still consume them via `window`.

### Fourth batch (while user was offline overnight)
Wrapped 9 more files: `ai-helpers.js`, `manager-export.js`, `drive.js`,
`custom-sections.js`, `dashboard.js`, `ai-context-ui.js`,
`dashboard-insights.js`, `fields.js`, `commandhub-page.js`. Skipped
`reports-print.js` deliberately — it's implicated in the print bug
currently being tested, didn't want to touch it mid-diagnosis.

**Broadened the same-file-reference check** from `onclick=` only to
also cover `onchange=`, `oninput=`, `onkeyup=`, `onkeydown=`, `onblur=`,
`onfocus=`, `onsubmit=` — this caught `dashboard.js`'s
`dashSetCreditMonth` (a dropdown `onchange` handler), which the
onclick-only check had wrongly marked "private."

**Found two more externally-*reassigned* variables** needing the same
`_curPage` treatment (kept as true bare globals, declared before the
IIFE, not wrapped): `drive.js`'s `_driveAccessToken` (reassigned by
`auth.js` in 3 places) and `fields.js`'s `_fmCustom` (reassigned
*internally* by fields.js itself in 3 places, and read externally by
`config.js`/`data-page.js` as a bare identifier — same risk even though
the reassignment isn't from another file, since a one-time bridge would
go stale the moment fields.js replaced the array).

**Caught and fixed a wrapping mistake before it shipped:** the first
mechanical wrap (`manager-export.js`) inserted the IIFE opener right
after literal line 1 — which was the *opening* of a multi-line `/**`
JSDoc comment block, trapping `(function() { 'use strict';` as comment
text instead of real code, leaving the final `})();` with nothing to
close. `node -c` caught it immediately. Rewrote the wrapping approach
to properly detect and skip past all leading comments (both `//` and
`/** */` blocks) before inserting, and verified the new approach against
every subsequent file in this batch.

**Final verification, done programmatically rather than by eye:** (1)
confirmed every expected bridge (`window.X = X`) is actually present in
each file, (2) confirmed every name intended to stay private has zero
references anywhere else in the codebase or `index.html`. Zero leaks
found on either check.

### Fifth batch — `ai-instructions-ui.js` and the `auth.js` monkey-patch
Wrapped `ai-instructions-ui.js` cleanly (21 bridges, 14 hidden, zero
issues). `auth.js` surfaced the most structurally interesting case yet:

**`drive.js` monkey-patches `unlockApp`** — captures the original
function, then reassigns `unlockApp = function(){...}` to add
auto-backup-after-unlock. `auth.js` itself calls `unlockApp()`
internally in several places. If `unlockApp` had been wrapped in the
IIFE like everything else, drive.js's patch would only ever have
affected a `window`-level copy, while every internal call inside
auth.js would keep calling the original, unpatched version forever —
silently breaking the auto-backup feature with no error anywhere.

`unlockApp` also calls `initAutoRefresh()` internally, which had no
other external dependents (would otherwise have been wrapped/hidden) —
had to travel with it, kept bare for the same reason. Traced the full
call chain first to confirm nothing else `unlockApp` needs is
internal-to-auth.js (everything else — `initApp`, `startSupabaseSync`,
`rebuildAll`, `manualSync`, etc. — lives in other files and is
unaffected either way).

Verified the actual monkey-patch scenario end-to-end in Node: captured
the bare `unlockApp`, patched it exactly like drive.js does, called it
bare (simulating an internal auth.js call) — confirmed the patched
version runs, not the stale original. Then the usual programmatic
sweep: all 18 expected bridges present, zero leaks from the 22 names
kept private.

### Lessons learned converting `actions.js`

1. **Never `import` from a file that isn't itself a module yet.** Almost
   added `import { EventBus } from './event-bus.js'` — but event-bus.js
   is still a classic script with no `export`, so that import would have
   made the browser fetch/parse it a *second* time as a separate module,
   creating two different `EventBus` objects. Caught by reasoning it
   through before running it, not by the syntax checker (`node --check`
   doesn't verify that the target module actually exports what you're
   importing). Stuck with the bare-identifier + window-bridge approach
   for any not-yet-converted dependency; only `import` from files that
   are already real modules.
2. **`node --check` did catch** a duplicate `})();` left over from an
   edit that didn't consume the file's original closing paren — a good
   reminder that even "just adding a bridge line" needs a syntax check
   immediately after, every time.

---

## 🎯 Progress scale (subjective, gut-check — not precise)

**On a scale of improvement this session (1–100):** ~12/100
Reasoning: dead-code sweep, all 5 original architecture violations, and
Floor 1–3 modularization are done AND device-verified clean (no console
errors, no notify loop, no ReferenceErrors). That's meaningfully more
solid than "code that compiles" — it's "code confirmed working on the
actual device under actual use," which is the bar that matters. Still
early on Floor 4/5 (42 files to go).

**On a scale of "perfect web app" (1–100):** ~13/100
Reasoning: same increment as above, plus this round proved out the
*process* (Node runtime testing + mandatory device testing + explicit
EventBus-subscriber-impact checks) that the remaining 42 files need to
go through safely — that process itself is now a durable asset, not
just this session's progress.

These two numbers will be updated at the end of each session so we can watch them move.

---

## 📋 Backlog (deferred by request)
- **Manager tab credit summary card** — same collapsed-by-default summary card with month dropdown that exists on the Dashboard, placed above "Credit Details" / below "Save All & Sync" on the Manager tab. Explicitly deferred by request until the improvement score reaches 100.

