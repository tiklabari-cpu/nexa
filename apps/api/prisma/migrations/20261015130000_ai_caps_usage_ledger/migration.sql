-- Per-workspace AI caps, the AI usage ledger and the test meters (tm 283.2 ·
-- SiyahTuş analysis AI-16, AI-19-S2 · PLAN §D231).
--
-- Until now every workspace had the same daily allowance — the deployment's
-- `AI_DAILY_*_PER_WORKSPACE` — and nothing recorded which feature spent it.
-- This adds three things beside the counters of 20261002150000:
--
--   1. `licenses.ai_daily_{llm,embedding}_tokens_cap` — the platform's
--      override for one workspace. The API resolves `override ?? plan ??
--      deployment default` and hands the result to `ai_budget_reserve` as its
--      cap parameter, so the check and the increment stay one statement.
--   2. `ai_usage_events` — one row per settled call that cost something:
--      which feature (surface), which meter, which model tier, how many
--      tokens. A breakdown, not the cap: the cap is `ai_daily_usage`.
--   3. The `_test` meters a simulation is counted on (AI-19-S2), on the
--      workspace's own row, and on the deployment's *live* row — a test spends
--      the same provider key, and the deployment's cap is that key's.
--
-- Expand-only (CONVENTIONS §6.3): two nullable columns, a new table, a new
-- function, and three functions replaced with supersets of what they did —
-- every call the previous release makes ('llm' / 'embedding') behaves exactly
-- as before. The previous release never writes a cap column or a test meter,
-- so neither the trigger nor the CHECKs below can refuse it.

-- --------------------------------------------------------------------------
-- 1. licenses — the platform's per-workspace override
-- --------------------------------------------------------------------------
-- NULL inherits (plan, then deployment default). At least 1 when set: "no AI"
-- is a decision about the workspace, not a cap of zero tokens, and a zero
-- would read as "inherit" to anyone who forgets the difference.
ALTER TABLE licenses
  ADD COLUMN ai_daily_llm_tokens_cap BIGINT,
  ADD COLUMN ai_daily_embedding_tokens_cap BIGINT;

ALTER TABLE licenses ADD CONSTRAINT licenses_ai_daily_caps_check CHECK (
  (ai_daily_llm_tokens_cap IS NULL OR ai_daily_llm_tokens_cap >= 1)
  AND (ai_daily_embedding_tokens_cap IS NULL OR ai_daily_embedding_tokens_cap >= 1)
);

-- The cap is the platform's to set (AI-16-S2: the workspace's owner sees it
-- and cannot raise it). `licenses` is writable by the application role — a
-- workspace edits its own settings there — so a column grant cannot keep the
-- role off these two; a trigger does. The tenant API connects as
-- `siyahtus_app`; the owner (migrations, psql, test fixtures) and a SECURITY
-- DEFINER function run as someone else and pass. So does the platform panel's
-- own role (tm 389.12), which is the writer this is waiting for.
CREATE FUNCTION licenses_reject_tenant_ai_caps()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'siyahtus_app' THEN
    RAISE EXCEPTION 'a workspace''s AI caps are set by the platform, not by the workspace'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER licenses_ai_caps_platform_only
  BEFORE UPDATE OF ai_daily_llm_tokens_cap, ai_daily_embedding_tokens_cap ON licenses
  FOR EACH ROW
  WHEN (OLD.ai_daily_llm_tokens_cap IS DISTINCT FROM NEW.ai_daily_llm_tokens_cap
        OR OLD.ai_daily_embedding_tokens_cap IS DISTINCT FROM NEW.ai_daily_embedding_tokens_cap)
  EXECUTE FUNCTION licenses_reject_tenant_ai_caps();

CREATE TRIGGER licenses_ai_caps_platform_only_insert
  BEFORE INSERT ON licenses
  FOR EACH ROW
  WHEN (NEW.ai_daily_llm_tokens_cap IS NOT NULL OR NEW.ai_daily_embedding_tokens_cap IS NOT NULL)
  EXECUTE FUNCTION licenses_reject_tenant_ai_caps();

