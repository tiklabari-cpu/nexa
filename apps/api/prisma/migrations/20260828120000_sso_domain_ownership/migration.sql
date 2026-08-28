-- A verified domain now has to be *proved*, not merely claimed
-- (NFR-S11 · NFR-S12 — PLAN §D116 MEDIUM (a), reopened by §D134).
--
-- ## What 20260826140000 fixed, and what it did not
--
-- That migration confined just-in-time provisioning to a list of domains, and
-- everything it hardened about the *shape* of a claim still holds: exact
-- equality, no suffix, no wildcard, an empty list admits nobody, and the gate
-- lives inside the two SECURITY DEFINER resolvers where no later route can
-- forget it. None of that is undone here.
--
-- What it left open is who may make the claim. `sso_connections.verified_domains`
-- is a list the workspace writes about itself, so the workspace that owns the
-- connection decides which domains its identity provider is authoritative for.
-- The threat actor in the original finding *is* that workspace's owner — the
-- write surface is `exactRole: owner`, the narrowest gate in the product, and
-- narrowing a door is not a defence against the person standing behind it. So an
-- owner could write `verified_domains: [victim-corp.com]`, have their own IdP
-- assert `ceo@victim-corp.com`, and land back at both halves of §D116: a
-- stranger's account adopted into their tenant with a session minted under that
-- identity, and the account row of an address that never signed up occupied for
-- good.
--
-- ## The rule this adds
--
-- Claiming a domain and proving it are two different acts. The claim stays where
-- it was (`sso_connections.verified_domains`); the proof gets its own row, per
-- connection and per domain, and only a domain whose row carries a `verified_at`
-- takes part in provisioning. A claim with no proof is inert — visible on the
-- screen as pending, worth nothing at a sign-in.
--
-- The proof is a challenge to a mailbox only the domain's operator can read:
-- `postmaster@`, `admin@`, `administrator@`, `hostmaster@` or `webmaster@` at
-- the domain being claimed — the small set of reserved local parts RFC 2142
-- defines and certificate authorities have used for domain validation for
-- decades. A token is mailed there and has to come back through the API.
-- Reading `postmaster@victim-corp.com` is exactly the capability the attacker in
-- the finding does not have.
--
-- ## Where the rule is enforced, and the one place it deliberately is not
--
-- Inside the same two resolvers, for the same reason §D125 put the first half
-- there: they run outside row level security, so they are the last place a rule
-- can be stated and still be impossible to skip.
--
-- But the gate now guards *creation*, not sign-in. §D116's harm is two acts of
-- creation — a membership row for somebody who never consented, and an account
-- row for an address that never signed up. Somebody who already holds both is
-- not being adopted by their next sign-in; refusing them would be a rule with no
-- threat behind it, and it would have one very concrete cost. The lists this
-- table inherits were *derived* by 20260826140000 from the domains a workspace's
-- current members already sign in from. Those are a record of a fact, never a
-- proof of ownership, so this migration cannot honour them as proof — and if the
-- gate also covered sign-in, refusing to honour them would lock every existing
-- federation's staff out at their next login. Guarding creation keeps the fix
-- and drops the outage.

-- ---------------------------------------------------------------------------
-- 1. The proof, one row per claimed domain
-- ---------------------------------------------------------------------------
-- A table rather than a second array, because a proof has state a string cannot
-- carry: which mailbox was challenged, when, and whether the answer came back.
-- `license_id` is denormalised from the connection so the row can carry the
-- ordinary tenant policy every other table here has, rather than reaching
-- through a join in a USING clause.
CREATE TABLE "sso_domain_verifications" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "domain" TEXT NOT NULL,
    -- SHA-256 of the challenge token, never the token. A 32-byte random value
    -- has nothing to grind, so this is the repo's token rule (lib/crypto.ts)
    -- rather than a KDF. Null before the first challenge and again after a
    -- successful one: the token is spent, and a spent secret left in the row is
    -- a secret waiting to be replayed.
    "token_hash" TEXT,
    -- The address the challenge went to, kept so the screen can say where to
    -- look and so an audit reader can see which mailbox vouched for the domain.
    "challenge_mailbox" TEXT,
    "challenge_sent_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sso_domain_verifications_pkey" PRIMARY KEY ("id")
);

