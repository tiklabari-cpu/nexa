-- The owner cancels the subscription (tm 384 · BL-03): the reason, the period
-- end that turns the flag into a canceled subscription and a read-only
-- workspace, the export window after it and the deletion the retention sweep
-- carries out. `cancel_at_period_end` and `canceled_at` are 389.10's
-- (20261103090000); this adds what happens when the period ends.
--
-- Expand-only (CONVENTIONS §6.3): four nullable columns, CHECKs no existing row
-- can fail (every new column is NULL), three new functions and their grants.
-- The code before this migration reads none of it.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
-- `cancel_reason`  why the owner cancelled (`@siyahtus/types` CANCEL_REASONS);
--                  null for the platform's cancellation, which gives none.
-- `ended_at`       when the period ended and the subscription became
--                  `canceled`; the export window and the deletion count from it.
-- `export_until`   ended_at + 30 days: the workspace is read-only and
--                  exportable until then, closed (`licenses.status =
--                  'canceled'`) after.
-- `data_deletion_at` when the retention sweep deletes the workspace — the
--                  export window, or longer when the workspace chose a longer
--                  retention; null when it chose `unlimited` (kept).
ALTER TABLE subscriptions
  ADD COLUMN cancel_reason TEXT,
  ADD COLUMN ended_at TIMESTAMPTZ(6),
  ADD COLUMN export_until TIMESTAMPTZ(6),
  ADD COLUMN data_deletion_at TIMESTAMPTZ(6);

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_cancel_reason_check
  CHECK (cancel_reason IS NULL OR cancel_reason IN
    ('too_expensive', 'missing_features', 'switching_provider', 'not_using',
     'business_closed', 'other'))
  NOT VALID;
ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_cancel_reason_check;

-- The two dates after the end exist only once the subscription has ended.
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_cancellation_dates_check
  CHECK ((export_until IS NULL OR ended_at IS NOT NULL)
         AND (data_deletion_at IS NULL OR ended_at IS NOT NULL))
  NOT VALID;
ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_cancellation_dates_check;

-- ---------------------------------------------------------------------------
-- 2. Which workspaces the period-end step has to look at
-- ---------------------------------------------------------------------------
-- Run by the `invoice_close` job (the period-close pass) as `siyahtus_app`,
-- which sees no licence but its own: SECURITY DEFINER lists them, the step
-- itself then works under each workspace's row level security
-- (`subscription-cancel.ts`, which re-reads and decides).
--
-- Two kinds of row: a flagged subscription whose period has ended (to end
-- it), and an ended one whose export window has passed while the workspace is
-- still read-only (to close it). The period end of a subscription with no
-- term on file is the end of the UTC month it was cancelled in —
-- `cancellationTakesEffectAt` in `@siyahtus/types` says the same.
-- A sandbox never pays and is never listed; a suspended workspace is the
-- platform's to move.
CREATE FUNCTION subscription_cancel_due_tenants(p_now TIMESTAMPTZ)
RETURNS TABLE (license_id BIGINT, organization_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT s.license_id, l.organization_id
  FROM subscriptions s
  JOIN licenses l ON l.id = s.license_id
  WHERE l.sandbox_of_license_id IS NULL
    AND (
      (s.cancel_at_period_end
       AND s.status <> 'canceled'
       AND l.status NOT IN ('suspended', 'canceled')
       AND COALESCE(
             s.current_period_end,
             (date_trunc('month', s.canceled_at AT TIME ZONE 'UTC') + interval '1 month')
               AT TIME ZONE 'UTC'
           ) <= p_now)
      OR
      (s.status = 'canceled'
       AND s.export_until IS NOT NULL
       AND s.export_until <= p_now
       AND l.status = 'read_only')
    )
  ORDER BY s.license_id
  LIMIT 500;
$$;

-- ---------------------------------------------------------------------------
-- 3. The deletion
-- ---------------------------------------------------------------------------
-- The retention sweep (`retention.ts`, `RETENTION_ENABLED`) deletes a canceled
-- workspace once its `data_deletion_at` has passed, through the platform's own
-- purge (`platform_purge_workspace`, 20261103090000) — one definition of what
-- "delete a workspace" removes. That function acts on `purge_scheduled_at`,
-- which the tenant role may not write (`licenses_suspension_platform_only`),
-- so this one, SECURITY DEFINER, sets it and calls it in one step.
--
-- What keeps it from being a way to delete someone else's workspace: it reads
-- the real clock, never a caller's, and it purges only a workspace whose own
-- latest subscription — a row only that workspace (or the platform) can
-- write — says it ended and its deletion date has passed, with the workspace
-- still read-only or closed (a new purchase in between made it active again
-- and cleared the dates). Checked again under the licence's row lock; NOWAIT
-- as the platform purge does, so a busy row raises and the next pass retries.
CREATE FUNCTION subscription_cancel_purge_due()
RETURNS TABLE (license_id BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT l.id
  FROM licenses l
  JOIN LATERAL (
    SELECT s.status, s.data_deletion_at
    FROM subscriptions s
    WHERE s.license_id = l.id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) latest ON true
  WHERE l.sandbox_of_license_id IS NULL
    AND l.status IN ('read_only', 'canceled')
    AND latest.status = 'canceled'
    AND latest.data_deletion_at IS NOT NULL
    AND latest.data_deletion_at <= now()
  ORDER BY l.id
  LIMIT 100;
$$;

CREATE FUNCTION subscription_cancel_purge(p_license BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_status   TEXT;
  v_sandbox  BIGINT;
  v_sub      RECORD;
  v_purged   BOOLEAN;
BEGIN
  SELECT l.status, l.sandbox_of_license_id INTO v_status, v_sandbox
    FROM licenses l WHERE l.id = p_license FOR UPDATE NOWAIT;
  IF NOT FOUND OR v_sandbox IS NOT NULL OR v_status NOT IN ('read_only', 'canceled') THEN
    RETURN false;
  END IF;

  SELECT s.status, s.data_deletion_at INTO v_sub
    FROM subscriptions s
    WHERE s.license_id = p_license
    ORDER BY s.created_at DESC
    LIMIT 1;
  IF NOT FOUND OR v_sub.status <> 'canceled' OR v_sub.data_deletion_at IS NULL
     OR v_sub.data_deletion_at > now() THEN
    RETURN false;
  END IF;

  UPDATE licenses SET purge_scheduled_at = now() WHERE id = p_license;
  SELECT count(*) > 0 INTO v_purged FROM platform_purge_workspace(p_license);
  RETURN v_purged;
END;
$$;

REVOKE EXECUTE ON FUNCTION subscription_cancel_due_tenants(TIMESTAMPTZ),
  subscription_cancel_purge_due(), subscription_cancel_purge(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscription_cancel_due_tenants(TIMESTAMPTZ),
  subscription_cancel_purge_due(), subscription_cancel_purge(BIGINT) TO siyahtus_app;
