-- A procedure's example sentences, embedded (tm 297.3 · SiyahTuş analysis
-- AI-05 §2 · `services/ai/procedure-examples.ts`).
--
-- The understanding call chooses among the agent's procedures, each written
-- into its prompt with up to eight example sentences. Past 15 procedures the
-- prompt grows long and the choice harder, so the turn narrows the catalogue
-- first: the player's message is embedded once (the same embedding the
-- knowledge search uses) and only the 10 procedures whose examples lie nearest
-- to it are offered — the locked ones and the one in progress always. This
-- table is what "nearest" is measured against: one row per example sentence,
-- in the vector space that wrote it.
--
-- WRITTEN AFTER A SKILL SAVE, NEVER INSIDE IT. Embedding is a provider call,
-- and the network is never inside a tenant transaction (knowledge-service.ts):
-- the save clears the skill's rows, commits, then the examples are embedded and
-- written in a second, short transaction. A provider that fails leaves the
-- skill with no rows — and a procedure with no rows in the turn's space is one
-- the narrowing cannot judge, so it always stays in the catalogue. The same
-- holds for every procedure saved before this release and for a workspace
-- whose embedding provider changed: the narrowing degrades to none, never to a
-- procedure silently dropped.
--
-- The embedding space is named on every row, never defaulted, for the reason
-- `knowledge_chunks.embedding_space` exists (20260923090000): two spaces'
-- vectors are neighbours by accident.
--
-- Expand-only (CONVENTIONS §6.3): a new table the previous release does not
-- read. Configuration derived from a skill, not personal data; it goes with
-- its skill and its licence (CASCADE). The hnsw index is the next migration,
-- alone in its file (CONCURRENTLY).

CREATE TABLE "ai_procedure_examples" (
    "id"              UUID           NOT NULL,
    "license_id"      BIGINT         NOT NULL,
    "skill_id"        UUID           NOT NULL,
    "text"            TEXT           NOT NULL,
    "embedding"       vector(1536)   NOT NULL,
    "embedding_space" TEXT           NOT NULL,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_procedure_examples_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_procedure_examples_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_procedure_examples_skill_id_fkey"
      FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- A save replaces one skill's rows.
CREATE INDEX "ai_procedure_examples_skill_id_idx" ON "ai_procedure_examples"("skill_id");
-- The narrowing reads one workspace's rows of one space.
CREATE INDEX "ai_procedure_examples_license_id_embedding_space_idx"
  ON "ai_procedure_examples"("license_id", "embedding_space");

ALTER TABLE ai_procedure_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_procedure_examples_tenant ON ai_procedure_examples
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- --------------------------------------------------------------------------
-- The skill is the licence's own
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace write examples, under its own licence, for another
-- workspace's skill id — sentences the other workspace's turns would then be
-- narrowed by. This looks the skill up as the writer, under the writer's RLS,
-- and holds the row to it (the `ai_handoff_settings` pattern, 20261017120000).
CREATE FUNCTION ai_procedure_examples_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM skills s
     WHERE s.id = NEW.skill_id
       AND s.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_procedure_examples: skill % is not this workspace''s', NEW.skill_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_procedure_examples_before_insert
  BEFORE INSERT ON ai_procedure_examples
  FOR EACH ROW
  EXECUTE FUNCTION ai_procedure_examples_before_insert();

-- The default privileges (20260722090000) grant all four; narrow them. A row
-- is written once and replaced whole, never edited.
REVOKE UPDATE, TRUNCATE ON ai_procedure_examples FROM siyahtus_app;
GRANT SELECT, INSERT, DELETE ON ai_procedure_examples TO siyahtus_app;