-- One proof per domain per connection. Also the only read this table has —
-- "the domains of this connection" — so no separate index is created.
CREATE UNIQUE INDEX "sso_domain_verifications_connection_id_domain_key"
  ON "sso_domain_verifications"("connection_id", "domain");

ALTER TABLE "sso_domain_verifications" ADD CONSTRAINT "sso_domain_verifications_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "sso_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sso_domain_verifications" ADD CONSTRAINT "sso_domain_verifications_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Storage invariants, not input validation. The domain is stored in exactly the
-- normalised form `readVerifiedDomain` produces, because it is compared with
-- plain equality against `sso_connections.verified_domains` and against the
-- domain half of an asserted address; an uppercase or blank element here would
-- be a row that looks like a proof and can never match one.
ALTER TABLE "sso_domain_verifications" ADD CONSTRAINT "sso_domain_verifications_domain_check"
  CHECK ("domain" ~ '^[a-z0-9.-]+$' AND char_length("domain") BETWEEN 1 AND 253);

-- A digest or nothing. The shape is `hashToken`'s: SHA-256 rendered base64url,
-- which is 43 characters with no padding — the same encoding every other stored
-- credential digest in this schema uses. Written out rather than left to the
-- application because the one thing this column must never hold is the token
-- itself, and a 32-byte token from `generateToken` is 43 base64url characters
-- too. So the length cannot tell them apart, and this constraint is not the
-- guard that does: the guard is that the plaintext never leaves the request
-- that generated it. What this buys is narrower and still worth having — no
-- truncated digest, no hex, no empty string, nothing with a `+`, `/` or `=`
-- from a caller that reached for the wrong base64 alphabet.
ALTER TABLE "sso_domain_verifications" ADD CONSTRAINT "sso_domain_verifications_token_hash_check"
  CHECK ("token_hash" IS NULL OR "token_hash" ~ '^[A-Za-z0-9_-]{43}$');

-- A challenge is a mailbox and a moment together. Half of one would leave a
-- token whose expiry cannot be computed, and expiry is the only thing bounding
-- how long a mailed secret stays useful.
ALTER TABLE "sso_domain_verifications" ADD CONSTRAINT "sso_domain_verifications_challenge_check"
  CHECK (("challenge_mailbox" IS NULL) = ("challenge_sent_at" IS NULL));

-- Same tenant boundary as the connection this belongs to. A cross-tenant write
-- here would be a workspace granting itself proof of somebody else's domain,
-- which is the whole finding in one INSERT — so WITH CHECK matters at least as
-- much as USING.
ALTER TABLE sso_domain_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY sso_domain_verifications_tenant ON sso_domain_verifications
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

COMMENT ON TABLE "sso_domain_verifications" IS
  'Proof of ownership for one domain claimed by one SSO connection. Only a row with verified_at takes part in just-in-time provisioning (NFR-S11, PLAN D134).';

-- ---------------------------------------------------------------------------
-- 2. The claim list and the proof rows cannot drift apart
-- ---------------------------------------------------------------------------
-- Kept in step by a trigger rather than by the route, on the same principle as
-- the gate itself: a rule a caller has to remember is a rule some later caller
-- will not. Adding a domain to the claim list creates an unproved row; removing
-- it destroys the proof, so a domain cannot be dropped from the list and quietly
-- keep provisioning. Re-saving the same list changes nothing — ON CONFLICT DO
-- NOTHING is what makes an idempotent PATCH idempotent for the proof too, rather
-- than resetting a verification every time the form is submitted.
--
-- SECURITY DEFINER because the rows it writes are derived entirely from the row
-- that fired it: there is no caller-supplied value to widen, and running as the
-- owner means the trigger behaves identically for a tenant-scoped write, a
-- migration and a console session.
CREATE OR REPLACE FUNCTION sso_sync_domain_verifications()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_domains TEXT[] := COALESCE(NEW.verified_domains, ARRAY[]::TEXT[]);
BEGIN
  DELETE FROM sso_domain_verifications v
   WHERE v.connection_id = NEW.id
     AND NOT (v.domain = ANY (v_domains));

  INSERT INTO sso_domain_verifications (id, connection_id, license_id, domain, updated_at)
  SELECT gen_random_uuid(), NEW.id, NEW.license_id, d, now()
    FROM unnest(v_domains) AS d
  ON CONFLICT (connection_id, domain) DO NOTHING;

  RETURN NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION sso_sync_domain_verifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sso_sync_domain_verifications() TO nexa_app;

