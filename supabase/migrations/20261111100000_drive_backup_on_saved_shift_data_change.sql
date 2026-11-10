-- Re-run automatic Drive JSON snapshots when an already-finalized
-- shift's actual data changes, while ignoring metadata-only sync updates.
DROP TRIGGER IF EXISTS trg_drive_backup_on_shift_insert ON public.sheets;
DROP TRIGGER IF EXISTS trg_drive_backup_on_shift_update ON public.sheets;

CREATE TRIGGER trg_drive_backup_on_shift_insert
AFTER INSERT ON public.sheets
FOR EACH ROW
WHEN (NEW.draft = false)
EXECUTE FUNCTION public.drive_backup_on_shift_save();

CREATE TRIGGER trg_drive_backup_on_shift_update
AFTER UPDATE ON public.sheets
FOR EACH ROW
WHEN (
  NEW.draft = false
  AND (
    OLD.draft IS DISTINCT FROM false
    OR OLD.data IS DISTINCT FROM NEW.data
  )
)
EXECUTE FUNCTION public.drive_backup_on_shift_save();
