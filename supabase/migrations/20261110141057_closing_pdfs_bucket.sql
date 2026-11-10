-- Private storage bucket for Closing shift PDFs (initial 5 MiB limit).
-- The following migration raises the limit to 10 MiB.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('closing-pdfs', 'closing-pdfs', false, 5242880, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['application/pdf'];

drop policy if exists "staff select closing pdfs" on storage.objects;
create policy "staff select closing pdfs"
on storage.objects for select to authenticated
using (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()));

drop policy if exists "staff insert closing pdfs" on storage.objects;
create policy "staff insert closing pdfs"
on storage.objects for insert to authenticated
with check (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()));

drop policy if exists "staff update closing pdfs" on storage.objects;
create policy "staff update closing pdfs"
on storage.objects for update to authenticated
using (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()))
with check (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()));

drop policy if exists "staff delete closing pdfs" on storage.objects;
create policy "staff delete closing pdfs"
on storage.objects for delete to authenticated
using (bucket_id = 'closing-pdfs' and public.is_active_staff(auth.uid()));
