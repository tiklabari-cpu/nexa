-- Two-factor enrollment: the access path the endpoints in `routes/auth.ts` use
-- (NFR-S11 · FR-MOD-00.1 · S11-2FA-d, Faz-5 tm 152.4).
--
-- 20260826150000_two_factor_auth gave `account_two_factor` row level security
-- with *no permissive policy*, the `password_reset_tokens` shape: an ordinary
-- query by `nexa_app` sees nothing and writes nothing. 20260826170000 opened the
-- three functions the recovery-code sheet needs. These six are the rest of the
-- surface — enroll, read, activate, spend a step, disable, and the one question
-- that spans licences ("does any workspace this person belongs to insist on a
-- second factor").
--
-- No table is altered, so Prisma sees no change and `db:check-drift` stays
-- quiet, exactly as for 20260826170000.
--
-- Two rules hold throughout:
--
--   **State transitions are conditional UPDATEs, not read-then-write.** Every
--   function below decides in one statement whether it is allowed to act, so
--   two concurrent requests cannot both believe they won. `RETURNING true INTO`
--   with a NULL check is how each reports which way it went.
--
--   **`agent_memberships.two_factor_enabled` is derived, never authoritative.**
--   PRD §8.4 puts the flag on the membership, but the fact lives on the account
--   (`account_two_factor.activated_at`), and one person may hold memberships in
--   several licences. Activation and removal therefore rewrite *every* one of
--   the account's membership rows, here, inside the same function that changes
--   the fact — so the copy cannot drift from what it copies.
--
-- Naming: output columns are named apart from the table columns they carry
-- (`totp_secret`, not `secret`). `RETURNS TABLE (...)` declares a name per
-- output column, and 20260724094000_lifecycle_unambiguous_outputs is the record
-- of what a collision costs — 42702 "column reference is ambiguous", raised only
-- on the branch that runs.

-- ---------------------------------------------------------------------------
-- Begin (or restart) enrollment
-- ---------------------------------------------------------------------------
--
-- A half-finished enrollment must never become a lock. Somebody who closes the
-- tab before typing the first code, or who loses the phone between the two
-- steps, calls this again and gets a fresh secret; the abandoned one is
-- overwritten rather than standing in the way.
--
-- An *activated* row is a different matter and is refused (`false`). Replacing
-- a live second factor without proving anything would let a stolen session swap
-- the authenticator out from under its owner — silently, since the victim's app
-- would simply start being rejected. Turning 2FA off first is a step that costs
-- a password (`auth_two_factor_disable`'s caller), and that is the point.
--
-- The refusal and the write are one statement: the `WHERE` on `DO UPDATE` is
-- evaluated against the row as it is at that instant, so an activation racing
-- this call wins and the enrollment is refused, rather than both proceeding.
--
-- Any recovery sheet issued during the abandoned attempt goes with the secret
-- it belonged to — deleted only *after* the write is known to have happened, so
-- a refused call leaves an active account's sheet untouched.
CREATE FUNCTION auth_two_factor_begin_enrollment(
  p_account_id UUID,
  p_secret     TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_written BOOLEAN;
BEGIN
  INSERT INTO account_two_factor (account_id, secret)
  VALUES (p_account_id, p_secret)
  ON CONFLICT (account_id) DO UPDATE
     SET secret         = EXCLUDED.secret,
         activated_at   = NULL,
         last_used_step = NULL,
         created_at     = now()
   WHERE account_two_factor.activated_at IS NULL
  RETURNING true INTO v_written;

  IF v_written IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM two_factor_recovery_codes c WHERE c.account_id = p_account_id;
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Read the enrollment
-- ---------------------------------------------------------------------------
--
-- Returns no row at all when the account has never enrolled, which is the
-- state the caller has to tell apart from "enrolled but not yet activated".
--
-- The secret comes back in the clear because verifying a code requires it (see
-- 20260826150000 on why it is not hashed and not encrypted). Nothing outside
-- `TwoFactorService` may call this, and nothing may put the value in a response
-- body except the enrollment endpoint, which is showing the caller their own
-- freshly minted secret.
CREATE FUNCTION auth_two_factor_state(p_account_id UUID)
RETURNS TABLE (
  totp_secret     TEXT,
  activated       TIMESTAMPTZ,
  used_step       BIGINT,
  codes_remaining INT
)
LANGUAGE sql SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT t.secret,
         t.activated_at,
         t.last_used_step,
         (SELECT count(*)::INT FROM two_factor_recovery_codes c
           WHERE c.account_id = p_account_id AND c.used_at IS NULL)
    FROM account_two_factor t
   WHERE t.account_id = p_account_id;
$$;

-- ---------------------------------------------------------------------------
-- Activate
-- ---------------------------------------------------------------------------
--
-- The caller has already verified a code against the enrolled secret; what is
-- left is to make that irreversible in one statement. `activated_at IS NULL` in
-- the WHERE means a second activation racing the first matches nothing and is
-- told `false` rather than resetting the replay floor.
--
-- `p_step` is RFC 6238's step counter for the code that was just accepted, and
-- writing it here is what stops that same code being replayed straight into a
-- session: it becomes the floor every later verification must exceed.
CREATE FUNCTION auth_two_factor_activate(
  p_account_id UUID,
  p_step       BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_activated BOOLEAN;
BEGIN
  UPDATE account_two_factor t
     SET activated_at   = now(),
         last_used_step = p_step
   WHERE t.account_id = p_account_id
     AND t.activated_at IS NULL
  RETURNING true INTO v_activated;

  IF v_activated IS NULL THEN
    RETURN false;
  END IF;

  UPDATE agent_memberships m
     SET two_factor_enabled = true
   WHERE m.agent_id = p_account_id;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Spend a step
-- ---------------------------------------------------------------------------
--
-- The replay guard for every verification *after* activation. `last_used_step <
-- p_step` is the whole check: two requests presenting the same 30-second code
-- both compute the same step, and only the first UPDATE finds a row to change.
-- The second is told `false` and must treat the code as already spent — which
-- is why this returns a boolean the caller is expected to act on rather than
-- being a fire-and-forget write.
--
-- Refuses on an enrollment that is not activated: a code may only be spent
-- against live 2FA, the same rule `auth_two_factor_consume_recovery_code` holds
-- for a recovery code.
CREATE FUNCTION auth_two_factor_record_step(
  p_account_id UUID,
  p_step       BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_spent BOOLEAN;
BEGIN
  UPDATE account_two_factor t
     SET last_used_step = p_step
   WHERE t.account_id = p_account_id
     AND t.activated_at IS NOT NULL
     AND (t.last_used_step IS NULL OR t.last_used_step < p_step)
  RETURNING true INTO v_spent;

  RETURN COALESCE(v_spent, false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Disable
-- ---------------------------------------------------------------------------
--
-- Deleting the recovery codes is not tidying up: `two_factor_recovery_codes`
-- has its foreign key to `accounts`, not to `account_two_factor`, so dropping
-- the enrollment row alone would leave a live sheet of standalone second
-- factors behind. (`auth_two_factor_consume_recovery_code` refuses them anyway
-- once the enrollment is gone — two independent reasons the sheet dies with the
-- factor, which is the right number for something that is a credential.)
--
-- Codes go first, so a failure between the two statements cannot leave the
-- sheet without the enrollment that gates it. The membership flags follow the
-- fact they copy.
CREATE FUNCTION auth_two_factor_disable(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_removed BOOLEAN;
BEGIN
  DELETE FROM two_factor_recovery_codes c WHERE c.account_id = p_account_id;

  DELETE FROM account_two_factor t
   WHERE t.account_id = p_account_id
  RETURNING true INTO v_removed;

  UPDATE agent_memberships m
     SET two_factor_enabled = false
   WHERE m.agent_id = p_account_id;

  RETURN COALESCE(v_removed, false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Which of this account's workspaces insist on a second factor
-- ---------------------------------------------------------------------------
--
-- `security_settings.require_two_factor` is per (licence, brand) and every one
-- of those rows is behind row level security keyed to the *current* licence —
-- so the question "does any workspace this person belongs to require 2FA" is
-- one no tenant-scoped query can ask. An account is global (PRD §8.4); the
-- refusal that stops somebody switching their second factor off has to look at
-- all of their memberships, not just the one whose session happens to be
-- calling.
--
-- Any brand requiring it makes the licence require it: the setting is a
-- workspace policy that happens to be stored per brand, and reading it as "only
-- if the brand you signed in under says so" would let a member sign in under a
-- laxer brand to escape it.
--
-- Suspended and unapproved memberships are excluded, matching
-- `auth_list_memberships`: a workspace someone cannot sign in to is not one
-- whose policy should keep them locked into an authenticator.
--
-- Returns the workspace names so the refusal can say which workspace is asking,
-- rather than leaving somebody to guess which of five it was.
CREATE FUNCTION auth_two_factor_enforcing_licenses(p_account_id UUID)
RETURNS TABLE (
  enforcing_license_id BIGINT,
  workspace_name       TEXT
)
LANGUAGE sql SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT l.id, o.name
    FROM agent_memberships m
    JOIN licenses l      ON l.id = m.license_id
    JOIN organizations o ON o.id = l.organization_id
    JOIN security_settings s ON s.license_id = l.id
   WHERE m.agent_id = p_account_id
     AND NOT m.suspended
     AND NOT m.awaiting_approval
     AND s.require_two_factor
   ORDER BY l.id;
$$;

REVOKE EXECUTE ON FUNCTION auth_two_factor_begin_enrollment(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_two_factor_state(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_two_factor_activate(UUID, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_two_factor_record_step(UUID, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_two_factor_disable(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_two_factor_enforcing_licenses(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_two_factor_begin_enrollment(UUID, TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_two_factor_state(UUID) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_two_factor_activate(UUID, BIGINT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_two_factor_record_step(UUID, BIGINT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_two_factor_disable(UUID) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_two_factor_enforcing_licenses(UUID) TO nexa_app;
