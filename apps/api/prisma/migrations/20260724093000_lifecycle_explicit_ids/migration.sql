-- The lifecycle functions insert rows from inside the database, so they have to
-- supply the ids themselves.
--
-- Every id column in this schema except `licenses` is filled by the writer
-- rather than by a column default — that is Prisma's `@default(uuid())`, and the
-- earlier migration in this slice removed the one database-side default that
-- disagreed with it. These functions are writers too; they were relying on a
-- default that, correctly, is not there. Found by the tests as a not-null
-- violation on the very first real password-reset request.
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
  v_org     UUID := gen_random_uuid();
  v_license BIGINT;
  v_account UUID := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM accounts a WHERE a.email = p_email) THEN
    RAISE EXCEPTION 'account_exists' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO organizations (id, name, region) VALUES (v_org, p_organization_name, 'eu');

  INSERT INTO licenses (organization_id, plan, status, trial_ends_at)
  VALUES (v_org, 'growth', 'trialing', now() + make_interval(days => p_trial_days))
  RETURNING id INTO v_license;

  INSERT INTO accounts (id, email, name, password_hash)
  VALUES (v_account, p_email, p_name, p_password_hash);

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_license, v_account, 'owner', 'accepting_chats');

  RETURN QUERY SELECT v_account, v_license, v_org;
END;
$$;

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

  UPDATE password_reset_tokens
     SET used_at = now()
   WHERE account_id = v_account AND used_at IS NULL;

  INSERT INTO password_reset_tokens (id, account_id, token_hash, expires_at)
  VALUES (gen_random_uuid(), v_account, p_token_hash, p_expires_at);
END;
$$;

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
    v_account := gen_random_uuid();
    INSERT INTO accounts (id, email, name, password_hash)
    VALUES (v_account, v_invite.email,
            COALESCE(p_name, split_part(v_invite.email::TEXT, '@', 1)), p_password_hash);
  END IF;

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_invite.license_id, v_account, v_invite.role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;

  RETURN QUERY SELECT v_account, v_invite.license_id;
END;
$$;
