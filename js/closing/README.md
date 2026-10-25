# js/closing

Daily closing: closing bridge, native closing screen and ledger marks.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `closing-bridge.js` — CLOSING BRIDGE  —  V2 plan §6, "read + re-analyze"
- `closing-ledger-marks.js` — CLOSING LEDGER MARKS
- `closing-native.js` — CLOSING NATIVE  —  Closing Book + Credit Ledger, ported into BT Sales
