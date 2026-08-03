-- Resolve the workspace behind a public KB address, before any tenant context
-- exists (PUBKB-c). The anonymous reader path is served from a shared public
-- host where the path segment `{workspaceSlug}` is a `kb_settings.public_slug`;
-- turning that slug into a (licence, organization) is the one cross-tenant read
-- the public KB needs. Like `auth_resolve_organization_license` — its sibling
-- for the hosted Chat page — it runs SECURITY DEFINER because `kb_settings`
-- carries row level security that no session has set yet, and it answers a
-- single question and returns only the two columns a tenant context needs.
--
-- It only ever names a workspace that has *opted in*: `enabled = true` AND a
-- licence that is not `canceled`. A disabled KB, a cancelled workspace and an
-- unknown slug all return no row, so the caller cannot tell them apart — the
-- 404 policy (NFR-S5) begins in this function, not in the route.
CREATE OR REPLACE FUNCTION kb_resolve_public_slug(p_slug TEXT)
RETURNS TABLE (license_id BIGINT, organization_id UUID)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.license_id, l.organization_id
  FROM kb_settings s
  JOIN licenses l ON l.id = s.license_id
  WHERE s.public_slug = p_slug
    AND s.enabled = true
    AND l.status <> 'canceled'
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION kb_resolve_public_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kb_resolve_public_slug(TEXT) TO nexa_app;
