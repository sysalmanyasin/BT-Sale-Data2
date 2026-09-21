-- ══════════════════════════════════════════════════════════════════════
-- ntfy notifications: add check-out, and actually resolve a name
--
-- Two fixes to attendance_notify_manager() bundled together since they
-- touch the same function:
--
-- 1. CHECK-OUT NOTIFICATIONS. The original version only fired on
--    check_in -- a manager got pinged when someone arrived but never
--    when they left.
--
-- 2. NAME RESOLUTION. The original version's message was always
--    coalesce(new.staff_number, new.staff_id) -- i.e. always showed
--    "EMP-001 checked in", never a real name. Name resolution used to
--    happen in the now-deleted Kotlin ManagerNotifyService
--    (AttendanceApi.fetchStaffNames), which had nothing to do with
--    this trigger at all -- so removing that Android poller (see the
--    "strip the duplicate poller" migration) left ntfy's notifications
--    with NO name resolution whatsoever. This fixes that by doing the
--    lookup right here in SQL: joins to attendance_devices.staff_name
--    (populated by GeofenceHelper.registerFromServer on every staff
--    phone, and to a lesser extent whichever iPhone Shortcuts/
--    MacroDroid automation last upserted a name there, if any --
--    falls back to the bare staff_number/staff_id if no device row
--    has a name on file, exactly like the original behavior).
-- ══════════════════════════════════════════════════════════════════════

create or replace function attendance_notify_manager()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  resolved_name text;
  label text;
begin
  if new.event_type not in ('check_in', 'check_out') then
    return new;
  end if;

  select staff_name into resolved_name
  from attendance_devices
  where staff_name is not null
    and (staff_id = new.staff_id or staff_number = new.staff_number)
  order by last_seen_at desc nulls last
  limit 1;

  label := coalesce(resolved_name, new.staff_number, new.staff_id);

  perform net.http_post(
    url := 'https://ntfy.sh/',
    body := jsonb_build_object(
      'topic', 'CHANGE-ME-set-a-real-random-topic-see-comment-above',
      'title', case new.event_type when 'check_in' then 'Check-in' else 'Check-out' end,
      'message', label || ' ' || (case new.event_type when 'check_in' then 'checked in' else 'checked out' end),
      'tags', jsonb_build_array(case new.event_type when 'check_in' then 'office' else 'door' end)
    )
  );
  return new;
end;
$$;
