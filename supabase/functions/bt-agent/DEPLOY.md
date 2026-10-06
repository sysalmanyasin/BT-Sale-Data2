# bt-agent — deployment

**Status (2026-10-03):** migration `agent_foundation` applied and `bt-agent` v1 deployed (verify_jwt=true) to `wetbugzzchkghpzmowod` via the Supabase integration. Re-deploys happen the same way on each push; the GitHub workflow below is an optional backup and only warns if its secrets are missing.

**Automatic:** every push to `main` that touches `supabase/**` runs `.github/workflows/supabase-deploy.yml` (tests first, then deploys changed functions and applies new migration files). One-time setup: add repo secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_URL`. To run the first deploy by hand: Actions → *Deploy to Supabase* → Run workflow → functions `bt-agent`, migrations `20261003100000_agent_foundation.sql`. Manual CLI steps below still work.

Project: `wetbugzzchkghpzmowod` (main BT SALE DATA project).

1. Apply the migration: `supabase/migrations/20261003100000_agent_foundation.sql`
2. Secrets: **nothing to do for Groq.** Edge Function secrets are project-wide, and `GROQ_API_KEY`
   (plus `GEMINI_API_KEY`) already exist in project `wetbugzzchkghpzmowod` for `medicine-ai-info`,
   so `bt-agent` picks them up automatically. Groq is the first-choice provider. Optional extras:
   ```bash
   supabase secrets set CEREBRAS_API_KEY=... OPENROUTER_API_KEY=...   # more fail-over
   supabase secrets set AGENT_PER_MIN=20 AGENT_PER_DAY=400 AGENT_ALLOWED_ORIGINS=https://bt.duapharma.com
   ```
3. Deploy **with JWT verification ON** (the default) — do not pass `--no-verify-jwt`:
   ```bash
   supabase functions deploy bt-agent --project-ref wetbugzzchkghpzmowod
   ```
4. Sign in to the app, open the AI panel, ask "what is today's date?".

The function additionally checks that the signed-in email is an active row in
`bt_authorized_users`, so the public anon key alone can never reach a model.

Gemini and OpenRouter free tiers may use prompts for training. Requests the
client marks `sensitivity: "high"` (anything that touched salary/credit/staff
detail) are never sent to those providers.


## Gaps A–E update (migrations + behaviour)

Apply, in order (all idempotent), **before** deploying the function:

1. `20261005100000_agent_quota_and_settings.sql` — `agent_usage.kind/error` (per-attempt provider tracking), `agent_settings` (server kill switch), `agent_is_authorized()`.
2. `20261005110000_agent_undo.sql` — undo recipes on `agent_audit` (only `undone_at` may be updated).
3. `20261005120000_agent_memory_rules.sql` — `agent_memory` (facts) and `agent_rules` (versioned house-rules document).
4. `20261005130000_agent_schedules.sql` — `agent_schedules` (definitions only; **no runner yet**).

Then deploy `bt-agent` and `send-daily-ntfy-briefing` (it now imports `credit-alerts.js`, a byte-identical copy of `js/shared/credit-alerts.js`; a test keeps them equal).

Behaviour changes to know about:

- **CORS** now defaults to `https://bt.duapharma.com`. Set `AGENT_ALLOWED_ORIGINS` (comma list) only for local development; `*` still works if you set it explicitly.
- **Provider quota tracking** is shared across function instances through `agent_usage` (`kind = 'attempt'`). A provider/model that failed with 429/5xx/404 in the last 60 s is skipped by every instance. Soft daily caps (`dailyCap` in `PROVIDERS`: Groq 13,000, Gemini 1,400, OpenRouter 45) skip a provider once reached. Edit the numbers if your tier differs.
- **Kill switch**: ⛔ in the panel header flips `agent_settings.writes_killed`. The function reads it on every request, forces read-only prompts, and tells the browser, which stops offering and running change tools. If the browser can't read the switch it treats writes as stopped. To flip it by hand: `update agent_settings set value = 'true'::jsonb where key = 'writes_killed';`
- **House rules + facts** (🧠) are read server-side per user and appended to the system prompt (rules ≤ 4,000 chars, ≤ 40 facts of ≤ 300 chars), ranked below the safety rules. The model has no tool that writes them.


## Phase 4 update: history, streaming, routing, knowledge index

Apply `20261006100000_agent_history_and_knowledge.sql` **before** deploying (idempotent). It adds `agent_conversations` / `agent_messages`
(saved chats, owner-only), installs `pgvector` (`extensions.vector`), creates `agent_knowledge` + the service-role-only `agent_match_knowledge()`,
and labels memory facts as `user` or `assistant`.

New function files: `embed.ts` and `agent-shared.js` (byte-identical copy of `js/shared/agent-shared.js`; a test keeps them equal).

**One request path, five actions** (`action` in the JSON body): `chat` (default; `stream: true` returns Server-Sent Events), `route`, `review`, `index`, `search`.

- **Streaming**: events are `delta`, `reset` (fail-over happened after text was sent; discard it), `done`, `error`. A client that doesn't ask for `stream` gets plain JSON as before.
- **route / review** are small advisory model calls. They only use non-training providers, are limited separately (`kind = 'aux'`, 2x the chat limits), and fail silently: routing falls back to keywords, review to the rules auditor. Review can only *add* a warning.
- **Knowledge index** needs ONE embedding provider:

| Secret | Meaning |
|---|---|
| `AGENT_EMBED_PROVIDER` | `gemini` (default) or `cloudflare` |
| `GEMINI_API_KEY` | already set for chat; reused for `gemini-embedding-001` (768 dims) |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | only for `cloudflare` (`@cf/baai/bge-base-en-v1.5`, 768 dims) |
| `AGENT_EMBED_PER_DAY` | embedding calls per user per day, default 600 |

**Privacy.** The Gemini free tier may use prompts for training, so with Gemini only ordinary Notes and Sheets are indexed, after phone numbers,
CNICs, IBANs, emails and long digit runs are removed. **Staff notes are indexed only when the embedder is non-training (Cloudflare)**; with Gemini they are skipped
and the app says so. Nothing is sent until the owner taps *Index now* in 🧠 Memory. Vectors from different models are never compared (the model id is stored per row);
changing `AGENT_EMBED_PROVIDER` means tapping *Delete index* then *Index now* again. If embedding is unavailable, `search` falls back to keyword matching.

**Live eval in CI**: `.github/workflows/agent-live-eval.yml` runs weekly and on demand when the repository secret `GROQ_API_KEY` exists (skips otherwise). It is advisory and never gates a deploy.
