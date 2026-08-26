-- Two-factor enforcement: the two questions the sign-in path has to be able to
-- ask (NFR-S11 · FR-MOD-00.1 · S11-2FA-e, Faz-5 tm 152.5).
--
-- Everything before this made a second factor *possible*: an account could
-- enroll, activate, and hold a recovery sheet. Nothing read any of it on the way
-- in. `security_settings.require_two_factor` had no reader at all outside the
-- settings screen that writes it — a workspace whose console said "two-factor
-- required" was running on one factor.
--
-- Two facts close that, and they are deliberately separate because they answer
-- different questions and change on different clocks:
--
--   **Does this account hold a live second factor?** A property of the account,
--   global (PRD §8.4), true or false for every workspace it belongs to at once.
--
--   **Does this workspace insist its members hold one?** A property of the
--   licence, and it can be true for an account that has no factor at all — which
--   is precisely the case the refusal exists for.
--
-- No table is altered, so Prisma sees no change and `db:check-drift` stays
-- quiet, exactly as for 20260826170000 and 20260826190000.

-- ---------------------------------------------------------------------------
-- The memberships a person may sign in to, now saying which of them demand a
-- second factor
-- ---------------------------------------------------------------------------
--
-- Carried on the membership for the reason 20260814210000 gives for
-- `sso_enforced_connection_id`, and it is the same reason twice over: both
-- doors ask the same question of this function — `/auth/login` to say which
-- workspaces will demand something extra, `/auth/authorize` to demand it — and
-- a second lookup beside it is a second chance for the two to disagree. The
-- shape of that disagreement is a sign-in screen that offers a plain password
-- box for a workspace the next call refuses.
--
-- `two_factor_required` is the *policy* and nothing else. Whether the person
-- will actually be asked for a code is the policy OR'd with "this account has a
-- factor", and that second half is an account fact, not a membership one:
-- folding it in here would repeat one boolean across every row and leave the
-- client unable to tell "type your code" from "you must set one up first". The
-- two are reported separately and the client combines them —
-- `auth_two_factor_is_active` below is the other half.
--
-- Any brand requiring it makes the licence require it. The setting is a
-- workspace policy that happens to be stored per brand
-- (`security_settings` is keyed by (licence, brand)), and reading it as "only if
-- the brand you signed in under says so" would let a member sign in under a
-- laxer brand to escape it. `auth_two_factor_enforcing_licenses`
-- (20260826190000) already reads it that way; this is the same reading, applied
-- one licence at a time.
--
-- Membership filters are deliberately absent from the EXISTS: this row *is* the
-- membership, already filtered by the query below. `auth_two_factor_enforcing_licenses`
-- has to restate them because it starts from an account and fans out.
DROP FUNCTION IF EXISTS auth_list_memberships(UUID);

CREATE FUNCTION auth_list_memberships(p_account_id UUID)
RETURNS TABLE (
  license_id BIGINT,
  organization_id UUID,
  role TEXT,
  license_status TEXT,
  organization_name TEXT,
  client_id TEXT,
  sso_enforced_connection_id UUID,
  two_factor_required BOOLEAN
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.license_id, l.organization_id, m.role, l.status, o.name,
         (SELECT c.id FROM oauth_clients c
           WHERE c.organization_id = l.organization_id
           ORDER BY c.created_at
           LIMIT 1),
         -- Ordered so a license federating two providers always names the same
         -- one; `name` is what the workspace calls it and what the screen sorts
         -- by, with the id breaking a tie between two identical labels.
         (SELECT s.id FROM sso_connections s
           WHERE s.license_id = m.license_id
             AND s.enabled
             AND s.enforced
           ORDER BY s.name, s.id
           LIMIT 1),
         EXISTS (SELECT 1 FROM security_settings ss
                  WHERE ss.license_id = m.license_id
                    AND ss.require_two_factor)
  FROM agent_memberships m
  JOIN licenses l      ON l.id = m.license_id
  JOIN organizations o ON o.id = l.organization_id
  WHERE m.agent_id = p_account_id
    AND NOT m.suspended
  ORDER BY l.id;
$$;

REVOKE EXECUTE ON FUNCTION auth_list_memberships(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_list_memberships(UUID) TO nexa_app;

-- ---------------------------------------------------------------------------
-- Does this account hold a live second factor?
-- ---------------------------------------------------------------------------
--
-- `auth_two_factor_state` (20260826190000) already answers this, and answering
-- it that way would be wrong here: that function returns the TOTP secret, which
-- is the one credential in this system that cannot be hashed and therefore the
-- one worth never moving. The sign-in path asks a boolean on every attempt,
-- including every *failed* attempt, and pulling a plaintext shared secret into
-- application memory to compute one is how a secret ends up in a heap dump or a
-- log line. This returns the boolean and nothing else.
--
-- Pending enrollments do not count. A secret that has never been confirmed with
-- a code proves the person has an authenticator app open, not that it agrees
-- with this server about the time — gating a sign-in on one would lock out
-- somebody whose enrollment failed halfway.
--
-- SECURITY DEFINER for the same reason everything touching this table is:
-- `account_two_factor` has row level security with no permissive policy, so an
-- ordinary `nexa_app` query sees nothing at all.
CREATE FUNCTION auth_two_factor_is_active(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM account_two_factor t
     WHERE t.account_id = p_account_id
       AND t.activated_at IS NOT NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION auth_two_factor_is_active(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_two_factor_is_active(UUID) TO nexa_app;
