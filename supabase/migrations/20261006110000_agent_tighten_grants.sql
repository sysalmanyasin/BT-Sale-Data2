-- BT Sales IC — AI agent: least-privilege table grants.
-- Supabase auto-grants every new public table to `authenticated`, which is wider than these tables need. Row-level
-- security already denied the extra operations (no matching policy), so this removes the privileges as well:
-- defence in depth, so a future policy mistake cannot silently open a write path.
-- Idempotent: REVOKE of a privilege that is not held is a no-op.
revoke delete                  on public.agent_audit     from authenticated;  -- append-only (+ undone_at column update)
revoke insert, update          on public.agent_knowledge from authenticated;  -- only the bt-agent function writes the index
revoke update, delete          on public.agent_messages  from authenticated;  -- immutable; removed only via conversation cascade
revoke update, delete          on public.agent_rules     from authenticated;  -- versions are never edited
revoke insert, delete          on public.agent_settings  from authenticated;  -- one fixed row, update-only
revoke insert, update, delete  on public.agent_usage     from authenticated;  -- written by the function; users only read their own
