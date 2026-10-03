# bt-agent — deployment

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
