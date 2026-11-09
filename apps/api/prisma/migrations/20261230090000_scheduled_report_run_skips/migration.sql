-- Scheduled report delivery: a run that sends nothing still leaves a row
-- (tm 440 · the 2026-11-06 audit's F23 and F46 · FR-MOD-07.7).
--
-- 1. `skipped` runs. The sweep now intersects a definition's recipients with
--    the members who may still read the workspace's reports at the moment of
--    sending (not suspended, not awaiting approval, `reports.view = all`).
--    When nobody is left the period is resolved `skipped` with
--    `skip_reason = 'no_recipients'`; a period the sweep missed beyond its
--    catch-up allowance is recorded `skipped` with `'missed_window'`. Either
--    way the history screen says what happened instead of showing nothing.
-- 2. `skipped_recipient_count` — how many configured recipients the roster
--    check dropped on a run. A count, never the addresses: the history is
--    readable by anyone who may read reports.
-- 3. `scheduled_reports.enabled_at` — when the schedule last started (created,
--    switched back on, or moved to another frequency). The catch-up never
--    reaches a period that was over before then: a schedule paused for a
--    month did not "miss" that month.
--
-- Expand-only (CONVENTIONS §6.3): new columns carry defaults, the status CHECK
-- is widened, and the code before this release writes neither `skipped` nor a
-- `skip_reason`, so it runs against either schema. Existing schedules take
-- the migration's instant as `enabled_at` — no catch-up reaches behind the
-- release that introduced it.
ALTER TABLE "scheduled_report_runs" ADD COLUMN "skipped_recipient_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scheduled_report_runs" ADD COLUMN "skip_reason" TEXT;
ALTER TABLE "scheduled_reports" ADD COLUMN "enabled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE scheduled_report_runs DROP CONSTRAINT scheduled_report_runs_status_check;
ALTER TABLE scheduled_report_runs
  ADD CONSTRAINT scheduled_report_runs_status_check
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped'));

-- A skip names its reason and nothing else does: a `skipped` row without one
-- would read as an unexplained gap, and a reason on a sent row would be a lie.
ALTER TABLE scheduled_report_runs
  ADD CONSTRAINT scheduled_report_runs_skip_reason_check
    CHECK (
      (status = 'skipped') = (skip_reason IS NOT NULL)
      AND (skip_reason IS NULL OR skip_reason IN ('no_recipients', 'missed_window'))
    );

ALTER TABLE scheduled_report_runs
  ADD CONSTRAINT scheduled_report_runs_skipped_recipient_count_check
    CHECK (skipped_recipient_count >= 0);
