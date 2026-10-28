-- What became of each connection the AI took part in (tm 320.1 · SiyahTuş
-- analysis AI-25 · `@siyahtus/types` `ai-outcomes.ts`).
--
--   - `ai_conversation_outcomes` — one row per connection (panel "Chat ID",
--     `thread_id`) the AI took part in: opened by its first turn or its
--     hand-over, written as the conversation goes (`services/reports/
--     ai-outcomes.ts`: the turns' counts and topic, the hand-over, the first
--     person's reply, the player's "is it solved?" answer, the rating, the
--     card verdict, the close, the risk flags, the QA review) and settled 72
--     hours after the close by the finalize job (tm 320.2). `thread_id` names
--     the connection without a foreign key, like `qa_reviews`: the retention
--     sweep deletes closed threads, the metrics stay. The chat is a foreign
--     key: erasing the player deletes their chats, and their rows go too.
--     `brand_id`, `team_id`, `ai_agent_id`, `config_version_id` and
--     `procedure_id` are labels the reports filter by; none has a foreign key.
--   - `ratings.subject` — whom a rating judges: `ai` when no person had
--     written to the player on the connection, `human` otherwise (BSAT and
--     CSAT apart, AI-25-S2). Null on the rows before it.
--
-- The CHECKs and the constants of `ai-outcomes.ts` (and `HANDOFF_REASONS`,
-- `QA_MANDATORY_HANDOFF_REASONS`) are one list (`ai-outcomes.test.ts`
-- compares them).
--
-- Expand only (CONVENTIONS §6.3): a new table and a nullable column the
-- previous release does not read.

CREATE TABLE "ai_conversation_outcomes" (
    "id"                             UUID           NOT NULL DEFAULT gen_random_uuid(),
    "license_id"                     BIGINT         NOT NULL,
    "chat_id"                        VARCHAR(12)    NOT NULL,
    "thread_id"                      VARCHAR(12)    NOT NULL,
    "member_key"                     TEXT,
    "brand_id"                       UUID,
    "team_id"                        BIGINT,
    "ai_agent_id"                    UUID,
    "config_version_id"              UUID,
    "language"                       TEXT,
    "intent"                         TEXT,
    "procedure_id"                   UUID,
    "started_at"                     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at"                       TIMESTAMPTZ(6),
    "ai_turns"                       INTEGER        NOT NULL DEFAULT 0,
    "player_turns"                   INTEGER        NOT NULL DEFAULT 0,
    "clarification_turns"            INTEGER        NOT NULL DEFAULT 0,
    "required_slots_total"           INTEGER,
    "required_slots_filled"          INTEGER,
    "outcome"                        TEXT,
    "ai_claimed_resolved"            BOOLEAN        NOT NULL DEFAULT false,
    "resolution_confirmation"        TEXT,
    "confirmed_at"                   TIMESTAMPTZ(6),
    "handoff_at"                     TIMESTAMPTZ(6),
    "handoff_reason"                 TEXT,
    "handoff_mandatory_rule"         TEXT,
    "first_human_reply_at"           TIMESTAMPTZ(6),
    "handoff_card_rating"            TEXT,
    "handoff_card_missing"           TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "agent_reasked"                  BOOLEAN,
    "bsat"                           TEXT,
    "csat_after_handoff"             TEXT,
    "guardrail_hits"                 JSONB          NOT NULL DEFAULT '[]',
    "guardrail_violations_confirmed" INTEGER        NOT NULL DEFAULT 0,
    "flags"                          TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "mandatory_handoff_violation"    BOOLEAN        NOT NULL DEFAULT false,
    "repeat_same_intent_72h"         BOOLEAN,
    "repeat_any_72h"                 BOOLEAN,
    "repeat_of_id"                   UUID,
    "qa_result"                      TEXT,
    "finalized_at"                   TIMESTAMPTZ(6),
    "created_at"                     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversation_outcomes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_conversation_outcomes_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Erasure deletes the customer, and with it the chats: the rows go too.
    CONSTRAINT "ai_conversation_outcomes_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `AI_OUTCOMES`.
    CONSTRAINT ai_conversation_outcomes_outcome_check CHECK (
      outcome IS NULL OR outcome IN ('confirmed_resolved', 'assumed_pending', 'assumed_resolved', 'false_resolved', 'handed_off', 'abandoned', 'declined')
    ),
    -- `AI_OUTCOME_CONFIRMATIONS`, with its moment.
    CONSTRAINT ai_conversation_outcomes_confirmation_check CHECK (
      resolution_confirmation IS NULL OR resolution_confirmation IN ('yes', 'no')
    ),
    CONSTRAINT ai_conversation_outcomes_confirmed_at_check CHECK (
      (resolution_confirmation IS NULL) = (confirmed_at IS NULL)
    ),
    -- `HANDOFF_REASONS`, with its moment.
    CONSTRAINT ai_conversation_outcomes_handoff_reason_check CHECK (
      handoff_reason IS NULL OR handoff_reason IN ('guardrail_self_harm', 'guardrail_minor', 'guardrail_rg', 'risk_flag', 'guardrail_account_security', 'guardrail_complaint', 'guardrail_output_block', 'guardrail_workspace_rule', 'abuse', 'player_request', 'tenant_rule', 'procedure_rule', 'missing_required_info', 'repeat_same_day', 'negative_sentiment', 'player_said_unresolved', 'no_knowledge', 'not_understood', 'loop_detected', 'max_turns', 'unsupported_language', 'ai_failure')
    ),
    CONSTRAINT ai_conversation_outcomes_handoff_check CHECK (
      handoff_reason IS NULL OR handoff_at IS NOT NULL
    ),
    -- `QA_MANDATORY_HANDOFF_REASONS`, only beside a hand-over.
    CONSTRAINT ai_conversation_outcomes_mandatory_rule_check CHECK (
      handoff_mandatory_rule IS NULL OR (
        handoff_at IS NOT NULL
        AND handoff_mandatory_rule IN ('guardrail_self_harm', 'guardrail_minor', 'guardrail_rg', 'risk_flag', 'guardrail_account_security', 'guardrail_complaint')
      )
    ),
    -- `AI_HANDOFF_FEEDBACK_VALUES`; `AI_HANDOFF_CARD_MISSING_MAX`.
    CONSTRAINT ai_conversation_outcomes_card_rating_check CHECK (
      handoff_card_rating IS NULL OR handoff_card_rating IN ('sufficient', 'insufficient')
    ),
    CONSTRAINT ai_conversation_outcomes_card_missing_check CHECK (cardinality(handoff_card_missing) <= 20),
    -- The rating values (`good` | `bad`).
    CONSTRAINT ai_conversation_outcomes_bsat_check CHECK (bsat IS NULL OR bsat IN ('good', 'bad')),
    CONSTRAINT ai_conversation_outcomes_csat_check CHECK (
      csat_after_handoff IS NULL OR csat_after_handoff IN ('good', 'bad')
    ),
    -- `AI_OUTCOME_QA_RESULTS`.
    CONSTRAINT ai_conversation_outcomes_qa_result_check CHECK (
      qa_result IS NULL OR qa_result IN ('pass', 'fail', 'unresolved')
    ),
    CONSTRAINT ai_conversation_outcomes_counts_check CHECK (
      ai_turns >= 0 AND player_turns >= 0 AND clarification_turns >= 0
      AND guardrail_violations_confirmed >= 0
      AND (required_slots_total IS NULL OR required_slots_total >= 0)
      AND (required_slots_filled IS NULL OR (required_slots_filled >= 0
        AND required_slots_filled <= coalesce(required_slots_total, 0)))
    ),
    -- `AI_OUTCOME_GUARDRAIL_HITS_MAX`.
    CONSTRAINT ai_conversation_outcomes_guardrail_hits_check CHECK (
      jsonb_typeof(guardrail_hits) = 'array' AND jsonb_array_length(guardrail_hits) <= 50
    ),
    -- Settled once: a finalized row has ended.
    CONSTRAINT ai_conversation_outcomes_finalized_check CHECK (
      finalized_at IS NULL OR ended_at IS NOT NULL
    )
);

