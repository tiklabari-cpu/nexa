-- Unresolved questions (tm 317.1 · SiyahTuş analysis AI-22 · `@siyahtus/types`
-- `ai-unresolved.ts`): the messages the AI could not resolve, and the groups
-- they are clustered into.
--
--   - `ai_unresolved_items` — one message: why (`reason`), the player's words
--     and the player's message before them, masked (AI-26), the language, the
--     embedding the turn's search already made (`embedding_space` null exactly
--     when there is none — the clustering job embeds those, tm 317.2) and the
--     cluster it went to. Written by the live turn after its reply and by the
--     close of a conversation the player left on the AI's question. It goes
--     with its chat (erasure) and its thread (the retention sweep), and the
--     sweep takes it after 90 days whatever the conversation's window
--     (AI-22-S1). `event_id` names the message; events are partitioned, so
--     there is no foreign key. `brand_id` labels the brand; RLS stays per
--     licence (the report filters by brand, a cluster spans them);
--   - `ai_unresolved_clusters` — a group per AI agent and embedding space:
--     its title, the counts the report sorts by, and whether the workspace
--     ignored it or fixed it (`linked_change_id`, AI-21: no foreign key until
--     tm 316). The title and the counts outlive the items' words.
--
-- The CHECKs and the constants of `ai-unresolved.ts` are one list
-- (`ai-unresolved-schema.test.ts` compares them).
--
-- Expand only (CONVENTIONS §6.3): two new tables the previous release does
-- not read.

-- --------------------------------------------------------------------------
-- Clusters (first: the items point at them)
-- --------------------------------------------------------------------------

CREATE TABLE "ai_unresolved_clusters" (
    "id"               UUID           NOT NULL,
    "license_id"       BIGINT         NOT NULL,
    "ai_agent_id"      UUID           NOT NULL,
    "label"            TEXT           NOT NULL,
    "label_source"     TEXT           NOT NULL DEFAULT 'lexical',
    "centroid"         vector(1536),
    "embedding_space"  TEXT           NOT NULL,
    "item_count"       INTEGER        NOT NULL DEFAULT 0,
    "count_7d"         INTEGER        NOT NULL DEFAULT 0,
    "handoff_count"    INTEGER        NOT NULL DEFAULT 0,
    "abandon_count"    INTEGER        NOT NULL DEFAULT 0,
    "first_seen"       TIMESTAMPTZ(6) NOT NULL,
    "last_seen"        TIMESTAMPTZ(6) NOT NULL,
    "status"           TEXT           NOT NULL DEFAULT 'open',
    "ignore_reason"    TEXT,
    "linked_change_id" UUID,
    "resolved_at"      TIMESTAMPTZ(6),
    "post_fix_count"   INTEGER        NOT NULL DEFAULT 0,
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_unresolved_clusters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_unresolved_clusters_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_unresolved_clusters_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `UNRESOLVED_LABEL_SOURCES`, `UNRESOLVED_CLUSTER_STATUSES`.
    CONSTRAINT ai_unresolved_clusters_label_source_check CHECK (label_source IN ('llm', 'lexical')),
    CONSTRAINT ai_unresolved_clusters_status_check CHECK (status IN ('open', 'ignored', 'resolved')),
    -- `UNRESOLVED_LABEL_MAX`, `UNRESOLVED_IGNORE_REASON_MAX`.
    CONSTRAINT ai_unresolved_clusters_label_check CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
    CONSTRAINT ai_unresolved_clusters_ignore_reason_check CHECK (
      ignore_reason IS NULL OR char_length(btrim(ignore_reason)) BETWEEN 1 AND 500
    ),
    CONSTRAINT ai_unresolved_clusters_space_check CHECK (char_length(embedding_space) BETWEEN 1 AND 200),
    CONSTRAINT ai_unresolved_clusters_counts_check CHECK (
      item_count >= 0 AND count_7d >= 0 AND handoff_count >= 0 AND abandon_count >= 0
      AND post_fix_count >= 0 AND first_seen <= last_seen
    ),
    -- A fixed cluster says when it was fixed; an open or ignored one does not.
    CONSTRAINT ai_unresolved_clusters_resolved_check CHECK (
      (status = 'resolved') = (resolved_at IS NOT NULL)
    )
);

CREATE INDEX "ai_unresolved_clusters_agent_space_idx"
  ON "ai_unresolved_clusters"("license_id", "ai_agent_id", "embedding_space");

-- --------------------------------------------------------------------------
-- Items
-- --------------------------------------------------------------------------

