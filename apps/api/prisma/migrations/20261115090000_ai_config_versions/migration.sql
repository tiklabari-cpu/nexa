-- AI configuration versions (tm 316.1 · SiyahTuş analysis AI-20 · ADR-14b
-- `docs/adr/ai-config-versioning.md` §2.3, §2.8).
--
-- WHY THIS EXISTS. A save in the Playbook reaches every player at once: the AI
-- reads the editing tables live. AI-20 puts a draft → review → publish line in
-- between, and an audit's "which rules did this answer run on?" gets a version
-- number for an answer. This migration is the schema half; the workflow
-- (316.2), the compiler (316.5), the run-time read and cache (316.3) and the
-- scheduled jobs (316.6) come after it.
--
--   1. `ai_config_versions` — a customer-facing agent's compiled, immutable
--      package and its review trail. `number.minor` is the name on screen,
--      `seq` the licence's publication order (given at publication).
--   2. `ai_agents.published_version_id` (the version the AI answers from) and
--      `ai_agents.draft_revision` (the `If-Match` revision of the draft).
--   3. Knowledge chunks stop being deleted and start being versioned:
--      `knowledge_sources.retired_at` + `chunk_generation`,
--      `knowledge_chunks.generation` + a visibility range in `seq`
--      (`visible_from_version` ≤ seq < `hidden_from_version`).
--   4. Backfill: every customer-facing agent gets a published v1 (`seq` 1),
--      and every existing chunk is visible from it.
--
-- THE BASELINE. The ADR's v1 is "the workspace as it stands, compiled and
-- published". The compiler is TypeScript (316.5) and a migration is SQL, and
-- until the run time switches to packages (316.3) the tables stay live — a v1
-- compiled now would be stale by the time anything read it. So v1 is written
-- as a baseline, `package_format` 0 (`AI_CONFIG_PACKAGE_FORMAT_BASELINE`): an
-- empty package meaning "the editing tables, read and compiled", which is
-- exactly what the AI does today. The run time seals it once with the
-- compiled package (format 0 → ≥1, the one change the immutability trigger
-- lets through), and from then on it is frozen like any other version.
-- PLAN §D376.
--
-- Expand-only (CONVENTIONS §6.3): one new table, nullable or defaulted
-- columns nothing existing reads, CHECKs every existing row passes.

-- --------------------------------------------------------------------------
-- 1. Columns on existing tables
-- --------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "ai_agents" ADD COLUMN     "draft_revision" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "published_version_id" UUID;

-- AlterTable
-- `visible_from_version` arrives with a default of 1 and loses it at once:
-- every chunk that exists is visible from the baseline v1 (§2.3 backfill)
-- without rewriting the table (a constant default is stored once), and a
-- chunk written from now on waits for a publication to open its range.
ALTER TABLE "knowledge_chunks" ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "hidden_from_version" BIGINT,
ADD COLUMN     "visible_from_version" BIGINT DEFAULT 1;
ALTER TABLE "knowledge_chunks" ALTER COLUMN "visible_from_version" DROP DEFAULT;

-- AlterTable
ALTER TABLE "knowledge_sources" ADD COLUMN     "chunk_generation" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "retired_at" TIMESTAMPTZ(6);

-- --------------------------------------------------------------------------
-- 2. ai_config_versions
-- --------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "ai_config_versions" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "ai_agent_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "minor" INTEGER NOT NULL DEFAULT 0,
    "seq" BIGINT,
    "status" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshot_hash" CHAR(64) NOT NULL,
    "package_format" INTEGER NOT NULL,
    "knowledge_manifest" JSONB NOT NULL DEFAULT '[]',
    "diff_summary" JSONB,
    "base_version_id" UUID,
    "draft_revision" BIGINT NOT NULL,
    "test_run_id" UUID,
    "touches_compliance" BOOLEAN NOT NULL DEFAULT false,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "published_by" UUID,
    "published_at" TIMESTAMPTZ(6),
    "scheduled_at" TIMESTAMPTZ(6),
    "rollback_of" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_config_versions_license_id_ai_agent_id_number_minor_key" ON "ai_config_versions"("license_id", "ai_agent_id", "number", "minor");

