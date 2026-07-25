-- Data retention (NFR-C1/C2/C8 — GDPR/KVKK).
--
-- The retention job hard-deletes expired data one tenant at a time, each pass
-- wrapped in `withTenant` so row level security is what keeps a delete inside
-- its own workspace. But the job first has to know *which* tenants exist, and
-- listing licences is itself a cross-tenant read: the `licenses` policy is
-- `USING (organization_id = nexa_current_organization())`, so the application
-- role sees nothing without a context it does not yet have.
--
-- Rather than run the whole job as the table owner (which would exempt every
-- delete from RLS — the one safety net a compliance-critical, irreversible
-- delete most needs), the enumerator is a single SECURITY DEFINER function.
-- It mirrors the `auth_*` bootstrap functions: a small, named, reviewable hole
-- that answers exactly one question — "what tenants are there?" — and returns
-- only the two ids the loop needs. Everything the job then deletes goes back
-- through the `nexa_app` role under RLS.

CREATE OR REPLACE FUNCTION retention_list_tenants()
RETURNS TABLE (license_id BIGINT, organization_id UUID)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT l.id, l.organization_id
  FROM licenses l
  ORDER BY l.id;
$$;

GRANT EXECUTE ON FUNCTION retention_list_tenants() TO nexa_app;