CREATE TRIGGER sso_connections_sync_domain_verifications
AFTER INSERT OR UPDATE OF verified_domains, license_id ON sso_connections
FOR EACH ROW EXECUTE FUNCTION sso_sync_domain_verifications();

-- ---------------------------------------------------------------------------
-- 3. Existing claims become pending, not proved
-- ---------------------------------------------------------------------------
-- Every domain already in a claim list gets a row with `verified_at` NULL. That
-- is this migration applied to its own history: the lists 20260826140000 derived
-- record which domains a workspace's members already used, which is a fact about
-- the workspace and never a proof that the workspace controls the domain.
-- Treating them as proved would ship the fix and exempt precisely the rows the
-- finding is about.
INSERT INTO sso_domain_verifications (id, connection_id, license_id, domain, updated_at)
SELECT gen_random_uuid(), s.id, s.license_id, d, now()
  FROM sso_connections s
  CROSS JOIN LATERAL unnest(s.verified_domains) AS d
ON CONFLICT (connection_id, domain) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. The list provisioning actually reads
-- ---------------------------------------------------------------------------
-- Proved domains only, and only those still claimed. The second half is what
-- makes a drift between the two tables fail closed: a proof row that outlived
-- its claim — a trigger that did not fire, a hand-written UPDATE — provisions
-- nobody, because it is intersected with the list the connection presents.
CREATE OR REPLACE FUNCTION sso_connection_proved_domains(p_connection_id UUID)
RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(array_agg(v.domain), ARRAY[]::TEXT[])
    FROM sso_domain_verifications v
    JOIN sso_connections s ON s.id = v.connection_id
   WHERE v.connection_id = p_connection_id
     AND v.verified_at IS NOT NULL
     AND v.domain = ANY (COALESCE(s.verified_domains, ARRAY[]::TEXT[]));
$fn$;

REVOKE EXECUTE ON FUNCTION sso_connection_proved_domains(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sso_connection_proved_domains(UUID) TO nexa_app;

-- The SCIM half. A SCIM credential is minted per workspace and names no
-- connection, so it reads the union across the license's connections — the same
-- reading 20260826140000 gave it, narrowed from claims to proofs.
CREATE OR REPLACE FUNCTION sso_license_proved_domains(p_license_id BIGINT)
RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT v.domain), ARRAY[]::TEXT[])
    FROM sso_domain_verifications v
    JOIN sso_connections s ON s.id = v.connection_id
   WHERE v.license_id = p_license_id
     AND v.verified_at IS NOT NULL
     AND v.domain = ANY (COALESCE(s.verified_domains, ARRAY[]::TEXT[]));
$fn$;

