-- Terms of service acceptance at sign-up (tm 257.9 · ADR
-- docs/adr/pilot-public-readiness.md K-f · PLAN §D203).
--
-- With `TERMS_URL` set, the person who opens a workspace accepts the terms,
-- and the acceptance is a fact about the workspace — its licence — rather than
-- the account: the party to the terms is the workspace, and the accounts that
-- join it later (an invitation, SSO just-in-time provisioning, SCIM) arrive
-- through paths with no screen to tick a box on.
--
-- The version is stored, not only the time. `licenses.hipaa_baa_signed_at` is
-- a timestamp alone; copied here it would record *that* something was
-- accepted, never *which* text, and a change of terms could not be told apart
-- from the terms a workspace agreed to.
--
-- Expand-only (CONVENTIONS §6.3): two nullable columns, a check that every row
-- an older API writes already satisfies (both null), and `auth_signup`
-- re-created with a defaulted trailing argument, so the previous release calls
-- it exactly as before and gets exactly what it got.

-- --------------------------------------------------------------------------
-- 1. licenses.terms_accepted_at · licenses.terms_version
-- --------------------------------------------------------------------------
-- Null for every workspace that exists today and for every one opened while
-- the deployment names no terms. No backfill: nobody accepted anything, and
-- writing a version nobody saw would be the one false record here.
ALTER TABLE licenses
  ADD COLUMN terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN terms_version     TEXT;

-- Both or neither. A time without a version is the BAA's gap; a version
-- without a time is an acceptance nobody can date. Not a length check on the
-- version: the API bounds it (64), and a database rule that a later API could
-- outgrow would turn a configuration change into a failed sign-up.
ALTER TABLE licenses
  ADD CONSTRAINT licenses_terms_acceptance_check
  CHECK ((terms_accepted_at IS NULL) = (terms_version IS NULL));

-- --------------------------------------------------------------------------
-- 2. auth_signup — records the acceptance in the transaction that creates
--    the workspace
-- --------------------------------------------------------------------------
-- Here and not in a separate UPDATE after it: sign-up is already more than one
-- transaction (the default team is seeded after this function commits), and
-- an acceptance written afterwards could fail with the workspace already
-- created — leaving an owner who accepted, a licence that says they did not,
-- and no form left to accept on.
--
-- A new trailing argument is a new signature, so `DROP` + `CREATE` (the
-- 20260925120000 rule). Defaulted to NULL: an API from before this release
-- calls with eight arguments and records no acceptance, as it never did. The
-- body is 20261002120000's verbatim except the licence insert.
DROP FUNCTION IF EXISTS auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT, BOOLEAN);

CREATE FUNCTION auth_signup(
  p_email             CITEXT,
  p_name              TEXT,
  p_password_hash     TEXT,
  p_organization_name TEXT,
  p_trial_days        INT,
  p_region            TEXT DEFAULT 'eu',
  p_console_redirect  TEXT DEFAULT 'http://localhost:5173/auth/callback',
  p_email_verified    BOOLEAN DEFAULT TRUE,
  p_terms_version     TEXT DEFAULT NULL
)
RETURNS TABLE (created_account UUID, created_license BIGINT, created_organization UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_license BIGINT;
  v_account UUID := gen_random_uuid();
BEGIN
  -- Before anything is written, so a refused value creates nothing.
  IF NOT auth_console_redirect_admissible(p_console_redirect) THEN
    RAISE EXCEPTION 'console redirect % is not an admissible callback', p_console_redirect
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM accounts a WHERE a.email = p_email) THEN
    RAISE EXCEPTION 'siyahtus_account_exists';
  END IF;

  -- No validation of p_region here: `organizations_region_check` is the one
  -- place the legal set is written down, and this insert is inside the same
  -- transaction as everything below it, so a bad value fails the whole signup
  -- rather than half-creating a workspace in a region that does not exist.
  INSERT INTO organizations (id, name, region) VALUES (v_org, p_organization_name, p_region);

  -- The acceptance, when the deployment asked for one, lands with the licence
  -- itself: one row, one statement, so there is no moment at which the
  -- workspace exists and the acceptance does not.
  INSERT INTO licenses (organization_id, plan, status, trial_ends_at,
                        terms_accepted_at, terms_version)
  VALUES (v_org, 'growth', 'trialing', now() + make_interval(days => p_trial_days),
          CASE WHEN p_terms_version IS NOT NULL THEN now() END, p_terms_version)
  RETURNING id INTO v_license;

  -- The license default brand — the same row the migration backfill and the seed
  -- lay down, so single-brand behaviour is preserved for a fresh workspace too.
  INSERT INTO brands (id, license_id, name, slug, is_default, updated_at)
  VALUES (gen_random_uuid(), v_license, 'Default', 'default', true, now());

  -- Explicit either way rather than leaning on the column default: this is the
  -- one writer whose answer depends on the deployment.
  INSERT INTO accounts (id, email, name, password_hash, email_verified_at)
  VALUES (v_account, p_email, p_name, p_password_hash,
          CASE WHEN p_email_verified THEN now() END);

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_license, v_account, 'owner', 'accepting_chats');

  -- Public client: OAuth 2.1 uses PKCE rather than a secret for anything
  -- running in a browser or on a phone, where no secret stays secret. Two
  -- callbacks, one client: this deployment's console and the mobile app.
  INSERT INTO oauth_clients (id, organization_id, display_name, client_type, redirect_uris, scopes)
  VALUES ('siyahtus-agent-app-' || v_org::TEXT, v_org, 'SiyahTuş Agent App', 'public',
          ARRAY[p_console_redirect, 'siyahtus://auth/callback'],
          ARRAY[]::TEXT[]);

  RETURN QUERY SELECT v_account, v_license, v_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT, BOOLEAN, TEXT) TO siyahtus_app;
