-- Shareable report links (FR-MOD-07.3.1) — the "link" half of the Overview
-- header's "Share export/link".
--
-- One table plus one resolver. A row is a standing *anonymous* grant: whoever
-- holds the token reads one report group over one window with no account at
-- all. That is a new kind of thing in this schema, so the columns that bound it
-- are constrained here rather than left to the route:
--
--   * expires_at is NOT NULL and must be after created_at
--     (report_share_links_expires_after_created_check). A nullable expiry is a
--     permanent public URL one forgotten branch away; the requirement is a link
--     that expires, and the database is where that stops being a convention.
--   * range_from < range_to (report_share_links_range_check), the same reason
--     scheduled_report_runs constrains its period: a link whose window is empty
--     or inverted resolves successfully and shows nothing, which reads as "no
--     data" rather than as the bug it is.
--   * token_hash is UNIQUE platform-wide. One token resolves to at most one
--     link, and that is guaranteed by the database rather than by the resolver
--     happening to LIMIT 1 (NFR-S4/S5).
--   * group_id carries no FK and no domain CHECK — the scheduled_reports
--     decision, for the same reason: REPORT_GROUPS lives in code and gains
--     entries without a migration. The route validates it against the
--     catalogue.
--
-- The raw token is never stored (the api_tokens rule); token_last_four exists
-- only so the management list can tell two rows apart.
--
-- Expand-only (CONVENTIONS 6.3): a new table, nothing existing narrowed or
-- renamed. Code that predates this migration is unaffected by it.

-- CreateTable
CREATE TABLE "report_share_links" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "group_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_last_four" TEXT NOT NULL,
    "range_from" TIMESTAMPTZ(6) NOT NULL,
    "range_to" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_agent_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_share_links_token_hash_key" ON "report_share_links"("token_hash");

-- CreateIndex
CREATE INDEX "report_share_links_license_id_created_at_idx" ON "report_share_links"("license_id", "created_at");

-- AddForeignKey
ALTER TABLE "report_share_links" ADD CONSTRAINT "report_share_links_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A link that never expires is the thing this feature must not become. NOT NULL
-- says there is always an expiry; this says it is always in the future of the
-- row that carries it, so a client cannot mint one that is born dead (or, with a
-- negative interval, one whose "expiry" reads as a creation date.)
ALTER TABLE report_share_links
  ADD CONSTRAINT report_share_links_expires_after_created_check
    CHECK (expires_at > created_at);

-- The pinned window is a real window. Mirrors
-- scheduled_report_runs_period_range_check: an empty or inverted range resolves
-- fine and renders an empty table, which is indistinguishable from a quiet
-- workspace.
ALTER TABLE report_share_links
  ADD CONSTRAINT report_share_links_range_check
    CHECK (range_from < range_to);

-- Row level security, the plain licence match every other tenant table uses.
-- What is behind it is sharper than most: a cross-tenant INSERT would let one
-- workspace mint an anonymous, unauthenticated reader for another workspace's
-- reports, and a cross-tenant UPDATE would let it un-revoke one that had been
-- withdrawn.
ALTER TABLE report_share_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_share_links_tenant ON report_share_links
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app and reaches the table only through that policy.
-- Granted explicitly: the schema-wide GRANT in 20260722154008 covered only the
-- tables that existed then.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_share_links TO nexa_app;

-- Resolve a share token before any tenant context exists.
--
-- The reader is anonymous — there is no session to set a licence from — so the
-- token has to name its own workspace. The same small, reviewable pre-tenant
-- hole as auth_resolve_organization_license, kb_resolve_public_slug and
-- email_resolve_inbound_address: SECURITY DEFINER, one question, one row, and
-- EXECUTE granted narrowly.
--
-- **The 404 policy begins here, not in the route** (NFR-S5), which is the whole
-- reason the filtering lives in the function. A revoked link, an expired one, a
-- cancelled workspace and a token that never existed all return no row, so the
-- route physically cannot tell them apart and therefore cannot leak which miss
-- occurred — not through a status, not through a message, and not through a
-- second query it would otherwise have had to run.
--
-- It takes the *digest*, never the token: the raw value does not cross this
-- boundary, so it cannot appear in pg_stat_statements or a query log.
CREATE OR REPLACE FUNCTION reports_resolve_share_link(p_token_hash TEXT)
RETURNS TABLE (
  share_id UUID,
  license_id BIGINT,
  organization_id UUID,
  group_id TEXT,
  range_from TIMESTAMPTZ,
  range_to TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.license_id, l.organization_id, s.group_id, s.range_from, s.range_to, s.expires_at
  FROM report_share_links s
  JOIN licenses l ON l.id = s.license_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND l.status <> 'canceled'
  LIMIT 1;
$$;

-- SECURITY DEFINER runs as the function owner, so EXECUTE is granted narrowly
-- and never to PUBLIC.
REVOKE EXECUTE ON FUNCTION reports_resolve_share_link(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reports_resolve_share_link(TEXT) TO nexa_app;
