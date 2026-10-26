-- The root panel's account actions (tm 389.11 · FR-ADMIN-11 · docs/platform-admin/design.md §C
-- accounts).
--
-- Expand-only (CONVENTIONS §6.3): two nullable columns, a CHECK no existing row
-- can fail (both columns are NULL everywhere), a trigger that refuses the
-- tenant role a change to them, two new functions and one grant. The code
-- before this migration reads none of it.

-- ---------------------------------------------------------------------------
-- 1. A suspension of the person, not of a workspace
-- ---------------------------------------------------------------------------
-- `licenses.suspended_at` (20261101120000) closes one workspace for everybody
-- in it. This closes one account in every workspace it belongs to: the
-- password stops opening a session, every token it holds stops resolving, the
-- realtime gateway refuses its socket. Its memberships are untouched — lifting
-- the suspension puts the person back exactly where they were. The reason is
-- the operator's, kept for the panel and shown to nobody else.
ALTER TABLE accounts
  ADD COLUMN platform_suspended_at TIMESTAMPTZ(6),
  ADD COLUMN platform_suspended_reason TEXT;

ALTER TABLE accounts ADD CONSTRAINT accounts_platform_suspended_reason_check
  CHECK (platform_suspended_reason IS NULL OR platform_suspended_at IS NOT NULL)
  NOT VALID;
ALTER TABLE accounts VALIDATE CONSTRAINT accounts_platform_suspended_reason_check;

-- The platform's alone. `accounts_update` lets a workspace update its members'
-- profiles; that must not include lifting a suspension SiyahTuş set. The
-- rule `licenses_reject_tenant_suspension` holds for the licence columns,
-- with its own message.
CREATE FUNCTION accounts_reject_tenant_platform_suspension()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'siyahtus_app' THEN
    RAISE EXCEPTION 'an account''s suspension is set and lifted by the platform, not by a workspace'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_platform_suspension_platform_only
  BEFORE UPDATE OF platform_suspended_at, platform_suspended_reason ON accounts
  FOR EACH ROW
  WHEN (OLD.platform_suspended_at IS DISTINCT FROM NEW.platform_suspended_at
        OR OLD.platform_suspended_reason IS DISTINCT FROM NEW.platform_suspended_reason)
  EXECUTE FUNCTION accounts_reject_tenant_platform_suspension();

-- Whether the account is suspended — one primary-key read, asked by the
-- tenant API where a password becomes a session (`authenticateAccount`) and
-- where a code or a refresh token becomes one (`#issueGrant`). SECURITY
-- DEFINER because both run before any tenant context exists, where row level
-- security would hide the row and the answer would always be "no". A token's
-- resolution does not call this: it reads the column through the membership
-- statement it already runs, inside the tenant, where the row is visible.
CREATE FUNCTION auth_account_suspended(p_account UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT a.platform_suspended_at IS NOT NULL FROM accounts a WHERE a.id = p_account),
    false);
$$;

REVOKE EXECUTE ON FUNCTION auth_account_suspended(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_account_suspended(UUID) TO siyahtus_app;

-- ---------------------------------------------------------------------------
-- 2. A forced password reset, from the platform
-- ---------------------------------------------------------------------------
-- The link is recorded exactly as the person's own "forgot password" records
-- it (spending any earlier one) — the same function, so the two cannot drift.
GRANT EXECUTE ON FUNCTION auth_request_password_reset(CITEXT, TEXT, TIMESTAMPTZ)
  TO siyahtus_platform;

-- ---------------------------------------------------------------------------
-- 3. Erasure
-- ---------------------------------------------------------------------------
-- The account row, and with it every table that carries its foreign key —
-- memberships, groups, schedules, refresh tokens, the second factor and its
-- recovery codes, reset and verification links — `ON DELETE CASCADE`
-- throughout (`invitations.pending_account_id` is `SET NULL`). `api_tokens`
-- names its holder by no foreign key (`owner_id` is text, because a bot holds
-- tokens too), so a person's own tokens are deleted by hand; a SCIM token,
-- whose `owner_id` is merely the admin who minted the workspace's connector,
-- and a bot's stay. What the account wrote inside a workspace — messages,
-- notes, audit entries — names it by id only and stays with the workspace.
--
-- SECURITY DEFINER for the reason `platform_purge_workspace` (20261103090000)
-- gives: the cascade reaches `account_two_factor` and its recovery codes,
-- which the platform role may not delete (20261101090000). EXECUTE goes to the
-- platform role alone; the tenant API never calls it.
--
-- Refused while the account is the Founder of any workspace that is not a
-- sandbox: the workspace would be left with nobody able to hold it (the
-- single-owner rule). The caller checks first and answers 409 with the
-- workspaces' numbers; this is the same rule under the row lock, for the
-- request that changed the answer in between. A sandbox's owner is its
-- parent's member and the parent's Founder can reset it, so it does not count.
--
-- Returns the licences the account was a member of (the caller has written
-- each one's trail already, in the same transaction), or NULL when there was
-- no such account.
CREATE FUNCTION platform_erase_account(p_account UUID)
RETURNS BIGINT[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_licenses BIGINT[];
BEGIN
  PERFORM 1 FROM accounts a WHERE a.id = p_account FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM agent_memberships m
      JOIN licenses l ON l.id = m.license_id
     WHERE m.agent_id = p_account AND m.role = 'owner' AND l.sandbox_of_license_id IS NULL
  ) THEN
    RAISE EXCEPTION 'platform_erase_account: % is the Founder of a workspace', p_account
      USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(array_agg(m.license_id ORDER BY m.license_id), ARRAY[]::BIGINT[])
    INTO v_licenses
    FROM agent_memberships m WHERE m.agent_id = p_account;

  DELETE FROM api_tokens t
   WHERE t.owner_id = p_account::text AND t.kind IN ('pat', 'oauth', 'enrollment', 'impersonation');
  DELETE FROM accounts a WHERE a.id = p_account;

  RETURN v_licenses;
END;
$$;

REVOKE EXECUTE ON FUNCTION platform_erase_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_erase_account(UUID) TO siyahtus_platform;
