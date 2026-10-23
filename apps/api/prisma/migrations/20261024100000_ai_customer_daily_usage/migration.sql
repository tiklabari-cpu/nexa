-- The per-member daily AI allowance (tm 339.1 · SiyahTuş analysis GV-01).
--
-- The workspace's and the deployment's daily caps count tokens; nothing
-- counted what one visitor takes of them, so a script on one page could spend
-- the workspace's whole day. Two pieces:
--
--   1. `ai_customer_daily_usage` — one row per member and conversation day
--      (the workspace's day, ID-04): the AI turns answered and what they cost.
--      The API raises `ai_turns` with one `INSERT … ON CONFLICT DO UPDATE …
--      WHERE ai_turns < cap RETURNING` — the check and the increment are one
--      statement, so concurrent turns cannot all slip under the line.
--   2. `security_settings.ai_turns_per_customer_day` — the allowance, 40 by
--      default (GV-01); 0 turns it off.
--
-- Expand-only (CONVENTIONS §6.3): a new table and a defaulted column, nothing
-- an earlier release reads or writes.

-- --------------------------------------------------------------------------
-- 1. ai_customer_daily_usage
-- --------------------------------------------------------------------------
CREATE TABLE ai_customer_daily_usage (
    "license_id"  BIGINT         NOT NULL,
    "customer_id" UUID           NOT NULL,
    "day"         DATE           NOT NULL,
    "ai_turns"    INTEGER        NOT NULL DEFAULT 0,
    "llm_tokens"  BIGINT         NOT NULL DEFAULT 0,
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_customer_daily_usage_pkey" PRIMARY KEY ("license_id", "customer_id", "day"),
    CONSTRAINT "ai_customer_daily_usage_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- A member erased takes their counters with them.
    CONSTRAINT "ai_customer_daily_usage_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT ai_customer_daily_usage_numbers_check CHECK (ai_turns >= 0 AND llm_tokens >= 0)
);

CREATE INDEX "ai_customer_daily_usage_customer_id_idx" ON "ai_customer_daily_usage"("customer_id");

ALTER TABLE ai_customer_daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_customer_daily_usage_tenant ON ai_customer_daily_usage
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- Raised by the API in the workspace's own transaction; a counter is never
-- removed by hand (the licence's or the member's deletion cascades).
GRANT SELECT, INSERT, UPDATE ON ai_customer_daily_usage TO siyahtus_app;
REVOKE DELETE, TRUNCATE ON ai_customer_daily_usage FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. security_settings.ai_turns_per_customer_day
-- --------------------------------------------------------------------------
ALTER TABLE security_settings
  ADD COLUMN "ai_turns_per_customer_day" INTEGER NOT NULL DEFAULT 40;
ALTER TABLE security_settings
  ADD CONSTRAINT security_settings_ai_turns_per_customer_day_check
  CHECK (ai_turns_per_customer_day BETWEEN 0 AND 10000);