-- CreateIndex
CREATE UNIQUE INDEX "ai_config_versions_license_id_seq_key" ON "ai_config_versions"("license_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_published_version_id_key" ON "ai_agents"("published_version_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_visibility_idx" ON "knowledge_chunks"("license_id", "visible_from_version", "hidden_from_version");

-- AddForeignKey
-- NO ACTION, not SET NULL: a version is deleted only with its agent or its
-- licence, and then the row pointing at it goes in the same statement.
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "ai_config_versions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_config_versions" ADD CONSTRAINT "ai_config_versions_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_config_versions" ADD CONSTRAINT "ai_config_versions_ai_agent_id_fkey" FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_config_versions" ADD CONSTRAINT "ai_config_versions_base_version_id_fkey" FOREIGN KEY ("base_version_id") REFERENCES "ai_config_versions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_config_versions" ADD CONSTRAINT "ai_config_versions_rollback_of_fkey" FOREIGN KEY ("rollback_of") REFERENCES "ai_config_versions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_config_versions" ADD CONSTRAINT "ai_config_versions_test_run_id_fkey" FOREIGN KEY ("test_run_id") REFERENCES "ai_test_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The closed vocabulary (`AI_CONFIG_VERSION_STATUSES`, `@siyahtus/types`
-- `ai-config-versions.ts`; `ai-config-versions-schema.test.ts` compares them).
ALTER TABLE ai_config_versions
  ADD CONSTRAINT ai_config_versions_status_check CHECK (status IN (
    'in_review', 'approved', 'published', 'superseded', 'rejected'
  ));

-- A version has a publication order exactly when it has been published.
ALTER TABLE ai_config_versions
  ADD CONSTRAINT ai_config_versions_seq_check CHECK (
    (status IN ('published', 'superseded')) = (seq IS NOT NULL AND published_at IS NOT NULL)
  );

ALTER TABLE ai_config_versions
  ADD CONSTRAINT ai_config_versions_number_check CHECK (number >= 1 AND minor >= 0 AND (seq IS NULL OR seq >= 1));

ALTER TABLE ai_config_versions
  ADD CONSTRAINT ai_config_versions_package_check CHECK (
    package_format >= 0
    AND jsonb_typeof(snapshot) = 'object'
    AND jsonb_typeof(knowledge_manifest) = 'array'
    AND snapshot_hash ~ '^[0-9a-f]{64}$'
  );

-- The baseline (`package_format` 0) is the migration's v1 and nothing else:
-- an empty package standing for the tables as they were.
ALTER TABLE ai_config_versions
  ADD CONSTRAINT ai_config_versions_baseline_check CHECK (
    package_format <> 0
    OR (number = 1 AND minor = 0 AND snapshot = '{}'::jsonb AND knowledge_manifest = '[]'::jsonb)
  );

ALTER TABLE ai_config_versions
  ADD CONSTRAINT ai_config_versions_self_check CHECK (
    (base_version_id IS NULL OR base_version_id <> id) AND (rollback_of IS NULL OR rollback_of <> id)
  );

ALTER TABLE ai_config_versions
  ADD CONSTRAINT ai_config_versions_review_note_check CHECK (char_length(review_note) <= 2000);

-- One open version per agent (§2.3): a new submission rejects the open one
-- first, so two approved packages can never publish over each other in the
-- wrong order. One published version per agent: the publish transaction
-- supersedes the old one before it publishes the new one.
CREATE UNIQUE INDEX ai_config_versions_one_open
  ON ai_config_versions (ai_agent_id) WHERE status IN ('in_review', 'approved');
CREATE UNIQUE INDEX ai_config_versions_one_published
  ON ai_config_versions (ai_agent_id) WHERE status = 'published';

ALTER TABLE ai_config_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_config_versions_tenant ON ai_config_versions
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- A version is history: no workspace deletes one or empties the table. It
-- goes with its agent or its licence (the cascades run as the table owner).
-- The root panel may read; it writes nothing here.
REVOKE DELETE, TRUNCATE ON ai_config_versions FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE ON ai_config_versions TO siyahtus_app;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_config_versions FROM siyahtus_platform;
    GRANT SELECT ON public.ai_config_versions TO siyahtus_platform;
  END IF;
END
$$;

-- --------------------------------------------------------------------------
-- The agent, the base, the rollback source and the test run are the agent's
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace write a version, under its own licence, for another
-- workspace's agent — or base one on another workspace's version. These are
-- looked up as the writer, under the writer's RLS (the `ai_guidance_rules`
-- pattern, 20261019120000). Only a customer-facing agent is versioned:
-- Copilot never answers a player (§2.2).
CREATE FUNCTION ai_config_versions_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a
     WHERE a.id = NEW.ai_agent_id
       AND a.license_id = NEW.license_id
       AND a.kind = 'ai_agent'
  ) THEN
    RAISE EXCEPTION 'ai_config_versions: % is not this workspace''s customer-facing AI agent', NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.base_version_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM ai_config_versions v
       WHERE v.id = NEW.base_version_id AND v.ai_agent_id = NEW.ai_agent_id
    ) THEN
      RAISE EXCEPTION 'ai_config_versions: base version % is not this agent''s', NEW.base_version_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.rollback_of IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM ai_config_versions v
       WHERE v.id = NEW.rollback_of AND v.ai_agent_id = NEW.ai_agent_id
    ) THEN
      RAISE EXCEPTION 'ai_config_versions: rolled-back version % is not this agent''s', NEW.rollback_of
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.test_run_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM ai_test_runs r
       WHERE r.id = NEW.test_run_id AND r.ai_agent_id = NEW.ai_agent_id
    ) THEN
      RAISE EXCEPTION 'ai_config_versions: test run % is not this agent''s', NEW.test_run_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_config_versions_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, license_id, base_version_id, rollback_of, test_run_id
  ON ai_config_versions
  FOR EACH ROW
  EXECUTE FUNCTION ai_config_versions_before_write();

