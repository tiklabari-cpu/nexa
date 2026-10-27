-- Website crawling, schema half (tm 312.1 · SiyahTuş analysis AI-17).
--
-- The crawl in this build is one synchronous fetch inside the request, from a
-- stub that answers every URL with the same text. This is the storage the
-- real one works in (tm 312.2–312.4):
--
--   1. `knowledge_sources` gains the crawl's settings — `crawl_scope`,
--      `page_limit`, `include_paths`, `exclude_paths` — and its outcome,
--      `last_crawled_at` and `page_count`. The status vocabulary gains
--      `crawling` (a job is under way) and `partial` (the crawl finished with
--      pages that failed).
--   2. `knowledge_pages` — one row per source and normalised URL: what became
--      of the page (`@siyahtus/types` `KNOWLEDGE_PAGE_STATUSES`) and the hash
--      of its text, so a re-crawl embeds only what changed.
--   3. `knowledge_chunks.page_id` — the page a chunk was cut from, so a
--      changed page's chunks are replaced and a removed page's deleted
--      without touching the rest of the source.
--   4. `knowledge_jobs` — the queue the runner works through
--      (`KNOWLEDGE_JOB_KINDS`, `KNOWLEDGE_JOB_STATUSES`), with the frontier a
--      stopped job resumes from. At most one job under way per source.
--
-- The runner's cross-tenant claim (a SECURITY DEFINER function, the
-- `ai_jobs_claim` shape) arrives with the runner (tm 312.3); until then the
-- application role reads and writes its own tenant's rows only.
--
-- Expand-only (CONVENTIONS §6.3): new nullable/defaulted columns, two new
-- tables, a wider status CHECK. A row an earlier release writes — a website
-- source with no crawl settings, a chunk with no page — satisfies every
-- constraint below.

-- --------------------------------------------------------------------------
-- 1. knowledge_sources — crawl settings and outcome
-- --------------------------------------------------------------------------
ALTER TABLE "knowledge_sources" ADD COLUMN     "crawl_scope" TEXT,
ADD COLUMN     "page_limit" INTEGER,
ADD COLUMN     "include_paths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "exclude_paths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "last_crawled_at" TIMESTAMPTZ(6),
ADD COLUMN     "page_count" INTEGER NOT NULL DEFAULT 0;

-- `crawling` and `partial` join the four stored statuses (20260722154008).
ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_status_check;
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_status_check
  CHECK (status IN ('pending', 'indexing', 'ready', 'failed', 'crawling', 'partial'));

-- Only a website is crawled. A website source added before this column
-- existed has a null scope and is read as `single` — what it was crawled as.
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_crawl_scope_check CHECK (
  crawl_scope IS NULL
  OR (type = 'website' AND crawl_scope IN ('single', 'all', 'sitemap'))
);
-- `KNOWLEDGE_PAGE_LIMIT`.
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_page_limit_check CHECK (
  page_limit IS NULL OR (type = 'website' AND page_limit BETWEEN 1 AND 200)
);
-- `KNOWLEDGE_CRAWL_PATHS`: a website's lists, at most 20 entries each, every
-- entry a path prefix starting with `/` (the API refuses the rest of what
-- `KNOWLEDGE_CRAWL_PATH_PATTERN` does; no entry holds a newline, so joining
-- on one and looking for a newline not followed by `/` finds a bad entry).
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_crawl_paths_check CHECK (
  (type = 'website' OR (cardinality(include_paths) = 0 AND cardinality(exclude_paths) = 0))
  AND cardinality(include_paths) <= 20
  AND cardinality(exclude_paths) <= 20
  AND array_position(include_paths, NULL) IS NULL
  AND array_position(exclude_paths, NULL) IS NULL
  AND (cardinality(include_paths) = 0
       OR (E'\n' || array_to_string(include_paths, E'\n')) !~ E'\n([^/]|$)')
  AND (cardinality(exclude_paths) = 0
       OR (E'\n' || array_to_string(exclude_paths, E'\n')) !~ E'\n([^/]|$)')
);
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_page_count_check
  CHECK (page_count >= 0);

