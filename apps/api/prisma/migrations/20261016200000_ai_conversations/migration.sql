-- The AI conversation state (tm 292.1 · SiyahTuş analysis AI-01, AI-03 §2,
-- AI-04, AI-11; ADR-14b §2.7).
--
-- Today the AI answers every message as if it were the first: nothing about
-- the conversation survives from one turn to the next. This table is where it
-- does — one row per connection (panel "Chat ID" = `thread_id`; its day
-- container, panel "Thread ID", is `chat_id`: K1=A, so no separate
-- `daily_thread_id` column):
--
--   - where the AI is: who answers (`mode`, AI-11), the active procedure, its
--     frozen definition and step (AI-03), what it has collected (`slots`,
--     AI-04), a suspended topic, counters and signals;
--   - how far it has read: `last_processed_event_seq`, the connection's
--     `event_sequence` the last turn covered (AI-01 batching);
--   - the lock: `version`. A turn reads it, does its model work outside any
--     transaction, and writes back `WHERE version = :read` — no row means
--     somebody else wrote first and the turn's draft is not sent. The database
--     bumps it on every UPDATE (the trigger below), so no writer can forget to
--     and an agent taking the conversation over (AI-11) fences a running turn
--     by writing anything at all;
--   - the configuration it runs on: `config_version_id`, pinned once when the
--     row opens (ADR-14b §2.7) — null until versioning ships (tm 316), and a
--     null may be filled once, never changed.
--
-- The state and the AI's logic over it arrive with their own tasks (#292.2–4
-- the turn, #293 the mode, #294 the digest, #295 the slots, #296 the
-- procedure); this opens the columns they share so none has to widen the table.
--
-- A record, not configuration (ADR-14b §2.2), and it holds personal data
-- (slot values): RLS by licence, and it goes with its connection — the thread
-- FK cascades, so the retention sweep's thread delete and a customer's erasure
-- (customer → chats → threads) take it. No FK to `chats`: the thread is the
-- connection, and the insert trigger holds `chat_id` to the thread's own chat.
-- No FK to `skills` either — a procedure deleted mid-conversation must not
-- erase where the conversation was; `procedure_snapshot` keeps its definition.
-- No FK for `config_version_id` yet: `ai_config_versions` is tm 316's.
--
-- `siyahtus_app` may open a row and change its state; it may not delete one,
-- move it to another connection, or set `version` / `updated_at` (the
-- database's). Expand-only (CONVENTIONS 6.3): a new table nothing reads yet.

CREATE TABLE "ai_conversations" (
    "id"                       UUID           NOT NULL,
    "license_id"               BIGINT         NOT NULL,
    "chat_id"                  VARCHAR(12)    NOT NULL,
    "thread_id"                VARCHAR(12)    NOT NULL,
    "mode"                     TEXT           NOT NULL DEFAULT 'ai',
    "mode_changed_at"          TIMESTAMPTZ(6),
    "mode_changed_by"          TEXT,
    "mode_reason"              TEXT,
    "active_skill_id"          UUID,
    "procedure_snapshot"       JSONB,
    "procedure_snapshot_hash"  TEXT,
    "step_id"                  TEXT,
    "step_status"              TEXT,
    "slots"                    JSONB          NOT NULL DEFAULT '{}',
    "suspended"                JSONB,
    "counters"                 JSONB          NOT NULL DEFAULT '{}',
    "signals"                  JSONB          NOT NULL DEFAULT '{}',
    "digest"                   JSONB,
    "outcome"                  TEXT,
    "last_processed_event_seq" INTEGER        NOT NULL DEFAULT 0,
    "version"                  INTEGER        NOT NULL DEFAULT 0,
    "config_version_id"        UUID,
    "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at"                TIMESTAMPTZ(6),

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_conversations_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_conversations_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `AI_CONVERSATION_MODES` (`@siyahtus/types`).
    CONSTRAINT ai_conversations_mode_check CHECK (mode IN ('ai', 'human', 'paused')),
    -- Who and why are codes (an account id, `ai`, `system`; `agent_takeover`),
    -- never conversation text.
    CONSTRAINT ai_conversations_mode_changed_by_check CHECK (
      mode_changed_by IS NULL OR char_length(mode_changed_by) BETWEEN 1 AND 64
    ),
    CONSTRAINT ai_conversations_mode_reason_check CHECK (
      mode_reason IS NULL OR mode_reason ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
    -- `AI_CONVERSATION_STEP_STATUSES`.
    CONSTRAINT ai_conversations_step_status_check CHECK (
      step_status IS NULL OR step_status IN ('awaiting_answer', 'ready', 'done')
    ),
    CONSTRAINT ai_conversations_step_id_check CHECK (
      step_id IS NULL OR char_length(step_id) BETWEEN 1 AND 128
    ),
    -- `AI_CONVERSATION_OUTCOMES`.
    CONSTRAINT ai_conversations_outcome_check CHECK (
      outcome IS NULL
      OR outcome IN ('resolved', 'resolved_waiting', 'handed_off', 'abandoned', 'no_ai')
    ),
    -- A frozen procedure travels with its hash (ADR-14b §2.9: sha256 of the
    -- canonical JSON, shown on the handoff card) — one without the other is
    -- a definition nobody can name.
    CONSTRAINT ai_conversations_snapshot_pair_check CHECK (
      (procedure_snapshot IS NULL) = (procedure_snapshot_hash IS NULL)
    ),
    CONSTRAINT ai_conversations_snapshot_hash_check CHECK (
      procedure_snapshot_hash IS NULL OR procedure_snapshot_hash ~ '^[0-9a-f]{64}$'
    ),
    -- The structured columns are objects, never a bare value or a list.
    CONSTRAINT ai_conversations_json_shape_check CHECK (
      jsonb_typeof(slots) = 'object'
      AND jsonb_typeof(counters) = 'object'
      AND jsonb_typeof(signals) = 'object'
      AND (procedure_snapshot IS NULL OR jsonb_typeof(procedure_snapshot) = 'object')
      AND (suspended IS NULL OR jsonb_typeof(suspended) = 'object')
      AND (digest IS NULL OR jsonb_typeof(digest) = 'object')
    ),
    CONSTRAINT ai_conversations_numbers_check CHECK (
      last_processed_event_seq >= 0 AND version >= 0
    ),
    CONSTRAINT ai_conversations_closed_after_created_check CHECK (
      closed_at IS NULL OR closed_at >= created_at
    )
);

-- One row per connection (05 AI-03 §2), and the way a turn finds it.
CREATE UNIQUE INDEX "ai_conversations_license_id_chat_id_thread_id_key"
  ON "ai_conversations"("license_id", "chat_id", "thread_id");

-- The cascade from `threads` (retention, erasure).
CREATE INDEX "ai_conversations_thread_id_idx" ON "ai_conversations"("thread_id");

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_conversations_tenant ON ai_conversations
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- --------------------------------------------------------------------------
-- The connection is the licence's own, and the row starts unlocked
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace open a conversation, under its own licence, on another
-- workspace's thread id. This looks the thread up as the writer — under the
-- writer's RLS — and holds the row to it: same licence, same chat. A new row
-- also starts at version 0 whatever the insert said, so the lock's count is
-- never the writer's to choose.
CREATE FUNCTION ai_conversations_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM threads t
     WHERE t.id = NEW.thread_id
       AND t.chat_id = NEW.chat_id
       AND t.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_conversations: thread % is not a connection of chat % in this workspace',
      NEW.thread_id, NEW.chat_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.version := 0;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_conversations_before_insert
  BEFORE INSERT ON ai_conversations
  FOR EACH ROW
  EXECUTE FUNCTION ai_conversations_before_insert();

-- --------------------------------------------------------------------------
-- Every write bumps the version; the pinned configuration and the read
-- position only move forward
-- --------------------------------------------------------------------------
-- The optimistic lock is only as good as its counter: a write that left
-- `version` alone would slip past a turn holding the old number. So the
-- counter is not the writer's — every UPDATE, by anyone, moves it by one.
--
-- `config_version_id` is pinned when the row opens (ADR-14b §2.7). Null means
-- "before versioning, live tables" and may be filled once (§2.7 madde 3);
-- after that it never changes — a version published mid-conversation does not
-- reach it, and neither does a rollback.
--
-- `last_processed_event_seq` never goes back: a turn that covered event N
-- cannot be un-covered by a slower turn that read less.
CREATE FUNCTION ai_conversations_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.config_version_id IS NOT NULL
     AND NEW.config_version_id IS DISTINCT FROM OLD.config_version_id THEN
    RAISE EXCEPTION 'ai_conversations: config_version_id is pinned for the conversation (ADR-14b 2.7)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.last_processed_event_seq < OLD.last_processed_event_seq THEN
    RAISE EXCEPTION 'ai_conversations: last_processed_event_seq cannot move back (% -> %)',
      OLD.last_processed_event_seq, NEW.last_processed_event_seq
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_conversations_before_update
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW
  EXECUTE FUNCTION ai_conversations_before_update();

-- The default privileges (20260722090000) grant all four; narrow them. The
-- identity columns, `version`, `created_at` and `updated_at` are not the
-- runtime's to write.
REVOKE UPDATE, DELETE, TRUNCATE ON ai_conversations FROM siyahtus_app;
GRANT SELECT, INSERT ON ai_conversations TO siyahtus_app;
GRANT UPDATE (
  mode, mode_changed_at, mode_changed_by, mode_reason,
  active_skill_id, procedure_snapshot, procedure_snapshot_hash, step_id, step_status,
  slots, suspended, counters, signals, digest, outcome,
  last_processed_event_seq, config_version_id, closed_at
) ON ai_conversations TO siyahtus_app;
