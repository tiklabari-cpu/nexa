-- The AI's hand-over triggers and messages (tm 303.1 · SiyahTuş analysis
-- AI-09; owner decision K9; assumptions AI-09-S1, AI-09-S2).
--
-- Today the AI hands a conversation to a person only when a procedure says so,
-- or a guardrail fires. AI-09 adds triggers of its own — a player not
-- understood twice in a row, a negative streak, a loop, too many turns, the
-- same problem twice the same day — and the sentence the player is told as it
-- happens, per reason, said as written (no model). Both are the workspace's to
-- tune; the compliance triggers are not (`LOCKED_HANDOFF_REASONS`,
-- `@siyahtus/types` `handoff.ts`), so nothing here stores a switch for them.
--
-- Three columns on the agent's hand-over settings row (20261017120000):
--
--   triggers    — { not_understood: { enabled, turns, ask_first },
--                   negative_sentiment: { enabled, consecutive, ask_first },
--                   abuse: { warnings }, loop_detected: { enabled },
--                   max_turns: { enabled, turns }, repeat_same_day: { enabled } }
--   messages    — { <reason>: "…" } — only the reasons the workspace wrote a
--                 message for; the others say the default
--                 (`DEFAULT_HANDOFF_MESSAGES`), so a default can still change.
--   after_hours — { text } — what the player is told when the hand-over lands
--                 where nobody is accepting chats (AI-12 §4).
--
-- Null — no row, or never set — is the defaults; a field the value leaves out
-- or holds something out of bounds in has its default (`readHandoffTriggers`,
-- `readHandoffMessages`, `readHandoffAfterHours`).
--
-- A draft table (ADR-14b §2.12): no publish state on the row, writes through
-- `config-draft.ts`, and the turn reads these from the configuration it is
-- pinned to (`AiConfigSource`). Unlike `assignment_mode`, they go into the
-- versioned package (ADR-14b §2.2).
--
-- Expand-only (CONVENTIONS §6.3): nullable columns nothing earlier reads.

ALTER TABLE "ai_handoff_settings"
  ADD COLUMN "triggers"    JSONB,
  ADD COLUMN "messages"    JSONB,
  ADD COLUMN "after_hours" JSONB;

-- Every message a string, none past what `HANDOFF_MESSAGE_MAX` (500
-- characters, the route's limit) can take in UTF-8 — 4 bytes a character: the
-- route refuses more, this keeps a writer past the route from storing a blob.
-- The bound is in bytes because a database created SQL_ASCII (the development
-- one is) counts a Turkish letter as two characters, so a 500-character CHECK
-- would refuse a message the route let through. A CHECK takes no subquery, so
-- the walk over the object is a function of its own.
CREATE FUNCTION ai_handoff_messages_valid(messages JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(messages) = 'object'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_each(messages) AS m(reason, body)
        WHERE jsonb_typeof(m.body) <> 'string'
           OR octet_length(m.body #>> '{}') > 2000
     );
$$;

ALTER TABLE "ai_handoff_settings"
  ADD CONSTRAINT ai_handoff_settings_triggers_check
    CHECK (triggers IS NULL OR jsonb_typeof(triggers) = 'object'),
  ADD CONSTRAINT ai_handoff_settings_messages_check
    CHECK (messages IS NULL OR ai_handoff_messages_valid(messages)),
  ADD CONSTRAINT ai_handoff_settings_after_hours_check
    CHECK (
      after_hours IS NULL
      OR (
        jsonb_typeof(after_hours) = 'object'
        AND octet_length(coalesce(after_hours ->> 'text', '')) <= 2000
      )
    );

-- The runtime may change these settings, as it may the others on the row
-- (20261017120000 narrowed UPDATE to the settings themselves).
GRANT UPDATE (triggers, messages, after_hours) ON ai_handoff_settings TO siyahtus_app;
