-- The AI coaching and suggestion queue (tm 318.1 · SiyahTuş analysis AI-23 ·
-- `@siyahtus/types` `ai-suggestions.ts`).
--
--   - `ai_suggestions` — one agent's mark on the AI's message ("wrong",
--     "should have handed over", "tone"…), or an answer of their own offered
--     to the AI's knowledge; later also a QA finding (AI-24) and an
--     unresolved-questions cluster agents kept answering (AI-23-S2). It keeps
--     the last messages up to the marked one, masked when it was made
--     (`excerpt_masked`, AI-26), so a review outlives the conversation's
--     retention: `thread_id` names the connection without a foreign key — the
--     retention sweep deletes closed threads, and the suggestion stays. The
--     chat is a foreign key: erasing the player deletes their chats, and the
--     suggestions about them go too. `event_ids` name the marked message;
--     events are partitioned, so there is no foreign key. `team_id` is the
--     conversation's team when the suggestion was made — a Team Lead reviews
--     their teams' (RL-03); a team deleted later leaves its id behind, which
--     only an administrator's view still lists. `resulting_change_id` is the
--     AI-21 change accepting it wrote (no foreign key: the history prunes
--     itself).
--   - `ai_usage_events.surface` gains `coaching`: the drafting job's model
--     call and the duplicate search's embedding (AI-23 §2–§3).
--
-- The CHECKs and the constants of `ai-suggestions.ts` are one list
-- (`ai-suggestions-schema.test.ts` compares them).
--
-- Expand only (CONVENTIONS §6.3): a new table the previous release does not
-- read, and a CHECK that admits one more value.

