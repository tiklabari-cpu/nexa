-- The root panel's billing and usage (tm 389.12 · FR-ADMIN-12/13 ·
-- docs/platform-admin/design.md §C billing, usage · PLAN §D218).
--
-- Two things the panel needs from the tenant's tables:
--
--   1. **An end to an AI cap override.** `licenses.ai_daily_*_tokens_cap`
--      (20261015130000, tm 283.2) is the one place a workspace's own AI
--      allowance is set; a contract or a goodwill raise often has an end date,
--      so the override gets one. Past it, the workspace reads as if no override
--      were set (`services/ai/ai-caps.ts`); the column is the platform's alone,
--      like the caps it qualifies.
--   2. **Credits on the next statement.** `platform_credits` (20261101090000)
--      holds what an operator granted a workspace; the period-close sweep
--      (`invoice-close-sweep.ts`) now takes each open credit off the statement
--      it freezes, as a negative line of its own, in the transaction that
--      writes the statement. The sweep runs as `siyahtus_app`, which may not
--      read `platform_credits` at all, so the taking is one SECURITY DEFINER
--      function: it touches the caller's own workspace only, the statement it
--      is handed only, and never pushes a total below zero — whatever is left
--      of a credit waits for the next statement as a row of its own.
--
-- Expand-only (CONVENTIONS §6.3): three nullable columns, a CHECK widened (a
-- negative line is allowed exactly when it names the credit it applies), two
-- triggers replaced with supersets, one new function. The previous release
-- writes none of these columns and never calls the function; a statement it
-- freezes simply carries no credit.

-- --------------------------------------------------------------------------
-- 1. licenses — when the AI cap override lapses
-- --------------------------------------------------------------------------
-- NULL: until the platform changes it. Only meaningful beside an override; one
-- without an override is refused, so a stale date cannot silently apply to
-- the next override somebody sets.
ALTER TABLE licenses ADD COLUMN ai_daily_caps_expires_at TIMESTAMPTZ(6);

ALTER TABLE licenses ADD CONSTRAINT licenses_ai_daily_caps_expiry_check CHECK (
  ai_daily_caps_expires_at IS NULL
  OR ai_daily_llm_tokens_cap IS NOT NULL
  OR ai_daily_embedding_tokens_cap IS NOT NULL
) NOT VALID;
ALTER TABLE licenses VALIDATE CONSTRAINT licenses_ai_daily_caps_expiry_check;

-- The same rule as the caps: the tenant role may not move it. Both triggers
-- are replaced with the column added; the function they call is unchanged.
DROP TRIGGER licenses_ai_caps_platform_only ON licenses;
CREATE TRIGGER licenses_ai_caps_platform_only
  BEFORE UPDATE OF ai_daily_llm_tokens_cap, ai_daily_embedding_tokens_cap,
                   ai_daily_caps_expires_at ON licenses
  FOR EACH ROW
  WHEN (OLD.ai_daily_llm_tokens_cap IS DISTINCT FROM NEW.ai_daily_llm_tokens_cap
        OR OLD.ai_daily_embedding_tokens_cap IS DISTINCT FROM NEW.ai_daily_embedding_tokens_cap
        OR OLD.ai_daily_caps_expires_at IS DISTINCT FROM NEW.ai_daily_caps_expires_at)
  EXECUTE FUNCTION licenses_reject_tenant_ai_caps();

DROP TRIGGER licenses_ai_caps_platform_only_insert ON licenses;
CREATE TRIGGER licenses_ai_caps_platform_only_insert
  BEFORE INSERT ON licenses
  FOR EACH ROW
  WHEN (NEW.ai_daily_llm_tokens_cap IS NOT NULL OR NEW.ai_daily_embedding_tokens_cap IS NOT NULL
        OR NEW.ai_daily_caps_expires_at IS NOT NULL)
  EXECUTE FUNCTION licenses_reject_tenant_ai_caps();

-- --------------------------------------------------------------------------
-- 2. platform_credits — what is left of a credit
-- --------------------------------------------------------------------------
-- A credit larger than the statement it lands on is split: the row keeps the
-- part that was applied and names the statement, and the rest becomes a new
-- open row pointing back at it — so `SUM(amount_minor) WHERE invoice_id IS
-- NULL` is always the workspace's open balance, and the history of one grant
-- reads as a chain.
ALTER TABLE platform_credits ADD COLUMN remainder_of UUID;
ALTER TABLE platform_credits ADD CONSTRAINT platform_credits_remainder_of_fkey
  FOREIGN KEY (remainder_of) REFERENCES platform_credits(id) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX platform_credits_remainder_of_idx ON platform_credits(remainder_of);

-- --------------------------------------------------------------------------
-- 3. invoice_line_items — a credit line
-- --------------------------------------------------------------------------
-- 20260911100000 refused every negative line ("a credit is a refund by another
-- name"). The platform's credit is the deliberate exception (05 BL-03: no
-- refunds; a goodwill or annual-plan adjustment is a credit), and it is held
-- to one shape: a line below zero must name the credit it applies, and a line
-- naming a credit must be below zero. Every other line is as before.
ALTER TABLE invoice_line_items ADD COLUMN platform_credit_id UUID;
ALTER TABLE invoice_line_items ADD CONSTRAINT invoice_line_items_platform_credit_id_fkey
  FOREIGN KEY (platform_credit_id) REFERENCES platform_credits(id)
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX invoice_line_items_platform_credit_id_key
  ON invoice_line_items(platform_credit_id);

ALTER TABLE invoice_line_items DROP CONSTRAINT invoice_line_items_amount_check;
ALTER TABLE invoice_line_items ADD CONSTRAINT invoice_line_items_amount_check CHECK (
  CASE WHEN platform_credit_id IS NULL THEN amount_cents >= 0 ELSE amount_cents < 0 END
);

-- --------------------------------------------------------------------------
-- 4. billing_apply_platform_credits — the sweep's one call
-- --------------------------------------------------------------------------
-- Takes the caller's open credits, oldest first, off the statement
-- `p_invoice_id` until it owes nothing or the credits run out, and answers how
-- much it took. Inside the sweep's transaction, right after the statement and
-- its lines: the statement and its credit commit together or not at all.
--
--   - Only the workspace in the tenant context, only its own statement: a
--     statement of another workspace is "not found", exactly like a missing one.
--   - Idempotent: a statement that already carries a credit line takes nothing
--     more, so calling it twice is harmless.
--   - Concurrency: the statement row is locked first, then the credit rows
--     (`FOR UPDATE`, re-checked by Postgres after the wait), so two sweeps
--     racing for one credit cannot both apply it — the one that waited finds
--     it taken and skips it.
--   - A trial or pilot statement (`trial`, or a zero total) owes nothing and
--     takes nothing; a credit in another currency than the statement's is
--     left for one that matches.
CREATE FUNCTION billing_apply_platform_credits(p_invoice_id UUID)
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

  IF v_invoice.status <> 'paid' OR v_invoice.total_cents <= 0 THEN
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

REVOKE EXECUTE ON FUNCTION billing_apply_platform_credits(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_apply_platform_credits(UUID) TO siyahtus_app;
