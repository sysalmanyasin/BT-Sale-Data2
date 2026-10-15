# Android Quick Add and Ask Dua

The Android app includes two new launcher widgets—**Quick Add** (Jazz Cash, Add Credit, Add Expense shortcuts) and **Ask Dua**—plus the full **Quick Add / Ask Dua** screen. Both use the BT Sale Data Supabase project. Add them from Android Home screen → Widgets after installing the updated APK.

## Access and security

- Sign in with an individual Supabase Auth account whose email is active in `public.bt_authorized_users`.
- The existing widget-service account remains read-only and is not used for writes.
- The `android-assistant` Edge Function requires a JWT and independently checks the signed-in user's authorization before every action.
- Quick Add inserts into `bt_inbox_ledger` or `bt_inbox_staff_credit`. Existing database triggers fold those events into the shared payload. It never sends a replacement payload or invokes arbitrary SQL/RPC.
- Each submit uses a client UUID as the inbox primary key. The client keeps that ID across retries until it receives confirmation, so replaying the same request cannot add the same row twice.
- Ask Dua receives a bounded, server-selected subset of business records and invokes a configured server-side AI provider without tools. The Ask Dua branch has no write operation. If no AI provider responds, it returns an error without changing data.

## Build

Pushes affecting `android-widget/**` trigger **Build Closing Widget APK** in GitHub Actions. The workflow uploads `closing-widget-debug-apk` as an artifact when the build succeeds.

## Smoke test after installing

1. Open **Quick Add / Ask Dua** and sign in using an authorized staff account.
2. Add a small legitimate test entry only if you intend it to become part of the real ledger; verify it appears in the matching ledger and that the trigger folded it into the payload.
3. Try submitting the same request twice in a network-retry test; the inbox UUID primary key must prevent a second insert.
4. Ask Dua a question whose answer can be checked against current ledger/credit records.
5. Verify Ask Dua fails safely when no provider is configured or available and that the request does not alter business data.
6. Confirm all existing home-screen widgets still refresh and inventory search still opens.

No synthetic production transaction should be used for testing.