REVOKE EXECUTE ON FUNCTION sso_license_proved_domains(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sso_license_proved_domains(BIGINT) TO nexa_app;

-- ---------------------------------------------------------------------------
-- 5. SAML just-in-time provisioning, gated on proof
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE`: the signature and the result columns are unchanged, and
-- keeping them unchanged is deliberate — the caller's contract (`domain_rejected`
-- as a flag rather than a raise, so a refusal is audited rather than logged as a
-- 500) is the part of §D125 worth preserving exactly.
--
-- The one behavioural change is *when* the gate applies: only when this call
-- would create something — an account row, or a membership row. A person who
-- already holds a membership in this license is signing in, not being adopted.
CREATE OR REPLACE FUNCTION auth_provision_sso_account(
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
AS $fn$
DECLARE
  v_license            BIGINT;
  v_domains            TEXT[];
  v_account            UUID;
  v_is_member          BOOLEAN := false;
  v_account_created    BOOLEAN := false;
  v_membership_created BOOLEAN := false;
BEGIN
  -- The tenant still comes off the connection row, keyed by the connection the
  -- assertion was verified against: not a caller-supplied filter, so no endpoint
  -- can provision into a license its connection does not belong to.
  SELECT s.license_id INTO v_license FROM sso_connections s WHERE s.id = p_connection_id;

  -- No such connection: return nothing. The caller has already resolved the
  -- connection to get here, so this is the "it was deleted mid-login" race, and
  -- an empty result is refused the same way a missing membership is.
  IF v_license IS NULL THEN RETURN; END IF;

  SELECT a.id INTO v_account FROM accounts a WHERE a.email = p_email;

  IF v_account IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM agent_memberships m
       WHERE m.license_id = v_license AND m.agent_id = v_account
    ) INTO v_is_member;
  END IF;

  -- Nothing would be created, so there is nothing to prove. Everything else —
  -- suspended, unapproved, deprovisioned — is decided by `auth_list_memberships`
  -- above this function, exactly as before.
  IF NOT v_is_member THEN
    v_domains := sso_connection_proved_domains(p_connection_id);
    IF NOT sso_email_domain_verified(p_email, v_domains) THEN
      RETURN QUERY SELECT NULL::UUID, false, false, true;
      RETURN;
    END IF;
  END IF;

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
      -- Somebody else created the same person between the SELECT and the
      -- INSERT. Adopt their row.
      SELECT a.id INTO v_account FROM accounts a WHERE a.email = p_email;
      v_account_created := false;
    END;
  END IF;

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_license, v_account, p_role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;
  -- FOUND is false when the conflict clause suppressed the insert: an existing
  -- membership was left exactly as it was.
  v_membership_created := FOUND;

  RETURN QUERY SELECT v_account, v_account_created, v_membership_created, false;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. SCIM provisioning, gated on the same proof
-- ---------------------------------------------------------------------------
-- Same rule, second surface, same reason 20260826140000 closed both: only one of
-- them ends in a session, but the other is an unattended connector that can
-- occupy account rows every night.
CREATE OR REPLACE FUNCTION scim_provision_member(
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
AS $fn$
DECLARE
  v_domains            TEXT[];
  v_account            UUID;
  v_is_member          BOOLEAN := false;
  v_account_created    BOOLEAN := false;
  v_membership_created BOOLEAN := false;
BEGIN
  SELECT a.id INTO v_account FROM accounts a WHERE a.email = p_email;

  IF v_account IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM agent_memberships m
       WHERE m.license_id = p_license_id AND m.agent_id = v_account
    ) INTO v_is_member;
  END IF;

  IF NOT v_is_member THEN
    v_domains := sso_license_proved_domains(p_license_id);
    IF NOT sso_email_domain_verified(p_email, v_domains) THEN
      RETURN QUERY SELECT NULL::UUID, false, false, true;
      RETURN;
    END IF;
  END IF;

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
      -- `accounts.email` decides it; the loser adopts the winner's row.
      SELECT a.id INTO v_account FROM accounts a WHERE a.email = p_email;
      v_account_created := false;
    END;
  END IF;

  INSERT INTO agent_memberships (license_id, agent_id, role, suspended, scim_external_id)
  VALUES (p_license_id, v_account, p_role, NOT p_active, p_external_id)
  ON CONFLICT (license_id, agent_id) DO NOTHING;
  -- FOUND is false when the conflict clause suppressed the insert: the person is
  -- already a member, which is the 409 case the endpoint answers.
  v_membership_created := FOUND;

  RETURN QUERY SELECT v_account, v_account_created, v_membership_created, false;
END;
$fn$;
