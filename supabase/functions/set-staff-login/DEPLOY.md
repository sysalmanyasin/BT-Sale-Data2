# set-staff-login

Creates or resets a staff member's **Closing App** login (phone + 4-digit PIN). Called by the Staff Registry
("Set/Reset PIN", `js/manager-staff.js`) through `supabase.functions.invoke`, which sends the signed-in user's token.

## Security (changed 2026-10-05, v21)
Before v21 this function had `verify_jwt` off and **no check inside**: anyone who knew an internal staff id could set that
person's PIN and then log in to the Closing App as them. It now requires a valid Supabase session whose email is an
**active row in `bt_authorized_users`** (checked in code; `verify_jwt` stays off because the public anon key would pass it
anyway). Staff accounts (`<phone>@staff.internal`) are not in that table, so staff cannot reset PINs.

Verified after deploy: a call with no token returns 401 "Not signed in"; a call with only the public anon key returns 401
"Invalid session".

## Known limits (not fixed here)
- The PIN is 4 digits and the Closing App password is derived deterministically (`<pin>_<staffId>`), so a login can be
  brute-forced if someone knows a staff phone number. Consider a longer PIN and attempt limits in the Closing App.
- `bt_staff` is currently readable by the anon role (policy "anon can read staff for login lookup"), which exposes phone,
  CNIC and address. See the security notes in the project docs before changing it, because the Closing App login may depend on it.

## Deploy
```bash
supabase functions deploy set-staff-login --project-ref wetbugzzchkghpzmowod --no-verify-jwt
```
No extra secrets (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are automatic).
