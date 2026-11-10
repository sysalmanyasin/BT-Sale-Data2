# closing-ntfy-notify

Production Edge Function for the Closing app. The deployed production source (v13: adds the signed "Open PDF" link via `closing-pdf`) matches `supabase/functions/closing-ntfy-notify/index.ts`.

## Required Supabase Edge Function secrets
- `NOTIFY_SHARED_SECRET`: must match the Bearer token sent by the database trigger.
- `NTFY_CLOSING_TOPIC`: private ntfy topic name; never commit it.
- `NTFY_TOKEN`: optional ntfy.sh account token. Set this when using an authenticated ntfy account to avoid shared-IP rate limits.
- `NTFY_VARIANCE_ALERT`: optional variance threshold in PKR; defaults to 500.

Set secrets in Supabase Dashboard → Edge Functions → Secrets. The function fails closed if the shared secret or topic is missing.

## Database objects
The corresponding database objects are version-controlled under `supabase/migrations/`:
- `20261027034720_closing_notify_ack.sql`
- `20261110141057_closing_pdfs_bucket.sql`
- `20261110174920_grant_execute_is_active_staff_to_authenticated.sql`
- `20261110182339_increase_closing_pdf_bucket_limit_to_10_mib.sql`

These versions are already recorded as applied in the production Supabase migration history. They are kept as immutable history; do not edit or replay them. Add a new timestamped migration for every future SQL change.

## Deployment safety
The `.github/workflows/supabase-deploy.yml` workflow deploys changed Edge Function folders from this repository. It only considers newly added migration files, rejects edits/deletions of historical migrations, and skips any migration version already recorded by Supabase.

Do not deploy a local/older copy of this function over production. Update the tracked source first, review it, then deploy through the repository workflow.

## PDF link
The notification links to the `closing-pdf` function (`supabase/functions/closing-pdf/index.ts`, `verify_jwt = false` in `config.toml`). The link is `?key=<sheet key>&sig=<HMAC-SHA256(key, NOTIFY_SHARED_SECRET)>` and is resolved at tap time to a fresh 5-minute signed URL for `closing-pdfs/<key>.pdf`, so it works even though the app uploads the PDF a few seconds after the notification fires. Both functions need `NOTIFY_SHARED_SECRET`; `closing-pdf` also uses the built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Deploy both together.
