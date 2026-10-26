# Structure roadmap (target: 90+/100, built to scale ~100x in modules)

Baseline audit: 71/100. Each phase is independently shippable and must keep `npm run lint`, `npm test` and `npm run build:check` green.

| Phase | Goal | Status |
|---|---|---|
| 1 | One source for Supabase URL/keys (`js/shared/backend-config.js`), guard test, delete legacy WhatsApp function, ESLint + warning ratchet in CI | **Done** |
| 2 | Merge duplicate helpers (`esc` x12, `fmt` x10, `fmtMoney` x5) into `js/shared/`; break the 11 import cycles (`repository`, `config`, `bt-date`, `bt-format`, `bt-search`, `ledger-store`, `manager-*`) by moving shared constants into leaf modules; fix 46 empty `catch {}` | **Done** (cycles: the only real one was manager-staff/salary/generic/credit; `esc` copies: 25 -> 1; `fmtMoney` copies differ in format so are left; empty `catch` blocks remain) |
| 3 | Group `js/` by domain (`sales/`, `manager/`, `inventory/`, `platform/`), add a module-boundary test (a domain may import only `shared/` + its own folder) and a `js/<domain>/README.md` per folder; split god files (`cover-dashboard`, `emergency-billing-native`, `ai-center/ui`, `stockledger`) | **Mostly done**: 14 domains under `js/` (manager, str, inventory, closing, audit, emergency-billing, ledger, sheets, sales, mail, cover + existing agent, ai-center, herald); core = 28 files; boundary rules enforced by `tests/static/domain-boundaries.test.js`; `scripts/move-module.mjs` moves modules and fixes every reference. **Still to do:** split god files (`cover/cover-dashboard.js` 1,984 lines, `emergency-billing-native`, `ai-center/ui`, `inventory/stockledger`) |
| 4 (in progress) | Replace the 265 inline handlers with delegated listeners, drop `window.*` bridges module by module, generate `index.html` script list from a manifest, add a bundler (esbuild/Vite) for hashing + minification | Planned |
| 5 | Ratchet lint: `no-undef` to error, lower `--max-warnings` each release; move attendance anon `USING(true)` policies behind authenticated/Edge-controlled writes | Planned |

Scale rules for new modules: new feature = new folder under its domain; no new `window.*` globals; no URLs/keys outside `backend-config.js`; data writes via Action -> Repository -> EventBus.

## Phase 4 progress: inline handlers — DONE (0 left)
- `js/shared/dom-actions.js` is the delegated dispatcher (`data-on-click="action" data-args='[...]'`, plus `data-self-only`, `data-key`, `data-confirm`, `data-stop`, `data-then` for `a(); b()` chains). Legacy `window.*` names still resolve through it; new code uses `registerActions()` and builds attributes with `act()` (values are JSON + HTML escaped).
- **index.html: 267 -> 0** and **js/ templates: 221 -> 0** inline handlers. `tests/static/no-inline-handlers.test.js` enforces zero in both, that every action name resolves to a real function, and that files importing/using the helpers do so correctly.
- Classic (non-module) scripts (`platform/drive.js`, `sales/dashboard-heatmap.js`) cannot `import`; they use `window.BTDomActions`.
- Next: ship a strict CSP (drop `'unsafe-inline'` for scripts; the 3 inline `<script>` blocks in index.html need moving or hashing first), then retire `window.*` bridges module by module (actions registered via `registerActions()` instead).

## Phase 5 progress: layers, globals, CSP, CORS, size
- **Layers:** `js/` has no loose files. Core is three folders: `platform/` (state, sync, auth, boot), `ui/` (shell, nav, search, icons), `lib/` (date, format, print, rules). `tests/static/domain-boundaries.test.js` treats all three as the core layer; `file-size-budget.test.js` fails if a loose file reappears.
- **Globals:** 86 implicit globals became real `import`s. `no-undef` is an **error**; the remaining 166 names are the explicit registry in `config/legacy-globals.mjs` (ratcheted by `tests/static/legacy-globals.test.js`). 19 of them are dead `typeof`-guarded hooks defined nowhere: delete the call sites. The rest are core->domain couplings and `window` bridges.
- **Lint:** 0 errors, 0 warnings (`--max-warnings 0`), edge-function `.js` helpers included.
- **CSP:** no inline scripts remain (`platform/early-prefs.js`, `sw-register.js`, `gauth-preload.js`); `index.html` carries a `script-src` CSP; `csp-and-cors.test.js` keeps every script host covered. Smoke-test sign-in, the Sheets picker and the attendance map after deploy.
- **CORS:** `set-staff-login`, `medicine-ai-info`, `google-drive` allow only `https://bt.duapharma.com` (env `ALLOWED_ORIGINS` overrides). Redeploy the three functions.
- **Build safety:** `npm run bundle:check` bundles every module entry with esbuild (also a test). `npm run test:coverage` enforces a coverage floor in CI. `sw.js` history moved to `CHANGELOG.md`.
- **Still open:** split the 7 files over 1,000 lines (caps in `file-size-budget.test.js`), retire the registry names (convert/expose via imports, then lower the budget), and ship a production bundle (esbuild is verification-only today).
