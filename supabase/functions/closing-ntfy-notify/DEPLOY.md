# closing-ntfy-notify

Sends the Closing app shift summary to ntfy when a shift is saved. Called by the
`trg_notify_admin_shift_saved_ins` / `_upd` database triggers through
`public.notify_admin_shift_saved()`.

**Production status:** active, version 12, `verify_jwt=false` (pinned in
`supabase/config.toml`). The handler authenticates every request itself with
`NOTIFY_SHARED_SECRET`; do not turn on JWT verification without changing the
database caller.

## Secrets

Set these in Supabase → Project → Edge Functions → Secrets. Never commit values.

- `NOTIFY_SHARED_SECRET` — required; must match the database-side secret in
  Supabase Vault under `closing_notify_shared_secret`.
- `NTFY_CLOSING_TOPIC` — required; ntfy topic name, treated as a password.
- `NTFY_TOKEN` — optional ntfy.sh account token (`tk_...`). When present, the
  function sends as that account to avoid shared-egress quota/rate-limit issues.
- `NTFY_VARIANCE_ALERT` — optional variance threshold in Rs. for high priority
  (default 500).

## SQL dependency and secret handling

The migration
`supabase/migrations/20261027034720_closing_notify_ack.sql` creates the
notification log/status RPC and the two `public.sheets` triggers.

On the existing production database, its first run migrates the legacy bearer
value from the old trigger function into Supabase Vault without printing or
committing the value. The trigger function then reads it from Vault at runtime.
For a fresh project, create the Vault secret named
`closing_notify_shared_secret` first, using the same value as
`NOTIFY_SHARED_SECRET`, before applying the migration.

The notification log table has RLS enabled and no client-facing row policies.
The status RPC is executable by authenticated users; the trigger function is
not directly executable by client roles.

## Read-only diagnostic

Send `{"diag":true}` with the shared-secret Authorization header. The response
reports whether `NTFY_TOKEN` is configured and, if possible, the ntfy account
tier/quota. It never returns the token itself and does not publish a message.

```bash
curl -sS -X POST \
  'https://wetbugzzchkghpzmowod.functions.supabase.co/closing-ntfy-notify' \
  -H "Authorization: Bearer $NOTIFY_SHARED_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"diag":true}'
```

## Deploy

Push a change under `supabase/functions/closing-ntfy-notify/**` to `main`;
`.github/workflows/supabase-deploy.yml` tests first, then deploys this function
using the JWT setting in `supabase/config.toml`.

Manual fallback:

```bash
supabase functions deploy closing-ntfy-notify --project-ref wetbugzzchkghpzmowod
```
