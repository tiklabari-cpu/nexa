-- The workspace's side of the compliance guardrails (tm 301.2 · SiyahTuş
-- analysis AI-08 · ADR-14b §2.12 · `@siyahtus/types` `ai-guardrails.ts`).
--
-- The platform's locked rules, G1–G19, live in code (`guardrails.ts`) and no
-- table holds them: a workspace cannot switch one off or edit it — the API
-- answers 403 — it can only add stricter things, and these tables hold them:
--
--   - `ai_guardrail_settings` — one row per customer-facing agent: the crisis
--     text G3 sends verbatim before its hand-over, the complaint procedure G15
--     gives, whether the judge call reads risky drafts, and the Founder's
--     approval of the crisis text. An agent cannot be switched on until that
--     approval stands (`409 ai_guardrail_setup_incomplete`, AI-08-S1). G14's
--     access information is not here: it is AI-13's setting (#310, K13);
--   - `ai_guardrail_rules` — extra imperative lines for the prompt's second
--     layer (`tenant_compliance`), each also able to block or hand over;
--   - `ai_forbidden_phrases` — what a reply must not say, exactly, as whole
--     words or by a pattern of a bounded dialect (the API refuses the rest);
--   - `ai_guardrail_hits` — the record of every hit, bound to its turn.
--
-- The first three are editing tables (ADR-14b §2.1, §2.12): no publish state —
-- `active` is "on in this version" — and every write goes through
-- `services/ai/config-draft.ts`, which stamps `updated_at`. A change to them
-- touches compliance: tm 316 asks the Founder to approve the version that
-- carries it. `approved_by`/`approved_at` are the crisis text's approval until
-- then, not a publish gate after it.
--
-- `scope` is `{"all": true}`, `{"skill_ids": [...]}` or `{"brand_ids": [...]}`,
-- a behaviour rule's shape (`readGuidanceScope`). The CHECKs below and the
-- constants of `ai-guardrails.ts` are one list (`ai-guardrails.test.ts`
-- compares them).
--
-- Expand only (CONVENTIONS §6.3): four new tables the previous release does
-- not read. Configuration, except `ai_guardrail_hits`, which quotes the
-- player's or the AI's words and goes with the conversation.

-- --------------------------------------------------------------------------
-- Settings
-- --------------------------------------------------------------------------

CREATE TABLE "ai_guardrail_settings" (
    "ai_agent_id"    UUID           NOT NULL,
    "license_id"     BIGINT         NOT NULL,
    "crisis_text"    TEXT,
    "complaint_text" TEXT,
    "judge_enabled"  BOOLEAN        NOT NULL DEFAULT false,
    "approved_by"    UUID,
    "approved_at"    TIMESTAMPTZ(6),
    "updated_by"     UUID,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_guardrail_settings_pkey" PRIMARY KEY ("ai_agent_id"),
    CONSTRAINT "ai_guardrail_settings_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_guardrail_settings_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `GUARDRAIL_TEXT_MAX`.
    CONSTRAINT ai_guardrail_settings_texts_check CHECK (
      (crisis_text IS NULL OR char_length(crisis_text) BETWEEN 1 AND 1000)
      AND (complaint_text IS NULL OR char_length(complaint_text) BETWEEN 1 AND 1000)
    ),
    -- An approval is of a crisis text; there is nothing to approve without one.
    CONSTRAINT ai_guardrail_settings_approval_check CHECK (
      approved_at IS NULL OR crisis_text IS NOT NULL
    )
);

CREATE INDEX "ai_guardrail_settings_license_id_idx" ON "ai_guardrail_settings"("license_id");

-- --------------------------------------------------------------------------
-- Workspace rules
-- --------------------------------------------------------------------------

