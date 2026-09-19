-- ══════════════════════════════════════════════════════════════════════
-- Manager check-in notifications via ntfy.sh (real push, not polling)
--
-- Complements (does not yet replace) ManagerNotifyService's 60-second
-- Android poller: this fires the moment a check-in row lands, works
-- identically on iPhone and Android, and survives OEM battery-killers
-- since it's real push infrastructure (APNs/FCM under the hood via
-- ntfy's own apps), not a foreground service this device has to keep
-- alive itself.
--
-- Uses pg_net (already installed on this project) to fire an async,
-- fire-and-forget HTTP call on every INSERT into attendance_events
-- where event_type = 'check_in'. Uses ntfy's JSON publish format
-- (POST to https://ntfy.sh/ root with a JSON body naming the topic),
-- documented at https://docs.ntfy.sh/publish/#publish-as-json.
--
-- SECURITY DEFINER is required here (not just convention, like the
-- manager-PIN function) -- without it, the trigger would run as
-- 'anon' (whoever's INSERT fired it), and anon has no USAGE grant on
-- the 'net' schema. Running as this function's owner sidesteps that.
--
-- IMPORTANT -- the ntfy topic is effectively a password (ntfy has no
-- sign-up; anyone who knows the topic name can subscribe and read
-- every notification, or publish fake ones). Never put your real
-- topic in a file committed to a public repo -- this file
-- deliberately ships a placeholder. Set the real one by running this
-- directly in the Supabase SQL editor (a long, random topic -- see
-- https://docs.ntfy.sh/publish/#picking-a-topic for a generator):
--   create or replace function attendance_notify_manager()
--   returns trigger language plpgsql security definer
--   set search_path = public, extensions, net as $INNER$
--   begin
--     if new.event_type = 'check_in' then
--       perform net.http_post(
--         url := 'https://ntfy.sh/',
--         body := jsonb_build_object(
--           'topic', '<your real random topic here>',
--           'title', 'Check-in',
--           'message', coalesce(new.staff_number, new.staff_id) || ' checked in',
--           'tags', jsonb_build_array('office')
--         )
--       );
--     end if;
--     return new;
--   end;
--   $INNER$;
-- ══════════════════════════════════════════════════════════════════════

create or replace function attendance_notify_manager()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
begin
  if new.event_type = 'check_in' then
    perform net.http_post(
      url := 'https://ntfy.sh/',
      body := jsonb_build_object(
        'topic', 'CHANGE-ME-set-a-real-random-topic-see-comment-above',
        'title', 'Check-in',
        'message', coalesce(new.staff_number, new.staff_id) || ' checked in',
        'tags', jsonb_build_array('office')
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_events_notify_manager on attendance_events;
create trigger attendance_events_notify_manager
after insert on attendance_events
for each row execute function attendance_notify_manager();
