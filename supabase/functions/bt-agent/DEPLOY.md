# bt-agent — deployment

Project: `wetbugzzchkghpzmowod` (main BT SALE DATA project).

1. Apply the migration: `supabase/migrations/20261003100000_agent_foundation.sql`
2. Set secrets (any subset; Groq + Cerebras recommended, they are non-training):
   ```bash
   supabase secrets set GROQ_API_KEY=... CEREBRAS_API_KEY=... GEMINI_API_KEY=... OPENROUTER_API_KEY=...
   # optional
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
