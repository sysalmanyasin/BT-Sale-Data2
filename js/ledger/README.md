# js/ledger

Ledger and cash tally: store, actions, page, quick add, Jazz Cash.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `jazz-cash.js` — JAZZ CASH MODULE — Balance Tally
- `ledger-actions.js` — LEDGER ACTIONS  —  Floor 3 of the architecture
- `ledger-page.js` — LEDGER PAGE  —  Floor 4/5 of the architecture
- `ledger-quick-add.js` — LEDGER QUICK ADD
- `ledger-store.js` — LEDGER STORE  —  Floor 1/2 of the architecture
- `quick-add.js` — QUICK ADD — one widget, four destinations (Jazz Cash / Staff Credit
