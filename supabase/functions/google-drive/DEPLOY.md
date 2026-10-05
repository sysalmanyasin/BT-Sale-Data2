# google-drive

Versioned Google Drive backup / restore for the Closing App data (app-data folder, 30 versions kept).
Production: `verify_jwt` **on** (the public anon key passes it), and every action is additionally gated in code:
the Admin PIN from `settings.data.adminPin`, or (for `backup` only) the per-install `auto_key` used by the database trigger.

## Secrets
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Edge Function secrets, never in git). The Google refresh token is stored
server-side in table `google_drive_backup` and never sent to the browser. Related SQL (`google_drive_backup.sql`, functions
`admin_restore_backup`, `admin_set_drive_trigger`, trigger `drive_backup_on_shift_save`) lives in the Closing App project.

## Hardening ideas (not done)
- The Admin PIN check has **no attempt limit** and the endpoint is reachable with the public anon key, so a short PIN can be
  guessed. A successful guess allows `restore` (replaces all data), `disconnect` and `list_versions`. Add a per-IP/attempt
  counter or lock-out, and use a long PIN.
- Compare the PIN in constant time.

## Deploy
```bash
supabase functions deploy google-drive --project-ref wetbugzzchkghpzmowod
```