-- --------------------------------------------------------------------------
-- 2. knowledge_pages
-- --------------------------------------------------------------------------
CREATE TABLE "knowledge_pages" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "source_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "url_hash" CHAR(64) NOT NULL,
    "title" TEXT,
    "lang" TEXT,
    "content_hash" CHAR(64),
    "status" TEXT NOT NULL,
    "http_status" INTEGER,
    "error" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "miss_count" INTEGER NOT NULL DEFAULT 0,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "fetched_at" TIMESTAMPTZ(6),
    "changed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_pages_pkey" PRIMARY KEY ("id"),
    -- `KNOWLEDGE_PAGE_STATUSES`.
    CONSTRAINT knowledge_pages_status_check CHECK (
      status IN ('ok', 'unchanged', 'skipped_scope', 'robots_disallowed',
                 'blocked', 'needs_js', 'error', 'removed')
    ),
    -- The source's own URL ceiling (`source_url` maxLength 2048).
    CONSTRAINT knowledge_pages_url_check CHECK (char_length(url) BETWEEN 1 AND 2048),
    CONSTRAINT knowledge_pages_url_hash_check CHECK (url_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT knowledge_pages_content_hash_check
      CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT knowledge_pages_title_check
      CHECK (title IS NULL OR char_length(title) <= 500),
    -- A primary subtag, like `knowledge_sources.language`.
    CONSTRAINT knowledge_pages_lang_check CHECK (lang IS NULL OR lang ~ '^[a-z]{2,3}$'),
    CONSTRAINT knowledge_pages_http_status_check
      CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
    -- A code, not prose: a page's error is something to group by, and never
    -- the page's text.
    CONSTRAINT knowledge_pages_error_check
      CHECK (error IS NULL OR error ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT knowledge_pages_counts_check
      CHECK (depth >= 0 AND miss_count >= 0 AND chunk_count >= 0)
);

CREATE UNIQUE INDEX "knowledge_pages_source_id_url_hash_key" ON "knowledge_pages"("source_id", "url_hash");
-- The page table of a source's detail drawer, by status.
CREATE INDEX "knowledge_pages_source_id_status_idx" ON "knowledge_pages"("source_id", "status");
CREATE INDEX "knowledge_pages_license_id_idx" ON "knowledge_pages"("license_id");

ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE knowledge_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_pages_tenant ON knowledge_pages
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_pages TO siyahtus_app;
REVOKE TRUNCATE ON knowledge_pages FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 3. knowledge_chunks.page_id
-- --------------------------------------------------------------------------
-- Nullable: every chunk written so far, and every chunk that is not a
-- crawled page's, has none. The page goes, its chunks go.
ALTER TABLE "knowledge_chunks" ADD COLUMN     "page_id" UUID;
CREATE INDEX "knowledge_chunks_page_id_idx" ON "knowledge_chunks"("page_id");
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "knowledge_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- 4. knowledge_jobs
-- --------------------------------------------------------------------------
CREATE TABLE "knowledge_jobs" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "frontier" JSONB NOT NULL DEFAULT '[]',
    "pages_discovered" INTEGER NOT NULL DEFAULT 0,
    "pages_done" INTEGER NOT NULL DEFAULT 0,
    "pages_ok" INTEGER NOT NULL DEFAULT 0,
    "pages_unchanged" INTEGER NOT NULL DEFAULT 0,
    "pages_skipped" INTEGER NOT NULL DEFAULT 0,
    "pages_failed" INTEGER NOT NULL DEFAULT 0,
    "pages_removed" INTEGER NOT NULL DEFAULT 0,
    "bytes_fetched" BIGINT NOT NULL DEFAULT 0,
    "requested_by" UUID,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_jobs_pkey" PRIMARY KEY ("id"),
    -- `KNOWLEDGE_JOB_KINDS`.
    CONSTRAINT knowledge_jobs_kind_check CHECK (kind IN ('crawl', 'refresh', 'document')),
    -- `KNOWLEDGE_JOB_STATUSES`.
    CONSTRAINT knowledge_jobs_status_check CHECK (
      status IN ('queued', 'running', 'waiting_budget', 'done', 'failed', 'cancelled')
    ),
    -- What each status carries (the `ai_jobs_state_shape_check` rule): a
    -- running job without a lease could never be taken again if its runner
    -- died; a finished one without `finished_at` has no age.
    CONSTRAINT knowledge_jobs_status_shape_check CHECK (
      CASE status
        WHEN 'running' THEN lease_until IS NOT NULL AND started_at IS NOT NULL
                            AND finished_at IS NULL
        WHEN 'queued' THEN lease_until IS NULL AND finished_at IS NULL
        WHEN 'waiting_budget' THEN lease_until IS NULL AND finished_at IS NULL
        ELSE lease_until IS NULL AND finished_at IS NOT NULL
      END
    ),
    CONSTRAINT knowledge_jobs_frontier_check CHECK (jsonb_typeof(frontier) = 'array'),
    CONSTRAINT knowledge_jobs_counts_check CHECK (
      pages_discovered >= 0 AND pages_done >= 0 AND pages_ok >= 0
      AND pages_unchanged >= 0 AND pages_skipped >= 0 AND pages_failed >= 0
      AND pages_removed >= 0 AND bytes_fetched >= 0 AND attempts >= 0
    ),
    CONSTRAINT knowledge_jobs_error_check
      CHECK (error IS NULL OR error ~ '^[a-z][a-z0-9_]{0,63}$')
);

-- The runner's entry point (due unfinished jobs) and the queue's depth.
CREATE INDEX "knowledge_jobs_status_available_at_idx" ON "knowledge_jobs"("status", "available_at");
-- A source's jobs, newest last — its history and the cascade.
CREATE INDEX "knowledge_jobs_source_id_created_at_idx" ON "knowledge_jobs"("source_id", "created_at");
CREATE INDEX "knowledge_jobs_license_id_idx" ON "knowledge_jobs"("license_id");
-- At most one job under way per source: a second crawl request while one runs
-- is a refused write, not two runners on one site. Partial — Prisma cannot
-- express it; `scripts/check-drift.ts` names it.
CREATE UNIQUE INDEX "knowledge_jobs_one_active_per_source" ON "knowledge_jobs"("source_id")
  WHERE status IN ('queued', 'running', 'waiting_budget');

ALTER TABLE "knowledge_jobs" ADD CONSTRAINT "knowledge_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Both tenant ids are checked, as on `ai_jobs`: the runner opens the job's
-- tenant context from the row, so a row filed under another organization
-- would run there.
ALTER TABLE knowledge_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_jobs_tenant ON knowledge_jobs
  USING (license_id = siyahtus_current_license()
         AND organization_id = siyahtus_current_organization())
  WITH CHECK (license_id = siyahtus_current_license()
              AND organization_id = siyahtus_current_organization());

-- Rows leave with their source (CASCADE); nothing deletes a job by itself.
GRANT SELECT, INSERT, UPDATE ON knowledge_jobs TO siyahtus_app;
REVOKE DELETE, TRUNCATE ON knowledge_jobs FROM siyahtus_app;
