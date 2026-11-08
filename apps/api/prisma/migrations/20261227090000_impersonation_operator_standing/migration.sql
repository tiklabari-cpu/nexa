-- An operator's standing bounds what they opened as a member (tm 430 · the
-- 2026-11-06 audit's F12 · FR-ADMIN-21 · docs/platform-admin/design.md §G).
-- Function only; no table changes.
--
-- A disabled operator's "enter as the customer" token went on working until
-- its session's window ran out: `auth_resolve_token` read the session's end
-- and window, never the operator who opened it. The root panel now ends an
-- operator's open sessions — and revokes the tokens they were traded for — in
-- the same transaction that disables them, moves them to a role that may not
-- hold the session's mode, or revokes their sessions
-- (`services/platform/admin-directory.ts`). This is the floor under that:
-- whatever disabled the operator (that path, a later one, psql), every token
-- of every session they opened reads as revoked from their `disabled_at` on,
-- here, where both the API's edge and the RTM gateway resolve a token. A
-- re-enabled operator gets back only a session nothing ended — the root
-- panel's disable ends them all.
--
-- `platform_admins` is closed to the tenant role (20261101090000), like the
-- sessions table: SECURITY DEFINER is what reads it, as it already reads
-- `platform_impersonation_sessions`. The admin row always exists — its foreign
-- key from the session is ON DELETE RESTRICT, and operators are never deleted.
--
-- Same signature, the same fifteen columns in the same order: CREATE OR
-- REPLACE keeps the function's OID and its result type, so a connection's
-- prepared `SELECT * FROM auth_resolve_token($1)` — the API's token service,
-- the RTM gateway's login and ops check — runs the new body on its next call,
-- with no "cached plan must not change result type" and nothing to restart
-- (20261101150000 had to DROP + CREATE because it added columns). SECURITY
-- DEFINER and the SET clause keep the planner from inlining the body into a
-- caller's plan, so no cached plan holds the old one either.
--
-- Only the impersonation branch changes: for every other kind the session and
-- operator are NULL and the two timestamps are the token's own, as before.
CREATE OR REPLACE FUNCTION auth_resolve_token(p_token_hash TEXT)
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
              ELSE COALESCE(t.revoked_at, s.ended_at, a.disabled_at) END,
         l.status, o.region,
         s.id, s.mode, s.admin_id
  FROM api_tokens t
  JOIN licenses l ON l.id = t.license_id
  JOIN organizations o ON o.id = t.organization_id
  LEFT JOIN platform_impersonation_sessions s ON s.id = t.impersonation_session_id
  LEFT JOIN platform_admins a ON a.id = s.admin_id
  WHERE t.token_hash = p_token_hash;
$$;

-- CREATE OR REPLACE keeps the function's privileges; restated so this file
-- says on its own who may call it.
REVOKE EXECUTE ON FUNCTION auth_resolve_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_token(TEXT) TO siyahtus_app;
