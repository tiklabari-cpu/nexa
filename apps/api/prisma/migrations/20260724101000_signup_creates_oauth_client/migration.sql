-- Give a signed-up workspace an OAuth client, and stop the web app guessing
-- which client to use.
--
-- The agent app derived `client_id` from the organisation name — first word,
-- lowercased. That worked only because the seed created clients named to match.
-- A workspace created through signup had no client at all, so the new owner
-- got a 201 and then could not sign in: the failure landed on `/auth/authorize`
-- and surfaced as "could not create that workspace", which is not what
-- happened. Found in the browser; the integration test missed it because it
-- only exercised `/auth/login`, which needs no client.
--
-- The guess was also a collision waiting to happen — "Acme Bikes" and
-- "Acme Tools" both reduce to `acme`, and client_id is a primary key. Ids are
-- now derived from the organisation's uuid, and `auth_list_memberships`
-- returns the id so nothing has to guess it.
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

  -- Public client: OAuth 2.1 uses PKCE rather than a secret for anything
  -- running in a browser, where no secret stays secret.
  INSERT INTO oauth_clients (id, organization_id, display_name, client_type, redirect_uris, scopes)
  VALUES ('nexa-agent-app-' || v_org::TEXT, v_org, 'Nexa Agent App', 'public',
          ARRAY['http://localhost:5173/auth/callback'], ARRAY[]::TEXT[]);

  RETURN QUERY SELECT v_account, v_license, v_org;
END;
$$;

-- Hand the client id back with the membership, so the caller never guesses.
DROP FUNCTION IF EXISTS auth_list_memberships(UUID);

CREATE FUNCTION auth_list_memberships(p_account_id UUID)
RETURNS TABLE (
  license_id BIGINT,
  organization_id UUID,
  role TEXT,
  license_status TEXT,
  organization_name TEXT,
  client_id TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.license_id, l.organization_id, m.role, l.status, o.name,
         (SELECT c.id FROM oauth_clients c
           WHERE c.organization_id = l.organization_id
           ORDER BY c.created_at
           LIMIT 1)
  FROM agent_memberships m
  JOIN licenses l      ON l.id = m.license_id
  JOIN organizations o ON o.id = l.organization_id
  WHERE m.agent_id = p_account_id
    AND NOT m.suspended
  ORDER BY l.id;
$$;

REVOKE EXECUTE ON FUNCTION auth_list_memberships(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_list_memberships(UUID) TO nexa_app;