CREATE TABLE "ai_guardrail_rules" (
    "id"          UUID           NOT NULL,
    "license_id"  BIGINT         NOT NULL,
    "ai_agent_id" UUID           NOT NULL,
    "title"       TEXT           NOT NULL,
    "body"        TEXT           NOT NULL,
    "category"    TEXT           NOT NULL,
    "action"      TEXT           NOT NULL DEFAULT 'prompt_only',
    "scope"       JSONB          NOT NULL DEFAULT '{"all": true}',
    "active"      BOOLEAN        NOT NULL DEFAULT true,
    "created_by"  UUID,
    "updated_by"  UUID,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_guardrail_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_guardrail_rules_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_guardrail_rules_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `GUARDRAIL_CATEGORIES` — the catalogue's five groups.
    CONSTRAINT ai_guardrail_rules_category_check CHECK (
      category IN ('responsible_gaming', 'money', 'data_security', 'legal', 'transparency')
    ),
    -- `GUARDRAIL_RULE_ACTIONS`.
    CONSTRAINT ai_guardrail_rules_action_check CHECK (
      action IN ('prompt_only', 'block_output', 'force_handoff')
    ),
    -- `GUARDRAIL_RULE_TITLE_MAX`, `GUARDRAIL_RULE_BODY_MAX`.
    CONSTRAINT ai_guardrail_rules_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT ai_guardrail_rules_body_check CHECK (char_length(body) BETWEEN 1 AND 600),
    CONSTRAINT ai_guardrail_rules_scope_check CHECK (jsonb_typeof(scope) = 'object')
);

CREATE INDEX "ai_guardrail_rules_license_id_ai_agent_id_idx"
  ON "ai_guardrail_rules"("license_id", "ai_agent_id");

-- --------------------------------------------------------------------------
-- Forbidden phrases
-- --------------------------------------------------------------------------

CREATE TABLE "ai_forbidden_phrases" (
    "id"          UUID           NOT NULL,
    "license_id"  BIGINT         NOT NULL,
    "ai_agent_id" UUID           NOT NULL,
    "phrase"      TEXT           NOT NULL,
    "match"       TEXT           NOT NULL DEFAULT 'word',
    "lang"        TEXT,
    "scope"       JSONB          NOT NULL DEFAULT '{"all": true}',
    "action"      TEXT           NOT NULL DEFAULT 'block',
    "active"      BOOLEAN        NOT NULL DEFAULT true,
    "created_by"  UUID,
    "updated_by"  UUID,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_forbidden_phrases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_forbidden_phrases_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_forbidden_phrases_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `FORBIDDEN_PHRASE_MATCHES`, `FORBIDDEN_PHRASE_ACTIONS`.
    CONSTRAINT ai_forbidden_phrases_match_check CHECK ("match" IN ('exact', 'word', 'regex')),
    CONSTRAINT ai_forbidden_phrases_action_check CHECK (action IN ('block', 'warn')),
    -- `FORBIDDEN_PHRASE_MAX`, `FORBIDDEN_PHRASE_REGEX_MAX`. Whether a pattern is
    -- of the safe dialect is the API's (`forbiddenPhraseProblem`): SQL cannot say.
    CONSTRAINT ai_forbidden_phrases_phrase_check CHECK (
      char_length(phrase) BETWEEN 1 AND 200
      AND ("match" <> 'regex' OR char_length(phrase) <= 120)
    ),
    -- `FORBIDDEN_PHRASE_LANG`; null applies to every reply.
    CONSTRAINT ai_forbidden_phrases_lang_check CHECK (lang IS NULL OR lang ~ '^[a-z]{2}$'),
    CONSTRAINT ai_forbidden_phrases_scope_check CHECK (jsonb_typeof(scope) = 'object')
);

CREATE INDEX "ai_forbidden_phrases_license_id_ai_agent_id_idx"
  ON "ai_forbidden_phrases"("license_id", "ai_agent_id");

-- --------------------------------------------------------------------------
-- The agent is the licence's own
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace write settings, rules or phrases, under its own licence,
-- for another workspace's agent id. This looks the agent up as the writer,
-- under the writer's RLS (the `ai_guidance_rules` pattern, 20261019120000).
CREATE FUNCTION ai_guardrails_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a
     WHERE a.id = NEW.ai_agent_id
       AND a.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION '%: ai agent % is not this workspace''s', TG_TABLE_NAME, NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_guardrail_settings_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, license_id ON ai_guardrail_settings
  FOR EACH ROW
  EXECUTE FUNCTION ai_guardrails_before_write();

CREATE TRIGGER ai_guardrail_rules_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, license_id ON ai_guardrail_rules
  FOR EACH ROW
  EXECUTE FUNCTION ai_guardrails_before_write();

CREATE TRIGGER ai_forbidden_phrases_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, license_id ON ai_forbidden_phrases
  FOR EACH ROW
  EXECUTE FUNCTION ai_guardrails_before_write();

