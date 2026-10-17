-- When a person is assigned to a visitor's connection (tm 293.2 · SiyahTuş
-- analysis AI-11 §3, §7; owner decision K9 "Önce AI").
--
-- Today routing assigns a connection the moment the visitor's first message
-- opens it, so the AI and an agent answer the same player side by side. An AI
-- agent set to 'ai_first' changes that: the connection opens unassigned,
-- outside the queue and in `ai` mode (`threads.ai_mode`, 20261017100000), and
-- is routed to a person only when it leaves the AI — the AI hands it over, a
-- rule bot answers, or a person takes it. 'parallel' is today's behaviour.
--
-- One row per AI agent: the table the AI agent's hand-over settings live in
-- (05 AI-09 — trigger thresholds, hand-over messages, after-hours and
-- no-answer policies arrive with tm 303, the stall timeout with tm 293.6).
-- This opens it with the one column the AI-first start needs.
--
-- `assignment_mode` is read live when a connection opens, never from a pinned
-- configuration version: no AI conversation exists yet at that moment, and it
-- is a question of when a person is routed, which ADR-14b §2.2 keeps out of the
-- versioned package (human routing reads its tables live).
--
-- No row means `DEFAULT_AI_ASSIGNMENT_MODE` (`@siyahtus/types`): 'parallel',
-- so every existing workspace keeps its behaviour. The CHECK and
-- `AI_ASSIGNMENT_MODES` are one list (`ai-first-start.test.ts` compares them).
--
-- Expand-only (CONVENTIONS §6.3): a new table nothing reads before this
-- release. Configuration, not personal data; it goes with its agent (CASCADE)
-- and its licence.

CREATE TABLE "ai_handoff_settings" (
    "ai_agent_id"     UUID           NOT NULL,
    "license_id"      BIGINT         NOT NULL,
    "assignment_mode" TEXT           NOT NULL DEFAULT 'parallel',
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_handoff_settings_pkey" PRIMARY KEY ("ai_agent_id"),
    CONSTRAINT "ai_handoff_settings_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_handoff_settings_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `AI_ASSIGNMENT_MODES` (`@siyahtus/types`).
    CONSTRAINT ai_handoff_settings_assignment_mode_check
      CHECK (assignment_mode IN ('ai_first', 'parallel'))
);

-- A connection's opening reads the workspace's rows (`ai-first.ts`).
CREATE INDEX "ai_handoff_settings_license_id_idx" ON "ai_handoff_settings"("license_id");

ALTER TABLE ai_handoff_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_handoff_settings_tenant ON ai_handoff_settings
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- --------------------------------------------------------------------------
-- The agent is the licence's own, and the database keeps the time
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace write settings, under its own licence, for another
-- workspace's agent id. This looks the agent up as the writer — under the
-- writer's RLS — and holds the row to it. `updated_at` is the database's, so
-- no writer has to remember it (ADR-14b §2.5 keeps it out of the routes).
CREATE FUNCTION ai_handoff_settings_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a
     WHERE a.id = NEW.ai_agent_id
       AND a.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_handoff_settings: ai agent % is not this workspace''s', NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_handoff_settings_before_write
  BEFORE INSERT OR UPDATE ON ai_handoff_settings
  FOR EACH ROW
  EXECUTE FUNCTION ai_handoff_settings_before_write();

-- The default privileges (20260722090000) grant all four; narrow them. A
-- settings row goes with its agent, never on its own, and only the setting
-- itself is the runtime's to change.
REVOKE UPDATE, DELETE, TRUNCATE ON ai_handoff_settings FROM siyahtus_app;
GRANT SELECT, INSERT ON ai_handoff_settings TO siyahtus_app;
GRANT UPDATE (assignment_mode) ON ai_handoff_settings TO siyahtus_app;
