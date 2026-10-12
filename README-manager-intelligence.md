# Manager Intelligence: status

This started as two patch sets ("first 10" and "second 10" improvements). The patch files and installer scripts they described are not in the repository, so there is nothing to apply. This page records what is actually live.

| What | Where | Status |
|---|---|---|
| Money-at-risk stockouts, STR mismatches, cash reconciliation, 7/30-day trends in the daily push | `supabase/functions/send-daily-ntfy-briefing/manager-intelligence.ts`, called from its `index.ts` | **Live in the repo** (needs a redeploy of the function to reach production; see its `DEPLOY.md`) |
| Read-only action plan (reorder suggestions from 30-day velocity and stock) | `manager_action_plan` in `js/agent/tools/manager-intelligence-v2.js` | Live (assistant tool, changes nothing) |
| Weekday forecast, reorder draft, money overview | `weekday_forecast`, `reorder_draft`, `money_overview` in `js/agent/tools/planning.js` | Live |
| Findings with evidence, impact and recommendation | AI Center Command Deck (`js/ai-center/ui.js`, `copilot.js`) | Live |

Removed as unused (2026-10-12; recoverable from git history): the AI Center helper modules `finding-actions.js`, `manager-intelligence.js`, `manager-intelligence-v2.js` and their tests, and the second ntfy module `manager-intelligence-v2.ts` (it overlapped the live one). The `agent_finding_actions` table from migration `20261008120000` remains but nothing uses it.

No financial or inventory write path was added by any of this. Approval, audit, VERIFY, undo, write lock and kill switch stay authoritative.
