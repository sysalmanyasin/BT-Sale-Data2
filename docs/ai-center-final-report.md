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
Measured 2026-10-08 by running `npm test` (Node 22.22.2, jsdom, clean `npm ci`): 170 suites, 909 tests, 909 pass, 0 fail, 0 skipped, about 56 s. Earlier counts in this file (790) and the README (167) were stale. New this round: model v2, approval/verify/history/security end to end through the real UI and panel, repo-index secret filtering and search, retry telemetry.

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
10. **Recommendations have two distinct paths.** (a) Every finding carries fixed rule-based guidance (`guidanceFor` in `js/ai-center/model.js`), labelled as rule text, not AI. (b) When an investigation runs, the orchestrator may emit a structured AI recommendation (`investigation_advice`, basis `analyst_synthesis`, `js/agent/core/orchestrator.js`), shown only when evidence supports it. The AI path is covered by unit tests only; it has not been exercised against a live model.

## Completion status (audited 2026-10-08, HEAD 8506935)
Status is based only on what was run in a sandbox with no browser, no Supabase credentials and no model access.

| Requirement | Status | Evidence / blocker |
|---|---|---|
| Full test suite | DONE | 909/909 pass, 0 fail (run, not quoted from commits) |
| Docs and test counts | DONE | README and this report corrected |
| Repo index and SW cache | DONE | Index rebuilt at HEAD gives the same content (260 files, 2553 symbols); SW cache is v11.26 and precaches repo-index.json |
| Approval, reject, write, VERIFY, audit, undo (code paths) | PARTIAL | Covered by DOM and unit tests against fakes; not run against production Supabase |
| Six-system KPI accuracy vs production | NOT VERIFIED | Needs live data; checklist in ai-center-kpi-verification.md |
| UNKNOWN / OFFLINE / DEGRADED states | PARTIAL | Test-covered; not observed live |
| Single / multi-specialist investigations | PARTIAL | Orchestrator and UI tests pass; real model-backed runs not executed |
| Repository Intelligence through the UI | PARTIAL | jsdom UI tests pass; not seen in a browser |
| Responsive UI (desktop / tablet / mobile), accessibility | NOT VERIFIED | No browser in this environment; known limitation 1 stands |
| Security: auth expiry, kill switch, redaction, failures | PARTIAL | Static and unit tests pass; live auth expiry and realtime failure not exercised |
| Cash and Staff as separate specialists | NOT DONE (by design) | Served by one Staff & money specialist; no fake specialists added |
| Voice | NOT DONE | Disabled pending decision (privacy) |

Overall: the code and test suite are healthy, but production readiness is not proven. Remaining blockers are live-data KPI checks, a real-browser responsive pass, and live write/approve/VERIFY/undo runs.
