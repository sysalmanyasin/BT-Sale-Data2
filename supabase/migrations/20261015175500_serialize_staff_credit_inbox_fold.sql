-- Serialize Staff Credit inbox folds so concurrent inserts cannot overwrite
-- each other's JSONB changes in bt_salesdata.payload.
CREATE OR REPLACE FUNCTION public.bt_fold_staff_credit_inbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_month text := to_char(NEW.entry_date, 'FMMonth YYYY');
  v_staff jsonb;
  v_rows jsonb;
  v_idx integer := -1;
  v_i integer := 0;
  v_row jsonb;
  v_entry jsonb := jsonb_build_object(
    'date', to_char(NEW.entry_date, 'YYYY-MM-DD'),
    'desc', coalesce(NEW.description, ''),
    'amount', NEW.amount,
    'source', NEW.source
  );
BEGIN
  -- Acquire the shared payload row lock before reading its month array.
  -- Under READ COMMITTED this makes concurrent folds read the latest committed row.
  PERFORM 1 FROM public.bt_salesdata WHERE id = 'main' FOR UPDATE;

  -- Staff IDs in the inbox are stable EMP-* IDs; bt_staff.id may be an
  -- internal emp_* key, so resolve the staff record by either identifier.
  SELECT data INTO v_staff
  FROM public.bt_staff
  WHERE id = NEW.staff_id OR data->>'staffId' = NEW.staff_id
  ORDER BY CASE WHEN data->>'staffId' = NEW.staff_id THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT payload #> ARRAY['manager', 'credit', v_month]
  INTO v_rows
  FROM public.bt_salesdata
  WHERE id = 'main';
  v_rows := coalesce(v_rows, '[]'::jsonb);

  FOR v_i IN 0 .. jsonb_array_length(v_rows) - 1 LOOP
    v_row := v_rows -> v_i;
    IF (v_row ->> 'staffId') = NEW.staff_id THEN
      v_idx := v_i;
      EXIT;
    END IF;
  END LOOP;

  IF v_idx = -1 THEN
    v_row := jsonb_build_object(
      'staffId', NEW.staff_id,
      'name', coalesce(v_staff ->> 'name', NEW.staff_id),
      'prevBal', 0,
      'entries', jsonb_build_array(v_entry),
      'salary', 0,
      'lessGeneric', 0
    );
    v_rows := v_rows || jsonb_build_array(v_row);
  ELSE
    v_row := jsonb_set(
      v_row,
      '{entries}',
      coalesce(v_row -> 'entries', '[]'::jsonb) || jsonb_build_array(v_entry)
    );
    v_rows := jsonb_set(v_rows, ARRAY[v_idx::text], v_row);
  END IF;

  UPDATE public.bt_salesdata
  SET payload = jsonb_set(
        coalesce(payload, '{}'::jsonb),
        ARRAY['manager', 'credit', v_month],
        v_rows
      ),
      updated_at = now()
  WHERE id = 'main';

  RETURN NEW;
END;
$function$;
