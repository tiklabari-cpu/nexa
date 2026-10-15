-- AI usage alerts and who receives them (tm 283.3 · SiyahTuş analysis AI-16,
-- AI-16-S2 · PLAN §D232).
--
-- A workspace's owner hears when today's AI allowance is 80% used and when it
-- is used up — once each per workspace, UTC day and live meter, however many
-- calls cross the line at once and however many API processes see them do it.
-- The once is this table's unique key: the process whose INSERT lands sends the
-- notice, every other one finds the row already there and sends nothing.
--
--   1. `ai_usage_alerts` — one row per notice decided: the day, the meter, the
--      threshold, and the counter and cap that crossed it. The row is the
--      decision, written before the notice goes out, so a notice that fails to
--      send is not sent twice (the acceptance criterion is "exactly one").
--   2. `ai_usage_alert_recipients` — who besides the owner the notice goes to,
--      chosen by the owner (AI-16: "Kurucu … uyarı alıcılarını seçer"). Kept as
--      a list of accounts; the API narrows it to the workspace's current
--      owner/admin members at send time, so a member who has since left or been
--      demoted is skipped without the list having to be cleaned.
--
-- Expand-only (CONVENTIONS §6.3): two new tables, nothing an earlier release
-- reads or writes.

-- --------------------------------------------------------------------------
-- 1. ai_usage_alerts
-- --------------------------------------------------------------------------
CREATE TABLE ai_usage_alerts (
    "id"         UUID           NOT NULL,
    "license_id" BIGINT         NOT NULL,
    "day"        CHAR(8)        NOT NULL,
    "meter"      TEXT           NOT NULL,
    "threshold"  SMALLINT       NOT NULL,
    "used"       BIGINT         NOT NULL,
    "cap"        BIGINT         NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_usage_alerts_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- The live meters only: a simulation's allowance running out is the test
    -- lab's own 429, not a reason to e-mail the owner (AI-19-S2).
    CONSTRAINT ai_usage_alerts_meter_check CHECK (meter IN ('llm', 'embedding')),
    CONSTRAINT ai_usage_alerts_threshold_check CHECK (threshold IN (80, 100)),
    CONSTRAINT ai_usage_alerts_day_check CHECK (day ~ '^[0-9]{8}$'),
    CONSTRAINT ai_usage_alerts_numbers_check CHECK (used >= 0 AND cap >= 1)
);

CREATE UNIQUE INDEX "ai_usage_alerts_license_id_day_meter_threshold_key"
  ON "ai_usage_alerts"("license_id", "day", "meter", "threshold");

ALTER TABLE ai_usage_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_alerts_tenant ON ai_usage_alerts
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- Written by the API in the workspace's own transaction (the claim), read by the
-- usage screen. Nobody edits or removes a notice that was sent.
GRANT SELECT, INSERT ON ai_usage_alerts TO siyahtus_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ai_usage_alerts FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. ai_usage_alert_recipients
-- --------------------------------------------------------------------------
CREATE TABLE ai_usage_alert_recipients (
    "license_id" BIGINT         NOT NULL,
    "account_id" UUID           NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_alert_recipients_pkey" PRIMARY KEY ("license_id", "account_id"),
    CONSTRAINT "ai_usage_alert_recipients_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_usage_alert_recipients_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ai_usage_alert_recipients_account_id_idx" ON "ai_usage_alert_recipients"("account_id");

ALTER TABLE ai_usage_alert_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_alert_recipients_tenant ON ai_usage_alert_recipients
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- Replaced as a whole by the owner (`PUT /ai/usage/alert-recipients`).
GRANT SELECT, INSERT, DELETE ON ai_usage_alert_recipients TO siyahtus_app;
REVOKE UPDATE, TRUNCATE ON ai_usage_alert_recipients FROM siyahtus_app;
