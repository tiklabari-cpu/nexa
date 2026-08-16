-- Register the phone's way back in (FR-MOD-13.7 · 13.7-b).
--
-- A native app cannot receive an `https` redirect: nothing on the device is
-- listening for one, and routing the code through a hosted page would put it in
-- a browser the app does not control. RFC 8252 §7.1 answers this with a
-- private-use URI scheme the operating system hands back to the app, and
-- `nexa://auth/callback` is Nexa's (`@nexa/types` · `MOBILE_REDIRECT_URI`).
--
-- No new client and no new grant. The mobile app signs in as the workspace's
-- existing public client, through the same `/auth/authorize` → `/auth/token`
-- pair the console uses, with the same mandatory S256 PKCE. Registering a
-- second callback on that client is the whole change: a second token-issuing
-- path would be a second place for the rules to be wrong.
--
-- Sharing one client between the console and the phone is safe precisely
-- because matching is exact and PKCE is mandatory. A hostile app that claims
-- `nexa://` on the same device can win the callback and read the code — the
-- collision RFC 8252 warns about — but it holds no verifier, so the code cannot
-- be exchanged. The cost of that race is a sign-in that has to be retried, not
-- a session in somebody else's hands.

-- --------------------------------------------------------------------------
-- Existing workspaces
-- --------------------------------------------------------------------------
-- Scoped by id prefix, which is the first-party naming convention every path
-- that mints one of these follows (`auth_signup`, `sandbox_create`, the demo
-- seed). Partner-registered clients get a 32-hex id from `generateClientId`, so
-- they cannot be caught by it — and they must not be: a redirect belongs to
-- whoever registered the app, and adding one on their behalf would silently
-- widen an allowlist its owner never touched.
UPDATE oauth_clients
   SET redirect_uris = redirect_uris || ARRAY['nexa://auth/callback']
 WHERE (id LIKE 'nexa-agent-app-%' OR id LIKE 'nexa-sandbox-app-%')
   AND NOT ('nexa://auth/callback' = ANY (redirect_uris));

-- --------------------------------------------------------------------------
-- New workspaces
-- --------------------------------------------------------------------------
-- `CREATE OR REPLACE`, not `DROP` + `CREATE`: the signature is unchanged, so
-- there is no second overload to be resolved against by accident and the
-- existing grants stay in place. The body is `20260815090000_region_us`'s with
-- one array literal widened — everything else is reproduced verbatim, because
-- a replace is whole-body and a "shortened" version would quietly drop the
-- brand row or the membership.
--
-- `sandbox_create` needs no change: it copies its parent's registered
-- redirects rather than hard-coding any, so a sandbox opened after this
-- migration inherits the native callback with the rest.
CREATE OR REPLACE FUNCTION auth_signup(
  p_email             CITEXT,
  p_name              TEXT,
  p_password_hash     TEXT,
  p_organization_name TEXT,
  p_trial_days        INT,
  p_region            TEXT DEFAULT 'eu'
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

  INSERT INTO accounts (id, email, name, password_hash)
  VALUES (v_account, p_email, p_name, p_password_hash);

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_license, v_account, 'owner', 'accepting_chats');

  -- Public client: OAuth 2.1 uses PKCE rather than a secret for anything
  -- running in a browser or on a phone, where no secret stays secret. Two
  -- callbacks, one client: the console's and the mobile app's.
  INSERT INTO oauth_clients (id, organization_id, display_name, client_type, redirect_uris, scopes)
  VALUES ('nexa-agent-app-' || v_org::TEXT, v_org, 'Nexa Agent App', 'public',
          ARRAY['http://localhost:5173/auth/callback', 'nexa://auth/callback'],
          ARRAY[]::TEXT[]);

  RETURN QUERY SELECT v_account, v_license, v_org;
END;
$$;
