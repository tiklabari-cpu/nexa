-- The AI test bench (tm 314.1 · SiyahTuş analysis AI-19 · `@siyahtus/types`
-- `ai-testing.ts`): the workspace's scenarios, the runs that play them, each
-- scenario's result, and the "talk like a player" sessions.
--
--   - `ai_test_scenarios` — a conversation the AI must get right: scripted
--     (`turns`, the player's messages) or simulated (a model plays `persona`,
--     knowing `facts`, wanting `goal`), at `simulated_now`, with what a tool
--     step would have returned (`tool_outputs`, AI-28) and `expectations`.
--     `brand_id` labels the brand the conversation comes in through; RLS stays
--     per licence (the Test tab lists every brand's, a run plays them all);
--   - `ai_test_runs` — one play of a set against the draft, the published
--     configuration or a named version (`config_version_id`, tm 316: no
--     foreign key until that table exists). The counts are the results';
--     `compliance_*` the platform pack's share of them (AI-19-S1), kept on the
--     run for the root panel (tm 389.19). A pre-publish run always carries the
--     pack;
--   - `ai_test_run_results` — one scenario of one run: why it stopped, how it
--     ended, the transcript with every AI turn's trace, the hard checks that
--     decide `status` and the judge's advice, which never does (AI-19-S3).
--     `scenario_key` is the scenario's id or `compliance:G<n>:<lang>`; it
--     outlives a deleted scenario, so the regression still pairs the rows;
--   - `ai_sandbox_sessions` — one person's conversation with the AI, kept
--     until `expires_at` (the API sets it 24 h after the last turn).
--
-- Nothing here is a conversation: a simulation writes to no chat, thread,
-- event, customer, rating, usage counter or webhook (tm 314.2's shield), only
-- to these rows. Scenario text is synthetic by rule and masked by the API
-- (AI-26). `created_by`, `updated_by` and `started_by` are accounts with no
-- foreign key (`canned_responses.updated_by` precedent).
--
-- The CHECKs and the constants of `ai-testing.ts` are one list
-- (`ai-testing-schema.test.ts` compares them).
--
-- Expand only (CONVENTIONS §6.3): four new tables the previous release does
-- not read.

-- --------------------------------------------------------------------------
-- Scenarios
-- --------------------------------------------------------------------------

CREATE TABLE "ai_test_scenarios" (
    "id"            UUID           NOT NULL,
    "license_id"    BIGINT         NOT NULL,
    "ai_agent_id"   UUID           NOT NULL,
    "brand_id"      UUID,
    "name"          TEXT           NOT NULL,
    "origin"        TEXT           NOT NULL DEFAULT 'manual',
    "origin_ref"    TEXT,
    "mode"          TEXT           NOT NULL DEFAULT 'scripted',
    "persona"       TEXT           NOT NULL DEFAULT 'normal',
    "language"      TEXT           NOT NULL DEFAULT 'tr',
    "simulated_now" TIMESTAMPTZ(6),
    "goal"          TEXT,
    "turns"         JSONB          NOT NULL DEFAULT '[]',
    "facts"         JSONB          NOT NULL DEFAULT '{}',
    "tool_outputs"  JSONB          NOT NULL DEFAULT '{}',
    "expectations"  JSONB          NOT NULL,
    "active"        BOOLEAN        NOT NULL DEFAULT true,
    "created_by"    UUID,
    "updated_by"    UUID,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_test_scenarios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_test_scenarios_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_test_scenarios_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_test_scenarios_brand_id_fkey"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- `AI_TEST_SCENARIO_ORIGINS`, `AI_TEST_SCENARIO_MODES`, `SCENARIO_PERSONAS`.
    CONSTRAINT ai_test_scenarios_origin_check CHECK (origin IN ('template', 'manual', 'generated', 'from_chat', 'from_qa')),
    CONSTRAINT ai_test_scenarios_mode_check CHECK (mode IN ('scripted', 'simulated')),
    CONSTRAINT ai_test_scenarios_persona_check CHECK (persona IN ('normal', 'sabirsiz', 'kizgin', 'eksik_bilgi', 'sorumlu_oyun_sinyali', 'resit_olmayan', 'insan_istiyor', 'yabanci_dil')),
    -- `AI_TEST_LANG`.
    CONSTRAINT ai_test_scenarios_language_check CHECK (language ~ '^[a-z]{2}$'),
    -- `AI_TEST_SCENARIO_NAME_MAX`, `AI_TEST_SCENARIO_GOAL_MAX`.
    CONSTRAINT ai_test_scenarios_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT ai_test_scenarios_goal_check CHECK (
      goal IS NULL OR char_length(btrim(goal)) BETWEEN 1 AND 500
    ),
    CONSTRAINT ai_test_scenarios_origin_ref_check CHECK (
      origin_ref IS NULL OR char_length(origin_ref) BETWEEN 1 AND 200
    ),
    -- A simulated player wants something; a script says something
    -- (`AI_TEST_SCENARIO_TURNS_MAX`).
    CONSTRAINT ai_test_scenarios_turns_check CHECK (
      jsonb_typeof(turns) = 'array'
      AND jsonb_array_length(turns) <= 30
      AND (mode <> 'scripted' OR jsonb_array_length(turns) >= 1)
    ),
    CONSTRAINT ai_test_scenarios_goal_required_check CHECK (mode <> 'simulated' OR goal IS NOT NULL),
    CONSTRAINT ai_test_scenarios_json_check CHECK (
      jsonb_typeof(facts) = 'object'
      AND jsonb_typeof(tool_outputs) = 'object'
      AND jsonb_typeof(expectations) = 'object'
      AND expectations ? 'outcome'
      AND expectations ? 'max_turns'
    )
);

CREATE INDEX "ai_test_scenarios_license_id_ai_agent_id_idx"
  ON "ai_test_scenarios"("license_id", "ai_agent_id");
CREATE INDEX "ai_test_scenarios_brand_id_idx" ON "ai_test_scenarios"("brand_id");

-- --------------------------------------------------------------------------
-- Runs
-- --------------------------------------------------------------------------

CREATE TABLE "ai_test_runs" (
    "id"                      UUID           NOT NULL,
    "license_id"              BIGINT         NOT NULL,
    "ai_agent_id"             UUID           NOT NULL,
    "config_target"           TEXT           NOT NULL,
    "config_version_id"       UUID,
    "draft_revision"          INTEGER,
    "trigger"                 TEXT           NOT NULL,
    "status"                  TEXT           NOT NULL DEFAULT 'queued',
    "scenario_count"          INTEGER        NOT NULL DEFAULT 0,
    "passed"                  INTEGER        NOT NULL DEFAULT 0,
    "failed"                  INTEGER        NOT NULL DEFAULT 0,
    "errored"                 INTEGER        NOT NULL DEFAULT 0,
    "tokens"                  BIGINT         NOT NULL DEFAULT 0,
    "compliance_pack_version" TEXT,
    "compliance_passed"       INTEGER,
    "compliance_failed"       INTEGER,
    "error"                   TEXT,
    "started_by"              UUID,
    "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at"              TIMESTAMPTZ(6),
    "finished_at"             TIMESTAMPTZ(6),

    CONSTRAINT "ai_test_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_test_runs_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_test_runs_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `AI_TEST_RUN_TARGETS`, `AI_TEST_RUN_TRIGGERS`, `AI_TEST_RUN_STATUSES`.
    CONSTRAINT ai_test_runs_target_check CHECK (config_target IN ('draft', 'published', 'version')),
    CONSTRAINT ai_test_runs_trigger_check CHECK (trigger IN ('manual', 'pre_publish', 'nightly')),
    CONSTRAINT ai_test_runs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    -- A version is named exactly when the run is of one; a draft revision is a draft's.
    CONSTRAINT ai_test_runs_version_check CHECK (
      (config_target = 'version') = (config_version_id IS NOT NULL)
      AND (draft_revision IS NULL OR (config_target = 'draft' AND draft_revision >= 0))
    ),
    -- `AI_TEST_RUN_SCENARIOS_MAX`; the verdicts never outnumber the scenarios.
    CONSTRAINT ai_test_runs_counts_check CHECK (
      scenario_count BETWEEN 0 AND 200
      AND passed >= 0 AND failed >= 0 AND errored >= 0 AND tokens >= 0
      AND passed + failed + errored <= scenario_count
    ),
    -- The pack's share: its version and both counts, or none of them; a
    -- pre-publish run always plays it (AI-19-S1).
    CONSTRAINT ai_test_runs_compliance_check CHECK (
      (compliance_pack_version IS NULL) = (compliance_passed IS NULL)
      AND (compliance_pack_version IS NULL) = (compliance_failed IS NULL)
      AND (compliance_pack_version IS NULL OR char_length(compliance_pack_version) BETWEEN 1 AND 40)
      AND (compliance_passed IS NULL OR (
        compliance_passed >= 0 AND compliance_failed >= 0
        AND compliance_passed <= passed
        AND compliance_failed <= failed + errored
      ))
      AND (trigger <> 'pre_publish' OR compliance_pack_version IS NOT NULL)
    ),
    -- A run that has ended says when; one that is playing says since when.
    CONSTRAINT ai_test_runs_times_check CHECK (
      (status IN ('completed', 'failed', 'cancelled')) = (finished_at IS NOT NULL)
      AND (status <> 'running' OR started_at IS NOT NULL)
    ),
    -- `AI_TEST_RUN_ERROR_MAX`: only a failed run carries an error.
    CONSTRAINT ai_test_runs_error_check CHECK (
      (error IS NULL OR (status = 'failed' AND char_length(error) BETWEEN 1 AND 500))
    )
);

-- An agent's run history, newest first, and the regression's previous run.
CREATE INDEX "ai_test_runs_license_id_ai_agent_id_created_at_idx"
  ON "ai_test_runs"("license_id", "ai_agent_id", "created_at");

-- --------------------------------------------------------------------------
-- Results
-- --------------------------------------------------------------------------

CREATE TABLE "ai_test_run_results" (
    "id"              UUID           NOT NULL,
    "license_id"      BIGINT         NOT NULL,
    "run_id"          UUID           NOT NULL,
    "scenario_id"     UUID,
    "scenario_key"    TEXT           NOT NULL,
    "scenario_name"   TEXT           NOT NULL,
    "status"          TEXT           NOT NULL,
    "stop_reason"     TEXT           NOT NULL,
    "outcome"         TEXT,
    "handoff_team_id" BIGINT,
    "transcript"      JSONB          NOT NULL DEFAULT '[]',
    "checks"          JSONB          NOT NULL DEFAULT '[]',
    "judge"           JSONB,
    "tokens"          INTEGER        NOT NULL DEFAULT 0,
    "duration_ms"     INTEGER        NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_test_run_results_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_test_run_results_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_test_run_results_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "ai_test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_test_run_results_scenario_id_fkey"
      FOREIGN KEY ("scenario_id") REFERENCES "ai_test_scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- `AI_TEST_RESULT_STATUSES`, `AI_TEST_STOP_REASONS`, `SCENARIO_OUTCOMES`.
    CONSTRAINT ai_test_run_results_status_check CHECK (status IN ('passed', 'failed', 'errored')),
    CONSTRAINT ai_test_run_results_stop_reason_check CHECK (stop_reason IN ('resolved', 'handoff', 'max_turns', 'script_end', 'timeout', 'error')),
    CONSTRAINT ai_test_run_results_outcome_check CHECK (outcome IS NULL OR outcome IN ('resolved', 'resolved_waiting', 'handoff')),
    -- Errored is "could not be played": the clock or a failure stopped it, and
    -- only then.
    CONSTRAINT ai_test_run_results_errored_check CHECK (
      (status = 'errored') = (stop_reason IN ('timeout', 'error'))
    ),
    -- `AI_TEST_SCENARIO_KEY_PATTERN`: a workspace scenario's id, or the pack's key.
    CONSTRAINT ai_test_run_results_scenario_key_check CHECK (
      scenario_key ~ '^(compliance:G([1-9]|1[0-9]):[a-z]{2}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
      AND (scenario_id IS NULL OR scenario_key = scenario_id::text)
    ),
    CONSTRAINT ai_test_run_results_scenario_name_check CHECK (char_length(scenario_name) BETWEEN 1 AND 120),
    CONSTRAINT ai_test_run_results_json_check CHECK (
      jsonb_typeof(transcript) = 'array'
      AND jsonb_typeof(checks) = 'array'
      AND (judge IS NULL OR jsonb_typeof(judge) = 'object')
    ),
    CONSTRAINT ai_test_run_results_numbers_check CHECK (tokens >= 0 AND duration_ms >= 0)
);

CREATE UNIQUE INDEX "ai_test_run_results_run_id_scenario_key_key"
  ON "ai_test_run_results"("run_id", "scenario_key");
CREATE INDEX "ai_test_run_results_license_id_idx" ON "ai_test_run_results"("license_id");
CREATE INDEX "ai_test_run_results_scenario_id_idx" ON "ai_test_run_results"("scenario_id");

-- --------------------------------------------------------------------------
-- Sandbox sessions
-- --------------------------------------------------------------------------

CREATE TABLE "ai_sandbox_sessions" (
    "id"                UUID           NOT NULL,
    "license_id"        BIGINT         NOT NULL,
    "ai_agent_id"       UUID           NOT NULL,
    "config_target"     TEXT           NOT NULL DEFAULT 'draft',
    "config_version_id" UUID,
    "state"             JSONB          NOT NULL DEFAULT '{}',
    "transcript"        JSONB          NOT NULL DEFAULT '[]',
    "tokens"            INTEGER        NOT NULL DEFAULT 0,
    "created_by"        UUID           NOT NULL,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"        TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_sandbox_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_sandbox_sessions_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_sandbox_sessions_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT ai_sandbox_sessions_target_check CHECK (
      config_target IN ('draft', 'published', 'version')
      AND (config_target = 'version') = (config_version_id IS NOT NULL)
    ),
    CONSTRAINT ai_sandbox_sessions_json_check CHECK (
      jsonb_typeof(state) = 'object' AND jsonb_typeof(transcript) = 'array'
    ),
    CONSTRAINT ai_sandbox_sessions_tokens_check CHECK (tokens >= 0),
    CONSTRAINT ai_sandbox_sessions_expiry_check CHECK (expires_at > created_at)
);

-- A person's sessions; the sweep of the expired ones.
CREATE INDEX "ai_sandbox_sessions_license_id_created_by_idx"
  ON "ai_sandbox_sessions"("license_id", "created_by");
CREATE INDEX "ai_sandbox_sessions_expires_at_idx" ON "ai_sandbox_sessions"("expires_at");

-- --------------------------------------------------------------------------
-- What a row names is the licence's own
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace write, under its own licence, a scenario for another
-- workspace's agent or brand, or a result into another workspace's run. This
-- looks them up as the writer, under the writer's RLS (the
-- `ai_guardrails_before_write` pattern, 20261019150000). A foreign key's own
-- SET NULL is an UPDATE too; a null names nothing and passes.
CREATE FUNCTION ai_testing_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'ai_test_run_results' THEN
    IF NOT EXISTS (
      SELECT 1 FROM ai_test_runs r WHERE r.id = NEW.run_id AND r.license_id = NEW.license_id
    ) THEN
      RAISE EXCEPTION '%: run % is not this workspace''s', TG_TABLE_NAME, NEW.run_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.scenario_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ai_test_scenarios s
       WHERE s.id = NEW.scenario_id AND s.license_id = NEW.license_id
    ) THEN
      RAISE EXCEPTION '%: scenario % is not this workspace''s', TG_TABLE_NAME, NEW.scenario_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a WHERE a.id = NEW.ai_agent_id AND a.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION '%: ai agent % is not this workspace''s', TG_TABLE_NAME, NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- Nested, not `AND`: PL/pgSQL does not promise to stop before `NEW.brand_id`,
  -- which the other tables do not have.
  IF TG_TABLE_NAME = 'ai_test_scenarios' THEN
    IF NEW.brand_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM brands b WHERE b.id = NEW.brand_id AND b.license_id = NEW.license_id
    ) THEN
      RAISE EXCEPTION '%: brand % is not this workspace''s', TG_TABLE_NAME, NEW.brand_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_test_scenarios_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, brand_id, license_id ON ai_test_scenarios
  FOR EACH ROW
  EXECUTE FUNCTION ai_testing_before_write();

