-- A closed period nobody paid for freezes as `open` (tm 431 · the 2026-11-06
-- audit's F13 · FR-MOD-10.3).
--
-- The sweep froze every closed period that was not a trial month as `paid`,
-- whether or not anything was paid: a workspace whose trial ended on the 10th
-- and that never paid got a `paid` statement for the month on the 1st, and
-- the root panel's revenue (`status = 'paid'`) counted it. The sweep now asks
-- whether the period was paid for (`periodPaid`, the same rule the open
-- estimate already used) and freezes `open` when it was not. `open` was
-- refused here because the only `open` invoice used to be the estimate, which
-- is never stored; a statement that is owed and unpaid is a different thing,
-- and the vocabulary already had the word for it.
--
-- Widening a CHECK is the safe direction (CONVENTIONS §6.3): the code before
-- this release never writes `open`, so it runs against either list. The table
-- holds one row per workspace per month, so validating it in place is cheap.
ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check CHECK (status IN ('paid', 'open', 'trial'));

-- The credit function took credits off `paid` statements only. Until now that
-- was the same as "every statement that owes something", since a trial month
-- was the only other kind. Keep that meaning: an unpaid statement still owes
-- its total, so an open credit comes off it like off any other. Without this a
-- credit would wait for the next paid statement and skip the one it was meant
-- for.
--
-- Same signature and result type; CREATE OR REPLACE keeps the OID, the owner,
-- SECURITY DEFINER, the grant to `siyahtus_app` and the revoke from PUBLIC.
-- The body is 20261105090000's with that one condition changed.
CREATE OR REPLACE FUNCTION billing_apply_platform_credits(p_invoice_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license  BIGINT := siyahtus_current_license();
  v_invoice  RECORD;
  v_credit   RECORD;
  v_left     BIGINT;
  v_take     BIGINT;
  v_position INTEGER;
  v_applied  BIGINT := 0;
BEGIN
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'billing_apply_platform_credits needs a tenant context' USING ERRCODE = '42501';
  END IF;

  SELECT id, license_id, status, currency, total_cents INTO v_invoice
    FROM invoices WHERE id = p_invoice_id AND license_id = v_license
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_apply_platform_credits: no such invoice' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.status NOT IN ('paid', 'open') OR v_invoice.total_cents <= 0 THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM invoice_line_items
              WHERE invoice_id = v_invoice.id AND platform_credit_id IS NOT NULL) THEN
    RETURN 0;
  END IF;

  v_left := v_invoice.total_cents;
  SELECT COALESCE(max(position), -1) INTO v_position
    FROM invoice_line_items WHERE invoice_id = v_invoice.id;

  FOR v_credit IN
    SELECT id, amount_minor FROM platform_credits
     WHERE license_id = v_license AND invoice_id IS NULL AND amount_minor > 0
       AND currency = upper(v_invoice.currency)
     ORDER BY created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_credit.amount_minor, v_left);

    IF v_take < v_credit.amount_minor THEN
      INSERT INTO platform_credits
        (id, license_id, amount_minor, currency, reason, admin_id, invoice_id, created_at, remainder_of)
      SELECT gen_random_uuid(), c.license_id, c.amount_minor - v_take, c.currency, c.reason,
             c.admin_id, NULL, c.created_at, c.id
        FROM platform_credits c WHERE c.id = v_credit.id;
    END IF;

    UPDATE platform_credits SET amount_minor = v_take, invoice_id = v_invoice.id
     WHERE id = v_credit.id;

    v_position := v_position + 1;
    INSERT INTO invoice_line_items
      (id, invoice_id, license_id, position, description, amount_cents, platform_credit_id)
    VALUES (gen_random_uuid(), v_invoice.id, v_license, v_position, 'Account credit',
            -v_take::integer, v_credit.id);

    v_left := v_left - v_take;
    v_applied := v_applied + v_take;
  END LOOP;

  IF v_applied > 0 THEN
    UPDATE invoices SET total_cents = total_cents - v_applied::integer WHERE id = v_invoice.id;
  END IF;
  RETURN v_applied;
END;
$$;
