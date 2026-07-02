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

*Last updated: this session. Numbers are measured directly against the
originally uploaded zip, not estimated.*

| Metric | Before | After | Change |
|---|---|---|---|
| Dead functions removed | — | **18** | 18 confirmed-unused functions deleted (auth.js, ui.js, supabase.js, manager.js, dashboard.js, dashboard-insights.js, ai-bridge.js, commandhub-page.js) |
| Dead files removed | 46 files | 45 files | `data-base.js` deleted (defined `MONTHLY_BASE`/`DAILY_BASE`, referenced nowhere) |
| Global naming collisions | 1 | **0** | `chpOpenScan` was defined twice (intentional override, but left dead code + a stale comment behind — cleaned up) |
| Total `.js` lines | 22,617 | 22,571 | net **−46** (274 lines removed, 230 added — some removals were bug-fix rewrites, not pure deletion) |
| Architecture violations fixed | 5 categories | | See list below |
| Files converted to real ES modules | 0 of 46 | **3 of 46** | `config.js`, `repository.js`, `actions.js` |
| Global symbols behind a module export | 0 of ~850 | **37 of ~850** | `config.js` (35) + `Repository` + `Actions` — still bridged to `window` until consumers migrate |
| Files still 100% bare-global classic scripts | 46 | **42** | `event-bus.js` bridged (still classic) so modules can see it |
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

### 🐛 Real bug found via device testing (caught by you, not by me)
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

**On a scale of improvement this session (1–100):** ~8/100
Reasoning: dead-code sweep and the 5 architecture-violation fixes are done and are the "quick win" category. Global modularization — the bigger, riskier, more valuable piece — has only just started (1 of 46 files).

**On a scale of "perfect web app" (1–100):** ~10/100
Reasoning: this scale includes full modularization (45 files still to go), `ai-memory.js` being genuinely fixed, and no further audit findings on a second deep pass. We're early on the part of the work that actually moves this number — most of a "perfect app" score is the modularization + the eventual removal of every `window` bridge, which is many sessions away at a careful pace.

These two numbers will be updated at the end of each session so we can watch them move.
