-- Copy every closing PDF stored in the private `closing-pdfs` bucket to the
-- Google Drive "Closing Backups" folder, server-side.
--
-- Why: the browser used to push the PDF to Drive itself, which only works for
-- a linked, active staff session (google-drive `backup_pdf`). Closings saved by
-- anyone else (e.g. the Admin PIN login) produced the Storage PDF but no Drive
-- copy, with only a console.warn. This trigger calls the google-drive
-- `backup_pdf_stored` action with the install's auto key, so it no longer
-- depends on who closed the shift. Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.drive_pdf_on_storage_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net'
AS $function$
declare
  v_auto_key text;
begin
  if new.bucket_id is distinct from 'closing-pdfs' or new.name !~ '^[A-Za-z0-9_.-]+\.pdf$' then
    return new;
  end if;

  select auto_key into v_auto_key from google_drive_backup where id = 1;
  if v_auto_key is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://wetbugzzchkghpzmowod.supabase.co/functions/v1/google-drive',
    body := jsonb_build_object(
      'action', 'backup_pdf_stored',
      'autoKey', v_auto_key,
      'fileKey', regexp_replace(new.name, '\.pdf$', '')
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM'
    ),
    timeout_milliseconds := 30000
  );
  return new;
exception when others then
  -- never block a PDF upload because the Drive hand-off failed
  raise warning 'drive_pdf_on_storage_upload failed: %', sqlerrm;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_drive_pdf_on_closing_pdf_upload ON storage.objects;
CREATE TRIGGER trg_drive_pdf_on_closing_pdf_upload
  AFTER INSERT OR UPDATE OF name, metadata ON storage.objects
  FOR EACH ROW
  WHEN (NEW.bucket_id = 'closing-pdfs')
  EXECUTE FUNCTION public.drive_pdf_on_storage_upload();
