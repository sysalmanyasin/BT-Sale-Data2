# BT AI Center: architecture audit and map (prompt section 52)

The AI Center is a **control room over the existing assistant**. It owns no business logic, no second data layer and no write path of its own.

## Layers

| Layer | Files | Role |
|---|---|---|
| Presentation | `js/ai-center/ui.js`, `css/ai-center.css` | Draws everything with `textContent` (never `innerHTML`, except the assistant's escaped markdown). |
| Pure model | `js/ai-center/model.js` | Maps existing tool results to findings, system cards, lifecycle, approval view, correlations, health rules. No DOM, no Supabase. |
| Adapters | `js/ai-center/adapters.js` | Read-only: runs existing READ tools through `runTool(..., {allow:['read']})`, reads bridge sync stamps and the agent tables. |
| Telemetry | `js/agent/core/telemetry.js`, `telemetry-store.js` | Real events only. Ring buffer (400) + redacted 7-day device history. |
| Agent | `js/agent/core/*`, `js/agent/tools/*` | The existing assistant: router, specialists, tool registry, approval controller, verifiers, undo, audit. |
| Repository index | `scripts/build-repo-index.mjs` -> `js/ai-center/repo-index.json` | Secret-filtered symbol map. Names and locations only. |

## Feature -> service -> data source -> agent -> tool -> approval -> audit

| Feature | Service | Data source | Agent | Tool(s) | Approval | Audit |
|---|---|---|---|---|---|---|
| Needs attention | `collectSnapshot` | `daily_briefing`, `closing_recent_days`, `list_pending_strs` | none (rules) | read tools | none (read) | telemetry `snapshot`, `finding_new/cleared` |
| Six system cards | `collectSnapshot` + `systemStatus` | briefing, `get_daily_sales`, `str_overview`, `closing_recent_days` | none | read tools | none | telemetry `tool_start/end` (source `ai-center`) |
| Deeper system views | `deepViews` (ui) + `readTool` | `low_cover_items`, `low_stock_items`, `slow_moving_stock`, `top_sales_days`, `list_pending_strs`, `closing_recent_days` | none | read tools, on tap | none | telemetry |
| Forecast | `buildForecast` | `get_target_pace` (= `Analytics.getTargetPaceForMonth`) + briefing projection (now delegating to the same function) | Sales | `get_target_pace` | none | telemetry |
| Cross-area signals | `correlate` | current findings | none (rules) | none | none | none: derived view |
| Ask BT / Investigate | `window.BTAgent.ask` | existing assistant | router-chosen specialist | per question | per change | `agent_audit` |
| Approval view | `approvalView` + `BTAgent.approvals/decide` | the live proposal + `approval_requested` event | whichever proposed | change tools | **yes: trusted tap; strong = 2 taps; delete = typed word** | `agent_audit`, telemetry `approval_*` |
| Verify | `runTool` -> verifier (`js/agent/tools/verify.js`) | re-read of the store written | n/a | each change tool | n/a | telemetry `verify_start/end`; verified flag in the tool result |
| Undo | existing `undo.js`, `undo-store.js` | `agent_audit` (48 h) | n/a | n/a | by tap | `agent_audit.undone_at` |
| Health | `collectHealth` + model rules | Supabase probes, `agent_usage`, `window._sbGetChannel()`, telemetry | n/a | n/a | n/a | n/a |
| Observability | `observability`, `specialistStats` | telemetry (session + 7-day history) | n/a | n/a | n/a | n/a |
| Tool intelligence | `listTools`, `toolStatus`, `toolStats` | tool registry + telemetry | n/a | all | shown per tool | n/a |
| Repository intelligence | `searchRepoIndex` | `repo-index.json` | none | none | none | none |

## Findings from the audit (what was wrong or duplicated, and what was done)

1. **Two forecast calculations** (briefing projection vs `Analytics.getTargetPaceForMonth`): merged. The briefing now delegates; a parity test locks it.
2. **Approval lived only in the assistant card**: now one shared controller; the Center and the card cannot disagree.
3. **No verify step after writes**: every change tool has a verifier that re-reads the store.
4. **Activity history was memory-only**: now a redacted 7-day device store. Restored events are marked `historical` and never make BT look busy.
5. **Health rows Realtime/Specialists were UNKNOWN**: now measured (bt-sync channel state; request/error events).
6. **Still not measurable**: the push briefing, closing push and Drive backup Edge Functions have no heartbeat. Shown as UNKNOWN with the reason.

## Event system

Types: `request_start`, `routed`, `step`, `tool_start`, `tool_end`, `approval_requested`, `approval_resolved`, `verify_start`, `verify_end`, `answer`, `instant`, `error`, `cancelled`, `retry`, `writes_killed`, `snapshot`, `finding_new`, `finding_cleared`. Each carries `event_id, timestamp, type, source, agent, tool, domain, status, duration, severity, entity_reference, request_id, metadata`. Nothing is emitted unless it actually happened.

## Security model

- The Center has **no write tool and no approval of its own**. `BTAgent.decide()` refuses any call without a trusted (real user) gesture; scripts cannot approve.
- Reads go through `runTool` with `allow:['read']`; the registry's hard blocks and the kill switch still apply.
- Arguments are redacted before storage (keys such as password, token, phone, CNIC, email, address). The device store keeps an allow-list of metadata fields, never tool arguments or answer text. It does keep the first 100 characters of each question.
- Repository index: no source text; secret-bearing files and lines are skipped; the builder refuses to write if the output matches a secret pattern.
- Tests: untrusted click cannot approve; wrong typed word grants nothing; locked mode creates no approval; restricted tools show `READ-ONLY`; redaction.
