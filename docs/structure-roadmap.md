# Structure roadmap (target: 90+/100, built to scale ~100x in modules)

Baseline audit: 71/100. Each phase is independently shippable and must keep `npm run lint`, `npm test` and `npm run build:check` green.

| Phase | Goal | Status |
|---|---|---|
| 1 | One source for Supabase URL/keys (`js/shared/backend-config.js`), guard test, delete legacy WhatsApp function, ESLint + warning ratchet in CI | **Done** |
| 2 | Merge duplicate helpers (`esc` x12, `fmt` x10, `fmtMoney` x5) into `js/shared/`; break the 11 import cycles (`repository`, `config`, `bt-date`, `bt-format`, `bt-search`, `ledger-store`, `manager-*`) by moving shared constants into leaf modules; fix 46 empty `catch {}` | **Done** (cycles: the only real one was manager-staff/salary/generic/credit; `esc` copies: 25 -> 1; `fmtMoney` copies differ in format so are left; empty `catch` blocks remain) |
| 3 | Group `js/` by domain (`sales/`, `manager/`, `inventory/`, `platform/`), add a module-boundary test (a domain may import only `shared/` + its own folder) and a `js/<domain>/README.md` per folder; split god files (`cover-dashboard`, `emergency-billing-native`, `ai-center/ui`, `stockledger`) | Planned |
| 4 | Replace the 265 inline handlers with delegated listeners, drop `window.*` bridges module by module, generate `index.html` script list from a manifest, add a bundler (esbuild/Vite) for hashing + minification | Planned |
| 5 | Ratchet lint: `no-undef` to error, lower `--max-warnings` each release; move attendance anon `USING(true)` policies behind authenticated/Edge-controlled writes | Planned |

Scale rules for new modules: new feature = new folder under its domain; no new `window.*` globals; no URLs/keys outside `backend-config.js`; data writes via Action -> Repository -> EventBus.
