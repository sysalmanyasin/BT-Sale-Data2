# Manager Intelligence, part 2 (items 11–20): status

> **Status (checked 2026-10-12 against the code).** This file used to be an install guide for `bt-sale-data-second10.patch` and `scripts/apply-manager-intelligence-v2.mjs`. **Neither is in the repository.** This page records what exists. The code wins on any conflict.

No new scheduler, AI provider, notification service, write path, approval system or business-data table was introduced.

| Item | Where it lives | Wired into the running app? |
|---|---|---|
| 11–14, 19–20 Opportunities, evidence bundles, anomaly signals, staff/credit signals, learning and verification summaries | `js/ai-center/manager-intelligence-v2.js` (`rankOpportunities`, `evidenceBundle`, `anomalySignals`, `learningSummary`, `verificationSummary`) | **No.** Unit-tested only (`tests/unit/manager-intelligence-v2.test.js`). |
| 15–16 7/30-day demand forecast, smart reorder recommendation | Same module; the live equivalents are the read tools `weekday_forecast` and `reorder_draft` (`js/agent/tools/planning.js`) | Live tools **Yes**; this module **No**. |
| Read-only action plan | `manager_action_plan` in `js/agent/tools/manager-intelligence-v2.js` (30-day velocity and stock; recommendation only, changes nothing) | **Yes**, imported by `js/agent/index.js`. |
| 17 Richer daily briefing blocks | `supabase/functions/send-daily-ntfy-briefing/manager-intelligence-v2.ts` | **No**; not imported by the function's `index.ts`. |

Tests: `npm test`. See [`README-manager-intelligence.md`](README-manager-intelligence.md).
