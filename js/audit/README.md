# js/audit

Pharmacy Audit Hub: read-only bridge and native audit screens.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `audit-bridge.js` — AUDIT BRIDGE  —  V2 plan §12, "read + re-analyze"
- `audit-native.js` — AUDIT NATIVE  —  Assignments Overview + Live Snapshot popup
