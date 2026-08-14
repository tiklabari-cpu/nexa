-- SCIM 2.0 server core (NFR-S11 · S11-e).
--
-- Three changes, each the storage half of one decision the endpoints make.
--
--   1. `api_tokens.kind` gains 'scim'. The credential an identity provider's
--      provisioning connector presents is a bearer token like every other one
--      this product issues, so it is stored the same way — hashed, revocable,
--      tenant-stamped — rather than in a table of its own that would have to
--      re-derive expiry, revocation and the license join. What makes it
--      different is what it is *allowed to reach*, and that is an authorization
--      decision, enforced where the other ones are (`plugins/auth.ts`).
--
--   2. `agent_memberships.scim_external_id` records the identity provider's own
--      id for a member. SCIM clients correlate on it: Okta and Entra send it on
--      create and then address the resource by it when a later sync cannot find
--      a `userName` match (a rename is exactly that case). Dropping it on the
--      floor would make the round-trip lossy in a way no later window can repair
--      without asking every workspace to re-sync.
--
--      It lives on the *membership*, not on the account, because it is the
--      identity provider of ONE workspace saying "this is our user 4711". The
--      same person may work for another workspace whose IdP calls them something
--      else, and `accounts` is global (PRD §8.4).
--
--   3. `scim_provision_member` — find-or-create the person a POST names.
--
-- ---------------------------------------------------------------------------
-- 1. The SCIM credential kind
-- ---------------------------------------------------------------------------
ALTER TABLE api_tokens DROP CONSTRAINT api_tokens_kind_check;
ALTER TABLE api_tokens
  ADD CONSTRAINT api_tokens_kind_check CHECK (kind IN ('pat', 'oauth', 'bot', 'scim'));

-- ---------------------------------------------------------------------------
-- 2. The identity provider's own id for a member
-- ---------------------------------------------------------------------------
ALTER TABLE agent_memberships ADD COLUMN scim_external_id TEXT;

-- Bounded and non-blank when present. An empty string is not an id, and a
-- column a provisioning client writes unattended is exactly the kind that
-- collects a 10 MB paste nobody notices until a list query slows down.
ALTER TABLE agent_memberships
  ADD CONSTRAINT agent_memberships_scim_external_id_check
  CHECK (
    scim_external_id IS NULL
    OR (btrim(scim_external_id) <> '' AND char_length(scim_external_id) <= 255)
  );

-- One external id names at most one member of a workspace. Without this, a
-- `filter=externalId eq "..."` — the lookup a client falls back to when a
-- rename breaks `userName` matching — could return two people, and the client
-- would pick one and patch the wrong account's membership.
--
-- Postgres treats NULLs as distinct in a unique index, so every member who was
-- not provisioned over SCIM is unaffected; there is no need for a partial index
-- (and a plain one keeps `schema.prisma` able to describe it exactly).
CREATE UNIQUE INDEX "agent_memberships_license_id_scim_external_id_key"
  ON agent_memberships (license_id, scim_external_id);

-- ---------------------------------------------------------------------------
-- 3. Provisioning a member a SCIM POST names
-- ---------------------------------------------------------------------------
-- The same chicken-and-egg `auth_provision_sso_account` solves, for the same
-- reason: `accounts` is global but its RLS visibility is derived from shared
-- membership, so a tenant-scoped session cannot see — and therefore cannot
-- adopt — a person who already works for a different workspace. It would insert
-- and hit the global unique index on `email`, turning "this colleague already
-- has a Nexa account" into a 500.
--
-- Deliberately NOT `auth_provision_sso_account` with extra arguments. The two
-- differ on the case that matters:
--
--   * a *sign-in* that finds an existing membership carries on into it — the
--     person is standing there and has just been vouched for;
--   * a *POST /Users* that finds one is a duplicate create, and RFC 7644 §3.3
--     requires 409 `uniqueness`. Returning `membership_created = false` lets the
--     endpoint answer that without a read-then-write race deciding it.
--
-- Everything `auth_provision_sso_account` refuses to touch, this refuses too:
-- an existing account is never modified — not its name, not its password hash.
-- Workspace A's provisioning connector must not be able to rename somebody
-- across workspace B, and it never had that power through the invitation flow
-- either. All it may add is a membership in its own license.
--
-- `routing_status` is left at the column default (`offline`), which is where
-- this differs from the SSO resolver on purpose: that one runs while the person
-- is signing in, so putting them straight into rotation is right. A member
-- provisioned by a nightly directory sync is not at their desk, and routing a
-- waiting customer to an empty chair is worse than making them click "available".
CREATE OR REPLACE FUNCTION scim_provision_member(
  p_license_id  BIGINT,
  p_email       CITEXT,
  p_name        TEXT,
  p_role        TEXT,
  p_external_id TEXT,
  p_active      BOOLEAN
)
RETURNS TABLE (account_id UUID, account_created BOOLEAN, membership_created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account            UUID;
  v_account_created    BOOLEAN := false;
  v_membership_created BOOLEAN := false;
BEGIN
  SELECT a.id INTO v_account FROM accounts a WHERE a.email = p_email;

  IF v_account IS NULL THEN
    BEGIN
      v_account := gen_random_uuid();
      INSERT INTO accounts (id, email, name, password_hash)
      VALUES (
        v_account,
        p_email,
        COALESCE(NULLIF(btrim(p_name), ''), split_part(p_email::TEXT, '@', 1)),
        NULL
      );
      v_account_created := true;
    EXCEPTION WHEN unique_violation THEN
      -- Two syncs racing on the same new address. The unique index on
      -- `accounts.email` decides it; the loser adopts the winner's row rather
      -- than failing a legitimate provisioning call.
      SELECT a.id INTO v_account FROM accounts a WHERE a.email = p_email;
      v_account_created := false;
    END;
  END IF;

  INSERT INTO agent_memberships (license_id, agent_id, role, suspended, scim_external_id)
  VALUES (p_license_id, v_account, p_role, NOT p_active, p_external_id)
  ON CONFLICT (license_id, agent_id) DO NOTHING;
  -- FOUND is false when the conflict clause suppressed the insert: the person
  -- is already a member, which is the 409 case above.
  v_membership_created := FOUND;

  RETURN QUERY SELECT v_account, v_account_created, v_membership_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION scim_provision_member(BIGINT, CITEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scim_provision_member(BIGINT, CITEXT, TEXT, TEXT, TEXT, BOOLEAN) TO nexa_app;