-- One row per connection: every write point upserts into it.
CREATE UNIQUE INDEX "ai_conversation_outcomes_license_id_thread_id_key"
  ON "ai_conversation_outcomes"("license_id", "thread_id");
-- The reports' window and the finalize job's "closed 72 hours ago".
CREATE INDEX "ai_conversation_outcomes_license_id_ended_at_idx"
  ON "ai_conversation_outcomes"("license_id", "ended_at");
-- The repeat-contact search: the member's later connections.
CREATE INDEX "ai_conversation_outcomes_license_id_member_key_started_at_idx"
  ON "ai_conversation_outcomes"("license_id", "member_key", "started_at");
CREATE INDEX "ai_conversation_outcomes_chat_id_idx" ON "ai_conversation_outcomes"("chat_id");
-- The writes that know only the connection (the first person's reply, the close).
CREATE INDEX "ai_conversation_outcomes_thread_id_idx" ON "ai_conversation_outcomes"("thread_id");

ALTER TABLE "ratings" ADD COLUMN "subject" TEXT;
-- `RATING_SUBJECTS`.
ALTER TABLE "ratings" ADD CONSTRAINT ratings_subject_check CHECK (subject IS NULL OR subject IN ('ai', 'human'));

-- --------------------------------------------------------------------------
-- RLS and grants
-- --------------------------------------------------------------------------

ALTER TABLE ai_conversation_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_conversation_outcomes_tenant ON ai_conversation_outcomes
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant every verb. A row is written
-- and kept; it goes with its chat or its workspace, never by the API's hand.
REVOKE ALL ON ai_conversation_outcomes FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE ON ai_conversation_outcomes TO siyahtus_app;

-- The root panel may read the figures; it never writes them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ai_conversation_outcomes FROM siyahtus_platform;
    GRANT SELECT ON ai_conversation_outcomes TO siyahtus_platform;
  END IF;
END
$$;
