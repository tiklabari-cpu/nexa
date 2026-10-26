-- The root panel's workspace actions (tm 389.10 · FR-ADMIN-09 · docs/platform-admin/design.md §C
-- workspaces).
--
-- Expand-only (CONVENTIONS §6.3): two nullable columns and a defaulted one,
-- a CHECK no existing row can fail (nothing is suspended through the platform
-- yet, so every row's new column is NULL), a re-created trigger that refuses
-- one column more, one new function and one grant. The code before this
-- migration reads none of it.

-- ---------------------------------------------------------------------------
-- 1. What a suspension interrupted
-- ---------------------------------------------------------------------------
-- Lifting a suspension puts the workspace back where it was: a trial resumes
-- as a trial (its end date untouched, so a trial that ran out meanwhile is
-- read-only again), a paid licence as paid. Without the column the platform
-- would have to guess from `trial_ends_at`, and a `past_due` or `read_only`
-- licence would come back `active` — the suspension would have paid its bill.
ALTER TABLE licenses ADD COLUMN suspended_from_status TEXT;

ALTER TABLE licenses ADD CONSTRAINT licenses_suspended_from_status_check
  CHECK (suspended_from_status IS NULL
         OR (status = 'suspended'
             AND suspended_from_status IN ('trialing', 'active', 'past_due', 'read_only', 'canceled')))
  NOT VALID;
ALTER TABLE licenses VALIDATE CONSTRAINT licenses_suspended_from_status_check;

-- The platform's alone, like the three suspension columns beside it
-- (20261101120000): the same trigger function, one column more.
DROP TRIGGER licenses_suspension_platform_only ON licenses;
CREATE TRIGGER licenses_suspension_platform_only
  BEFORE UPDATE OF status, suspended_at, suspended_reason, purge_scheduled_at,
    suspended_from_status ON licenses
  FOR EACH ROW
  WHEN ((OLD.status IS DISTINCT FROM NEW.status
         AND (OLD.status = 'suspended' OR NEW.status = 'suspended'))
        OR OLD.suspended_at IS DISTINCT FROM NEW.suspended_at
        OR OLD.suspended_reason IS DISTINCT FROM NEW.suspended_reason
        OR OLD.purge_scheduled_at IS DISTINCT FROM NEW.purge_scheduled_at
        OR OLD.suspended_from_status IS DISTINCT FROM NEW.suspended_from_status)
  EXECUTE FUNCTION licenses_reject_tenant_suspension();

DROP TRIGGER licenses_suspension_platform_only_insert ON licenses;
CREATE TRIGGER licenses_suspension_platform_only_insert
  BEFORE INSERT ON licenses
  FOR EACH ROW
  WHEN (NEW.status = 'suspended' OR NEW.suspended_at IS NOT NULL
        OR NEW.suspended_reason IS NOT NULL OR NEW.purge_scheduled_at IS NOT NULL
        OR NEW.suspended_from_status IS NOT NULL)
  EXECUTE FUNCTION licenses_reject_tenant_suspension();

-- ---------------------------------------------------------------------------
-- 2. Cancelling at the end of the period
-- ---------------------------------------------------------------------------
-- The flag the platform's "cancel subscription" sets and "resume" clears.
-- Nothing reads it at the period's end yet: the step that turns a flagged
-- subscription `canceled` is the owner-side task's (#384), which also adds the
-- owner's own cancellation and its reason. Until then the flag is a recorded
-- intent the panel shows, not a scheduled change.
ALTER TABLE subscriptions
  ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN canceled_at TIMESTAMPTZ(6);

-- ---------------------------------------------------------------------------
-- 3. The owner's verification link, from the platform
-- ---------------------------------------------------------------------------
-- "Resend the owner's verification e-mail" spends the earlier link and records
-- a new one exactly as the owner's own resend does — the same function, so
-- the two cannot drift apart.
GRANT EXECUTE ON FUNCTION auth_issue_email_verification(CITEXT, TEXT, TIMESTAMPTZ)
  TO siyahtus_platform;

-- ---------------------------------------------------------------------------
-- 4. The purge
-- ---------------------------------------------------------------------------
-- A workspace scheduled for deletion (`purge_scheduled_at`, set fourteen days
-- ahead by `POST /workspaces/{id}/delete`) is deleted once that moment has
-- passed, by the platform process's purge job, one workspace per call.
--
-- SECURITY DEFINER for the reason `purge_unverified_signups` (20261003190000)
-- gives: the licence's cascade has to remove its `audit_log` rows, which the
-- platform role may not delete (20261101090000 revokes it — the platform must
-- not be able to rewrite a trail). EXECUTE goes to the platform role alone;
-- the tenant API never calls it.
--
-- What goes, relying on the catalogue rather than a list (the reasoning of
-- `sandbox_reset`, 20260815200000): the licence row, and with it every table
-- that carries its foreign key — `ON DELETE CASCADE` throughout. Its sandbox,
-- a second tenant with an organization of its own, goes first, the same way.
-- `trusted_domains` is deleted by hand (it names the licence without a
-- cascade); `customers`, scoped to the organization, and the organization
-- itself go only when no other licence shares it. Accounts stay: an account
-- is a person who may belong to other workspaces, and erasing one is an
-- account action (389.11), not a side effect of deleting a workspace.
--
-- The schedule is asked again under the row lock, so a deletion cancelled a
-- moment ago is not carried out by a job that read the queue just before.
-- `NOWAIT` and `lock_timeout`: the purge never queues behind a request — a
-- row in use raises, the caller's transaction rolls back (its audit entry
-- with it) and the next pass tries again.
--
-- Returns one row when it purged — whether the organization went too, and
-- the sandbox licence that went with it — and none when nothing was due.
CREATE FUNCTION platform_purge_workspace(p_license BIGINT)
RETURNS TABLE (organization_deleted BOOLEAN, sandbox_license_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_license   licenses;
  v_sandbox   licenses;
  v_org_alone BOOLEAN;
BEGIN
  SELECT l.* INTO v_license FROM licenses l WHERE l.id = p_license FOR UPDATE NOWAIT;
  IF NOT FOUND OR v_license.purge_scheduled_at IS NULL OR v_license.purge_scheduled_at > now() THEN
    RETURN;
  END IF;

  SELECT s.* INTO v_sandbox FROM licenses s WHERE s.sandbox_of_license_id = p_license
    FOR UPDATE NOWAIT;
  IF FOUND THEN
    DELETE FROM licenses WHERE id = v_sandbox.id;
    DELETE FROM trusted_domains WHERE license_id = v_sandbox.id;
    IF NOT EXISTS (SELECT 1 FROM licenses x WHERE x.organization_id = v_sandbox.organization_id) THEN
      DELETE FROM customers WHERE organization_id = v_sandbox.organization_id;
      DELETE FROM trusted_domains WHERE organization_id = v_sandbox.organization_id;
      DELETE FROM organizations WHERE id = v_sandbox.organization_id;
    END IF;
  END IF;

  v_org_alone := NOT EXISTS (
    SELECT 1 FROM licenses x
     WHERE x.organization_id = v_license.organization_id AND x.id <> p_license);

  DELETE FROM licenses WHERE id = p_license;
  DELETE FROM trusted_domains WHERE license_id = p_license;
  IF v_org_alone THEN
    DELETE FROM customers WHERE organization_id = v_license.organization_id;
    DELETE FROM trusted_domains WHERE organization_id = v_license.organization_id;
    DELETE FROM organizations WHERE id = v_license.organization_id;
  END IF;

  RETURN QUERY SELECT v_org_alone, v_sandbox.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION platform_purge_workspace(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_purge_workspace(BIGINT) TO siyahtus_platform;
