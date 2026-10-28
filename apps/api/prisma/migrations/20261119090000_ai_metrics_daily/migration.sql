-- The AI quality metrics' daily rollup (tm 320.2 · SiyahTuş analysis AI-25 ·
-- `@siyahtus/types` `ai-metrics.ts`).
--
--   - `ai_metrics_daily` — the additive counts of `AiMetricCounts` per
--     workspace day (its own clock and day start, ID-04) and per brand, team,
--     topic, AI version and language: the same SQL the report sums over raw
--     `ai_conversation_outcomes` rows (`services/reports/ai-metrics.ts`), so a
--     day's rollup and its raw rows always agree. The `ai_metrics_rollup` job
--     rebuilds a day whole (delete, then insert) whenever one of its rows
--     changed, so a later QA result or the 72-hour finalize reaches the day
--     it ended on. No unique key: a day is replaced in one transaction, never
--     upserted. `brand_id`, `team_id`, `config_version_id` are labels, like
--     the outcome rows'; none has a foreign key.
--
-- Expand only (CONVENTIONS §6.3): a new table the previous release does not read.

CREATE TABLE "ai_metrics_daily" (
    "id"                  UUID           NOT NULL DEFAULT gen_random_uuid(),
    "license_id"          BIGINT         NOT NULL,
    "day"                 DATE           NOT NULL,
    "brand_id"            UUID,
    "team_id"             BIGINT,
    "intent"              TEXT,
    "config_version_id"   UUID,
    "language"            TEXT,
    "ended"               INTEGER        NOT NULL DEFAULT 0,
    "conversations"       INTEGER        NOT NULL DEFAULT 0,
    "confirmed"           INTEGER        NOT NULL DEFAULT 0,
    "assumed"             INTEGER        NOT NULL DEFAULT 0,
    "false_resolved"      INTEGER        NOT NULL DEFAULT 0,
    "unsettled"           INTEGER        NOT NULL DEFAULT 0,
    "handed_off"          INTEGER        NOT NULL DEFAULT 0,
    "abandoned"           INTEGER        NOT NULL DEFAULT 0,
    "declined"            INTEGER        NOT NULL DEFAULT 0,
    "false_in_settled"    INTEGER        NOT NULL DEFAULT 0,
    "contained"           INTEGER        NOT NULL DEFAULT 0,
    "card_sufficient"     INTEGER        NOT NULL DEFAULT 0,
    "card_insufficient"   INTEGER        NOT NULL DEFAULT 0,
    "reasked"             INTEGER        NOT NULL DEFAULT 0,
    "reask_judged"        INTEGER        NOT NULL DEFAULT 0,
    "mandatory_triggered" INTEGER        NOT NULL DEFAULT 0,
    "mandatory_compliant" INTEGER        NOT NULL DEFAULT 0,
    "mandatory_violations" INTEGER       NOT NULL DEFAULT 0,
    "mandatory_due"       INTEGER        NOT NULL DEFAULT 0,
    "guardrail_confirmed" INTEGER        NOT NULL DEFAULT 0,
    "guardrail_suspected" INTEGER        NOT NULL DEFAULT 0,
    "bsat_good"           INTEGER        NOT NULL DEFAULT 0,
    "bsat_bad"            INTEGER        NOT NULL DEFAULT 0,
    "csat_good"           INTEGER        NOT NULL DEFAULT 0,
    "csat_bad"            INTEGER        NOT NULL DEFAULT 0,
    "clarification_turns" INTEGER        NOT NULL DEFAULT 0,
    "clarification_rows"  INTEGER        NOT NULL DEFAULT 0,
    "repeat_any"          INTEGER        NOT NULL DEFAULT 0,
    "repeat_same_intent"  INTEGER        NOT NULL DEFAULT 0,
    "repeat_unmeasured"   INTEGER        NOT NULL DEFAULT 0,
    "computed_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_metrics_daily_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_metrics_daily_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT ai_metrics_daily_counts_check CHECK (
      conversations <= ended AND confirmed >= 0 AND assumed >= 0 AND false_resolved >= 0
      AND unsettled >= 0 AND handed_off >= 0 AND conversations >= 0
    )
);

-- A day's rows (the rebuild) and a window's (the readers).
CREATE INDEX "ai_metrics_daily_license_id_day_idx" ON "ai_metrics_daily"("license_id", "day");

-- --------------------------------------------------------------------------
-- RLS and grants
-- --------------------------------------------------------------------------

ALTER TABLE ai_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_metrics_daily_tenant ON ai_metrics_daily
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant every verb. The rollup reads,
-- inserts and replaces a day; nothing updates a row in place.
REVOKE ALL ON ai_metrics_daily FROM siyahtus_app;
GRANT SELECT, INSERT, DELETE ON ai_metrics_daily TO siyahtus_app;

-- The root panel may read the figures; it never writes them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ai_metrics_daily FROM siyahtus_platform;
    GRANT SELECT ON ai_metrics_daily TO siyahtus_platform;
  END IF;
END
$$;