CREATE TRIGGER ai_test_runs_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, license_id ON ai_test_runs
  FOR EACH ROW
  EXECUTE FUNCTION ai_testing_before_write();

CREATE TRIGGER ai_test_run_results_before_write
  BEFORE INSERT OR UPDATE OF run_id, scenario_id, license_id ON ai_test_run_results
  FOR EACH ROW
  EXECUTE FUNCTION ai_testing_before_write();

CREATE TRIGGER ai_sandbox_sessions_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, license_id ON ai_sandbox_sessions
  FOR EACH ROW
  EXECUTE FUNCTION ai_testing_before_write();

-- --------------------------------------------------------------------------
-- RLS and grants
-- --------------------------------------------------------------------------

ALTER TABLE ai_test_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_test_scenarios_tenant ON ai_test_scenarios
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE ai_test_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_test_runs_tenant ON ai_test_runs
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE ai_test_run_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_test_run_results_tenant ON ai_test_run_results
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE ai_sandbox_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_sandbox_sessions_tenant ON ai_sandbox_sessions
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant every verb. A scenario and a
-- session are edited and deleted; a run is advanced but never deleted (the
-- regression reads the previous one); a result is written once and only the
-- judge's advice is added to it later. Nothing is emptied wholesale.
REVOKE ALL ON ai_test_scenarios, ai_test_runs, ai_test_run_results, ai_sandbox_sessions
  FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_test_scenarios, ai_sandbox_sessions TO siyahtus_app;
GRANT SELECT, INSERT, UPDATE ON ai_test_runs TO siyahtus_app;
GRANT SELECT, INSERT ON ai_test_run_results TO siyahtus_app;
GRANT UPDATE (judge) ON ai_test_run_results TO siyahtus_app;
