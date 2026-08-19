# Smoke-test suite

A smoke-test suite for the app: fast, breadth-first checks that answer
"did anything fundamental break?" — not deep unit coverage of every
business rule (see "What's deliberately out of scope" below).

Zero build step. Runs on Node's own built-in test runner
(`node:test` + `node:assert/strict`), plus [jsdom](https://github.com/jsdom/jsdom)
as the only dependency, so the app's real browser-facing modules can be
exercised without a browser.

## Running it

```bash
npm install     # once, installs jsdom
npm test        # runs the whole suite
npm run test:verbose   # same, with the spec reporter (readable test names)
npm run test:watch     # re-runs on file changes
```

Expected result on a clean checkout: **all tests pass, 0 failures.**

## What's covered, and why

| Layer | Files | What it catches |
|---|---|---|
| **Static integrity** | `tests/static/file-references.test.js` | Every `<script>`/`<link>` in `index.html` points at a real file; every entry in `sw.js`'s `APP_SHELL` exists; every script/stylesheet `index.html` loads is actually precached (the exact "silently fails offline" drift the app's own README calls out as a real, previously-seen failure mode) |
| | `tests/static/manifest.test.js` | `manifest.json` is valid JSON, has the required PWA fields, and every icon/shortcut file it points at exists |
| | `tests/static/syntax-check.test.js` | Every one of the 89 JS files under `js/` and `sw.js` parses cleanly (`node --check`) — the cheapest possible net against a stray bracket or leftover merge marker |
| **Unit (pure modules)** | `tests/unit/config-formatters.test.js` | `js/config.js`'s number/currency formatters (`n`, `ff`, `fc`, `fv`, `pct`) that every report and dashboard tile depends on |
| | `tests/unit/event-bus.test.js` | `js/event-bus.js`: the single pub/sub channel every Repository write announces itself on and every Page listens to — subscribe, notify, unsubscribe, and "one bad listener can't break the others" |
| | `tests/unit/print-engine.test.js` | `js/print.js` loads and still exposes the exact API (`render`/`renderNewTab`/`renderThermal`/`renderThermalTable`) every report page calls into. Actually invoking a render is out of scope (needs a real canvas for jsPDF/html2canvas) |
| **Integration (Repository + Actions)** | `tests/unit/repository-staff.test.js` | The Staff Registry vertical slice (`config.js` → `event-bus.js` → `repository.js` → `actions.js`): add/update/reactivate/remove, the Sr# uniqueness rules, `localStorage` persistence, and `EventBus` notifications. Chosen deliberately — it's the one core-data-layer slice that doesn't reach out to unrelated classic-script globals the way the DAILY/MONTHLY helpers do (see `tests/helpers/README` note below) |
| **DOM / navigation** | `tests/dom/navigation.test.js` | Loads the **real** `index.html` into jsdom and runs the **real** `js/ui.js` against it (not a hand-rolled stub), then drives `showPage()` the way a nav-tab click would — checks the domain-classification table (`body[data-domain]`) matches the README for every domain, page activation/deactivation, and the Sale Data sub-nav toggle |

## Helpers

- **`tests/helpers/dom-env.js`** — installs a fresh jsdom `window` as
  the Node global environment, so real ES modules (`config.js`,
  `repository.js`, `actions.js`, `print.js`, ...) can be imported
  *unmodified* and see `window`/`document`/`localStorage` as bare
  globals, exactly like they would in a browser.
- **`tests/helpers/load-classic-script.js`** — runs one of the app's
  *classic* (non-module) `<script defer src="...">` files inside a
  jsdom window via Node's `vm` module, so a top-level
  `function showPage(){}` becomes a genuine global on that window —
  the same thing a browser does for a classic script, which is what
  lets the navigation tests call `window.showPage(...)` without
  touching the app's source.

## What's deliberately out of scope

- **DAILY/MONTHLY repository functions** (`upsertDaily`, month
  recompute, etc.) — several call bare globals like
  `invalidateRenderCache()` that only exist once `dashboard.js` has
  also loaded as a classic script. Wiring that up would mean loading
  most of the app's classic-script graph just to smoke-test one
  function, which stops being a *smoke* test. The Staff Registry slice
  above exercises the same Repository/Actions/EventBus plumbing
  without that entanglement.
- **Print rendering output** — `Print.render()` drives jsPDF +
  html2canvas against a live DOM capture; that needs a real browser
  canvas, not jsdom. The test suite verifies the API surface stays
  intact instead.
- **Supabase sync, Google Sign-In, the AI assistant, Android
  widgets/app** — all need live network access to third-party services
  this environment can't reach, and are integration/E2E territory, not
  smoke-test territory.
- **Visual/print regressions on a real device** — the README already
  flags that Android's `window.print()` doesn't block JS execution the
  way desktop does; that class of bug only shows up on a real device
  and can't be caught by a jsdom-based suite.

## Bugs this suite found (and fixed) while being built

1. **`sw.js`'s `APP_SHELL` was missing 8 files** actually loaded by
   `index.html` (`status-bar.js`, `icons.js`, `subtab-strip.js`,
   `sheets-api.js`, `sheets-sync.js`, `sheets-picker.js`,
   `sheets-app.js`, `sheets-app.css`) — exactly the "silently fails
   offline" drift the README calls out as a real risk. Fixed in
   `sw.js` (CACHE_NAME bumped to `v10.81`) and locked in by
   `file-references.test.js`.
2. **`Actions.addEmployee`'s id (`'emp_' + Date.now()`) could collide**
   when two employees were added inside the same millisecond, which
   then corrupted `_nextSrNum`'s "exclude the record itself" logic
   (it matches by id) into wrongly excluding *both* records. Fixed in
   `js/actions.js` by suffixing the id with a random component;
   locked in by a dedicated regression test in
   `repository-staff.test.js`.