-- --------------------------------------------------------------------------
-- 2. ai_daily_usage — the meter vocabulary, now four
-- --------------------------------------------------------------------------
-- The functions have always refused a meter they do not know; this says the
-- same in the table, so a row nobody's function wrote cannot invent a fifth.
ALTER TABLE ai_daily_usage ADD CONSTRAINT ai_daily_usage_meter_check
  CHECK (meter IN ('llm', 'embedding', 'llm_test', 'embedding_test'));

-- --------------------------------------------------------------------------
-- 3. ai_usage_events — the ledger
-- --------------------------------------------------------------------------
-- One row per settled call that cost at least one token, written by
-- ai_budget_settle_usage in the statement that settles the counter — so the
-- ledger's sum for a (workspace, day, meter) is the counter's `used`, unless
-- writing the row itself failed (then the counter is still right and the
-- function says so; see below). `day` is the reservation's UTC day, the
-- counter's key, not `at`'s: a call that crosses midnight is counted on the
-- day it was reserved on, in both places.
--
-- `chat_id` and `config_version_id` are references without foreign keys: the
-- ledger outlives a conversation's retention, and the AI configuration
-- versions (tm 290) do not exist yet. Neither carries content.
--
-- No database-side defaults: the function supplies every value, as it does
-- for ai_daily_usage, so the drift check has nothing to report.
CREATE TABLE ai_usage_events (
    "id"                UUID           NOT NULL,
    "license_id"        BIGINT         NOT NULL,
    "day"               CHAR(8)        NOT NULL,
    "at"                TIMESTAMPTZ(6) NOT NULL,
    "surface"           TEXT           NOT NULL,
    "meter"             TEXT           NOT NULL,
    "model_tier"        TEXT,
    "input_tokens"      BIGINT         NOT NULL,
    "output_tokens"     BIGINT         NOT NULL,
    "chat_id"           VARCHAR(12),
    "config_version_id" UUID,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_usage_events_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT ai_usage_events_surface_check CHECK (
      surface IN ('ai_agent', 'copilot', 'knowledge_index', 'simulation', 'qa', 'cluster')),
    CONSTRAINT ai_usage_events_meter_check CHECK (
      meter IN ('llm', 'embedding', 'llm_test', 'embedding_test')),
    -- A completion always names its tier; an embedding never has one. (`IS
    -- NOT NULL AND`, because a CHECK passes on NULL and `NULL IN (…)` is NULL.)
    CONSTRAINT ai_usage_events_model_tier_check CHECK (
      CASE WHEN meter IN ('llm', 'llm_test')
           THEN model_tier IS NOT NULL AND model_tier IN ('default', 'fast')
           ELSE model_tier IS NULL END),
    CONSTRAINT ai_usage_events_tokens_check CHECK (input_tokens >= 0 AND output_tokens >= 0),
    CONSTRAINT ai_usage_events_day_check CHECK (day ~ '^[0-9]{8}$')
);

CREATE INDEX "ai_usage_events_license_id_at_idx" ON "ai_usage_events"("license_id", "at" DESC);

