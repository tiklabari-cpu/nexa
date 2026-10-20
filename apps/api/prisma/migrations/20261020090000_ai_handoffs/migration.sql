-- The AI's hand-over cards (tm 304.1 · SiyahTuş analysis AI-10 ·
-- `@siyahtus/types` `ai-handoff-card.ts`).
--
-- When the AI hands a connection to a person it writes one card, in the
-- hand-over's own transaction (`HandoffService.execute`): what it was about,
-- who the player says they are, what the AI collected and decided on, what it
-- told the player, why it handed over, the risk and the mood, and the step it
-- suggests. Built from the conversation's state, never by a model. `id` is the
-- hand-over's `handoff_id`, which its transfer and AI-mode events carry.
--
-- A card is written once. Two things happen to it afterwards, and nothing
-- else (the trigger below): the agent whose first message after the hand-over
-- took it up (`accepted_by`, `accepted_at`, once), and an agent's verdict on
-- it (`feedback_*`: one per card, the last click wins — AI-10-S2).
--
-- `chat_id` and `thread_id` CASCADE: the card is about the conversation and
-- goes with it — the retention sweep, an erasure (through the customer's
-- chats). `skill_id`, `ai_conversation_id`, `target_group_id`, `accepted_by`
-- and `feedback_by` carry no foreign key: a procedure, a team or an account
-- removed later does not take the record with it.
--
-- `card_text` and `summary` lengths are checked in bytes as well as characters
-- would be: the development database is SQL_ASCII, where `char_length` counts
-- bytes, so the bounds are four times the characters the builder writes.
--
-- Expand only (CONVENTIONS §6.3): a new table the previous release does not
-- read.

CREATE TABLE "ai_handoffs" (
    "id"                      UUID           NOT NULL,
    "license_id"              BIGINT         NOT NULL,
    "chat_id"                 VARCHAR(12)    NOT NULL,
    "thread_id"               VARCHAR(12)    NOT NULL,
    "ai_conversation_id"      UUID,
    "skill_id"                UUID,
    "procedure_key"           TEXT,
    "procedure_snapshot_hash" TEXT,
    "intent_label"            TEXT,
    "summary"                 TEXT           NOT NULL,
    "question"                TEXT,
    "player"                  JSONB          NOT NULL DEFAULT '{}',
    "reason_codes"            TEXT[],
    "primary_reason"          TEXT           NOT NULL,
    "slots_snapshot"          JSONB          NOT NULL DEFAULT '[]',
    "decision_facts"          JSONB          NOT NULL DEFAULT '[]',
    "checks"                  JSONB          NOT NULL DEFAULT '[]',
    "ai_statements"           JSONB          NOT NULL DEFAULT '[]',
    "output_check_flags"      TEXT[]         DEFAULT ARRAY[]::TEXT[],
    "risk_flags"              TEXT[]         DEFAULT ARRAY[]::TEXT[],
    "sentiment"               TEXT,
    "suggested_next_step"     TEXT,
    "attachments"             JSONB          NOT NULL DEFAULT '[]',
    "target_group_id"         BIGINT,
    "priority"                TEXT           NOT NULL,
    "card_text"               TEXT           NOT NULL,
    "config_version_id"       UUID,
    "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_by"             UUID,
    "accepted_at"             TIMESTAMPTZ(6),
    "feedback"                TEXT,
    "feedback_reason"         TEXT,
    "feedback_by"             UUID,
    "feedback_at"             TIMESTAMPTZ(6),

    CONSTRAINT "ai_handoffs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_handoffs_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_handoffs_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ai_handoffs_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    -- `GUARDRAIL_PRIORITIES`, `AI_HANDOFF_SENTIMENTS`, `AI_HANDOFF_FEEDBACK_VALUES`,
    -- `AI_HANDOFF_OUTPUT_FLAGS`.
    CONSTRAINT ai_handoffs_priority_check CHECK (priority IN ('urgent', 'high', 'normal')),
    CONSTRAINT ai_handoffs_sentiment_check CHECK (
      sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative', 'angry')
    ),
    CONSTRAINT ai_handoffs_feedback_check CHECK (
      feedback IS NULL OR feedback IN ('sufficient', 'insufficient')
    ),
    CONSTRAINT ai_handoffs_output_flags_check CHECK (
      output_check_flags IS NOT NULL
      AND output_check_flags <@ ARRAY['draft_rewritten', 'draft_blocked', 'draft_warned']::TEXT[]
    ),
    CONSTRAINT ai_handoffs_risk_flags_check CHECK (
      risk_flags IS NOT NULL AND cardinality(risk_flags) <= 20
    ),
    -- At least one reason; the primary one is the most severe, first.
    CONSTRAINT ai_handoffs_reasons_check CHECK (
      reason_codes IS NOT NULL
      AND cardinality(reason_codes) BETWEEN 1 AND 30
      AND primary_reason = reason_codes[1]
    ),
    -- A verdict is someone's, at a time; a reason only with a verdict.
    CONSTRAINT ai_handoffs_feedback_fields_check CHECK (
      (feedback IS NULL) = (feedback_at IS NULL)
      AND (feedback IS NULL) = (feedback_by IS NULL)
      AND (feedback_reason IS NULL OR feedback IS NOT NULL)
    ),
    -- `AI_HANDOFF_FEEDBACK_REASON_MAX`.
    CONSTRAINT ai_handoffs_feedback_reason_check CHECK (
      feedback_reason IS NULL OR char_length(btrim(feedback_reason)) BETWEEN 1 AND 2000
    ),
    CONSTRAINT ai_handoffs_accepted_check CHECK ((accepted_at IS NULL) = (accepted_by IS NULL)),
    -- `AI_HANDOFF_CARD_TEXT_MAX`, `AI_HANDOFF_SUMMARY_MAX` (× 4, see above).
    CONSTRAINT ai_handoffs_card_text_check CHECK (char_length(card_text) BETWEEN 1 AND 32000),
    CONSTRAINT ai_handoffs_summary_check CHECK (char_length(summary) BETWEEN 1 AND 1600),
    CONSTRAINT ai_handoffs_json_check CHECK (
      jsonb_typeof(player) = 'object'
      AND jsonb_typeof(slots_snapshot) = 'array'
      AND jsonb_typeof(decision_facts) = 'array'
      AND jsonb_typeof(checks) = 'array'
      AND jsonb_typeof(ai_statements) = 'array'
      AND jsonb_typeof(attachments) = 'array'
    )
);

