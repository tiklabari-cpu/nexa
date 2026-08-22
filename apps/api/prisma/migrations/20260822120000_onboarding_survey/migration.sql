-- The "What are you tracking?" survey popover (FR-MOD-07.2) — the last of the
-- Faz-4 §6A "🔒 kalanları" codes.
--
-- Two columns on `licenses`, mirroring `onboarding_completed_at`/
-- `demo_seeded_at` beside them: `survey_answer` records which of the five
-- catalogue values (or null) the popover was answered with, and
-- `survey_answered_at` is set the moment it is answered OR skipped — either
-- way, so the popover never shows twice. The structural statement below is
-- exactly what `prisma migrate diff` emits for the schema change (minus the
-- unrelated pgvector index it always reports — see check-drift.ts). The CHECK
-- is invisible to Prisma and is added here by hand, the same way
-- `device_tokens_platform_check` is.

-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "survey_answer" TEXT,
ADD COLUMN     "survey_answered_at" TIMESTAMPTZ(6);

-- A row naming a goal the checklist reorder (`@nexa/types`'
-- `SURVEY_ANSWER_PRIORITY_STEP`) does not know is a personalization signal
-- that silently does nothing, the same reasoning as device_tokens_platform_check.
ALTER TABLE "licenses"
  ADD CONSTRAINT "licenses_survey_answer_check"
  CHECK (
    "survey_answer" IS NULL
    OR "survey_answer" IN ('agent_performance', 'team_sharing', 'spotting_problems', 'revenue_impact', 'other')
  );
