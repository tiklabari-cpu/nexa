-- What the AI does when the knowledge base has no answer (tm 298 · SiyahTuş
-- analysis AI-06 §8, assumption AI-06-S1).
--
-- A question no procedure takes goes to the knowledge base; when it has no
-- answer the AI says so — never a silence, never a guess — and either hands the
-- conversation to a person at once or asks once whether to. Which of the two
-- depends on what the question is about: money, account, bonus and
-- responsible gaming go to a person at once, anything else is asked about
-- first (`DEFAULT_NO_ANSWER`, `@siyahtus/types`). The workspace may change
-- either per group and put the sentence in its own words.
--
--   { "policy_by_category": { "money": "handoff" | "ask", "account": …,
--                             "bonus": …, "rg": …, "other": … },
--     "text": "…" | null }
--
-- One value per AI agent, on the agent's hand-over settings row
-- (20261017120000; tm 303 adds the other hand-over triggers and messages
-- beside it). Null — no row, or never set — is the defaults; a group the value
-- leaves out, or holds something unknown in, has its default
-- (`readNoAnswerSettings`). Read live when the turn runs, never from a pinned
-- configuration version (ADR-14b §2.2, as `assignment_mode`).
--
-- Expand-only (CONVENTIONS §6.3): a nullable column nothing earlier reads.

ALTER TABLE "ai_handoff_settings" ADD COLUMN "no_answer" JSONB;

-- An object, and its sentence no longer than `NO_ANSWER_TEXT_MAX` — the route
-- refuses more, this keeps a writer past the route from storing it.
ALTER TABLE "ai_handoff_settings"
  ADD CONSTRAINT ai_handoff_settings_no_answer_check
    CHECK (
      no_answer IS NULL
      OR (
        jsonb_typeof(no_answer) = 'object'
        AND char_length(coalesce(no_answer ->> 'text', '')) <= 500
      )
    );

-- The runtime may change the setting, as it may the others on the row
-- (20261017120000 narrowed UPDATE to the settings themselves).
GRANT UPDATE (no_answer) ON ai_handoff_settings TO siyahtus_app;