-- --------------------------------------------------------------------------
-- A published package never changes; a status only moves forward
-- --------------------------------------------------------------------------
-- What the AI answered from must stay what it was (§2.3, §3 "Bu eki delen
-- değişiklikler"): once a version has a `seq` its package, manifest, hash,
-- order and provenance are frozen — a rollback writes a new version instead.
-- The one exception is sealing the baseline: format 0 becomes the compiled
-- package once, and is frozen from then on. Status moves:
--   in_review → approved | rejected | published
--   approved  → published | rejected | in_review   (approval withdrawn)
--   published → superseded
-- `superseded` and `rejected` are final.
CREATE FUNCTION ai_config_versions_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  sealing BOOLEAN := OLD.package_format = 0 AND NEW.package_format > 0;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.license_id IS DISTINCT FROM OLD.license_id
     OR NEW.ai_agent_id IS DISTINCT FROM OLD.ai_agent_id
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.minor IS DISTINCT FROM OLD.minor
     OR NEW.rollback_of IS DISTINCT FROM OLD.rollback_of
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ai_config_versions: a version''s identity never changes'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'in_review' AND NEW.status IN ('approved', 'rejected', 'published'))
    OR (OLD.status = 'approved' AND NEW.status IN ('published', 'rejected', 'in_review'))
    OR (OLD.status = 'published' AND NEW.status = 'superseded')
  ) THEN
    RAISE EXCEPTION 'ai_config_versions: status % cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.seq IS NOT NULL THEN
    IF NEW.seq IS DISTINCT FROM OLD.seq
       OR NEW.base_version_id IS DISTINCT FROM OLD.base_version_id
       OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision
       OR NEW.diff_summary IS DISTINCT FROM OLD.diff_summary
       OR NEW.touches_compliance IS DISTINCT FROM OLD.touches_compliance
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
      RAISE EXCEPTION 'ai_config_versions: a published version''s record never changes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT sealing AND (
         NEW.snapshot IS DISTINCT FROM OLD.snapshot
      OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
      OR NEW.knowledge_manifest IS DISTINCT FROM OLD.knowledge_manifest
      OR NEW.package_format IS DISTINCT FROM OLD.package_format
    ) THEN
      RAISE EXCEPTION 'ai_config_versions: a published package never changes'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_config_versions_guard_update
  BEFORE UPDATE ON ai_config_versions
  FOR EACH ROW
  EXECUTE FUNCTION ai_config_versions_guard_update();

