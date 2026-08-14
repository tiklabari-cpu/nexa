-- Resolvers the SAML service-provider endpoints need (NFR-S11 · S11-d).
--
-- No schema change: `sso_connections` (S11-a) and the certificate rotation
-- overlap (S11-a2) already hold everything a login reads, and `accounts` has
-- been able to represent a passwordless SSO-only person since the first auth
-- migration. What is missing is a way to *reach* any of it from the two new
-- endpoints, because both are unauthenticated by nature: a browser arriving at
-- `/auth/saml/{id}/login` has no token, and the IdP posting to `/acs` has no
-- account at all, so neither request can establish a tenant context before it
-- knows which connection it is about. Row level security correctly answers
-- "nothing" to every query in that state.
--
-- The established shape for that problem in this codebase is a SECURITY DEFINER
-- function with a pinned `search_path`, granted to `nexa_app` only: the same
-- device `auth_find_account_for_login`, `auth_find_client` and
-- `auth_accept_invitation` use. Each function below is narrow on purpose — one
-- takes a connection id and returns exactly one connection, the other takes a
-- license id the caller has *already proven* it holds (it came off a verified
-- assertion's connection row) and provisions inside it. Neither takes a filter
-- a caller could widen.

-- ---------------------------------------------------------------------------
-- The connection a login is about.
-- ---------------------------------------------------------------------------
-- Returns the license and organization alongside the row, so the endpoint never
-- has to make a second unscoped read to find out whose workspace it is in — the
-- tenant of everything that follows is derived from this one lookup and from
-- nothing the caller sent. `status` rides along because a canceled workspace
-- must not be signed into, and that is cheaper to answer here than with another
-- SECURITY DEFINER call.
--
-- Disabled connections are returned rather than filtered: the caller refuses
-- them with the same "not found" a missing id gets, and returning the row keeps
-- this function a plain lookup instead of a policy.
CREATE OR REPLACE FUNCTION auth_find_sso_connection(p_connection_id UUID)
RETURNS TABLE (
  id UUID,
  license_id BIGINT,
  organization_id UUID,
  license_status TEXT,
  idp_entity_id TEXT,
  idp_sso_url TEXT,
  idp_certificate_pem TEXT,
  previous_certificate_pem TEXT,
  previous_certificate_expires_at TIMESTAMPTZ,
  attribute_mapping JSONB,
  allow_idp_initiated BOOLEAN,
  enabled BOOLEAN
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.id,
         s.license_id,
         l.organization_id,
         l.status,
         s.idp_entity_id,
         s.idp_sso_url,
         s.idp_certificate_pem,
         s.previous_certificate_pem,
         s.previous_certificate_expires_at,
         s.attribute_mapping,
         s.allow_idp_initiated,
         s.enabled
  FROM sso_connections s
  JOIN licenses l ON l.id = s.license_id
  WHERE s.id = p_connection_id;
$$;

-- ---------------------------------------------------------------------------
-- Just-in-time provisioning.
-- ---------------------------------------------------------------------------
-- Find (or create) the person an assertion named, and make sure they belong to
-- the workspace whose IdP vouched for them.
--
-- Three rules are enforced here rather than in the caller, because each of them
-- is a rule about *state* and a caller could only implement it with a
-- read-then-write race:
--
--   1. **An existing account is never modified.** Not its name, not its
--      password hash. Workspace A's identity provider asserting a colleague's
--      address must not be able to rename them everywhere or clear the password
--      they sign in to workspace B with. All it can do is add a membership in
--      its own license — which its admin could do by sending an invitation
--      anyway, so the federation grants no power the workspace lacked.
--   2. **An existing membership is left exactly as it is.** `ON CONFLICT DO
--      NOTHING`, so a suspended teammate stays suspended and a role someone was
--      promoted to is not reset to `agent` on their next sign-in. The caller
--      then finds no *eligible* membership (`auth_list_memberships` filters
--      suspended and unapproved ones out) and refuses the login, which is the
--      behaviour suspension is for.
--   3. **Concurrent first logins settle in the database.** Two assertions for
--      the same new address arriving together would both see "no account" and
--      both insert; the unique index on `accounts.email` decides it and the
--      loser re-reads the winner's row instead of failing a legitimate sign-in.
--
-- A new account is created with `password_hash` NULL — the SSO-only shape the
-- schema has always described. It is deliberately not given a password, so the
-- account cannot be signed into by any means the workspace's IdP does not
-- control.
CREATE OR REPLACE FUNCTION auth_provision_sso_account(
  p_license_id BIGINT,
  p_email      CITEXT,
  p_name       TEXT,
  p_role       TEXT
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
      -- Rule 3: somebody else created the same person between the SELECT and
      -- the INSERT. Adopt their row.
      SELECT a.id INTO v_account FROM accounts a WHERE a.email = p_email;
      v_account_created := false;
    END;
  END IF;

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (p_license_id, v_account, p_role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;
  -- FOUND is false when the conflict clause suppressed the insert, which is
  -- exactly rule 2: an existing membership was left untouched.
  v_membership_created := FOUND;

  RETURN QUERY SELECT v_account, v_account_created, v_membership_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_find_sso_connection(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_provision_sso_account(BIGINT, CITEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_find_sso_connection(UUID) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_provision_sso_account(BIGINT, CITEXT, TEXT, TEXT) TO nexa_app;
