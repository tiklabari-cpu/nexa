-- Impersonation credentials, tenant half (tm 389.2 · docs/platform-admin/design.md §B3, §G).
--
-- The platform (389.15) opens a `platform_impersonation_sessions` row with a
-- one-time handoff code; the operator's browser brings the code to the tenant
-- API, which trades it here for an ordinary bearer token of a new kind. This
-- migration is the storage and the trade; nothing in the tenant API mints or
-- honours the kind yet — `token-service.ts` refuses it until 389.15 puts the
-- impersonation gate in front of it.

-- ---------------------------------------------------------------------------
-- 1. api_tokens.kind += 'impersonation', + impersonation_session_id
-- ---------------------------------------------------------------------------
ALTER TABLE api_tokens ADD COLUMN impersonation_session_id UUID;

ALTER TABLE api_tokens DROP CONSTRAINT api_tokens_kind_check;
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_kind_check
  CHECK (kind IN ('pat', 'oauth', 'bot', 'scim', 'enrollment', 'impersonation'))
  NOT VALID;
ALTER TABLE api_tokens VALIDATE CONSTRAINT api_tokens_kind_check;

-- An impersonation token names its session, and only it does. No existing row
-- is of the new kind or carries the column, so this refuses nothing stored.
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_impersonation_session_check
  CHECK ((kind = 'impersonation') = (impersonation_session_id IS NOT NULL))
  NOT VALID;
ALTER TABLE api_tokens VALIDATE CONSTRAINT api_tokens_impersonation_session_check;

-- Ending or deleting the session takes its tokens with it: the platform ends a
-- session by stamping `ended_at` (read by auth_resolve_token below), and a
-- session row removed with its licence must not leave a live credential.
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_impersonation_session_id_fkey
  FOREIGN KEY (impersonation_session_id) REFERENCES platform_impersonation_sessions(id)
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX api_tokens_impersonation_session_id_idx ON api_tokens (impersonation_session_id);

-- ---------------------------------------------------------------------------
-- 2. auth_resolve_token — three columns more, at the end
-- ---------------------------------------------------------------------------
-- The existing twelve columns keep their names, order and meaning; the new
-- ones are appended, so a caller reading by name is unaffected. A return type
-- cannot change under CREATE OR REPLACE, hence DROP + CREATE + the grant again.
--
-- For an impersonation token the session decides as well as the token: a
-- session the platform ended reads as revoked (`revoked_at`), and one past
-- its window as expired (`expires_at`), whichever comes first — so ending a
-- session needs no second write to `api_tokens`, and a session's tokens can
-- never outlive it. For every other kind the three are NULL and the two
-- timestamps are the token's own, as before.
DROP FUNCTION auth_resolve_token(TEXT);
CREATE FUNCTION auth_resolve_token(p_token_hash TEXT)
RETURNS TABLE (
  id UUID,
  license_id BIGINT,
  organization_id UUID,
  owner_id TEXT,
  kind TEXT,
  scopes TEXT[],
  client_id TEXT,
  family_id UUID,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  license_status TEXT,
  organization_region TEXT,
  impersonation_session_id UUID,
  impersonation_mode TEXT,
  impersonation_admin_id UUID
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.license_id, t.organization_id, t.owner_id, t.kind, t.scopes,
         t.client_id, t.family_id,
         CASE WHEN s.id IS NULL THEN t.expires_at
              ELSE LEAST(t.expires_at, s.ends_at) END,
         CASE WHEN s.id IS NULL THEN t.revoked_at
              ELSE COALESCE(t.revoked_at, s.ended_at) END,
         l.status, o.region,
         s.id, s.mode, s.admin_id
  FROM api_tokens t
  JOIN licenses l ON l.id = t.license_id
  JOIN organizations o ON o.id = t.organization_id
  LEFT JOIN platform_impersonation_sessions s ON s.id = t.impersonation_session_id
  WHERE t.token_hash = p_token_hash;
$$;

REVOKE EXECUTE ON FUNCTION auth_resolve_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_token(TEXT) TO siyahtus_app;

-- ---------------------------------------------------------------------------
-- 3. auth_consume_impersonation_handoff — the one-time trade
-- ---------------------------------------------------------------------------
-- Takes the digest of the handoff code and the digest of the token the caller
-- has just generated; never either plaintext, so neither can reach a query
-- log. In one statement it clears the code (so a second call with it finds
-- nothing — two racing redemptions are serialised on the row and exactly one
-- gets it back) and, for the call that won, inserts the token: kind
-- `impersonation`, owned by the impersonated member's account, expiring with
-- the session.
--
-- A code is good once, within `handoff_expires_at` (the platform sets it 60
-- seconds out, design §G), and only for a session that is neither ended nor
-- past its window. Anything else returns no row, and the caller cannot tell
-- which miss it was. The member must still hold a live membership of the
-- licence: an operator cannot sign in as somebody the workspace removed.
--
-- The token carries no scopes of its own: what it may reach is decided when
-- it is resolved (389.15, from the member's role and the session's mode).
-- Runs SECURITY DEFINER because platform_impersonation_sessions is closed to
-- the tenant role entirely (20261101090000) and api_tokens is under RLS no
-- context has been set for yet.
CREATE FUNCTION auth_consume_impersonation_handoff(p_code_hash TEXT, p_token_hash TEXT)
RETURNS TABLE (
  token_id UUID,
  session_id UUID,
  license_id BIGINT,
  organization_id UUID,
  account_id UUID,
  admin_id UUID,
  mode TEXT,
  ends_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session platform_impersonation_sessions%ROWTYPE;
  v_organization UUID;
  v_token UUID;
BEGIN
  IF p_code_hash IS NULL OR p_code_hash = '' OR p_token_hash IS NULL OR p_token_hash = '' THEN
    RETURN;
  END IF;

  UPDATE platform_impersonation_sessions s
     SET handoff_code_hash = NULL, handoff_expires_at = NULL
   WHERE s.handoff_code_hash = p_code_hash
     AND s.handoff_expires_at > now()
     AND s.ended_at IS NULL
     AND s.ends_at > now()
  RETURNING s.* INTO v_session;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT l.organization_id INTO v_organization
    FROM licenses l
    JOIN agent_memberships m ON m.license_id = l.id
   WHERE l.id = v_session.license_id
     AND m.agent_id = v_session.account_id
     AND NOT m.suspended
     AND NOT m.awaiting_approval;
  IF NOT FOUND THEN
    -- The code is spent either way: a code that named a removed member must
    -- not become good again if the membership comes back.
    RETURN;
  END IF;

  INSERT INTO api_tokens (id, license_id, organization_id, owner_id, kind, token_hash,
                          scopes, expires_at, impersonation_session_id)
  VALUES (gen_random_uuid(), v_session.license_id, v_organization,
          v_session.account_id::text, 'impersonation', p_token_hash,
          '{}', v_session.ends_at, v_session.id)
  RETURNING api_tokens.id INTO v_token;

  RETURN QUERY SELECT v_token, v_session.id, v_session.license_id, v_organization,
                      v_session.account_id, v_session.admin_id, v_session.mode,
                      v_session.ends_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_consume_impersonation_handoff(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_consume_impersonation_handoff(TEXT, TEXT) TO siyahtus_app;