-- --------------------------------------------------------------------------
-- The agent's pointer is one of its own published versions
-- --------------------------------------------------------------------------
-- Checked when the pointer is written, as the writer. The publish transaction
-- supersedes the old version, publishes the new one and then moves the
-- pointer; the pointer never names an open, rejected or foreign version.
CREATE FUNCTION ai_agents_published_version_check()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.published_version_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM ai_config_versions v
       WHERE v.id = NEW.published_version_id
         AND v.ai_agent_id = NEW.id
         AND v.status = 'published'
    ) THEN
      RAISE EXCEPTION 'ai_agents: % is not a published version of agent %', NEW.published_version_id, NEW.id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_agents_published_version_check
  BEFORE INSERT OR UPDATE OF published_version_id ON ai_agents
  FOR EACH ROW
  EXECUTE FUNCTION ai_agents_published_version_check();

-- --------------------------------------------------------------------------
-- 3. Chunk generations and visibility ranges (§2.8)
-- --------------------------------------------------------------------------
-- A range is written at most twice — opened, then closed — and never
-- reopened; a chunk's generation is the one it was written in. A rollback
-- copies chunks as a new generation rather than reopening a closed range.
-- The trigger fires only on a write naming these columns, so re-embedding
-- (which rewrites `embedding` in place) does not pay for it.
ALTER TABLE knowledge_chunks
  ADD CONSTRAINT knowledge_chunks_generation_check CHECK (generation >= 1);
ALTER TABLE knowledge_chunks
  ADD CONSTRAINT knowledge_chunks_visibility_check CHECK (
    (visible_from_version IS NULL OR visible_from_version >= 1)
    AND (hidden_from_version IS NULL
         OR (visible_from_version IS NOT NULL AND hidden_from_version > visible_from_version))
  );
ALTER TABLE knowledge_sources
  ADD CONSTRAINT knowledge_sources_chunk_generation_check CHECK (chunk_generation >= 1);

CREATE FUNCTION knowledge_chunks_visibility_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.generation IS DISTINCT FROM OLD.generation THEN
    RAISE EXCEPTION 'knowledge_chunks: a chunk''s generation never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.visible_from_version IS NOT NULL
     AND NEW.visible_from_version IS DISTINCT FROM OLD.visible_from_version THEN
    RAISE EXCEPTION 'knowledge_chunks: an opened visibility range is never moved'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.hidden_from_version IS NOT NULL
     AND NEW.hidden_from_version IS DISTINCT FROM OLD.hidden_from_version THEN
    RAISE EXCEPTION 'knowledge_chunks: a closed visibility range is never reopened'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_chunks_visibility_guard
  BEFORE UPDATE OF generation, visible_from_version, hidden_from_version ON knowledge_chunks
  FOR EACH ROW
  EXECUTE FUNCTION knowledge_chunks_visibility_guard();

-- --------------------------------------------------------------------------
-- 4. Backfill: every customer-facing agent's baseline v1
-- --------------------------------------------------------------------------
-- One per agent (one per licence in v1, tm 390.1), so `seq` 1 is each
-- licence's first. The hash is of the empty package's canonical JSON. The
-- system published it: no submitter, no reviewer. Copilot is not versioned.
-- `ai-config-versions-schema.test.ts` replays this section.
-- backfill:begin
INSERT INTO ai_config_versions
  (id, license_id, ai_agent_id, number, minor, seq, status, snapshot, snapshot_hash,
   package_format, knowledge_manifest, draft_revision, published_at)
SELECT gen_random_uuid(), a.license_id, a.id, 1, 0, 1, 'published', '{}'::jsonb,
       encode(sha256(convert_to('{}', 'UTF8')), 'hex'), 0, '[]'::jsonb, a.draft_revision,
       CURRENT_TIMESTAMP
  FROM ai_agents a
 WHERE a.kind = 'ai_agent'
   AND a.published_version_id IS NULL;

UPDATE ai_agents a
   SET published_version_id = v.id
  FROM ai_config_versions v
 WHERE v.ai_agent_id = a.id
   AND v.status = 'published'
   AND a.kind = 'ai_agent'
   AND a.published_version_id IS NULL;
-- backfill:end
