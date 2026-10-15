# Android Ask Dua backend status

Ask Dua must not call `bt-agent` with model-proposed tools from Android:
`bt-agent` is a single model-step endpoint whose normal web client executes
tools locally, and it does not itself fetch the business records requested by
the question.

The Android endpoint must require a normal Supabase session JWT and an active
`bt_authorized_users` row, expose a fixed allowlist of read-only server-side
queries, and pass only bounded query results to the model. It must reject
unknown tools and all write/SQL/RPC execution requests server-side. The existing
widget-service account is not sufficient authorization for this endpoint.

This file documents the security boundary; it is not a deployed API. Do not
display fabricated business answers or imply a request succeeded until a
verified read-only execution path is deployed.
