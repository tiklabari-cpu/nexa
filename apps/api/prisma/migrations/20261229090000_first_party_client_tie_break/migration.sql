-- The workspace's own sign-in client gets the same tie-break everywhere
-- (tm 438 · NFR-S11).
--
-- `auth_list_memberships` has named the organization's oldest OAuth client as
-- the client to sign in with since 20260724101000, and `/auth/login` hands that
-- `client_id` to the console and the phone. Since tm 438 single sign-on holds
-- every federated sign-in to that same client: `GET /auth/sso/{id}` names it to
-- an identity-provider-initiated arrival, and `/auth/saml/{id}/login` refuses
-- any other `client_id` of the workspace (a partner app's). Both read it in
-- TypeScript (`services/auth/first-party-client.ts`) as
-- `ORDER BY created_at, id LIMIT 1`; this function read `ORDER BY created_at`
-- alone.
--
-- Two clients inserted in one transaction share `now()`, and "oldest" was then
-- whichever row the plan returned first — so the client the sign-in screen was
-- handed could differ from the one SAML accepts, and the person would be turned
-- away at the SSO door holding the client the server itself gave them. Adding
-- `c.id` makes the two definitions one.
--
-- The body is 20260826230000's with that single change. Same signature and
-- return type, so CREATE OR REPLACE keeps the function's owner and grants; the
-- grants are restated anyway, as every redefinition of it has. No table is
-- altered, so Prisma sees no change and `db:check-drift` stays quiet.

CREATE OR REPLACE FUNCTION auth_list_memberships(p_account_id UUID)
RETURNS TABLE (
  license_id BIGINT,
  organization_id UUID,
  role TEXT,
  license_status TEXT,
  organization_name TEXT,
  client_id TEXT,
  sso_enforced_connection_id UUID,
  two_factor_required BOOLEAN
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.license_id, l.organization_id, m.role, l.status, o.name,
         -- The workspace's own sign-in client: its oldest, the id breaking a
         -- tie (`firstPartyClientId` in services/auth/first-party-client.ts).
         (SELECT c.id FROM oauth_clients c
           WHERE c.organization_id = l.organization_id
           ORDER BY c.created_at, c.id
           LIMIT 1),
         -- Ordered so a license federating two providers always names the same
         -- one; `name` is what the workspace calls it and what the screen sorts
         -- by, with the id breaking a tie between two identical labels.
         (SELECT s.id FROM sso_connections s
           WHERE s.license_id = m.license_id
             AND s.enabled
             AND s.enforced
           ORDER BY s.name, s.id
           LIMIT 1),
         EXISTS (SELECT 1 FROM security_settings ss
                  WHERE ss.license_id = m.license_id
                    AND ss.require_two_factor)
  FROM agent_memberships m
  JOIN licenses l      ON l.id = m.license_id
  JOIN organizations o ON o.id = l.organization_id
  WHERE m.agent_id = p_account_id
    AND NOT m.suspended
  ORDER BY l.id;
$$;

REVOKE EXECUTE ON FUNCTION auth_list_memberships(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_list_memberships(UUID) TO siyahtus_app;
