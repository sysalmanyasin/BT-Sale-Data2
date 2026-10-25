# js/emergency-billing

Emergency Billing: Supabase bridge and native screen.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `emergency-billing-bridge.js` — EMERGENCY BILLING BRIDGE — reads/writes emergency_invoices,
- `emergency-billing-native.js` — EMERGENCY BILLING NATIVE — page logic (Architecture doc, Phase 3 / §5, §6).
