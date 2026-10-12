# Manager Intelligence, part 1 (items 1–10): status

> **Status (checked 2026-10-12 against the code).** This file used to be an install guide for `bt-sale-data-first10.patch` and `scripts/apply-manager-intelligence.mjs`. **Neither file is in the repository**, so there is nothing to apply. This page now records what actually exists. Where it conflicts with the code, the code wins.

The work reuses the existing BT Agent, tool registry, telemetry, AI Center, Supabase tables and the twice-daily ntfy function. No financial/inventory write path was added; approval, audit, VERIFY, undo, write-lock and kill switch remain authoritative.

| # | Item | Where it lives | Wired into the running app? |
|---|---|---|---|
| 1 | Money-ranked inventory (top 10 estimated 7-day lost sales) | `js/ai-center/manager-intelligence.js` (`topMoneyFindings`), `supabase/functions/send-daily-ntfy-briefing/manager-intelligence.ts` | **No.** Unit-tested only; the ntfy `index.ts` does not import the `.ts` file; `daily_briefing` has no `money_ranked_top10` field. |
| 2 | Background alerts via ntfy | `manager-intelligence.ts` | **No** (same reason). |
| 5 | Finding actions (reviewed / snooze 7 days / resolve) | `js/ai-center/finding-actions.js`, migration `20261008120000_ai_center_finding_actions.sql` (`agent_finding_actions`) | **Table only.** The JS module is not imported by the UI. |
| 10 | Rule-based fallback | `deterministicFallback` in `manager-intelligence.js`; the assistant's own instant path (`core/instant.js`) is what runs | Fallback helper **No**; instant path **Yes**. |
| 3, 4, 7, 8, 9 | STR mismatch, cash reconciliation, trends, freshness, agent reliability | Partly covered by existing tools, Command Deck and health rules | Not as a separate feature set; check the Command Deck and `js/agent/tools/*` instead. |
| 6 | Mission/finding presentation | AI Center Command Deck (`js/ai-center/ui.js`) | **Yes** (as the Command Deck). |

Run `npm test` for the unit coverage (`tests/unit/manager-intelligence.test.js`). To finish wiring items 1, 2 and 5, the missing steps are: import `finding-actions.js` from `ui.js`, add the three files to `sw.js` `APP_SHELL`, and import `manager-intelligence.ts` from the ntfy function and redeploy it.

See also: [`README-manager-intelligence-v2.md`](README-manager-intelligence-v2.md), [`docs/ai-center-architecture.md`](docs/ai-center-architecture.md).