-- A workspace reads its own rows (the usage screen, tm 283.3); nothing but the
-- settle function writes, so the ledger cannot be told a different story than
-- the counter it sits beside — and nobody edits history.
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_events_tenant ON ai_usage_events
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT ON ai_usage_events TO siyahtus_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ai_usage_events FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 4. ai_budget_reserve — test meters, deployment row on the live meter
-- --------------------------------------------------------------------------
-- As 20261002150000, one change: the deployment's row is the *live* meter's
-- ('llm_test' spends on 'llm'). The workspace's row is the meter it was asked
-- for, so a simulation has its own allowance and never touches the live one.
-- Rows are still taken workspace first, deployment second.
CREATE OR REPLACE FUNCTION ai_budget_reserve(
  p_day           TEXT,
  p_meter         TEXT,
  p_estimate      BIGINT,
  p_workspace_cap BIGINT,
  p_global_cap    BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license BIGINT := siyahtus_current_license();
  v_live    TEXT := CASE p_meter WHEN 'llm_test' THEN 'llm'
                                 WHEN 'embedding_test' THEN 'embedding'
                                 ELSE p_meter END;
BEGIN
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'ai_budget_reserve needs a tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_meter IS NULL OR p_meter NOT IN ('llm', 'embedding', 'llm_test', 'embedding_test')
     OR p_day IS NULL OR p_day !~ '^[0-9]{8}$'
     OR p_estimate IS NULL OR p_estimate < 0
     OR p_workspace_cap IS NULL OR p_workspace_cap < 1
     OR p_global_cap IS NULL OR p_global_cap < 1 THEN
    RAISE EXCEPTION 'ai_budget_reserve: invalid argument' USING ERRCODE = '22023';
  END IF;

  INSERT INTO ai_daily_usage AS u (id, license_id, day, meter, reserved, used, updated_at)
  SELECT gen_random_uuid(), v_license, p_day, p_meter, p_estimate, 0, now()
   WHERE p_estimate <= p_workspace_cap
  ON CONFLICT (license_id, day, meter) DO UPDATE
     SET reserved = u.reserved + EXCLUDED.reserved, updated_at = now()
   WHERE u.reserved + u.used + EXCLUDED.reserved <= p_workspace_cap;
  IF NOT FOUND THEN
    RETURN 'workspace';
  END IF;

  INSERT INTO ai_daily_usage AS u (id, license_id, day, meter, reserved, used, updated_at)
  SELECT gen_random_uuid(), NULL, p_day, v_live, p_estimate, 0, now()
   WHERE p_estimate <= p_global_cap
  ON CONFLICT (license_id, day, meter) DO UPDATE
     SET reserved = u.reserved + EXCLUDED.reserved, updated_at = now()
   WHERE u.reserved + u.used + EXCLUDED.reserved <= p_global_cap;
  IF NOT FOUND THEN
    UPDATE ai_daily_usage u
       SET reserved = u.reserved - p_estimate, updated_at = now()
     WHERE u.license_id = v_license AND u.day = p_day AND u.meter = p_meter;
    RETURN 'global';
  END IF;

  RETURN NULL;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. ai_budget_exhausted — the same mapping for the early question
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_budget_exhausted(
  p_day           TEXT,
  p_meter         TEXT,
  p_minimum       BIGINT,
  p_workspace_cap BIGINT,
  p_global_cap    BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license BIGINT := siyahtus_current_license();
  v_live    TEXT := CASE p_meter WHEN 'llm_test' THEN 'llm'
                                 WHEN 'embedding_test' THEN 'embedding'
                                 ELSE p_meter END;
BEGIN
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'ai_budget_exhausted needs a tenant context' USING ERRCODE = '42501';
  END IF;

  IF p_minimum > p_workspace_cap OR EXISTS (
    SELECT 1 FROM ai_daily_usage u
     WHERE u.license_id = v_license AND u.day = p_day AND u.meter = p_meter
       AND u.reserved + u.used + p_minimum > p_workspace_cap
  ) THEN
    RETURN 'workspace';
  END IF;

  IF p_minimum > p_global_cap OR EXISTS (
    SELECT 1 FROM ai_daily_usage u
     WHERE u.license_id IS NULL AND u.day = p_day AND u.meter = v_live
       AND u.reserved + u.used + p_minimum > p_global_cap
  ) THEN
    RETURN 'global';
  END IF;

  RETURN NULL;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. ai_budget_settle — kept for the previous release, same mapping
-- --------------------------------------------------------------------------
-- The API now settles through ai_budget_settle_usage (below). This stays for
-- an API from the previous release still running beside the new one; it is
-- replaced only so that, were it ever handed a test meter, it would hand the
-- reservation back on the row the reservation was made on.
CREATE OR REPLACE FUNCTION ai_budget_settle(
  p_day      TEXT,
  p_meter    TEXT,
  p_reserved BIGINT,
  p_used     BIGINT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license BIGINT := siyahtus_current_license();
  v_live    TEXT := CASE p_meter WHEN 'llm_test' THEN 'llm'
                                 WHEN 'embedding_test' THEN 'embedding'
                                 ELSE p_meter END;
BEGIN
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'ai_budget_settle needs a tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_reserved IS NULL OR p_reserved < 0 OR p_used IS NULL OR p_used < 0 THEN
    RAISE EXCEPTION 'ai_budget_settle: invalid argument' USING ERRCODE = '22023';
  END IF;

  UPDATE ai_daily_usage u
     SET reserved = GREATEST(u.reserved - p_reserved, 0), used = u.used + p_used, updated_at = now()
   WHERE u.license_id = v_license AND u.day = p_day AND u.meter = p_meter;

  UPDATE ai_daily_usage u
     SET reserved = GREATEST(u.reserved - p_reserved, 0), used = u.used + p_used, updated_at = now()
   WHERE u.license_id IS NULL AND u.day = p_day AND u.meter = v_live;
END;
$$;

-- --------------------------------------------------------------------------
-- 7. ai_budget_settle_usage — settle the counters and write the ledger row
-- --------------------------------------------------------------------------
-- ai_budget_settle with the call's cost split into input and output and the
-- ledger's attribution beside it. The counters are settled exactly as before
-- (never below zero; the deployment's row on the live meter). Then, when the
-- call cost anything, the ledger row is written in the same transaction —
-- inside its own subtransaction, because the ledger is a report and the
-- counter is the cap: a row the ledger refuses (a surface it does not know, a
-- chat id that is not one) must not undo the settle. NULL when all went in;
-- the SQLSTATE and message when the ledger row did not, for the caller to log.
-- Validated like the reserve: a settle that cannot say what it is settling
-- settles nothing.
CREATE FUNCTION ai_budget_settle_usage(
  p_day               TEXT,
  p_meter             TEXT,
  p_reserved          BIGINT,
  p_input_tokens      BIGINT,
  p_output_tokens     BIGINT,
  p_surface           TEXT,
  p_model_tier        TEXT,
  p_chat_id           TEXT,
  p_config_version_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license BIGINT := siyahtus_current_license();
  v_live    TEXT := CASE p_meter WHEN 'llm_test' THEN 'llm'
                                 WHEN 'embedding_test' THEN 'embedding'
                                 ELSE p_meter END;
  v_used    BIGINT;
BEGIN
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'ai_budget_settle_usage needs a tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_meter IS NULL OR p_meter NOT IN ('llm', 'embedding', 'llm_test', 'embedding_test')
     OR p_day IS NULL OR p_day !~ '^[0-9]{8}$'
     OR p_reserved IS NULL OR p_reserved < 0
     OR p_input_tokens IS NULL OR p_input_tokens < 0
     OR p_output_tokens IS NULL OR p_output_tokens < 0 THEN
    RAISE EXCEPTION 'ai_budget_settle_usage: invalid argument' USING ERRCODE = '22023';
  END IF;
  v_used := p_input_tokens + p_output_tokens;

  UPDATE ai_daily_usage u
     SET reserved = GREATEST(u.reserved - p_reserved, 0), used = u.used + v_used, updated_at = now()
   WHERE u.license_id = v_license AND u.day = p_day AND u.meter = p_meter;

  UPDATE ai_daily_usage u
     SET reserved = GREATEST(u.reserved - p_reserved, 0), used = u.used + v_used, updated_at = now()
   WHERE u.license_id IS NULL AND u.day = p_day AND u.meter = v_live;

  IF v_used = 0 THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO ai_usage_events (id, license_id, day, at, surface, meter, model_tier,
                                 input_tokens, output_tokens, chat_id, config_version_id)
    VALUES (gen_random_uuid(), v_license, p_day, now(), p_surface, p_meter, p_model_tier,
            p_input_tokens, p_output_tokens, p_chat_id, p_config_version_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
  END;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_budget_settle_usage(TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_budget_settle_usage(TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT, UUID) TO siyahtus_app;
