-- "Enter as the customer", the tenant API's last two pieces (tm 389.15 ·
-- FR-ADMIN-21 · docs/platform-admin/design.md §G). Functions only: the tables
-- and the trade itself are tm 389.2's (20261101150000).

-- ---------------------------------------------------------------------------
-- 1. auth_end_impersonation — the console banner's "End session"
-- ---------------------------------------------------------------------------
-- The operator signed in as a member ends the session from inside the
-- workspace. The tenant role cannot touch platform_impersonation_sessions
-- (20261101090000 closes it entirely), so the end goes through here, and it is
-- keyed by the digest of the token presented rather than by a session id: the
-- caller proves it holds a token of the session it ends, the way revoking a
-- token proves it by presenting it. No plaintext reaches a query log.
--
-- `ended` is false when the session had already ended (from the root panel,
-- or by an earlier call) — the row still names it, so the caller can record
-- who it was. A token that is not an impersonation token returns no row.
-- Ending stamps the session only: auth_resolve_token reads `ended_at` as the
-- revocation of every token the session was traded for.
CREATE FUNCTION auth_end_impersonation(p_token_hash TEXT)
RETURNS TABLE (
  session_id UUID,
  license_id BIGINT,
  account_id UUID,
  admin_id UUID,
  ended BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session UUID;
  v_changed BOOLEAN;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash = '' THEN
    RETURN;
  END IF;

  SELECT t.impersonation_session_id INTO v_session
    FROM api_tokens t
   WHERE t.token_hash = p_token_hash
     AND t.kind = 'impersonation';
  IF v_session IS NULL THEN
    RETURN;
  END IF;

  UPDATE platform_impersonation_sessions s
     SET ended_at = now(), end_reason = 'ended_in_workspace'
   WHERE s.id = v_session
     AND s.ended_at IS NULL;
  v_changed := FOUND;

  RETURN QUERY
    SELECT s.id, s.license_id, s.account_id, s.admin_id, v_changed
      FROM platform_impersonation_sessions s
     WHERE s.id = v_session;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_end_impersonation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_end_impersonation(TEXT) TO siyahtus_app;

-- ---------------------------------------------------------------------------
-- 2. auth_consume_impersonation_handoff — a suspended person is nobody to be
-- ---------------------------------------------------------------------------
-- Since tm 389.11 the root panel can suspend a person in every workspace
-- (`accounts.platform_suspended_at`). `token-service.ts` refuses every token
-- such a person holds, so a token minted here for one would be dead on
-- arrival; refusing the trade instead spends the code without minting a
-- credential at all. Same signature and body otherwise — CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION auth_consume_impersonation_handoff(p_code_hash TEXT, p_token_hash TEXT)
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
    JOIN accounts a ON a.id = m.agent_id
   WHERE l.id = v_session.license_id
     AND m.agent_id = v_session.account_id
     AND NOT m.suspended
     AND NOT m.awaiting_approval
     AND a.platform_suspended_at IS NULL;
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
