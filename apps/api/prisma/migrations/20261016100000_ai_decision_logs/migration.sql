-- The AI decision record (tm 288.2 · SiyahTuş analysis ID-08, ID-08-S1).
--
-- "Why did the AI say that to this player?" answered by number in minutes:
-- one row per AI turn naming the conversation, the request or job that ran it,
-- what the AI decided, the procedure and step it was on, what it retrieved and
-- how close it was, which guardrails fired, the model and what it cost. Ids,
-- scores, flags and counts only — the record never holds the message, the
-- reply or the prompt (ID-08 rule; the CHECK on `details` keeps the obvious
-- keys out of the one free-form column).
--
--   1. `ai_decision_logs` — the record. Kept as long as the conversation
--      (ID-08-S1): a row on a connection cascades with its thread, so the
--      retention sweep's thread delete takes it; a row with no connection is
--      swept by age under the same window (`services/retention/retention.ts`);
--      erasing the customer takes every row through `customer_id` / `chat_id`.
--      Rows are never edited: `siyahtus_app` holds SELECT, INSERT and DELETE
--      (the last for the sweep), not UPDATE.
--   2. `skill_runs.thread_id` — the connection a run answered, beside the day
--      container it already names. Nullable: a preview has none, and runs
--      before this release did not keep it. Its lookup index is built
--      concurrently in the next migration (CONVENTIONS 6.3).
--
-- Not partitioned: one row per AI turn is a fraction of `events`. If it ever
-- reaches that scale, the monthly range scheme of `events`
-- (`services/chat/event-partitions.ts`) is the one to follow.
--
-- Expand-only (CONVENTIONS 6.3): a new table and a new nullable column,
-- nothing an earlier release reads or writes.

-- --------------------------------------------------------------------------
-- 1. ai_decision_logs
-- --------------------------------------------------------------------------
CREATE TABLE ai_decision_logs (
    "id"                   UUID             NOT NULL,
    "license_id"           BIGINT           NOT NULL,
    "chat_id"              VARCHAR(12),
    "thread_id"            VARCHAR(12),
    "customer_id"          UUID,
    "trigger_event_id"     VARCHAR(40),
    "reply_event_id"       VARCHAR(40),
    "request_id"           VARCHAR(64),
    "job_id"               VARCHAR(128),
    "decision"             TEXT             NOT NULL,
    "procedure_id"         UUID,
    "procedure_version"    INTEGER,
    "step"                 TEXT,
    "knowledge_source_ids" UUID[]           DEFAULT ARRAY[]::UUID[],
    "chunk_ids"            UUID[]           DEFAULT ARRAY[]::UUID[],
    "retrieval_scores"     DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "guardrail_hits"       TEXT[]           DEFAULT ARRAY[]::TEXT[],
    "handoff_reason"       TEXT,
    "risk_flags"           TEXT[]           DEFAULT ARRAY[]::TEXT[],
    "model"                TEXT,
    "llm_input_tokens"     INTEGER          NOT NULL DEFAULT 0,
    "llm_output_tokens"    INTEGER          NOT NULL DEFAULT 0,
    "latency_ms"           INTEGER,
    "error_type"           TEXT,
    "details"              JSONB            NOT NULL DEFAULT '{}',
    "config_version_id"    UUID,
    "created_at"           TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_decision_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_decision_logs_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- The conversation's rows go with it, whichever end is deleted.
    CONSTRAINT "ai_decision_logs_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_decision_logs_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_decision_logs_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `AI_DECISIONS` (`@siyahtus/types`).
    CONSTRAINT ai_decision_logs_decision_check CHECK (decision IN (
      'answered', 'asked', 'handoff', 'silent', 'blocked', 'expired', 'cap_reached'
    )),
    CONSTRAINT ai_decision_logs_numbers_check CHECK (
      llm_input_tokens >= 0 AND llm_output_tokens >= 0
      AND (latency_ms IS NULL OR latency_ms >= 0)
      AND (procedure_version IS NULL OR procedure_version >= 1)
    ),
    -- `AI_DECISION_DETAILS_MAX_BYTES`, and an object rather than a bare value.
    -- The writer trims to the ceiling first; this is the floor under it.
    CONSTRAINT ai_decision_logs_details_check CHECK (
      jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 8192
    ),
    -- No conversation text in the free-form column, by the names text would
    -- arrive under. The writer drops these keys; this refuses them anyway.
    CONSTRAINT ai_decision_logs_details_no_text_check CHECK (
      NOT (details ?| ARRAY['text', 'message', 'reply', 'prompt', 'content', 'body'])
    )
);

-- The workspace's newest decisions, one conversation's in order, one
-- connection's, and the customer erasure's cascade.
CREATE INDEX "ai_decision_logs_license_id_created_at_idx" ON "ai_decision_logs"("license_id", "created_at" DESC);
CREATE INDEX "ai_decision_logs_chat_id_created_at_idx" ON "ai_decision_logs"("chat_id", "created_at");
CREATE INDEX "ai_decision_logs_thread_id_idx" ON "ai_decision_logs"("thread_id");
CREATE INDEX "ai_decision_logs_customer_id_idx" ON "ai_decision_logs"("customer_id");

ALTER TABLE ai_decision_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_decision_logs_tenant ON ai_decision_logs
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT, INSERT, DELETE ON ai_decision_logs TO siyahtus_app;
REVOKE UPDATE, TRUNCATE ON ai_decision_logs FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. skill_runs.thread_id
-- --------------------------------------------------------------------------
ALTER TABLE "skill_runs" ADD COLUMN "thread_id" VARCHAR(12);

-- SET NULL like `chat_id`: a run is the workspace's usage record (the AI Agent
-- report sums its tokens), so it outlives the connection it answered.
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
