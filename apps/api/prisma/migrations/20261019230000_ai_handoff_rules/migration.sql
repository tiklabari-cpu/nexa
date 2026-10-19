-- The workspace's hand-over rules (tm 303.3 · SiyahTuş analysis AI-09; owner
-- decision K9 · `@siyahtus/types` `handoff-rules.ts`).
--
-- An ordered list per customer-facing agent: a trigger (`trigger_type`,
-- `trigger_value`), a target team (`target_group_id` or a routing topic in
-- `target_topic`; neither is the usual routing) and a priority. The first
-- active rule that matches decides (`position`, then `created_at`, `id`).
-- The platform's locked rules (G1–G5, G13, G15) are the guardrail catalogue's
-- and are not stored here.
--
-- An editing table (ADR-14b §2.1, §2.12): no publish state — `active` is "on
-- in this version" — every write goes through `services/ai/config-draft.ts`,
-- which stamps `updated_at`, and a turn reads the rules through
-- `AiConfigSource`. `position` is not unique: a reorder rewrites every
-- position of the agent in one transaction, and a unique pair would need a
-- deferred constraint Prisma does not model.
--
-- The CHECKs and the type's lists are one (`ai-handoff-rules.test.ts`
-- compares them). Lengths are by byte, four per character: the development
-- database is SQL_ASCII and counts a Turkish letter as two characters (the
-- 20261019210000 note). `target_group_id` is a soft reference, like
-- `risk_flag_settings.rg_group_id`: a team deleted later sends the hand-over
-- to the usual routing (`handoff-service.ts`), and the route checks the team
-- is the workspace's when the rule is written.
--
-- Expand only (CONVENTIONS §6.3): a new table the previous release does not
-- read. Configuration, not personal data; it goes with its agent and its
-- licence.

CREATE TABLE "ai_handoff_rules" (
    "id"              UUID           NOT NULL,
    "license_id"      BIGINT         NOT NULL,
    "ai_agent_id"     UUID           NOT NULL,
    "position"        INTEGER        NOT NULL,
    "active"          BOOLEAN        NOT NULL DEFAULT true,
    "title"           TEXT           NOT NULL,
    "trigger_type"    TEXT           NOT NULL,
    "trigger_value"   TEXT,
    "target_group_id" BIGINT,
    "target_topic"    TEXT,
    "priority"        TEXT           NOT NULL DEFAULT 'normal',
    "created_by"      UUID,
    "updated_by"      UUID,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_handoff_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_handoff_rules_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_handoff_rules_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `HANDOFF_RULES_PER_AGENT_MAX` bounds the list; a position past it is a bug.
    CONSTRAINT ai_handoff_rules_position_check
      CHECK (position BETWEEN 1 AND 1000),
    -- `HANDOFF_RULE_TITLE_MAX` (80).
    CONSTRAINT ai_handoff_rules_title_check
      CHECK (btrim(title) <> '' AND octet_length(title) <= 320),
    -- `HANDOFF_RULE_TRIGGER_TYPES`.
    CONSTRAINT ai_handoff_rules_trigger_type_check
      CHECK (trigger_type IN ('topic', 'procedure', 'phrase', 'ai_unresolved', 'player_request', 'risk_flag')),
    -- The value each trigger takes: `HANDOFF_RULE_TOPICS`, a skill id,
    -- `HANDOFF_RULE_PHRASE_MAX` (100), `RISK_FLAG_TYPES`, none.
    CONSTRAINT ai_handoff_rules_trigger_value_check
      CHECK (
        CASE trigger_type
          WHEN 'topic' THEN trigger_value IN
            ('deposit', 'withdrawal', 'account_recovery', 'bonus', 'verification')
          WHEN 'procedure' THEN trigger_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          WHEN 'phrase' THEN btrim(trigger_value) <> '' AND octet_length(trigger_value) <= 400
          WHEN 'risk_flag' THEN trigger_value IN
            ('rg_signal', 'self_exclusion_request', 'underage_suspected', 'self_harm',
             'complaint_formal', 'fraud_suspected', 'account_takeover_suspected',
             'multi_account', 'abusive', 'account_security')
          ELSE trigger_value IS NULL
        END
      ),
    -- A team or a topic, never both (the procedures' `HandoffTarget`).
    CONSTRAINT ai_handoff_rules_target_check
      CHECK (
        NOT (target_group_id IS NOT NULL AND target_topic IS NOT NULL)
        AND (target_group_id IS NULL OR target_group_id > 0)
        AND (target_topic IS NULL OR target_topic ~ '^[a-z][a-z0-9_]{0,63}$')
      ),
    -- `GUARDRAIL_PRIORITIES`.
    CONSTRAINT ai_handoff_rules_priority_check
      CHECK (priority IN ('urgent', 'high', 'normal'))
);

-- The editor and the turn read one agent's list, in order.
CREATE INDEX "ai_handoff_rules_license_id_ai_agent_id_position_idx"
  ON "ai_handoff_rules"("license_id", "ai_agent_id", "position");

ALTER TABLE ai_handoff_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_handoff_rules_tenant ON ai_handoff_rules
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- --------------------------------------------------------------------------
-- The agent is the licence's own
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace write rules, under its own licence, for another
-- workspace's agent id (the `ai_guidance_rules` pattern, 20261019120000).
CREATE FUNCTION ai_handoff_rules_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a
     WHERE a.id = NEW.ai_agent_id
       AND a.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_handoff_rules: ai agent % is not this workspace''s', NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_handoff_rules_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, license_id ON ai_handoff_rules
  FOR EACH ROW
  EXECUTE FUNCTION ai_handoff_rules_before_write();

-- The default privileges (20260722090000) grant all four; a workspace never
-- empties the table wholesale.
REVOKE TRUNCATE ON ai_handoff_rules FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_handoff_rules TO siyahtus_app;
