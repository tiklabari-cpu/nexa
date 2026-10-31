-- Report filters (RP-01 · tm 368): a share link and a scheduled export keep the
-- report filter they were made with.
--
--   report_share_links.filters   the filter the link is frozen to; whoever opens
--       the link reads exactly this and cannot widen it.
--   scheduled_reports.filters    the filter every run applies.
--
-- Both a JSON object in the `@siyahtus/types` `ReportFilter` shape (`agent_id`,
-- `group_id`, `tag`, `topic`, each a list). DEFAULT '{}' = no filter, which is
-- what every existing row meant, so no backfill.
--
-- Safe beside the previous release (CONVENTIONS §6.3): the columns are new and
-- defaulted, the previous build neither reads nor writes them, and the resolver
-- below keeps every column it returned (one more at the end, which the previous
-- build does not map).
ALTER TABLE report_share_links ADD COLUMN filters jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE report_share_links
  ADD CONSTRAINT report_share_links_filters_object CHECK (jsonb_typeof(filters) = 'object');

ALTER TABLE scheduled_reports ADD COLUMN filters jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scheduled_reports
  ADD CONSTRAINT scheduled_reports_filters_object CHECK (jsonb_typeof(filters) = 'object');

-- The anonymous read returns the frozen filter with the grant. A RETURNS TABLE
-- cannot gain a column through CREATE OR REPLACE, so the function is dropped and
-- created again — inside this migration's transaction, so no caller sees it
-- missing — with its body otherwise as 20261101120000 left it, and its grants
-- restated (a dropped function takes them with it).
DROP FUNCTION reports_resolve_share_link(TEXT);

CREATE FUNCTION reports_resolve_share_link(p_token_hash TEXT)
RETURNS TABLE (
  share_id UUID,
  license_id BIGINT,
  organization_id UUID,
  group_id TEXT,
  range_from TIMESTAMPTZ,
  range_to TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  filters JSONB
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.license_id, l.organization_id, s.group_id, s.range_from, s.range_to,
    s.expires_at, s.filters
  FROM report_share_links s
  JOIN licenses l ON l.id = s.license_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND l.status NOT IN ('canceled', 'suspended')
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION reports_resolve_share_link(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reports_resolve_share_link(TEXT) TO siyahtus_app;
