-- The AI's behaviour rules (tm 299.1 · SiyahTuş analysis AI-07 ·
-- `services/ai/conversation/guidance.ts`).
--
-- A workspace had nowhere to tell its AI how to behave: `ai_agents.instruction`
-- existed, no API wrote it and no prompt read it. A rule here is one plain
-- sentence with a category, a scope and a priority; every message the AI
-- writes carries the rules in scope, between the step's instruction and the
-- persona (`PROMPT_LAYERS`).
--
-- An editing table (ADR-14b §2.1, §2.12): no publish state — `active` is "on in
-- this version" — and every write goes through `services/ai/config-draft.ts`,
-- which stamps `updated_at`. The turn reads the rules through `AiConfigSource`.
--
-- `scope` is one of `{"all": true}`, `{"skill_ids": [...]}` or
-- `{"brand_ids": [...]}`; the API validates it and the reader
-- (`readGuidanceScope`) treats anything else as applying nowhere. The CHECKs
-- and `GUIDANCE_CATEGORIES` / `GUIDANCE_BODY_MAX` are one list
-- (`ai-guidance.test.ts` compares them).
--
-- Expand, then move (CONVENTIONS §6.3): a new table the previous release does
-- not read, and a copy of `ai_agents.instruction` into it. The column stays —
-- the previous release still selects it — and is dropped by a later release.
-- Configuration, not personal data; it goes with its agent and its licence.

CREATE TABLE "ai_guidance_rules" (
    "id"          UUID           NOT NULL,
    "license_id"  BIGINT         NOT NULL,
    "ai_agent_id" UUID           NOT NULL,
    "title"       TEXT           NOT NULL,
    "body"        TEXT           NOT NULL,
    "category"    TEXT           NOT NULL,
    "scope"       JSONB          NOT NULL DEFAULT '{"all": true}',
    "priority"    INTEGER        NOT NULL DEFAULT 100,
    "active"      BOOLEAN        NOT NULL DEFAULT true,
    "owner_id"    UUID,
    "created_by"  UUID,
    "updated_by"  UUID,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_guidance_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_guidance_rules_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_guidance_rules_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `GUIDANCE_CATEGORIES` (`@siyahtus/types`).
    CONSTRAINT ai_guidance_rules_category_check
      CHECK (category IN ('communication', 'clarification', 'sensitive', 'prohibition', 'other')),
    -- `GUIDANCE_BODY_MAX`, `GUIDANCE_TITLE_MAX`.
    CONSTRAINT ai_guidance_rules_body_check
      CHECK (char_length(body) BETWEEN 1 AND 600),
    CONSTRAINT ai_guidance_rules_title_check
      CHECK (char_length(title) BETWEEN 1 AND 120),
    -- `GUIDANCE_PRIORITY_MIN` … `GUIDANCE_PRIORITY_MAX`.
    CONSTRAINT ai_guidance_rules_priority_check
      CHECK (priority BETWEEN 1 AND 1000),
    CONSTRAINT ai_guidance_rules_scope_check
      CHECK (jsonb_typeof(scope) = 'object')
);

-- The editor and the turn read one agent's rules.
CREATE INDEX "ai_guidance_rules_license_id_ai_agent_id_idx"
  ON "ai_guidance_rules"("license_id", "ai_agent_id");

ALTER TABLE ai_guidance_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_guidance_rules_tenant ON ai_guidance_rules
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- --------------------------------------------------------------------------
-- The agent is the licence's own
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace write rules, under its own licence, for another
-- workspace's agent id. This looks the agent up as the writer, under the
-- writer's RLS, and holds the row to it (the `ai_handoff_settings` pattern,
-- 20261017120000).
CREATE FUNCTION ai_guidance_rules_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a
     WHERE a.id = NEW.ai_agent_id
       AND a.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_guidance_rules: ai agent % is not this workspace''s', NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_guidance_rules_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, license_id ON ai_guidance_rules
  FOR EACH ROW
  EXECUTE FUNCTION ai_guidance_rules_before_write();

-- The default privileges (20260722090000) grant all four; a workspace never
-- empties the table wholesale.
REVOKE TRUNCATE ON ai_guidance_rules FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_guidance_rules TO siyahtus_app;

-- --------------------------------------------------------------------------
-- Move: a customer-facing agent's `instruction` becomes its "Genel talimat"
-- --------------------------------------------------------------------------
-- One rule per filled instruction, scope every conversation, on — what its
-- author wrote it for. An instruction longer than a rule's 600 characters is
-- cut into consecutive rules ("Genel talimat (2)", …) rather than shortened:
-- nothing the author wrote is lost. Copilot never talks to a player, so its
-- instruction is not a behaviour rule and stays where it is.
--
-- ADR-14b §2.12 asks this move to go through the write helper and leave one
-- change-history row; the helper's only step today is `updated_at`, written
-- here, and the history (tm 315) does not exist yet — its first row for these
-- rules is their next edit (PLAN §D280).
INSERT INTO ai_guidance_rules
  (id, license_id, ai_agent_id, title, body, category, scope, priority, active, created_at, updated_at)
SELECT gen_random_uuid(),
       a.license_id,
       a.id,
       CASE WHEN part.n = 1 THEN 'Genel talimat' ELSE 'Genel talimat (' || part.n || ')' END,
       substr(btrim(a.instruction), (part.n - 1) * 600 + 1, 600),
       'other',
       '{"all": true}'::jsonb,
       100,
       true,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
  FROM ai_agents a
 CROSS JOIN LATERAL generate_series(
         1, ceil(char_length(btrim(a.instruction)) / 600.0)::int
       ) AS part(n)
 WHERE a.kind = 'ai_agent'
   AND a.instruction IS NOT NULL
   AND btrim(a.instruction) <> '';
