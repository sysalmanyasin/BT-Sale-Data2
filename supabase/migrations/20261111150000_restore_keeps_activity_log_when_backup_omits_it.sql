-- Drive backups no longer include activity_log (it was ~80% of each file; free-plan egress).
-- Restore used to run `delete from activity_log` unconditionally, so restoring a log-less backup
-- would have wiped the live audit trail. Now the log is replaced ONLY when the backup carries one
-- (older backups do). Everything else about the restore is unchanged.
create or replace function public.admin_restore_backup(payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count_sheets int;
  v_count_cl int;
  v_count_del int;
  v_count_al int := 0;
begin
  if not is_authorized_user() then
    raise exception 'admin_restore_backup: caller is not an authorized owner' using errcode = '42501';
  end if;

  delete from sheets where true;
  delete from credit_ledger where true;
  delete from deleted_records where true;

  insert into sheets (key, date, shift, draft, data, updated_at)
  select
    key,
    coalesce(value->>'date', split_part(key,'_',1)),
    coalesce(value->>'shift', split_part(key,'_',2)),
    coalesce((value->>'draft')::boolean, false),
    value,
    case when value->>'savedAt' is not null
      then to_timestamp((value->>'savedAt')::bigint / 1000.0)
      else now()
    end
  from jsonb_each(coalesce(payload->'sheets', '{}'::jsonb)) as t(key, value);
  get diagnostics v_count_sheets = row_count;

  insert into credit_ledger (key, date, shift, data, saved_at, updated_at)
  select
    value->>'key', value->>'date', value->>'shift', value,
    case when value->>'savedAt' is not null then to_timestamp((value->>'savedAt')::bigint / 1000.0) else null end,
    case when value->>'savedAt' is not null then to_timestamp((value->>'savedAt')::bigint / 1000.0) else now() end
  from jsonb_array_elements(coalesce(payload->'creditLedger', '[]'::jsonb)) as value;
  get diagnostics v_count_cl = row_count;

  insert into deleted_records (key, deleted_at)
  select value->>'key', (value->>'deleted_at')::timestamptz
  from jsonb_array_elements(coalesce(payload->'deletedKeys', '[]'::jsonb)) as value;
  get diagnostics v_count_del = row_count;

  -- Activity log: only touched when the backup actually contains one.
  if jsonb_typeof(payload->'activityLog') = 'array' then
    delete from activity_log where true;
    insert into activity_log (ts, actor, key, action, changes)
    select (value->>'ts')::bigint, value->>'actor', value->>'key', value->>'action', value->'changes'
    from jsonb_array_elements(payload->'activityLog') as value;
    get diagnostics v_count_al = row_count;
  end if;

  update settings set data = coalesce(payload->'settings', '{}'::jsonb), updated_at = (extract(epoch from now())*1000)::bigint where id = 1;

  return jsonb_build_object(
    'sheets', v_count_sheets, 'creditLedger', v_count_cl,
    'deletedRecords', v_count_del, 'activityLog', v_count_al
  );
end;
$function$;
