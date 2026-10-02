-- Sign-up email verification (tm 257.7 · ADR docs/adr/pilot-public-readiness.md
-- K-e(1) · PLAN §D203).
--
-- Public sign-up checked no email: anyone could open a workspace under any
-- address, and the address's real owner would later be told it "already has an
-- account". With `SIGNUP_EMAIL_VERIFICATION=true` a new owner proves the
-- mailbox *and* the password before the first session — a link alone would let
-- whoever reads the mail activate somebody else's password, a password alone is
-- what the squatter already has.
--
-- Expand-only (CONVENTIONS §6.3): one nullable column, one table, functions
-- re-created with defaulted trailing arguments so an API still running the
-- previous release calls them exactly as before and gets exactly what it got.

-- --------------------------------------------------------------------------
-- 1. accounts.email_verified_at
-- --------------------------------------------------------------------------
-- Null means nobody has proved this address. Three statements, in this order:
--
--   * the column, nullable and without a default, so the backfill below is the
--     only thing that fills it;
--   * the backfill — EVERY account that exists today is verified, at the moment
--     it was created. Without it, switching the flag on would lock out the
--     operator, the seed and every invited teammate in one restart;
--   * the default, `now()`, for every account written from here on by a path
--     other than public sign-up. Each of those proves the address its own way —
--     an invitation is a link mailed to it, SSO just-in-time provisioning and
--     SCIM are the workspace's identity provider vouching for a verified domain,
--     the seed and the test fixtures are the operator — and none of them is
--     re-created here, so the default is what keeps them verified, including in
--     an API process from before this release. `auth_signup` is the one writer
--     that says otherwise, and only when the deployment asks it to.
ALTER TABLE accounts ADD COLUMN email_verified_at TIMESTAMPTZ(6);

UPDATE accounts SET email_verified_at = created_at WHERE email_verified_at IS NULL;

ALTER TABLE accounts ALTER COLUMN email_verified_at SET DEFAULT now();

