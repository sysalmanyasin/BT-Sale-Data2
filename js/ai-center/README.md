# js/ai-center

AI Center page: pure model, evidence, repository intelligence and command-deck UI.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `adapters.js` — AI CENTER — ADAPTERS (thin read layer over what BT already has)
- `avatar.js` — BT Intelligence — the talking avatar (js/ai-center/ui.js docks it in the hero and opens its settings sheet).
- `copilot.js` — AI CENTER — COPILOT LOGIC (pure)
- `deck-icons.js` — Line icons for the Command Deck (24x24, stroke only, drawn with currentColor). Decorative: always aria-hidden.
- `deck-model.js` — BT Intelligence "Command Deck" — pure view-model. Every number on the Overview comes from the real snapshot (d
- `forecast-game.js` — Forecast Game controller (side effects live here; the maths is js/shared/today-forecast.js).
- `index.js` — AI Center entry point. Loaded as a module from index.html AFTER js/agent/index.js
- `model.js` — AI CENTER — PURE MODEL
- `repo-intel.js` — AI CENTER -- REPOSITORY INTELLIGENCE (the service between the UI and js/ai-center/repo-index.json)
- `ui.js` — AI CENTER — UI
