-- Just-in-time provisioning may only name addresses the workspace's identity
-- provider has actually verified (NFR-S11 · NFR-S12 — PLAN §D116 MEDIUM (a)).
--
-- ## What was wrong
--
-- `auth_provision_sso_account` and `scim_provision_member` believed every
-- address handed to them. The address is the whole identity here — it is what
-- an account is found by — so a workspace that configured its own identity
-- provider, or minted its own SCIM credential, could assert any address on the
-- internet and have it provisioned. Two consequences, both real:
--
--   * **Adoption.** A stranger's existing account is pulled into the workspace
--     as a member. Row level security keeps what that membership can read
--     inside the attacker's own tenant, which is why this is not a cross-tenant
--     read — but through SAML it also ends in a *session bearing that account's
--     identity*, which is a genuinely new power. The invitation path this was
--     compared to (see the 20260814090000 header: "which its admin could do by
--     sending an invitation anyway") is not equivalent, and that is the mistake
--     being corrected: an invitation only becomes a membership when the invitee
--     opens the link and accepts. Consent was the missing half.
--   * **Squatting.** An address that never signed up gets an `accounts` row,
--     owned by nobody, which the global unique index on `email` then keeps its
--     real holder from ever registering with.
--
-- ## The rule
--
-- A connection now carries the domains its identity provider has been declared
-- authoritative for, and provisioning is confined to them. An empty list admits
-- nobody: "we have verified nothing" must not read as "everything is verified",
-- or the fix would be a no-op for exactly the workspace that never filled the
-- field in.
--
-- ## Where the rule is enforced, and why it is here
--
-- Inside the two SECURITY DEFINER resolvers, not in their callers. These
-- functions exist *because* they run outside row level security, so they are
-- the last place a rule can be stated and still be impossible to skip: a route
-- added later cannot forget a check it never had to make. `auth_provision_sso_
-- account` therefore stops taking a license id and takes the **connection id**
-- instead, deriving both the tenant and the verified domains from the row —
-- the principle the original header stated for its siblings ("Neither takes a
-- filter a caller could widen"), now applied to the filter that matters most.
-- SCIM has no connection to name (its credential is minted per workspace, at
-- `POST /settings/scim-tokens`), so it reads the union of the license's
-- connections; a workspace with no connection configured has verified nothing
-- and provisions nobody.

-- ---------------------------------------------------------------------------
-- 1. The domains a connection is authoritative for
-- ---------------------------------------------------------------------------
-- Shape follows the other Prisma-modelled scalar lists in this schema
-- (`oauth_clients.scopes`), so `schema.prisma` can describe the column exactly
-- and `db:check-drift` stays a real gate. The list is stored lowercase; case is
-- not part of a domain, and normalising on write means the match below is a
-- plain equality rather than a function call per element.
ALTER TABLE "sso_connections" ADD COLUMN "verified_domains" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ---------------------------------------------------------------------------
-- 2. Existing connections keep working — from derived data, not from a bypass
-- ---------------------------------------------------------------------------
-- Connections configured before this migration have no list, and an empty list
-- admits nobody. Treating "empty" as "allow everything" would be fail-open and
-- would leave the finding untouched for precisely the rows that predate the
-- fix, so instead the list is *derived*: the domains the workspace's current
-- members already sign in from. That is a fact about the workspace rather than
-- a permission this migration grants — every one of those people is already a
-- member, so nothing new becomes reachable — and it keeps a live federation
-- from locking its own staff out at the next sign-in.
--
-- Sliced to the same 20 the CHECK below allows: a workspace with more distinct
-- member domains than that keeps twenty and its owner adds the rest on the
-- screen, which is better than the whole migration failing on a constraint.
UPDATE "sso_connections" s
SET "verified_domains" = d.domains
FROM (
  SELECT m.license_id,
         (array_agg(DISTINCT lower(split_part(a.email::TEXT, '@', 2))))[1:20] AS domains
  FROM agent_memberships m
  JOIN accounts a ON a.id = m.agent_id
  WHERE position('@' in a.email::TEXT) > 0
  GROUP BY m.license_id
) d
WHERE d.license_id = s.license_id;

-- Storage invariants, not input validation — the write surface refuses far more
-- and says why (routes/settings.ts). What these buy is that no path can leave
-- behind an element that *looks* like a domain to a reader while being
-- something else: uppercase (which a normalised address could never match), an
-- empty string, a NULL, or an unbounded blob in a column read on every login.
--
-- Written without a subquery because a CHECK cannot contain one. Concatenating
-- with an empty separator is what lets one regex say "every element is made of
-- these characters": any element containing anything else puts that character
-- into the joined string. An element malformed in a way this cannot see
-- (`a.test b.test` as one string) is inert rather than dangerous — it is
-- compared for equality against a real address's domain, which can never
-- contain a space.
--
-- The length is bounded with `char_length` rather than inside the pattern:
-- PostgreSQL's POSIX engine refuses a repetition count above 255, and a bound
-- written as `{0,2560}` does not fail when the constraint is created — it fails
-- at the first INSERT, with "invalid repetition count(s)". Measured, not
-- guessed: the first hand-written INSERT against this table raised exactly that.
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_verified_domains_check"
  CHECK (
    "verified_domains" IS NULL
    OR (
      cardinality("verified_domains") <= 20
      AND array_position("verified_domains", NULL) IS NULL
      AND array_position("verified_domains", '') IS NULL
      AND char_length(array_to_string("verified_domains", '')) <= 2560
      AND array_to_string("verified_domains", '') ~ '^[a-z0-9.-]*$'
    )
  );

COMMENT ON COLUMN "sso_connections"."verified_domains" IS
  'E-mail domains this identity provider is authoritative for. Just-in-time provisioning is confined to them; an empty list provisions nobody (NFR-S11, PLAN D116).';

-- ---------------------------------------------------------------------------
-- 3. The match, in one place
-- ---------------------------------------------------------------------------
-- Both resolvers ask this and nothing else asks it differently. Exact equality,
-- never a suffix: a workspace that verified `acme.test` has said nothing about
-- `mail.acme.test` (a subdomain it may not run) and certainly nothing about
-- `acme.test.attacker.example` (a name anybody can register). Suffix matching
-- is how a domain check becomes a domain bypass, so the widening is refused
-- rather than made configurable.
CREATE OR REPLACE FUNCTION sso_email_domain_verified(p_email CITEXT, p_domains TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw    TEXT := p_email::TEXT;
  v_at     INT  := position('@' in p_email::TEXT);
  v_domain TEXT;
BEGIN
  -- Fail closed on every "we cannot tell" branch, including the one that
  -- matters most: a workspace that has verified nothing.
  IF p_domains IS NULL OR cardinality(p_domains) = 0 THEN RETURN false; END IF;
  IF v_at = 0 THEN RETURN false; END IF;

  v_domain := lower(substring(v_raw from v_at + 1));
  -- A second '@' means this is not one address with one domain, and picking
  -- which half to trust is exactly how a parser difference becomes a bypass.
  IF v_domain = '' OR position('@' in v_domain) > 0 THEN RETURN false; END IF;

  RETURN v_domain = ANY (p_domains);
END;
$$;

REVOKE EXECUTE ON FUNCTION sso_email_domain_verified(CITEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sso_email_domain_verified(CITEXT, TEXT[]) TO nexa_app;

-- ---------------------------------------------------------------------------
-- 4. SAML just-in-time provisioning, bound to its own connection
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than replaced: both the argument list and the
-- result columns change, and `CREATE OR REPLACE` may do neither.
--
-- The three rules the original stated are unchanged and still hold — an
-- existing account is never modified, an existing membership is left exactly as
-- it is, and concurrent first logins settle in the database. What is added in
-- front of them is a fourth: the address has to be one this connection's
-- identity provider was declared authoritative for.
--
-- The refusal is returned rather than raised. A raise would reach the endpoint
-- as a database error, which is how a security refusal ends up logged as a 500
-- and answered with the wrong status; a flag lets the caller record it in the
-- workspace's own audit trail next to every other reason a sign-in was turned
-- away, and answer with the same opaque failure the others get.
DROP FUNCTION IF EXISTS auth_provision_sso_account(BIGINT, CITEXT, TEXT, TEXT);

CREATE FUNCTION auth_provision_sso_account(
  p_connection_id UUID,
  p_email         CITEXT,
  p_name          TEXT,
  p_role          TEXT
)
RETURNS TABLE (
  account_id         UUID,
  account_created    BOOLEAN,
  membership_created BOOLEAN,
  domain_rejected    BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license            BIGINT;
  v_domains            TEXT[];
  v_account            UUID;
  v_account_created    BOOLEAN := false;
  v_membership_created BOOLEAN := false;
BEGIN
  -- The tenant and the domain list come off one row, keyed by the connection
  -- the assertion was verified against. Neither is a caller-supplied filter any
  -- more, so no endpoint can provision into a license its connection does not
  -- belong to, or against a domain list it chose.
  SELECT s.license_id, s.verified_domains
    INTO v_license, v_domains
    FROM sso_connections s
   WHERE s.id = p_connection_id;

  -- No such connection: return nothing. The caller has already resolved the
  -- connection to get here, so this is the "it was deleted mid-login" race, and
  -- an empty result is refused the same way a missing membership is.
  IF v_license IS NULL THEN RETURN; END IF;

  IF NOT sso_email_domain_verified(p_email, v_domains) THEN
    RETURN QUERY SELECT NULL::UUID, false, false, true;
    RETURN;
  END IF;

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
  VALUES (v_license, v_account, p_role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;
  -- FOUND is false when the conflict clause suppressed the insert, which is
  -- exactly rule 2: an existing membership was left untouched.
  v_membership_created := FOUND;

  RETURN QUERY SELECT v_account, v_account_created, v_membership_created, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_provision_sso_account(UUID, CITEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_provision_sso_account(UUID, CITEXT, TEXT, TEXT) TO nexa_app;

-- ---------------------------------------------------------------------------
-- 5. SCIM provisioning, bound to the workspace's verified domains
-- ---------------------------------------------------------------------------
-- Same rule, second surface. The audit that found this named both, and closing
-- only the one that ends in a session would leave the squatting half open to an
-- unattended connector running every night.
--
-- The domain list is the union across the license's connections rather than one
-- connection's, because a SCIM credential is minted per workspace and names no
-- connection. A license that has configured none has verified nothing, and
-- provisions nobody — the same reading `sso_email_domain_verified` gives an
-- empty list everywhere else.
DROP FUNCTION IF EXISTS scim_provision_member(BIGINT, CITEXT, TEXT, TEXT, TEXT, BOOLEAN);

CREATE FUNCTION scim_provision_member(
  p_license_id  BIGINT,
  p_email       CITEXT,
  p_name        TEXT,
  p_role        TEXT,
  p_external_id TEXT,
  p_active      BOOLEAN
)
RETURNS TABLE (
  account_id         UUID,
  account_created    BOOLEAN,
  membership_created BOOLEAN,
  domain_rejected    BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_domains            TEXT[];
  v_account            UUID;
  v_account_created    BOOLEAN := false;
  v_membership_created BOOLEAN := false;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT d), ARRAY[]::TEXT[])
    INTO v_domains
    FROM sso_connections s
    CROSS JOIN LATERAL unnest(s.verified_domains) AS d
   WHERE s.license_id = p_license_id;

  IF NOT sso_email_domain_verified(p_email, v_domains) THEN
    RETURN QUERY SELECT NULL::UUID, false, false, true;
    RETURN;
  END IF;

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
  -- is already a member, which is the 409 case the endpoint answers.
  v_membership_created := FOUND;

  RETURN QUERY SELECT v_account, v_account_created, v_membership_created, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION scim_provision_member(BIGINT, CITEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scim_provision_member(BIGINT, CITEXT, TEXT, TEXT, TEXT, BOOLEAN) TO nexa_app;
