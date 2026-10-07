# BT AI Center: final report (prompt section 53)

## What was built
A control room (`#ai-center`) over the existing assistant: live core state, lifecycle strip, six business systems with deeper read-only views, findings with evidence/recommendation/what-happens-if-I-act/related records/audit reference, cross-area signals, forecast, agent network, in-Center approval view, Action Center with undo, activity timeline (live + 7-day history), observability, measured health, tool intelligence, repository index search, command bar and palette. See `docs/ai-center-architecture.md` for the feature map.

## Agent map
Sales; Staff & money (Cash and Staff are one specialist in this repo: the Center shows the CASH and STAFF *systems* separately but they are served by Sales + Staff & money); Inventory; Stock transfers; Closing; Emergency billing; Notes & sheets; Analyst (chosen when 2+ areas match); Assistant (general).

## Tool map
Listed live in the Center (Tool Intelligence): domain, purpose, status (AVAILABLE / READ-ONLY / APPROVAL / BLOCKED), risk, approval rule, and 7-day runs, success rate, average time, last used (this device).

## KPI data sources
`docs/ai-center-kpi-verification.md`.

## Security and approval
Every change: preview, trusted tap (2 taps if strong, typed word for deletes), kill switch, writes lock, audit, 48 h undo, and now an automatic read-back verify. The Center cannot approve anything by script.

## Tests
Unit and DOM suites run with `npm test` (790 at the time of writing). New this round: model v2, approval/verify/history/security end to end through the real UI and panel, repo-index secret filtering and search, retry telemetry.

## Known limitations (honest list)
1. **Not yet seen in a real browser**: layout on desktop/tablet/phone, animation, sticky command bar over the bottom nav. Needs your screenshots.
2. **KPI comparison with production** needs a person with the live data (checklist provided).
3. **Voice** is a disabled button: the browser speech API sends audio to the browser vendor. Left off pending your decision.
4. **Cash and Staff** are not separate specialists in the repo.
5. **Edge Functions** (push briefing, closing push, Drive backup) cannot be health-checked from the app; shown UNKNOWN.
6. **History is per device**, 7 days, 300 events, redacted. Cross-device history is the audit log (writes only).
7. **Stored questions**: the first 100 characters of each question are kept in device history.
8. **Repository index** is a snapshot built by `npm run index:repo` (names and locations only; it cannot explain code). It needs a rebuild after code changes; the Center shows its age and commit. It is a static file, not an Edge Function.
9. **Correlations** are rule-based co-occurrence, labelled not-proof. No statistical or AI correlation runs automatically.
10. **Recommendations** are fixed rule text per finding type, not AI.
