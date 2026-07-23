-- Raise the duplicate-email case as a plain plpgsql exception (P0001).
--
-- With `ERRCODE = 'unique_violation'` the driver maps it to its own
-- "unique constraint failed" and discards the message, so the service could not
-- tell this apart from any other unique violation and returned 500 instead of
-- the 409 the contract promises.
CREATE OR REPLACE FUNCTION auth_signup(
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
    RAISE EXCEPTION 'nexa_account_exists';
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
