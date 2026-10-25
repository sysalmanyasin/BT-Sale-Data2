# js/agent

AI assistant: client, tools (reads/writes/deletes), approval gates and UI panel for the bt-agent Edge Function.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `core/after-write.js` — What the app's own pages do after every save: refresh the dashboards and,
- `core/agent-client.js` — AGENT CLIENT — drives the tool loop in the browser.
- `core/audit.js` — Best-effort audit trail: local ring buffer + Supabase `agent_audit`
- `core/auditor.js` — The AUDITOR: a deterministic second reviewer for every change proposal.
- `core/briefing-badge.js` — Pure helpers for the proactive in-app briefing: what the ✨ badge shows and
- `core/guard.js` — Shared deterministic safety checks used by change-tool previews.
- `core/hard-blocks.js` — HARD BLOCKS — things the assistant may never do, whatever the model asks for, whatever the
- `core/history.js` — Saved conversations (tables agent_conversations / agent_messages). Only the visible turns are stored:
- `core/instant.js` — RULE-BASED INSTANT PATH — common one-line commands answered with NO model call (no tokens, no
- `core/kill-switch.js` — Server-side kill switch for AI changes (table agent_settings, key 'writes_killed').
- `core/knowledge.js` — Knowledge index, browser side: gathers the owner's Notes, Sheets (and optionally staff notes), turns them into
- `core/markdown-lite.js` — Tiny, safe markdown renderer for chat bubbles: escapes everything first,
- `core/memory.js` — Long-term memory + the "how I run this pharmacy" document (tables agent_memory / agent_rules).
- `core/orchestrator.js` — INVESTIGATION ORCHESTRATOR -- real multi-specialist investigation.
- `core/page-suggestions.js` — Page awareness for the global Dua panel. Pure: maps the page the person is looking at to an area (Sales, Inven
- `core/prefs.js` — Device-local assistant preferences (UI setting, not business data).
- `core/router.js` — Cheap, deterministic tool routing: offer the model only the tool groups the
- `core/server.js` — Thin transport to the bt-agent Edge Function. Uses the app's real
- `core/session-log.js` — In-memory record of changes made this session (for the auditor). Cleared with ↺.
- `core/specialists.js` — Specialist agents: one conversation, several focused "hats". Each turn the
- `core/telemetry-store.js` — TELEMETRY STORE — makes the activity history survive a reload.
- `core/telemetry.js` — AGENT TELEMETRY — the smallest possible real-event layer.
- `core/tool-registry.js` — AGENT TOOL REGISTRY
- `core/undo-store.js` — Persistent undo. Closures can't survive a reload, but every undo function in this app depends only
- `core/undo.js` — In-memory undo stack for AI changes in this session. Reload-proof undo lives in undo-store.js
- `core/usage-stats.js` — Usage + audit screen data. Pure aggregation (testable) and two thin fetchers.
- `index.js` — AI agent entry point (Phase 2: read + approval-gated changes).
- `tools/_names.js` — Name resolution shared by every tool that takes a person's name.
- `tools/_util.js` — Shared helpers for agent tools. Pure functions, no app imports.
- `tools/app.js` — App-level tools: context + navigation (UI only, changes no data).
- `tools/audit.js` — Audit Hub + payment-mix READ tools. Audit numbers come from the audit bridge's ai_audit_overview() aggregates
- `tools/billing.js` — Emergency Billing domain — READ-ONLY tools over the synced emergency_invoices tables.
- `tools/briefing.js` — Cross-domain "what needs my attention today?" — deterministic checks
- `tools/closing.js` — Closing domain — READ tools over the Closing app's synced shift sheets (read-only bridge).
- `tools/credit.js` — Staff credit (the Manager → Credit Ledger sheet).
- `tools/deletes.js` — DELETE tools. The riskiest thing the assistant can do, so:
- `tools/documents.js` — Documents domain — notes, sheets and the knowledge index. All READ-ONLY.
- `tools/forecast.js` — Today's forecast + the Forecast Game, as a READ tool. Data comes from the same controller the Sales tab uses.
- `tools/inventory.js` — Inventory domain — READ tools over the synced product list (read-only
- `tools/mail.js` — Mail briefing tools — the assistant reads the Utility > Mail briefing and manages follow-ups.
- `tools/manager-intelligence-v2.js` — Read-only BT Agent tool helpers. The tool itself is registered by the installer
- `tools/manager.js` — Manager domain — READ tools: staff registry (safe fields only) and ledgers.
- `tools/memory-tool.js` — remember_fact — the ONLY way the assistant can add to long-term memory, and only with the owner's tap.
- `tools/planning.js` — Planning domain — READ tools that answer "what will happen / what should I do":
- `tools/sales.js` — Sales domain — READ tools over DAILY / MONTHLY / targets.
- `tools/str.js` — STR (stock transfer) domain — READ tools over the synced STR headers/line items.
- `tools/verify.js` — VERIFIERS for the change tools.
- `tools/writes.js` — CHANGE tools (Phase 2). Every one of them:
- `ui/agent-panel.js` — AGENT PANEL: the ONE chat assistant, "Dua". A floating button on every page opens a compact panel over the cur
- `ui/voice.js` — BT DUA voice (shared by the AI Center bar AND the chat sheet): browser-native speech only (Web Speech API). No
