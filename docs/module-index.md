# Module Index

This guide maps important application modules to their responsibilities and the conventions contributors should preserve. It is a curated index, not an exhaustive listing of every file.

## Shared business logic

These modules keep calculations consistent across the web app and assistant integrations. Prefer reusing them over duplicating business rules in a page, notification, or AI tool.

| Module | Responsibility | Design notes |
|---|---|---|
| [`summary-calc.js`](../js/shared/summary-calc.js) | Pure summary and inventory-health calculations used by browser and server-side callers | Pass plain data in; return calculated data. Keep DOM and network access out. |
| [`inventory-metrics.js`](../js/shared/inventory-metrics.js) | Defines the shared “not sold in N days” rule across briefing, Stock Ledger alerts, assistant tools and AI Center | Preserve the documented row-shape compatibility and one shared definition. |
| [`planning-metrics.js`](../js/shared/planning-metrics.js) | Forecast, reorder, STR fill-rate and money-overview metrics used by assistant tools and AI Center cards | Keep calculations deterministic and unit-testable. |
| [`today-forecast.js`](../js/shared/today-forecast.js) | Daily-sale forecasting, intraday samples and Forecast Game scoring | Callers supply time and sample data; the module remains pure. |
| [`credit-alerts.js`](../js/shared/credit-alerts.js) | Duplicate-entry, unrolled-credit and aged-credit alerts | Shared between in-app briefing and push notification logic; changes should keep both contexts aligned. |
| [`agent-shared.js`](../js/shared/agent-shared.js) | Shared AI knowledge-index helpers, including redaction and chunk/stream utilities | Sensitive text must be redacted before it leaves the browser; keep browser and Edge Function copies in sync where tests require it. |

## Navigation and operational modules

| Module | Responsibility | Important convention |
|---|---|---|
| [`nav-sections.js`](../js/nav-sections.js) | Navigation tree and All Sections drawer | Treat it as the main source for section navigation. |
| [`global-search.js`](../js/global-search.js) | Fuzzy search for navigation sections and Staff Registry records | Classic script; depends on the existing search bridge and navigation code, so preserve script order in `index.html`. |
| [`boot-guard.js`](../js/boot-guard.js) | Reports missing dependencies caused by incorrect script load order | Keep it positioned after the dependency/module block it checks. |
| [`daily-checklist.js`](../js/daily-checklist.js) | Daily Check List page and date-specific UI drafts | Drafts are stored locally; do not describe them as synced business records unless the implementation changes. |
| [`record-day.js`](../js/record-day.js) | Celebrates a new all-time daily-sales record after daily-sales events | Uses the saved `TOTAL` value and the app's EventBus/write path instead of reimplementing sales calculations. |

## AI assistant layout

| Location | Responsibility |
|---|---|
| [`js/agent/core/`](../js/agent/core/) | Tool registration and execution, routing/specialists, approval controls, audit, undo and transport |
| [`js/agent/tools/`](../js/agent/tools/) | Domain-specific assistant tools |
| [`js/agent/ui/`](../js/agent/ui/) | Assistant panel and interaction UI |
| [`js/ai-center/`](../js/ai-center/) | BT Intelligence screens, models, forecast game and repository intelligence |
| [`supabase/functions/bt-agent/`](../supabase/functions/bt-agent/) | Server-side model step and provider integration |

### Adding or changing a module

1. Search for an existing shared helper before implementing a new calculation.
2. Keep pure business logic separate from DOM, storage and network code when practical.
3. Respect the app's mixed ES-module/classic-script loading model. If a classic script consumes globals such as `Repository`, `Actions` or `EventBus`, verify its order in `index.html`.
4. Route business-data writes through the established `Actions` / `LedgerActions` paths rather than writing parallel copies of records.
5. For assistant tools, declare the appropriate risk level. Write/critical tools must provide a validation/approval preview and should provide an undo recipe; never rely on prompt wording as the authorization boundary.
6. Keep duplicated browser/Edge Function helpers in sync when tests enforce byte-identical copies.
7. Add or update automated tests for changed calculations, data paths, navigation and security-sensitive behaviour.
8. After changing shipped app files, run `npm run build`, then `npm run build:check` and `npm test`. The build updates release stamps and PWA cache metadata; it does not bundle or minify.

## Verification commands

```bash
npm ci
npm test
npm run build:check
```

Use `npm run build` before shipping changed application assets, then rerun the checks above.
