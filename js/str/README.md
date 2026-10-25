# js/str

Stock Transfer Requests: shared helpers, bridge and native screens.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `str-bridge.js` — STR BRIDGE  —  STR Report tab (Stock Transfer Records, August 2026)
- `str-native.js` — STR NATIVE  —  STR Report tab (Stock Transfer Records)
- `str-report-native.js` — STR REPORT NATIVE  —  "Report" sub-tab under STR (Aug 2026)
- `str-shared.js` — STR SHARED  —  pure helpers shared by str-native.js (the STR list +
- `str-zero-dispatch.js` — STR ZERO DISPATCH — 3rd sub-tab under STR (Aug 2026)
