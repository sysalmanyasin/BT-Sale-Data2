# js/sales

Sales data: daily table, dashboards, reports, targets, analytics and sale payments.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `analytics.js` — ANALYTICS  —  Floor 3 business computation module (CF-03 / CF-04 fix)
- `cash-deposit-report.js` — CASH TO BE DEPOSITED REPORT  —  new Sale Data report.
- `daily-checklist.js`
- `dashboard-controls.js` — DASHBOARD CONTROLS  —  BT Sales App  ·  Rule-Based Intelligence Plan §2
- `dashboard-heatmap.js` — SALES CALENDAR HEATMAP  —  BT Sales App
- `dashboard-insights.js`
- `dashboard-race.js` — BT GAME PLAY  —  BT Sales App
- `dashboard.js` — FLOOR 5 — buildDashboard (pure renderer)
- `data-page.js` — DAILY TABLE
- `diff-report.js` — DIFF REPORT
- `entry-prefill.js` — ENTRY PREFILL — Add Entry (js/sales/data-page.js, #page-entry) auto-fill from
- `fields.js` — ES module conversion: custom-field state remains live through a
- `index-page.js` — INDEX  —  Floor 5 pure renderer
- `record-day.js` — RECORD DAY — a small "wonder": the moment a Sale Data save produces a
- `reports-print.js` — PRINT REPORTS — Monthly & Yearly
- `reports.js` — DAY DETAIL MODAL
- `sale-payments-bridge.js` — SALE PAYMENTS BRIDGE  —  BT Sale Data › Payments tab (Aug 2026)
- `sale-payments-native.js` — SALE PAYMENTS NATIVE  —  Sale Data › Payments tab
- `targets.js` — TARGETS