-- The workspace's cards by time (AI-25's hand-over quality), a chat's cards
-- (the inbox reads the newest, the archive all of them), and the connection's
-- (the accepted hook, a delete following the thread).
CREATE INDEX "ai_handoffs_license_id_created_at_idx" ON "ai_handoffs"("license_id", "created_at");
CREATE INDEX "ai_handoffs_chat_id_created_at_idx" ON "ai_handoffs"("chat_id", "created_at");
CREATE INDEX "ai_handoffs_thread_id_idx" ON "ai_handoffs"("thread_id");

-- --------------------------------------------------------------------------
-- What a row may be written as, and the two changes it takes
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace file a card, under its own licence, on another
-- workspace's chat. This looks the connection up as the writer, under the
-- writer's RLS (the `risk_flags_before_write` pattern, 20261019180000).
--
-- On INSERT: the connection is the chat's, and the chat the licence's; a card
-- is written with no taker and no verdict. On UPDATE: `accepted_*` once, from
-- nothing; `feedback_*` freely; nothing else.
CREATE FUNCTION ai_handoffs_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM threads t
       WHERE t.id = NEW.thread_id
         AND t.chat_id = NEW.chat_id
         AND t.license_id = NEW.license_id
    ) THEN
      RAISE EXCEPTION 'ai_handoffs: thread % is not chat %''s in this workspace',
        NEW.thread_id, NEW.chat_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.accepted_at IS NOT NULL OR NEW.feedback IS NOT NULL THEN
      RAISE EXCEPTION 'ai_handoffs: a card is written untaken and unjudged'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE.
  IF (NEW.id, NEW.license_id, NEW.chat_id, NEW.thread_id, NEW.ai_conversation_id, NEW.skill_id,
      NEW.procedure_key, NEW.procedure_snapshot_hash, NEW.intent_label, NEW.summary,
      NEW.question, NEW.player, NEW.reason_codes, NEW.primary_reason, NEW.slots_snapshot,
      NEW.decision_facts, NEW.checks, NEW.ai_statements, NEW.output_check_flags,
      NEW.risk_flags, NEW.sentiment, NEW.suggested_next_step, NEW.attachments,
      NEW.target_group_id, NEW.priority, NEW.card_text, NEW.config_version_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.license_id, OLD.chat_id, OLD.thread_id, OLD.ai_conversation_id, OLD.skill_id,
      OLD.procedure_key, OLD.procedure_snapshot_hash, OLD.intent_label, OLD.summary,
      OLD.question, OLD.player, OLD.reason_codes, OLD.primary_reason, OLD.slots_snapshot,
      OLD.decision_facts, OLD.checks, OLD.ai_statements, OLD.output_check_flags,
      OLD.risk_flags, OLD.sentiment, OLD.suggested_next_step, OLD.attachments,
      OLD.target_group_id, OLD.priority, OLD.card_text, OLD.config_version_id, OLD.created_at)
  THEN
    RAISE EXCEPTION 'ai_handoffs: a card is not rewritten'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.accepted_at IS NOT NULL
     AND (NEW.accepted_at, NEW.accepted_by) IS DISTINCT FROM (OLD.accepted_at, OLD.accepted_by)
  THEN
    RAISE EXCEPTION 'ai_handoffs: a card is taken up once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_handoffs_before_write
  BEFORE INSERT OR UPDATE ON ai_handoffs
  FOR EACH ROW
  EXECUTE FUNCTION ai_handoffs_before_write();

-- --------------------------------------------------------------------------
-- RLS and grants
-- --------------------------------------------------------------------------

ALTER TABLE ai_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_handoffs_tenant ON ai_handoffs
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant all four; a card is never
-- deleted on its own (it goes with its conversation), and a workspace never
-- empties the table.
GRANT SELECT, INSERT, UPDATE ON ai_handoffs TO siyahtus_app;
REVOKE DELETE, TRUNCATE ON ai_handoffs FROM siyahtus_app;
