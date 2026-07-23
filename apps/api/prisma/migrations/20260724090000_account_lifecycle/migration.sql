-- Account lifecycle: signup, password recovery, team invitations.
-- PRD FR-MOD-00.2, 00.3, 04.3.1, 04.4.
--
-- Neither table is in PRD §8.4 — the schema there describes a workspace that
-- already exists and says nothing about how one comes into being. Recorded as
-- deviation D12 in PLAN.md.

-- Reset tokens are stored only as a hash. A leaked backup or a careless log of
-- this table must not be a set of working password-reset links.
CREATE TABLE password_reset_tokens (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID         NOT NULL,
    "token_hash" TEXT         NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at"    TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_tokens_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX password_reset_tokens_token_hash_key ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_tokens_account_id_idx ON password_reset_tokens (account_id);

CREATE TABLE invitations (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "license_id"      BIGINT       NOT NULL,
    "organization_id" UUID         NOT NULL,
    "email"           CITEXT       NOT NULL,
    "role"            TEXT         NOT NULL,
    "token_hash"      TEXT         NOT NULL,
    "invited_by_id"   UUID         NOT NULL,
    "expires_at"      TIMESTAMPTZ(6) NOT NULL,
    "accepted_at"     TIMESTAMPTZ(6),
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE,
    CONSTRAINT "invitations_invited_by_id_fkey"
      FOREIGN KEY ("invited_by_id") REFERENCES "accounts"("id") ON DELETE CASCADE,
    -- `owner` is absent on purpose: ownership transfers deliberately, not by
    -- an email someone can forward.
    CONSTRAINT invitations_role_check CHECK (role IN ('admin', 'agent'))
);

CREATE UNIQUE INDEX invitations_token_hash_key ON invitations (token_hash);
CREATE INDEX invitations_license_id_idx ON invitations (license_id, created_at DESC);

-- One live invitation per person per workspace. Two working links to the same
-- workspace for the same address is one more than anyone wanted, and revoking
-- "the" invitation would leave the other one open.
CREATE UNIQUE INDEX uq_one_pending_invitation
  ON invitations (license_id, email) WHERE accepted_at IS NULL;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitations_tenant ON invitations
  USING (license_id = nexa_current_license())
  WITH CHECK (license_id = nexa_current_license());

-- `password_reset_tokens` gets RLS with no permissive policy at all: every row
-- is invisible to the application role. Nothing in a tenant-scoped request has
-- any business reading a reset token, and the only code that needs them is the
-- SECURITY DEFINER pair below, which never returns the token itself.
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO nexa_app;

-- ---------------------------------------------------------------------------
-- Pre-auth entry points.
--
-- These run before a tenant context exists — signup is literally the request
-- that creates the tenant — so they follow the same shape as the widget-origin
-- resolver: one SECURITY DEFINER function per specific need, each returning the
-- minimum, rather than relaxing RLS for the application role.
-- ---------------------------------------------------------------------------

-- Signup: organization + licence + account + owner membership, or nothing.
-- Doing this in four application-level statements would let a crash halfway
-- leave someone with an account that belongs to no workspace and no way to say so.
CREATE OR REPLACE FUNCTION auth_signup(
  p_email             CITEXT,
  p_name              TEXT,
  p_password_hash     TEXT,
  p_organization_name TEXT,
  p_trial_days        INT
)
RETURNS TABLE (account_id UUID, license_id BIGINT, organization_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org     UUID;
  v_license BIGINT;
  v_account UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM accounts a WHERE a.email = p_email) THEN
    -- Surfaced to the caller as 409. Unlike password recovery, hiding this
    -- would strand someone who already has an account.
    RAISE EXCEPTION 'account_exists' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO organizations (name, region) VALUES (p_organization_name, 'eu')
  RETURNING id INTO v_org;

  INSERT INTO licenses (organization_id, plan, status, trial_ends_at)
  VALUES (v_org, 'growth', 'trialing', now() + make_interval(days => p_trial_days))
  RETURNING id INTO v_license;

  INSERT INTO accounts (email, name, password_hash)
  VALUES (p_email, p_name, p_password_hash)
  RETURNING id INTO v_account;

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_license, v_account, 'owner', 'accepting_chats');

  RETURN QUERY SELECT v_account, v_license, v_org;
END;
$$;

-- Records a reset token for an address, and reports nothing about whether the
-- address was real. The caller is expected to answer identically either way;
-- returning void rather than a boolean removes the temptation not to.
CREATE OR REPLACE FUNCTION auth_request_password_reset(
  p_email      CITEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT a.id INTO v_account FROM accounts a WHERE a.email = p_email;
  IF v_account IS NULL THEN
    RETURN;
  END IF;

  -- Any earlier outstanding token for this account is spent. Asking for a
  -- second link is how someone reacts to thinking the first one leaked.
  UPDATE password_reset_tokens
     SET used_at = now()
   WHERE account_id = v_account AND used_at IS NULL;

  INSERT INTO password_reset_tokens (account_id, token_hash, expires_at)
  VALUES (v_account, p_token_hash, p_expires_at);
END;
$$;

-- Consumes a token and sets the password. Returns the account on success and
-- nothing on failure, so "unknown", "expired" and "already used" are one answer.
CREATE OR REPLACE FUNCTION auth_consume_password_reset(
  p_token_hash    TEXT,
  p_password_hash TEXT
)
RETURNS TABLE (account_id UUID)
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

  UPDATE accounts SET password_hash = p_password_hash WHERE id = v_account;

  -- A reset is what someone does when they believe another person is in their
  -- account. Leaving that person signed in defeats the exercise.
  UPDATE oauth_refresh_tokens SET revoked_at = now()
   WHERE account_id = v_account AND revoked_at IS NULL;

  RETURN QUERY SELECT v_account;
END;
$$;

CREATE OR REPLACE FUNCTION auth_preview_invitation(p_token_hash TEXT)
RETURNS TABLE (organization_name TEXT, email TEXT, role TEXT, needs_password BOOLEAN)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT o.name,
         i.email::TEXT,
         i.role,
         NOT EXISTS (SELECT 1 FROM accounts a WHERE a.email = i.email)
  FROM invitations i
  JOIN organizations o ON o.id = i.organization_id
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL
    AND i.expires_at > now();
$$;

-- Accepts an invitation. If the address already has an account it gains a
-- membership; a second account would split one person's history in two
-- (PRD §8.4: accounts.email is unique).
CREATE OR REPLACE FUNCTION auth_accept_invitation(
  p_token_hash    TEXT,
  p_name          TEXT,
  p_password_hash TEXT
)
RETURNS TABLE (account_id UUID, license_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite  invitations%ROWTYPE;
  v_account UUID;
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

  SELECT a.id INTO v_account FROM accounts a WHERE a.email = v_invite.email;

  IF v_account IS NULL THEN
    IF p_password_hash IS NULL THEN
      RAISE EXCEPTION 'password_required' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO accounts (email, name, password_hash)
    VALUES (v_invite.email, COALESCE(p_name, split_part(v_invite.email::TEXT, '@', 1)), p_password_hash)
    RETURNING id INTO v_account;
  END IF;

  -- Already a member (invited twice, or invited after joining another way):
  -- keep the membership they have rather than silently changing their role.
  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_invite.license_id, v_account, v_invite.role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;

  RETURN QUERY SELECT v_account, v_invite.license_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_request_password_reset(CITEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_consume_password_reset(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_preview_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_request_password_reset(CITEXT, TEXT, TIMESTAMPTZ) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_consume_password_reset(TEXT, TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_preview_invitation(TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT) TO nexa_app;