-- --------------------------------------------------------------------------
-- The record of a hit
-- --------------------------------------------------------------------------
-- One row per rule a turn found broken, at the player's message (`input`) or
-- the AI's draft (`output`), and what the turn did about it. `turn_id` is the
-- turn's `ai_decision_logs.id` — the turn mints it before it starts, so its
-- hits and its decision share it; no foreign key, because a decision record
-- that failed to write (it never stops the reply) must not take the hit with
-- it. `rule_key` is `G3`, `rule:<uuid>` or `phrase:<uuid>` — no foreign key
-- either: deleting a phrase must not erase what it caught. `catalog_version`
-- is the `PLATFORM_GUARDRAILS_VERSION` the turn ran under; with
-- `pattern_index` it names the lexicon pattern that matched (AI-24's upkeep).
--
-- `evidence` quotes the player's or the AI's own words, masked before it is
-- written (AI-26), at most `GUARDRAIL_QUOTE_MAX` characters. So the row goes
-- with its conversation: `chat_id` and `thread_id` cascade, which is how the
-- retention sweep's thread delete and a customer's erasure (through
-- `chats.customer_id`) take it. A hit always has a conversation — a preview
-- records none. Rows are never edited.
CREATE TABLE "ai_guardrail_hits" (
    "id"              UUID           NOT NULL,
    "license_id"      BIGINT         NOT NULL,
    "chat_id"         VARCHAR(12)    NOT NULL,
    "thread_id"       VARCHAR(12)    NOT NULL,
    "turn_id"         UUID           NOT NULL,
    "rule_key"        TEXT           NOT NULL,
    "stage"           TEXT           NOT NULL,
    "action_taken"    TEXT           NOT NULL,
    "evidence"        TEXT,
    "pattern_index"   INTEGER,
    "catalog_version" TEXT           NOT NULL,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_guardrail_hits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_guardrail_hits_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_guardrail_hits_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_guardrail_hits_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `GUARDRAIL_STAGES`.
    CONSTRAINT ai_guardrail_hits_stage_check CHECK (stage IN ('input', 'output')),
    -- `GUARDRAIL_HIT_ACTIONS`.
    CONSTRAINT ai_guardrail_hits_action_check CHECK (action_taken IN (
      'handoff', 'crisis_text', 'rewrite', 'safe_text', 'prompt_block', 'warn', 'evidence'
    )),
    -- `guardrailHitRuleKey`.
    CONSTRAINT ai_guardrail_hits_rule_key_check CHECK (
      rule_key ~ '^(G([1-9]|1[0-9])|(rule|phrase):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
    ),
    -- `GUARDRAIL_QUOTE_MAX`.
    CONSTRAINT ai_guardrail_hits_evidence_check CHECK (
      evidence IS NULL OR char_length(evidence) <= 200
    ),
    CONSTRAINT ai_guardrail_hits_pattern_index_check CHECK (
      pattern_index IS NULL OR pattern_index >= 0
    )
);

-- The hit log, newest first; one rule's hits (the counts per rule key); one
-- conversation's (the timeline viewer, ID-09).
CREATE INDEX "ai_guardrail_hits_license_id_created_at_idx"
  ON "ai_guardrail_hits"("license_id", "created_at" DESC);
CREATE INDEX "ai_guardrail_hits_license_id_rule_key_created_at_idx"
  ON "ai_guardrail_hits"("license_id", "rule_key", "created_at" DESC);
CREATE INDEX "ai_guardrail_hits_chat_id_created_at_idx"
  ON "ai_guardrail_hits"("chat_id", "created_at");
CREATE INDEX "ai_guardrail_hits_thread_id_idx" ON "ai_guardrail_hits"("thread_id");

-- --------------------------------------------------------------------------
-- RLS and grants
-- --------------------------------------------------------------------------

ALTER TABLE ai_guardrail_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_guardrail_settings_tenant ON ai_guardrail_settings
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE ai_guardrail_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_guardrail_rules_tenant ON ai_guardrail_rules
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE ai_forbidden_phrases ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_forbidden_phrases_tenant ON ai_forbidden_phrases
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE ai_guardrail_hits ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_guardrail_hits_tenant ON ai_guardrail_hits
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant all four; a workspace never
-- empties a table wholesale, and a hit is never rewritten.
REVOKE TRUNCATE ON ai_guardrail_settings, ai_guardrail_rules, ai_forbidden_phrases FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ai_guardrail_settings, ai_guardrail_rules, ai_forbidden_phrases TO siyahtus_app;

GRANT SELECT, INSERT, DELETE ON ai_guardrail_hits TO siyahtus_app;
REVOKE UPDATE, TRUNCATE ON ai_guardrail_hits FROM siyahtus_app;
