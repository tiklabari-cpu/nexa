-- The console callback comes from the deployment, not from a literal
-- (tm 255.17 · PLAN §D189).
--
-- Every first-party OAuth client used to be registered with exactly one
-- console callback, `http://localhost:5173/auth/callback`, written into
-- `auth_signup` as a constant. The panel sends
-- `${window.location.origin}/auth/callback`, and matching is exact
-- (`OauthService.isRegisteredRedirect`), so on any address but the development
-- one — the pilot's `https://panel.<domain>`, or even its rehearsal on
-- `http://localhost:15173` (measured, tm 255.15) — every owner who signed up was
-- refused at `/auth/authorize` with "redirect_uri is not registered".
--
-- The address is configuration (`WEB_APP_URL`), and configuration lives in the
-- process, not in the database. So the API hands it in:
--
--   * at signup, as a new `auth_signup` argument, into the same transaction
--     that creates the client — a new workspace is never without it;
--   * at boot, through `auth_register_console_redirect`, for every first-party
--     client that already exists — the expand-only path for workspaces opened
--     before this, or before a deployment's `WEB_APP_URL` changed (CONVENTIONS
--     §6.3: it appends, it never removes).
--
-- Neither takes the value from a request. The only caller of either function is
-- the API's own code, passing `env.consoleRedirectUri`; the `redirect_uri` a
-- client sends is what gets checked against the list, never what writes it.

-- --------------------------------------------------------------------------
-- The one rule both functions apply
-- --------------------------------------------------------------------------
-- Character for character the pattern in `src/lib/console-redirect.ts`
-- (`CONSOLE_REDIRECT_PATTERN`): `https` on any host, or plain `http` on
-- loopback, then exactly `/auth/callback`. Checked in the database as well as
-- at boot because these are SECURITY DEFINER functions the runtime role can
-- call with any text it likes — defence in depth against a caller that is not
-- the one this file was written for. `isRegisteredRedirect` would refuse
-- anything else at sign-in anyway, so a refusal here only moves the failure to
-- the place that can name it.
CREATE FUNCTION auth_console_redirect_admissible(p_redirect TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_redirect IS NOT NULL
     AND p_redirect ~ '^(https://[a-z0-9.-]+(:[0-9]{1,5})?|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?)/auth/callback$'
$$;

-- --------------------------------------------------------------------------
-- New workspaces
-- --------------------------------------------------------------------------
-- A new trailing argument means a new signature, so `DROP` + `CREATE` rather
-- than `CREATE OR REPLACE` (which would leave the six-argument version beside
-- it as a second overload a six-argument call could still resolve to).
--
-- The argument has a default, and the default is the old constant: an API
-- process still running the previous release during a rollout calls with six
-- arguments and gets exactly what it got before (CONVENTIONS §6.3 — the old
-- code keeps working against the new schema). The body is
-- `20260816120000_mobile_native_redirect`'s with the console literal replaced
-- by the argument; everything else is reproduced verbatim, because a replace is
-- whole-body.
--
-- Decision (§D189): the new client registers the deployment's callback
-- *instead of* the development one, not beside it. On a real domain a
-- `localhost` callback is a door nobody uses and any local process on port
-- 5173 could answer; on the development stack the two are the same value
-- (`WEB_APP_URL` defaults to `http://localhost:5173`), so nothing changes there.
DROP FUNCTION IF EXISTS auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT);

CREATE FUNCTION auth_signup(
  p_email             CITEXT,
  p_name              TEXT,
  p_password_hash     TEXT,
  p_organization_name TEXT,
  p_trial_days        INT,
  p_region            TEXT DEFAULT 'eu',
  p_console_redirect  TEXT DEFAULT 'http://localhost:5173/auth/callback'
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
  -- callbacks, one client: this deployment's console and the mobile app.
  INSERT INTO oauth_clients (id, organization_id, display_name, client_type, redirect_uris, scopes)
  VALUES ('nexa-agent-app-' || v_org::TEXT, v_org, 'Nexa Agent App', 'public',
          ARRAY[p_console_redirect, 'nexa://auth/callback'],
          ARRAY[]::TEXT[]);

  RETURN QUERY SELECT v_account, v_license, v_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT) TO nexa_app;

-- --------------------------------------------------------------------------
-- Existing workspaces
-- --------------------------------------------------------------------------
-- A migration cannot do this part itself: it does not know the deployment's
-- address. The API calls this at every boot with its own `WEB_APP_URL`-derived
-- callback; after the first boot on a given address it matches no row and
-- writes nothing.
--
-- Expand-only. It appends and never removes — so a workspace opened before
-- this keeps its `localhost` callback (removing it is a contraction, and
-- whether to is the owner's decision, §D189), and a deployment that moves to a
-- new address keeps accepting the old one until someone takes it out.
--
-- Scoped by id prefix, the rule `20260816120000_mobile_native_redirect` set
-- down: first-party clients (`auth_signup`, `sandbox_create`, the demo seed)
-- are `nexa-agent-app-…` / `nexa-sandbox-app-…`; a partner's is 32 hex from
-- `generateClientId` and is never touched — its redirects belong to whoever
-- registered the app.
--
-- Two replicas booting together is safe: the second one's UPDATE waits on the
-- first one's row locks, re-checks `NOT (… = ANY …)` against the committed row
-- and skips it, so the callback is never appended twice. `lock_timeout` keeps a
-- boot from hanging behind a long transaction on the table; the caller treats a
-- failure as a logged error, not a fatal one.
CREATE FUNCTION auth_register_console_redirect(p_redirect TEXT)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT auth_console_redirect_admissible(p_redirect) THEN
    RAISE EXCEPTION 'console redirect % is not an admissible callback', p_redirect
      USING ERRCODE = '22023';
  END IF;

  UPDATE oauth_clients
     SET redirect_uris = redirect_uris || ARRAY[p_redirect]
   WHERE (id LIKE 'nexa-agent-app-%' OR id LIKE 'nexa-sandbox-app-%')
     AND NOT (p_redirect = ANY (redirect_uris));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_register_console_redirect(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_register_console_redirect(TEXT) TO nexa_app;
