# Android Quick Add backend status

This endpoint is intentionally not enabled by this README alone. Android's
read-only widget-service identity must never be used for writes. The production
write endpoint must accept a normal Supabase user session JWT, check the
user's UUID against `bt_mobile_write_authorized_users` on every request, and
perform the payload mutation atomically against the current `bt_salesdata`
row. The companion migration creates a private allowlist and idempotency
ledger, but does not grant any write access to anon/authenticated clients.

Before deployment, implement and test the transaction RPC/Edge Function
against the deployed payload and category conventions, then deploy with JWT
verification enabled. Do not treat this scaffold as a live write endpoint.
