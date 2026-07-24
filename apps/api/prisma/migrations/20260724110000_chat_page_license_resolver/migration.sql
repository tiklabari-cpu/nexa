-- Resolve an organization's licence *without* a trusted-domain match, for the
-- hosted Chat page (FR-MOD-08.5.9). That page is served from our own origin and
-- is a deliberately public chat link, so the allowlist — which governs where the
-- widget may be embedded on third-party sites — does not apply to it. Licences
-- carry row level security, so like the other widget resolvers this runs
-- SECURITY DEFINER to read across tenants before any session context exists.
CREATE OR REPLACE FUNCTION auth_resolve_organization_license(p_organization_id UUID)
RETURNS TABLE (license_id BIGINT, organization_id UUID, license_status TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT l.id, l.organization_id, l.status
  FROM licenses l
  WHERE l.organization_id = p_organization_id
  -- Prefer a live licence; a cancelled one sorts last.
  ORDER BY (l.status = 'canceled'), l.id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION auth_resolve_organization_license(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_organization_license(UUID) TO nexa_app;
