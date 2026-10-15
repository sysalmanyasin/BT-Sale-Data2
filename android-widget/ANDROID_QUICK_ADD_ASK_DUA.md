# Quick Add and Ask Dua — implementation/deployment boundary

The current Android app authenticates its dashboard repositories as the
dedicated `widget-service@internal.duapharma` Supabase account. RLS grants
that account reads only. This identity must remain read-only.

The app's existing web AI path is different: a signed-in user session is
checked against `bt_authorized_users`; the browser executes the returned
agent tools against its own live application data. Calling `bt-agent` from
Android does not provide that local tool execution and is not a live-data
answer API.

The migration `20261015100000_android_quick_add_authorization.sql` creates a
separate owner-managed write allowlist and idempotency ledger, with no client
table grants. It does not by itself authorize a user or provide a transaction
RPC. The two backend README files define the remaining server boundaries.
Do not enable transaction UI against the read-only service token or claim Ask
Dua has live data until the server-side allowlisted execution path is deployed.

Manual deployment requirements:
1. Apply the migration to BT Sale Data's Supabase project only after reviewing it.
2. Add only individually verified user UUIDs to `bt_mobile_write_authorized_users`.
3. Implement and test the atomic transaction endpoint against current payload/category
   semantics, then deploy with JWT verification enabled.
4. Implement the read-only Ask Dua endpoint using fixed, approved query functions;
   validate every query server-side and prohibit write tools and arbitrary SQL.
5. Add Android sign-in/session storage for authorized human users. Never reuse
   the dashboard service account for writes or AI access.
