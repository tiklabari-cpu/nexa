-- Retention sweep fairness (tm 441 · F24).
--
-- The sweep walked tenants in `licenses.id` order, so a pass that stopped part
-- way — one workspace's batch past the tenant transaction's 10 s ceiling, a
-- restart — left the same tail of workspaces unswept every time. The sweep now
-- stamps each workspace it finishes, and the enumerator walks the oldest stamp
-- first (never-swept first of all), so whoever was skipped leads the next pass.
--
-- Expand only (CONVENTIONS §6.3): a nullable column the old code never reads,
-- and the enumerator keeps its signature — only its ORDER BY changes, which
-- the old code does not depend on.

ALTER TABLE licenses ADD COLUMN retention_swept_at TIMESTAMPTZ;

COMMENT ON COLUMN licenses.retention_swept_at IS
  'When the retention sweep last finished this workspace (tm 441); null before it ever has. Orders retention_list_tenants().';

CREATE OR REPLACE FUNCTION retention_list_tenants()
RETURNS TABLE (license_id BIGINT, organization_id UUID)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT l.id, l.organization_id
  FROM licenses l
  ORDER BY l.retention_swept_at ASC NULLS FIRST, l.id;
$$;

GRANT EXECUTE ON FUNCTION retention_list_tenants() TO siyahtus_app;
