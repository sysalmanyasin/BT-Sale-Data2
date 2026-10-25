# js/sheets

Google Sheets integration: API, picker, sync, notes sheets and patching.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `notes-sheets.js`
- `sheets-api.js` — GOOGLE SHEETS API — thin wrapper around Sheets API v4
- `sheets-app.js` — SHEETS APP — the new "Sheets" panel inside Notes & Sheets
- `sheets-patch.js` — SHEETS PATCH  —  loaded after notes-sheets.js
- `sheets-picker.js` — GOOGLE PICKER — link a spreadsheet that already exists in Drive
- `sheets-sync.js` — SHEETS ↔ SUPABASE SYNC
