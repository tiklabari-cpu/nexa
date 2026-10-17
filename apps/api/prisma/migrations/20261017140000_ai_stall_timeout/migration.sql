-- How long a visitor may wait on the AI before a person is sent (tm 293.6 ·
-- SiyahTuş analysis AI-11 §5).
--
-- "Önce AI" (`assignment_mode = 'ai_first'`, 20261017120000) opens a visitor's
-- connection with nobody assigned and nothing queued, so the AI is the only one
-- answering it. A worker that died, a job that went missing (GV-02) or a turn
-- the caps refused left that visitor waiting on nobody. The `ai_stall` job
-- (`services/chat/ai-stall.ts`) watches for it: an unassigned connection in
-- `ai` mode whose oldest unanswered visitor message is older than this many
-- seconds goes to a person, reason `ai_failure`.
--
-- One value per AI agent, beside `assignment_mode`; no row means
-- `DEFAULT_AI_STALL_TIMEOUT_SECONDS` (`@siyahtus/types`), the same 60 the
-- column defaults to. The CHECK is `AI_STALL_TIMEOUT_SECONDS_MIN`/`_MAX`
-- (`ai-stall-watchdog.test.ts` compares them).
--
-- Expand-only (CONVENTIONS §6.3): a constant default, so the column is added
-- without rewriting the table, and nothing earlier reads it.

ALTER TABLE "ai_handoff_settings"
  ADD COLUMN "ai_stall_timeout_seconds" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "ai_handoff_settings"
  ADD CONSTRAINT ai_handoff_settings_ai_stall_timeout_seconds_check
    CHECK (ai_stall_timeout_seconds BETWEEN 15 AND 600);

-- The runtime may change the setting, as it may `assignment_mode`; nothing else
-- on the row (20261017120000 narrowed UPDATE to that one column).
GRANT UPDATE (ai_stall_timeout_seconds) ON ai_handoff_settings TO siyahtus_app;
