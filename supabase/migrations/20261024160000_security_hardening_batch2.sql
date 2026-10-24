-- ════════════════════════════════════════════════════════════════
-- SECURITY HARDENING — BATCH 2 (applied to prod 2026-10-24, after the app side shipped in PR #21)
-- Project: wetbugzzchkghpzmowod. Idempotent: safe to re-run.
--
-- 1. attendance_locations: the public key could create/edit office locations (and so
--    the geofence/QR setup). Writes now need an allow-listed signed-in user. READS stay
--    open to the public key on purpose: the installed Android attendance app reads the
--    active location (incl. qr_secret) with it. Closing that needs a new APK.
-- 2. pdf-library storage bucket: was PUBLIC with list/upload/delete open to everyone.
--    Now private; only an allow-listed signed-in user can list/upload/delete, and the app
--    opens files through 5-minute signed URLs (js/pdf-library.js).
--
-- ROLLBACK:
--   create policy attendance_locations_insert on public.attendance_locations for insert to anon, authenticated with check (true);
--   create policy attendance_locations_update on public.attendance_locations for update to anon, authenticated using (true) with check (true);
--   update storage.buckets set public = true where id = 'pdf-library';
--   create policy bt_pdf_library_storage_select on storage.objects for select to public using (bucket_id = 'pdf-library');
--   create policy bt_pdf_library_storage_insert on storage.objects for insert to public with check (bucket_id = 'pdf-library');
--   create policy bt_pdf_library_storage_delete on storage.objects for delete to public using (bucket_id = 'pdf-library');
-- ════════════════════════════════════════════════════════════════

drop policy if exists attendance_locations_insert on public.attendance_locations;
drop policy if exists attendance_locations_update on public.attendance_locations;
drop policy if exists attendance_locations_insert_authorized on public.attendance_locations;
drop policy if exists attendance_locations_update_authorized on public.attendance_locations;
create policy attendance_locations_insert_authorized on public.attendance_locations
  for insert to authenticated with check (public.bt_is_authorized_user());
create policy attendance_locations_update_authorized on public.attendance_locations
  for update to authenticated using (public.bt_is_authorized_user()) with check (public.bt_is_authorized_user());

update storage.buckets set public = false where id = 'pdf-library';
drop policy if exists bt_pdf_library_storage_delete on storage.objects;
drop policy if exists bt_pdf_library_storage_insert on storage.objects;
drop policy if exists bt_pdf_library_storage_select on storage.objects;
drop policy if exists bt_pdf_library_authorized_select on storage.objects;
drop policy if exists bt_pdf_library_authorized_insert on storage.objects;
drop policy if exists bt_pdf_library_authorized_delete on storage.objects;
create policy bt_pdf_library_authorized_select on storage.objects
  for select to authenticated using (bucket_id = 'pdf-library' and public.bt_is_authorized_user());
create policy bt_pdf_library_authorized_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'pdf-library' and public.bt_is_authorized_user());
create policy bt_pdf_library_authorized_delete on storage.objects
  for delete to authenticated using (bucket_id = 'pdf-library' and public.bt_is_authorized_user());
