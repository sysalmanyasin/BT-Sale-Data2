-- Android Quick Add: narrow, owner-managed authorization and idempotency.
-- Does not grant the widget-service role any write access.
create table if not exists public.bt_mobile_write_authorized_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
alter table public.bt_mobile_write_authorized_users enable row level security;
revoke all on public.bt_mobile_write_authorized_users from anon, authenticated;
-- Deliberately no client policies: only the narrowly scoped SECURITY DEFINER
-- transaction function may consult this allowlist.
create table if not exists public.bt_mobile_transaction_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  destination text not null,
  created_at timestamptz not null default now(),
  result jsonb not null,
  primary key (user_id, request_id)
);
alter table public.bt_mobile_transaction_requests enable row level security;
revoke all on public.bt_mobile_transaction_requests from anon, authenticated;

-- Add approved user UUIDs explicitly after verifying their identity:
-- insert into public.bt_mobile_write_authorized_users(user_id)
-- select id from auth.users where email = 'verified-user@example.com';
-- Never authorize the widget-service account.
