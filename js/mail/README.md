# js/mail

Mail briefing and the cover mail strip.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `cover-mail-strip.js` — COVER MAIL STRIP (js/mail/cover-mail-strip.js)
- `mail-briefing.js` — MAIL BRIEFING — Utility > Mail (js/mail/mail-briefing.js)
