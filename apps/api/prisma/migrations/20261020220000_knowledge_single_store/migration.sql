-- The single knowledge store, expand step (tm 309.1 · SiyahTuş analysis AI-14,
-- owner decision K11 · `docs/adr/single-knowledge-store.md` §2 · ADR-14b §2.12
-- · `@siyahtus/types` `knowledge-store.ts`).
--
--   * knowledge_sources.audiences      — who may use the source: `ai_agent`
--                                        (the AI's answers to players) and/or
--                                        `copilot`. One of three sets, kept in
--                                        that order without repeats and never
--                                        empty, so `= '{copilot}'` is an exact
--                                        test (ADR §3 detail 1).
--   * knowledge_sources.ai_agent_ids   — the AI agents it is for; empty = all.
--   * knowledge_sources.brand_ids      — the brands it is for; empty = all.
--   * knowledge_sources.language       — a primary language subtag, or null.
--   * knowledge_sources.owner_id,
--     reviewed_at, review_interval_days — who keeps it true and when a person
--                                        last confirmed it: due again 90 days
--                                        later unless set (AI-14-S3). Meta
--                                        fields (ADR-14b §2.2).
--   * knowledge_sources.valid_until    — past it the source answers nothing.
--   * knowledge_sources.kb_article_id  — the published KB article it mirrors
--                                        (AI-14-S2): one source per article
--                                        (20261020220400), gone with it.
--   * knowledge_sources.source_table,
--     source_row_id                    — the structured-table row it renders
--                                        (AI-13, tm 310): both or neither.
--   * kb_articles.ai_audiences         — who besides the reader may use an
--                                        article once it is published: both
--                                        unless switched off, empty = neither.
--   * chats.brand_id                   — the brand the member came in through,
--                                        written when the chat opens; null when
--                                        unknown or when a day's connections
--                                        came through more than one brand.
--
-- Expand only (CONVENTIONS §6.3): the previous release neither reads nor
-- writes any of these, and every row it inserts takes defaults the CHECKs
-- accept. Retrieval keeps following `ai_agent_id` until tm 309.2 moves it onto
-- `audiences`, `ai_agent_ids`, `brand_ids` and `valid_until` and backfills the
-- first two; from this release every new source has them written from the
-- agent record it is filed under, so a release reading them never meets a row
-- this one left at the defaults. `reviewed_at` is backfilled in 20261020220100.
-- No `status` column: `status` stays the indexing state; a publish state lives
-- in the AI configuration's versions (ADR-14b §2.12, tm 316).
--
-- No RLS change. A source may be several brands', so the brand filter is the
-- query's, never the policy's (ADR §2.4). `chats.brand_id` is a label, not a
-- scope: the inbox stays licence-wide (`brand-isolation.test.ts`,
-- BRAND_LABEL_TABLES). Both brand references are soft — an array holds no
-- foreign key, and a chat outlives its brand. `kb_article_id` is a real one,
-- written by the server only, from the article it publishes in the same
-- licence context.
--
-- The GIN indexes on `audiences` and `brand_ids` and the unique index on
-- `kb_article_id` are each built CONCURRENTLY in a file of their own
-- (20261020220200–0400). The structural statements are what `prisma migrate
-- diff` emits for the schema change, `NOT NULL` added on the three arrays (the
-- `skills.examples` precedent); the CHECKs are invisible to Prisma and read
-- back against `@siyahtus/types` by `knowledge-store-schema.test.ts`.

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "brand_id" UUID;

-- AlterTable
ALTER TABLE "kb_articles" ADD COLUMN     "ai_audiences" TEXT[] NOT NULL DEFAULT ARRAY['ai_agent', 'copilot']::TEXT[];

-- AlterTable
ALTER TABLE "knowledge_sources" ADD COLUMN     "ai_agent_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "audiences" TEXT[] NOT NULL DEFAULT ARRAY['ai_agent', 'copilot']::TEXT[],
ADD COLUMN     "brand_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "kb_article_id" UUID,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "review_interval_days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "source_row_id" UUID,
ADD COLUMN     "source_table" TEXT,
ADD COLUMN     "valid_until" TIMESTAMPTZ(6);

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_kb_article_id_fkey" FOREIGN KEY ("kb_article_id") REFERENCES "kb_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `KNOWLEDGE_AUDIENCES`, in their one spelling. Equalities rather than
-- `IN (...)`: a list of arrays would be folded into one array of arrays, which
-- refuses sets of different lengths.
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_audiences_check CHECK (
  audiences = '{ai_agent}' OR audiences = '{copilot}' OR audiences = '{ai_agent,copilot}'
);

-- An id list never holds a NULL (`array_position` finds one as IS NOT
-- DISTINCT FROM), so "for this agent / brand" is a plain `= ANY`.
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_scope_ids_check CHECK (
  array_position(ai_agent_ids, NULL) IS NULL AND array_position(brand_ids, NULL) IS NULL
);

-- `KNOWLEDGE_LANGUAGE_PATTERN`.
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_language_check
  CHECK (language IS NULL OR language ~ '^[a-z]{2,3}$');

-- `KNOWLEDGE_REVIEW_INTERVAL_DAYS`.
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_review_interval_days_check
  CHECK (review_interval_days BETWEEN 1 AND 365);

-- A table row's address is a table name and an id, both or neither.
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_source_row_check CHECK (
  (source_table IS NULL) = (source_row_id IS NULL)
  AND (source_table IS NULL OR source_table ~ '^[a-z][a-z0-9_]{0,62}$')
);

-- `KNOWLEDGE_AUDIENCES` again, and the empty set: the AI does not use it.
ALTER TABLE kb_articles ADD CONSTRAINT kb_articles_ai_audiences_check CHECK (
  ai_audiences = '{}' OR ai_audiences = '{ai_agent}' OR ai_audiences = '{copilot}'
  OR ai_audiences = '{ai_agent,copilot}'
);