CREATE TABLE "ai_suggestions" (
    "id"                  UUID           NOT NULL,
    "license_id"          BIGINT         NOT NULL,
    "ai_agent_id"         UUID           NOT NULL,
    "kind"                TEXT           NOT NULL,
    "source"              TEXT           NOT NULL DEFAULT 'agent_flag',
    "chat_id"             VARCHAR(12),
    "thread_id"           VARCHAR(12),
    "event_ids"           TEXT[]         NOT NULL DEFAULT '{}',
    "excerpt_masked"      JSONB          NOT NULL DEFAULT '[]',
    "note"                TEXT,
    "team_id"             BIGINT,
    "proposed_change"     JSONB,
    "removed_specifics"   TEXT[]         NOT NULL DEFAULT '{}',
    "drafted_by"          TEXT,
    "duplicate_of"        UUID,
    "cluster_id"          UUID,
    "similar_chunk_ids"   UUID[]         NOT NULL DEFAULT '{}',
    "status"              TEXT           NOT NULL DEFAULT 'new',
    "reviewer_id"         UUID,
    "reviewed_at"         TIMESTAMPTZ(6),
    "review_note"         TEXT,
    "resulting_change_id" UUID,
    "created_by"          UUID,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_suggestions_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_suggestions_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Erasure deletes the customer, and with it the chats: the suggestions go too.
    CONSTRAINT "ai_suggestions_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_suggestions_duplicate_of_fkey"
      FOREIGN KEY ("duplicate_of") REFERENCES "ai_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ai_suggestions_cluster_id_fkey"
      FOREIGN KEY ("cluster_id") REFERENCES "ai_unresolved_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ai_suggestions_reviewer_id_fkey"
      FOREIGN KEY ("reviewer_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ai_suggestions_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- `SUGGESTION_KINDS`, `SUGGESTION_SOURCES`, `SUGGESTION_STATUSES`.
    CONSTRAINT ai_suggestions_kind_check CHECK (kind IN ('wrong_answer', 'missing_info', 'should_have_handed_off', 'should_not_have_handed_off', 'tone', 'promote_agent_answer', 'other')),
    CONSTRAINT ai_suggestions_source_check CHECK (source IN ('agent_flag', 'qa_finding', 'unresolved_cluster')),
    CONSTRAINT ai_suggestions_status_check CHECK (status IN ('new', 'drafting', 'in_review', 'accepted', 'rejected', 'merged')),
    CONSTRAINT ai_suggestions_drafted_by_check CHECK (drafted_by IS NULL OR drafted_by IN ('llm', 'lexical')),
    -- `SUGGESTION_NOTE_MAX`, `SUGGESTION_REVIEW_NOTE_MAX`.
    CONSTRAINT ai_suggestions_note_check CHECK (
      note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 1000
    ),
    CONSTRAINT ai_suggestions_review_note_check CHECK (
      review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 1 AND 1000
    ),
    -- `SUGGESTION_TARGETS`, `SUGGESTION_TITLE_MAX`, `SUGGESTION_BODY_MAX`.
    CONSTRAINT ai_suggestions_proposed_change_check CHECK (
      proposed_change IS NULL OR (
        jsonb_typeof(proposed_change) = 'object'
        AND proposed_change->>'target' IN ('knowledge_snippet', 'guidance_rule', 'procedure_example', 'procedure_note')
        AND char_length(btrim(COALESCE(proposed_change->>'title', ''))) BETWEEN 1 AND 200
        AND char_length(btrim(COALESCE(proposed_change->>'body', ''))) BETWEEN 1 AND 4000
      )
    ),
    CONSTRAINT ai_suggestions_excerpt_check CHECK (jsonb_typeof(excerpt_masked) = 'array'),
    -- A connection is a chat's: one without the other names nothing.
    CONSTRAINT ai_suggestions_conversation_check CHECK (
      (chat_id IS NULL) = (thread_id IS NULL)
    ),
    -- `SUGGESTION_SIMILAR_CHUNKS_MAX`.
    CONSTRAINT ai_suggestions_similar_check CHECK (cardinality(similar_chunk_ids) <= 3),
    -- Decided exactly when reviewed; a rejection says why, a merge says into
    -- what, an acceptance had something to write.
    CONSTRAINT ai_suggestions_reviewed_check CHECK (
      (status IN ('accepted', 'rejected', 'merged')) = (reviewed_at IS NOT NULL)
    ),
    CONSTRAINT ai_suggestions_rejected_check CHECK (
      status <> 'rejected' OR review_note IS NOT NULL
    ),
    CONSTRAINT ai_suggestions_merged_check CHECK (
      status <> 'merged' OR duplicate_of IS NOT NULL OR cluster_id IS NOT NULL
    ),
    CONSTRAINT ai_suggestions_accepted_check CHECK (
      status <> 'accepted' OR proposed_change IS NOT NULL
    ),
    CONSTRAINT ai_suggestions_self_check CHECK (duplicate_of IS NULL OR duplicate_of <> id)
);

-- The queue: a workspace's open suggestions by team, newest first (AI-23).
CREATE INDEX "ai_suggestions_license_status_team_created_idx"
  ON "ai_suggestions"("license_id", "status", "team_id", "created_at");
-- One person's: their own list and the day's allowance (AI-23 §1).
CREATE INDEX "ai_suggestions_created_by_created_at_idx"
  ON "ai_suggestions"("created_by", "created_at");
CREATE INDEX "ai_suggestions_chat_id_idx" ON "ai_suggestions"("chat_id");
CREATE INDEX "ai_suggestions_cluster_id_idx" ON "ai_suggestions"("cluster_id")
  WHERE cluster_id IS NOT NULL;
-- The same message, kind and author once (AI-23 §1: a second is 409).
CREATE UNIQUE INDEX "ai_suggestions_one_per_mark_key"
  ON "ai_suggestions"("license_id", "created_by", "kind", "event_ids")
  WHERE source = 'agent_flag' AND created_by IS NOT NULL AND cardinality(event_ids) > 0;

-- --------------------------------------------------------------------------
-- The workspace's own rows only
-- --------------------------------------------------------------------------

-- A foreign key proves the row exists, not that it is this workspace's. Read
-- as the writer, under its RLS: another workspace's agent, chat, thread, team
-- or cluster is not there to find. The connection is checked only when it is
-- written: the retention sweep deletes it later and the suggestion stays.
CREATE FUNCTION ai_suggestions_before_write() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- PL/pgSQL does not promise to stop an `OR` before `OLD`, which an
  -- INSERT has none of: what moved is decided first, branch by branch.
  conversation_moved BOOLEAN := TRUE;
  team_moved BOOLEAN := TRUE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    conversation_moved := NEW.thread_id IS DISTINCT FROM OLD.thread_id
      OR NEW.chat_id IS DISTINCT FROM OLD.chat_id;
    team_moved := NEW.team_id IS DISTINCT FROM OLD.team_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a
     WHERE a.id = NEW.ai_agent_id AND a.license_id = NEW.license_id AND a.kind = 'ai_agent'
  ) THEN
    RAISE EXCEPTION 'ai_suggestions: ai agent % is not this workspace''s', NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.thread_id IS NOT NULL AND conversation_moved THEN
    IF NOT EXISTS (
      SELECT 1 FROM threads t
       WHERE t.id = NEW.thread_id AND t.chat_id = NEW.chat_id AND t.license_id = NEW.license_id
    ) THEN
      RAISE EXCEPTION 'ai_suggestions: thread % is not this workspace''s chat %',
        NEW.thread_id, NEW.chat_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.team_id IS NOT NULL AND team_moved THEN
    IF NOT EXISTS (
      SELECT 1 FROM groups g WHERE g.id = NEW.team_id AND g.license_id = NEW.license_id
    ) THEN
      RAISE EXCEPTION 'ai_suggestions: team % is not this workspace''s', NEW.team_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.duplicate_of IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ai_suggestions s
     WHERE s.id = NEW.duplicate_of AND s.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_suggestions: suggestion % is not this workspace''s', NEW.duplicate_of
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- A cluster is one agent's: a suggestion joins only its own agent's.
  IF NEW.cluster_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ai_unresolved_clusters c
     WHERE c.id = NEW.cluster_id AND c.license_id = NEW.license_id
       AND c.ai_agent_id = NEW.ai_agent_id
  ) THEN
    RAISE EXCEPTION 'ai_suggestions: cluster % is not this agent''s', NEW.cluster_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_suggestions_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, chat_id, thread_id, team_id, duplicate_of, cluster_id, license_id
  ON ai_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION ai_suggestions_before_write();

-- --------------------------------------------------------------------------
-- RLS and grants
-- --------------------------------------------------------------------------

ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_suggestions_tenant ON ai_suggestions
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant every verb. A suggestion is
-- written, drafted and reviewed; it goes with its chat, its agent or its
-- workspace, never by the API's hand.
REVOKE ALL ON ai_suggestions FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE ON ai_suggestions TO siyahtus_app;

-- --------------------------------------------------------------------------
-- The usage ledger's surfaces: `AI_USAGE_SURFACES` gains `coaching`
-- --------------------------------------------------------------------------

ALTER TABLE ai_usage_events DROP CONSTRAINT ai_usage_events_surface_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_surface_check CHECK (
  surface IN ('ai_agent', 'copilot', 'knowledge_index', 'simulation', 'qa', 'cluster', 'coaching')
) NOT VALID;
ALTER TABLE ai_usage_events VALIDATE CONSTRAINT ai_usage_events_surface_check;