-- --------------------------------------------------------------------------
-- 2. email_verification_tokens
-- --------------------------------------------------------------------------
-- `password_reset_tokens`' design, one for one, as it stands after
-- 20260724090000 and the two alignments that followed it: stored only as a
-- SHA-256 hash, so a leaked backup is not a set of working links; RLS on with
-- no permissive policy, so the application role sees no row and only the
-- SECURITY DEFINER functions below touch them. No database-side id default
-- (the functions supply `gen_random_uuid()`, Prisma's `@default(uuid())` is
-- client-side — 20260724091000) and `ON UPDATE CASCADE` like every other
-- foreign key (20260724092000), so the drift check has nothing to report.
CREATE TABLE email_verification_tokens (
    "id"         UUID           NOT NULL,
    "account_id" UUID           NOT NULL,
    "token_hash" TEXT           NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at"    TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_verification_tokens_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX email_verification_tokens_token_hash_key ON email_verification_tokens (token_hash);
CREATE INDEX email_verification_tokens_account_id_idx ON email_verification_tokens (account_id);

ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON email_verification_tokens TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 3. The one place an address becomes verified
-- --------------------------------------------------------------------------
-- Called by the three things that prove a mailbox: the verification link
-- (with the password), a completed password reset, and an accepted invitation.
-- Not callable by the application role — only from the SECURITY DEFINER
-- functions below, which run as this function's owner.
--
-- Returns whether this call did it, so it acts once: the outstanding links are
-- spent, and the trial clock restarts. The trial of a workspace opened by an
-- unverified owner starts when the owner proves the address, not when somebody
-- typed it — otherwise a link opened on day three buys an eleven-day trial.
-- Only an owned, still-trialing licence is touched, and only when the caller
-- passes a length (`TRIAL_DAYS`); an older API passes none.
CREATE FUNCTION auth_mark_email_verified(p_account UUID, p_trial_days INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE accounts a SET email_verified_at = now()
   WHERE a.id = p_account AND a.email_verified_at IS NULL;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE email_verification_tokens t SET used_at = now()
   WHERE t.account_id = p_account AND t.used_at IS NULL;

  IF p_trial_days IS NOT NULL THEN
    UPDATE licenses l
       SET trial_ends_at = now() + make_interval(days => p_trial_days)
     WHERE l.status = 'trialing'
       AND l.id IN (SELECT m.license_id FROM agent_memberships m
                     WHERE m.agent_id = p_account AND m.role = 'owner');
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_mark_email_verified(UUID, INT) FROM PUBLIC;

-- --------------------------------------------------------------------------
-- 4. auth_signup — can create an owner nobody has verified yet
-- --------------------------------------------------------------------------
-- A new trailing argument is a new signature, so `DROP` + `CREATE` (the
-- 20260925120000 rule). Defaulted to TRUE: an API from before this release
-- calls with seven arguments and gets a verified owner, as it always did. The
-- body is 20260925120000's verbatim except the account insert.
DROP FUNCTION IF EXISTS auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT);

CREATE FUNCTION auth_signup(
  p_email             CITEXT,
  p_name              TEXT,
  p_password_hash     TEXT,
  p_organization_name TEXT,
  p_trial_days        INT,
  p_region            TEXT DEFAULT 'eu',
  p_console_redirect  TEXT DEFAULT 'http://localhost:5173/auth/callback',
  p_email_verified    BOOLEAN DEFAULT TRUE
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

  INSERT INTO licenses (organization_id, plan, status, trial_ends_at)
  VALUES (v_org, 'growth', 'trialing', now() + make_interval(days => p_trial_days))
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

REVOKE EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT, BOOLEAN) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 5. Issuing a verification link
-- --------------------------------------------------------------------------
-- `auth_request_password_reset`'s shape (20260724100000): records a token only
-- for an account that exists AND is still unverified, spends the earlier ones
-- (asking again is how someone reacts to a lost or leaked mail), and reports
-- what it recorded — the account's id, so the caller can write the trail after
-- answering without a second lookup; NULL when nothing was recorded. Knowing
-- is fine; the route answers the same body either way.
CREATE FUNCTION auth_request_email_verification(
  p_email      CITEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT a.id INTO v_account FROM accounts a
   WHERE a.email = p_email AND a.email_verified_at IS NULL;
  IF v_account IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE email_verification_tokens t SET used_at = now()
   WHERE t.account_id = v_account AND t.used_at IS NULL;

  INSERT INTO email_verification_tokens (id, account_id, token_hash, expires_at)
  VALUES (gen_random_uuid(), v_account, p_token_hash, p_expires_at);

  RETURN v_account;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_request_email_verification(CITEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_request_email_verification(CITEXT, TEXT, TIMESTAMPTZ) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 6. Redeeming a link: token AND password
-- --------------------------------------------------------------------------
-- Two steps, because the password is checked in the API (scrypt lives there)
-- and the token must not be spent by a wrong one.
--
-- The lookup hands back the hash to verify against — the same disclosure
-- `auth_find_account_for_login` makes, to the same caller. It reads; it spends
-- nothing.
CREATE FUNCTION auth_find_email_verification(p_token_hash TEXT)
RETURNS TABLE (pending_account UUID, password_hash TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.password_hash
  FROM email_verification_tokens t
  JOIN accounts a ON a.id = t.account_id
  WHERE t.token_hash = p_token_hash
    AND t.used_at IS NULL
    AND t.expires_at > now();
$$;

-- Spends the token only if the account's password is still the one the API just
-- verified (`p_password_hash`, read by the lookup above) — a reset that landed
-- in between makes this match nothing — then marks the address verified.
-- Unknown, expired, used and changed-underneath are one empty answer. The
-- email and name come back with the id, as `auth_accept_invitation`'s do: the
-- caller has no tenant context to read them with afterwards.
CREATE FUNCTION auth_consume_email_verification(
  p_token_hash    TEXT,
  p_password_hash TEXT,
  p_trial_days    INT
)
RETURNS TABLE (verified_account UUID, verified_email TEXT, verified_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account UUID;
  v_email   TEXT;
  v_name    TEXT;
BEGIN
  UPDATE email_verification_tokens t
     SET used_at = now()
    FROM accounts a
   WHERE t.token_hash = p_token_hash
     AND t.used_at IS NULL
     AND t.expires_at > now()
     AND a.id = t.account_id
     AND a.password_hash = p_password_hash
  RETURNING t.account_id, a.email::TEXT, a.name INTO v_account, v_email, v_name;

  IF v_account IS NULL THEN
    RETURN;
  END IF;

  PERFORM auth_mark_email_verified(v_account, p_trial_days);

  RETURN QUERY SELECT v_account, v_email, v_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_find_email_verification(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_consume_email_verification(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_email_verification(TEXT) TO siyahtus_app;
GRANT EXECUTE ON FUNCTION auth_consume_email_verification(TEXT, TEXT, INT) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 7. Reading the state at the sign-in doors
-- --------------------------------------------------------------------------
-- By address, because one of the doors (SAML) has to ask before it provisions
-- anything. NULL when no account holds the address.
CREATE FUNCTION auth_email_verified(p_email CITEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.email_verified_at IS NOT NULL FROM accounts a WHERE a.email = p_email;
$$;

REVOKE EXECUTE ON FUNCTION auth_email_verified(CITEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_email_verified(CITEXT) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 8. A completed password reset — whatever the flag says
-- --------------------------------------------------------------------------
-- Two changes to 20260724094000's body:
--
--   * it revokes the account's bearer tokens (`api_tokens`: OAuth access
--     tokens, personal access tokens, enrollment tickets), not only its refresh
--     tokens. The contract has always said "existing sessions revoked", and an
--     access token or a PAT minted by whoever the reset is meant to lock out is
--     a session. Not `scim` (a workspace's provisioning credential that merely
--     records the admin who minted it) and not `bot` (owned by a bot id);
--   * it verifies the address: the person has just read a link mailed to it and
--     chosen the password, which is everything the verification link proves.
--
-- New trailing argument → new signature → `DROP` + `CREATE`; defaulted to NULL,
-- so an older API's two-argument call restarts no trial.
DROP FUNCTION IF EXISTS auth_consume_password_reset(TEXT, TEXT);

CREATE FUNCTION auth_consume_password_reset(
  p_token_hash    TEXT,
  p_password_hash TEXT,
  p_trial_days    INT DEFAULT NULL
)
RETURNS TABLE (reset_account UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account UUID;
BEGIN
  UPDATE password_reset_tokens t
     SET used_at = now()
   WHERE t.token_hash = p_token_hash
     AND t.used_at IS NULL
     AND t.expires_at > now()
  RETURNING t.account_id INTO v_account;

  IF v_account IS NULL THEN
    RETURN;
  END IF;

  UPDATE accounts a SET password_hash = p_password_hash WHERE a.id = v_account;

  UPDATE oauth_refresh_tokens r SET revoked_at = now()
   WHERE r.account_id = v_account AND r.revoked_at IS NULL;

  UPDATE api_tokens k SET revoked_at = now()
   WHERE k.owner_id = v_account::TEXT
     AND k.kind IN ('pat', 'oauth', 'enrollment')
     AND k.revoked_at IS NULL;

  PERFORM auth_mark_email_verified(v_account, p_trial_days);

  RETURN QUERY SELECT v_account;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_consume_password_reset(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_consume_password_reset(TEXT, TEXT, INT) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 9. Invitations to an address nobody has verified
-- --------------------------------------------------------------------------
-- An invitation joins an existing account without asking for its password.
-- Until now every account's address was as good as proven; an unverified one
-- may have been typed by a stranger, and joining it would hand the invited
-- workspace to the stranger's password. So such an account is treated like a
-- newcomer: the preview asks for a password, and accepting sets it, verifies
-- the address (the invitee has just opened a link mailed there) and revokes
-- every session the old password opened.
--
-- Keyed on the account's state, not the flag: with the flag off no unverified
-- account is ever created, and one left over from a time it was on is no more
-- trustworthy for the flag having been turned off since.
CREATE OR REPLACE FUNCTION auth_preview_invitation(p_token_hash TEXT)
RETURNS TABLE (organization_name TEXT, email TEXT, role TEXT, needs_password BOOLEAN)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT o.name,
         i.email::TEXT,
         i.role,
         NOT EXISTS (SELECT 1 FROM accounts a
                      WHERE a.email = i.email AND a.email_verified_at IS NOT NULL)
  FROM invitations i
  JOIN organizations o ON o.id = i.organization_id
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL
    AND i.expires_at > now();
$$;

-- 20260724096000's body plus the unverified branch; `DROP` + `CREATE` for the
-- defaulted trailing argument, as above.
DROP FUNCTION IF EXISTS auth_accept_invitation(TEXT, TEXT, TEXT);

CREATE FUNCTION auth_accept_invitation(
  p_token_hash    TEXT,
  p_name          TEXT,
  p_password_hash TEXT,
  p_trial_days    INT DEFAULT NULL
)
RETURNS TABLE (joined_account UUID, joined_license BIGINT, joined_email TEXT, joined_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite   invitations%ROWTYPE;
  v_account  UUID;
  v_email    TEXT;
  v_name     TEXT;
  v_verified BOOLEAN;
BEGIN
  UPDATE invitations i
     SET accepted_at = now()
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.expires_at > now()
  RETURNING i.* INTO v_invite;

  IF v_invite.id IS NULL THEN
    RETURN;
  END IF;

  SELECT a.id, a.email::TEXT, a.name, a.email_verified_at IS NOT NULL
    INTO v_account, v_email, v_name, v_verified
  FROM accounts a WHERE a.email = v_invite.email;

  IF v_account IS NULL THEN
    IF p_password_hash IS NULL THEN
      RAISE EXCEPTION 'siyahtus_password_required';
    END IF;
    v_account := gen_random_uuid();
    v_email   := v_invite.email::TEXT;
    v_name    := COALESCE(p_name, split_part(v_invite.email::TEXT, '@', 1));
    INSERT INTO accounts (id, email, name, password_hash)
    VALUES (v_account, v_invite.email, v_name, p_password_hash);
  ELSIF NOT v_verified THEN
    IF p_password_hash IS NULL THEN
      RAISE EXCEPTION 'siyahtus_password_required';
    END IF;
    v_name := COALESCE(p_name, v_name);
    UPDATE accounts a SET password_hash = p_password_hash, name = v_name WHERE a.id = v_account;

    UPDATE oauth_refresh_tokens r SET revoked_at = now()
     WHERE r.account_id = v_account AND r.revoked_at IS NULL;
    UPDATE api_tokens k SET revoked_at = now()
     WHERE k.owner_id = v_account::TEXT
       AND k.kind IN ('pat', 'oauth', 'enrollment')
       AND k.revoked_at IS NULL;

    PERFORM auth_mark_email_verified(v_account, p_trial_days);
  END IF;

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_invite.license_id, v_account, v_invite.role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;

  RETURN QUERY SELECT v_account, v_invite.license_id, v_email, v_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT, INT) TO siyahtus_app;