CREATE TABLE "ai_unresolved_items" (
    "id"                UUID           NOT NULL,
    "license_id"        BIGINT         NOT NULL,
    "ai_agent_id"       UUID           NOT NULL,
    "brand_id"          UUID,
    "chat_id"           VARCHAR(12)    NOT NULL,
    "thread_id"         VARCHAR(12)    NOT NULL,
    "event_id"          VARCHAR(40),
    "text_masked"       TEXT           NOT NULL,
    "context_masked"    TEXT,
    "language"          TEXT,
    "reason"            TEXT           NOT NULL,
    "intent_guess"      TEXT,
    "config_version_id" UUID,
    "embedding"         vector(1536),
    "embedding_space"   TEXT,
    "cluster_id"        UUID,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_unresolved_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_unresolved_items_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_unresolved_items_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_unresolved_items_brand_id_fkey"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- Erasure deletes the customer, and with it the chats: the items go too.
    CONSTRAINT "ai_unresolved_items_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- The retention sweep deletes closed threads: the items go with them.
    CONSTRAINT "ai_unresolved_items_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_unresolved_items_cluster_id_fkey"
      FOREIGN KEY ("cluster_id") REFERENCES "ai_unresolved_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- `UNRESOLVED_REASONS`.
    CONSTRAINT ai_unresolved_items_reason_check CHECK (reason IN ('no_procedure_match', 'no_knowledge', 'low_confidence', 'said_dont_know', 'unsupported_language', 'not_understood_handoff', 'player_abandoned', 'asked_human_after_ai', 'agent_flagged')),
    -- `UNRESOLVED_TEXT_MAX`, `UNRESOLVED_MIN_CHARS`.
    CONSTRAINT ai_unresolved_items_text_check CHECK (char_length(btrim(text_masked)) BETWEEN 3 AND 1000),
    CONSTRAINT ai_unresolved_items_context_check CHECK (
      context_masked IS NULL OR char_length(btrim(context_masked)) BETWEEN 1 AND 1000
    ),
    CONSTRAINT ai_unresolved_items_language_check CHECK (language IS NULL OR language ~ '^[a-z]{2}$'),
    CONSTRAINT ai_unresolved_items_intent_check CHECK (
      intent_guess IS NULL OR char_length(intent_guess) BETWEEN 1 AND 200
    ),
    -- A vector is in a space; a space names a vector.
    CONSTRAINT ai_unresolved_items_embedding_check CHECK (
      (embedding IS NULL) = (embedding_space IS NULL)
      AND (embedding_space IS NULL OR char_length(embedding_space) BETWEEN 1 AND 200)
    )
);

CREATE INDEX "ai_unresolved_items_license_id_created_at_idx"
  ON "ai_unresolved_items"("license_id", "created_at");
CREATE INDEX "ai_unresolved_items_cluster_id_idx" ON "ai_unresolved_items"("cluster_id");
CREATE INDEX "ai_unresolved_items_chat_id_idx" ON "ai_unresolved_items"("chat_id");
CREATE INDEX "ai_unresolved_items_thread_id_idx" ON "ai_unresolved_items"("thread_id");

-- --------------------------------------------------------------------------
-- The workspace's own rows only
-- --------------------------------------------------------------------------

-- A foreign key proves the row exists, not that it is this workspace's. Read
-- as the writer, under its RLS: another workspace's agent, brand, thread or
-- cluster is not there to find. One function per table — PL/pgSQL does not
-- promise to stop an `AND` before a column the other table lacks.
CREATE FUNCTION ai_unresolved_clusters_before_write() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a WHERE a.id = NEW.ai_agent_id AND a.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_unresolved_clusters: ai agent % is not this workspace''s', NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION ai_unresolved_items_before_write() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a WHERE a.id = NEW.ai_agent_id AND a.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_unresolved_items: ai agent % is not this workspace''s', NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM threads t
     WHERE t.id = NEW.thread_id AND t.chat_id = NEW.chat_id AND t.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_unresolved_items: thread % is not this workspace''s chat %',
      NEW.thread_id, NEW.chat_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands b WHERE b.id = NEW.brand_id AND b.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_unresolved_items: brand % is not this workspace''s', NEW.brand_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- A cluster is one agent's: an item joins only its own agent's.
  IF NEW.cluster_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ai_unresolved_clusters c
     WHERE c.id = NEW.cluster_id AND c.license_id = NEW.license_id
       AND c.ai_agent_id = NEW.ai_agent_id
  ) THEN
    RAISE EXCEPTION 'ai_unresolved_items: cluster % is not this agent''s', NEW.cluster_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_unresolved_clusters_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, license_id ON ai_unresolved_clusters
  FOR EACH ROW
  EXECUTE FUNCTION ai_unresolved_clusters_before_write();

CREATE TRIGGER ai_unresolved_items_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, brand_id, chat_id, thread_id, cluster_id, license_id
  ON ai_unresolved_items
  FOR EACH ROW
  EXECUTE FUNCTION ai_unresolved_items_before_write();

-- --------------------------------------------------------------------------
-- RLS and grants
-- --------------------------------------------------------------------------

ALTER TABLE ai_unresolved_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_unresolved_clusters_tenant ON ai_unresolved_clusters
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE ai_unresolved_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_unresolved_items_tenant ON ai_unresolved_items
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant every verb. A cluster is
-- written, counted, merged and deleted by the clustering job and the report.
-- An item is written once; afterwards only where it was clustered and its
-- embedding (tm 317.2) change — never its words or its reason — and the
-- retention sweep deletes it.
REVOKE ALL ON ai_unresolved_clusters, ai_unresolved_items FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_unresolved_clusters TO siyahtus_app;
GRANT SELECT, INSERT, DELETE ON ai_unresolved_items TO siyahtus_app;
GRANT UPDATE (cluster_id, embedding, embedding_space) ON ai_unresolved_items TO siyahtus_app;
