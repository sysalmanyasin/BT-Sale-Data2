-- Security hardening: remove the documented temporary manager PIN if it is
-- still configured. The original attendance_manager_pin migration seeded
-- CHANGE-ME-0000, which is publicly known and must never remain a valid
-- manager credential.
--
-- Safe for installations that already replaced the temporary PIN: the
-- row is deleted only when its current bcrypt hash verifies against that
-- exact temporary value. If the row is absent, this is a no-op. Managers
-- must configure a real PIN before manager-mode verification can succeed.
delete from public.attendance_manager_pin
where id = true
  and pin_hash = extensions.crypt('CHANGE-ME-0000', pin_hash);
