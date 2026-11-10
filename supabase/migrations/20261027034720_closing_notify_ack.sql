-- Closing shift notification acknowledgement + ntfy trigger.
-- The old production trigger embedded its bearer secret in the function body.
-- On first run, move that value into Supabase Vault without exposing it in Git.
-- Fresh projects must provision vault secret closing_notify_shared_secret first.

create table if not exists public.closing_notify_log (
  id          bigserial primary key,
  sheet_key   text        not null,
  request_id  bigint      not null,
  created_at  timestamptz not null default now()
);
create index if not exists closing_notify_log_key_idx
  on public.closing_notify_log (sheet_key, id desc);
alter table public.closing_notify_log enable row level security;

do $vault_migration$
declare
  v_definition text;
  v_secret text;
  v_secret_id uuid;
begin
  select id into v_secret_id
  from vault.secrets
  where name = 'closing_notify_shared_secret'
  limit 1;

  if v_secret_id is null then
    select pg_get_functiondef('public.notify_admin_shift_saved()'::regprocedure)
      into v_definition;

    select (regexp_match(
      v_definition,
      $re$'Authorization'\s*,\s*'Bearer\s+([^']+)'$re$
    ))[1] into v_secret;

    if coalesce(v_secret, '') = '' then
      raise exception 'Provision Vault secret closing_notify_shared_secret before applying this migration';
    end if;

    perform vault.create_secret(
      v_secret,
      'closing_notify_shared_secret',
      'Bearer shared secret for closing-ntfy-notify Edge Function',
      null
    );
  end if;
end;
$vault_migration$;

create or replace function public.notify_admin_shift_saved()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'net', 'vault', 'pg_temp'
as $function$
declare
  v_req bigint;
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'closing_notify_shared_secret'
  limit 1;

  if coalesce(v_secret, '') = '' then
    raise exception 'Vault secret closing_notify_shared_secret is not configured';
  end if;

  v_req := net.http_post(
    url := 'https://wetbugzzchkghpzmowod.functions.supabase.co/closing-ntfy-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'key', new.key,
      'date', new.date,
      'shift', new.shift,
      'data', new.data
    )
  );

  insert into public.closing_notify_log (sheet_key, request_id)
  values (new.key, v_req);

  return new;
end;
$function$;

create or replace function public.closing_notify_status(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare
  l public.closing_notify_log%rowtype;
  r record;
begin
  select * into l
  from public.closing_notify_log
  where sheet_key = p_key
  order by id desc
  limit 1;

  if not found then
    return jsonb_build_object('log_id', 0);
  end if;

  select status_code, error_msg into r
  from net._http_response
  where id = l.request_id;

  return jsonb_build_object(
    'log_id', l.id,
    'status_code', r.status_code,
    'ok', coalesce(r.status_code between 200 and 299, false),
    'error', r.error_msg
  );
end;
$function$;

revoke all on function public.notify_admin_shift_saved() from public;
revoke all on function public.closing_notify_status(text) from public;
grant execute on function public.closing_notify_status(text) to authenticated;

drop trigger if exists trg_notify_admin_shift_saved_ins on public.sheets;
create trigger trg_notify_admin_shift_saved_ins
after insert on public.sheets
for each row when (new.draft = false)
execute function public.notify_admin_shift_saved();

drop trigger if exists trg_notify_admin_shift_saved_upd on public.sheets;
create trigger trg_notify_admin_shift_saved_upd
after update on public.sheets
for each row when ((new.draft = false) and (old.data is distinct from new.data))
execute function public.notify_admin_shift_saved();
