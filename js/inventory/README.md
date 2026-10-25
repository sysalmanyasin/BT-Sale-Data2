# js/inventory

Inventory: bridge, native screens, health dashboard and stock ledger.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `excess-working.js` — EXCESS WORKING  —  native port of "Excess Stock Control"'s branch-level
- `inventory-bridge.js` — INVENTORY BRIDGE  —  BT Inventory tab (July 2026)
- `inventory-health-dashboard.js` — INVENTORY HEALTH DASHBOARD  —  standalone inventory tab (July 2026)
- `inventory-native.js` — INVENTORY NATIVE  —  BT Inventory tab
- `reorder-report.js` — REORDER REPORT — the inverse of Excess Working: instead of flagging
- `stockledger.js` — Same project + anon/publishable key already baked into js/audit/audit-bridge.js
