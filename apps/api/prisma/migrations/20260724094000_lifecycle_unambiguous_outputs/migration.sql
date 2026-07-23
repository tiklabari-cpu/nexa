-- Rename the OUT parameters so they cannot collide with column names.
--
-- `RETURNS TABLE (account_id ...)` declares a plpgsql variable called
-- `account_id`, and every table these functions touch has a column by that
-- name. Postgres then refuses the statement with 42702 "column reference is
-- ambiguous" — but only on the branch that actually runs it, which is why a
-- direct psql call against a non-matching token looked fine and the real
-- request did not.
--
-- The alternative (`#variable_conflict use_column`) resolves it silently in one
-- direction, which is the wrong trade for code that assigns permissions.
DROP FUNCTION IF EXISTS auth_signup(CITEXT, TEXT, TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS auth_consume_password_reset(TEXT, TEXT);
DROP FUNCTION IF EXISTS auth_accept_invitation(TEXT, TEXT, TEXT);

CREATE FUNCTION auth_signup(
  p_email             CITEXT,
  p_name              TEXT,
  p_password_hash     TEXT,
  p_organization_name TEXT,
  p_trial_days        INT
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

CREATE FUNCTION auth_consume_password_reset(p_token_hash TEXT, p_password_hash TEXT)
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

  RETURN QUERY SELECT v_account;
END;
$$;

CREATE FUNCTION auth_accept_invitation(
  p_token_hash    TEXT,
  p_name          TEXT,
  p_password_hash TEXT
)
RETURNS TABLE (joined_account UUID, joined_license BIGINT)
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

REVOKE EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_consume_password_reset(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_consume_password_reset(TEXT, TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT) TO nexa_app;
