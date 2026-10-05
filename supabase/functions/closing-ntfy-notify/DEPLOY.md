# closing-ntfy-notify

Sends the Closing app's shift summary to ntfy whenever a shift is saved. Called by the
`trg_notify_admin_shift_saved_ins` / `_upd` database triggers (through `public.notify_admin_shift_saved`)
with `Authorization: Bearer <NOTIFY_SHARED_SECRET>`. `verify_jwt` is off (pinned in `supabase/config.toml`).

## Secrets
- `NOTIFY_SHARED_SECRET` (required): must match the token the trigger sends.
- `NTFY_CLOSING_TOPIC` (**required in this repo copy**): on ntfy.sh a topic name works like a password, so it is
  deliberately NOT in this public repository.
- `NTFY_VARIANCE_ALERT` (optional): variance (Rs) at/above which priority is high (default 500).

## IMPORTANT before deploying from the repo
The function currently deployed in production (v5) still has the old topic built into its source as a default.
This repo copy removed that default and fails closed (HTTP 500) when `NTFY_CLOSING_TOPIC` is missing, so
**set the `NTFY_CLOSING_TOPIC` secret to the current topic first**, otherwise closing alerts stop.
