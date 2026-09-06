-- Automatic refresh for a `website` knowledge source (FR-MOD-06.3.3, "expiry
-- + automatic re-crawl" — the PRD acceptance criterion's last unclosed piece,
-- tm 198.4).
--
-- Three nullable columns, defaulting to NULL/no-op so every existing source
-- keeps behaving exactly as it did before this migration (expand-only,
-- CONVENTIONS §6.3):
--
--   * refresh_after_days — how often, in days, an admin wants this source
--     re-crawled. NULL means "never automatically" — today's behaviour for
--     every source that already exists.
--   * next_refresh_at — when the freshness sweep should next attempt this
--     source. Recomputed from refresh_after_days every time the source is
--     actually refreshed (edit, manual reindex, or the sweep itself), never
--     read as a deadline that must be hit.
--   * last_refresh_error — why the most recent refresh attempt failed, if it
--     did. Cleared on the next success. A failed refresh never touches
--     `content` or the source's chunks (see services/ai/knowledge-refresh.ts),
--     so this column is purely a status the admin can read, not a sign that
--     anything was lost.
ALTER TABLE knowledge_sources
  ADD COLUMN "refresh_after_days" INTEGER,
  ADD COLUMN "next_refresh_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_refresh_error" TEXT;

-- Restated at the database, not only in the route: the field is meaningless
-- for anything but a `website` source (there is nothing else to re-crawl),
-- and an out-of-range window would let a caller that bypasses the route
-- schedule a sweep that runs every tick (0) or effectively never (a
-- multi-decade window).
ALTER TABLE knowledge_sources
  ADD CONSTRAINT knowledge_sources_refresh_after_days_check
    CHECK (refresh_after_days IS NULL OR (refresh_after_days BETWEEN 1 AND 365)),
  ADD CONSTRAINT knowledge_sources_refresh_after_days_website_check
    CHECK (refresh_after_days IS NULL OR type = 'website');

-- Serves the freshness sweep's per-tenant query: "website sources due now."
CREATE INDEX "knowledge_sources_type_next_refresh_at_idx" ON "knowledge_sources"("type", "next_refresh_at");
