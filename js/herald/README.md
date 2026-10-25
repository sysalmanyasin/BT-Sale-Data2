# js/herald

Herald: rules-driven daily briefing engine and page.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `herald-engine.js` — IC HERALD — INSIGHT ENGINE  (js/herald/herald-engine.js)
- `herald-page.js` — IC HERALD — PAGE RENDERER  (js/herald/herald-page.js)
