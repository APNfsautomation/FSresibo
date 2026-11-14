-- FSResibo v3.8.1 / Issue #64: My Receipt On Hold.
-- UAT-FIRST, requires separate explicit authorization to apply to a hosted database.
-- Additive only: existing rows become NOT held, all existing receipt data/statuses are preserved.
-- Do not apply to Monthly Filing; it is an independent workflow.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS is_on_hold boolean NOT NULL DEFAULT false;

-- Consumed receipts must never carry a Hold. Protects even raw REST/SQL clients.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.receipts'::regclass
      AND conname = 'receipts_hold_requires_available_check'
  ) THEN
    ALTER TABLE public.receipts ADD CONSTRAINT receipts_hold_requires_available_check
      CHECK (status = 'available' OR is_on_hold = false);
  END IF;
END
$$;

-- A malicious client cannot bypass an existing hold by simultaneously changing
-- is_on_hold=false AND status=consumed in one UPDATE. Release Hold first.
CREATE OR REPLACE FUNCTION public.prevent_held_receipt_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF old.status = 'available' AND old.is_on_hold AND new.status = 'consumed' THEN
    RAISE EXCEPTION 'Release Hold before consuming this receipt'
      USING ERRCODE = '23514';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS receipts_prevent_held_consumption ON public.receipts;
CREATE TRIGGER receipts_prevent_held_consumption
  BEFORE UPDATE OF status, is_on_hold ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_held_receipt_consumption();

REVOKE ALL ON FUNCTION public.prevent_held_receipt_consumption() FROM PUBLIC, anon, authenticated;

-- Replace the previous multi-row REST UPDATE with an atomic exact-set operation.
-- Runs with the signed-in user's normal RLS privileges (never SECURITY DEFINER).
-- Locks every eligible row so concurrent Hold/status updates cannot slip between
-- verification and consumption. Missing, cross-account, held, or already Consumed
-- receipts make the ENTIRE batch fail; no partial Consumed changes are committed.
CREATE OR REPLACE FUNCTION public.consume_receipts_available_unheld(p_ids uuid[])
RETURNS SETOF public.receipts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  requested_ids uuid[];
  requested_count integer;
  eligible_count integer;
  changed_count integer := 0;
  changed_record public.receipts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT array_agg(DISTINCT requested.id), count(DISTINCT requested.id)
    INTO requested_ids, requested_count
  FROM unnest(p_ids) AS requested(id)
  WHERE requested.id IS NOT NULL;

  IF requested_count IS NULL OR requested_count = 0 THEN
    RAISE EXCEPTION 'At least one receipt is required';
  END IF;

  SELECT count(*) INTO eligible_count
  FROM (
    SELECT r.id FROM public.receipts AS r
    WHERE r.id = ANY(requested_ids)
      AND r.user_id = auth.uid()
      AND r.status = 'available'
      AND r.is_on_hold = false
    FOR UPDATE
  ) AS locked_rows;

  IF eligible_count <> requested_count THEN
    RAISE EXCEPTION 'Every receipt must be owned, Available and not On Hold';
  END IF;

  FOR changed_record IN
    UPDATE public.receipts
      SET status = 'consumed'
    WHERE id = ANY(requested_ids)
      AND user_id = auth.uid()
      AND status = 'available'
      AND is_on_hold = false
    RETURNING *
  LOOP
    changed_count := changed_count + 1;
    RETURN NEXT changed_record;
  END LOOP;

  IF changed_count <> requested_count THEN
    RAISE EXCEPTION 'Receipt consumption integrity check failed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_receipts_available_unheld(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_receipts_available_unheld(uuid[]) TO authenticated;

-- RLS and existing owner-scoped receipt policies remain unchanged.
-- UAT rollback, only after quarantining newly written hold values and verifying:
-- DROP FUNCTION IF EXISTS public.consume_receipts_available_unheld(uuid[]);
-- DROP TRIGGER IF EXISTS receipts_prevent_held_consumption ON public.receipts;
-- DROP FUNCTION IF EXISTS public.prevent_held_receipt_consumption();
-- ALTER TABLE public.receipts DROP CONSTRAINT IF EXISTS receipts_hold_requires_available_check;
-- ALTER TABLE public.receipts DROP COLUMN IF EXISTS is_on_hold;
