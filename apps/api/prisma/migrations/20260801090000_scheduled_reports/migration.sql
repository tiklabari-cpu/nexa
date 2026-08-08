-- Scheduled report exports (PRD §5.3-Reports · NFR-C8 · NFR-S9) — the data
-- layer for 07.9-sched. Two tables, no data written; the code paths that fill
-- them come later (routes in 07.9-sched-b/-c, the scheduler in 07.9-sched-e).
--
--   * scheduled_reports     — a license-scoped standing instruction: which
--                             report group, how often, to whom. `group_id`
--                             names a REPORT_GROUPS entry in code rather than a
--                             row, so it carries no foreign key and no domain
--                             CHECK — that catalogue gained four groups in 07.7
--                             alone and each addition would otherwise cost a
--                             migration. The route validates it instead.
--   * scheduled_report_runs — one row per period, and the lock that keeps the
--                             feature idempotent. The scheduler inserts the row
--                             *before* mailing, so a second sweep (a retry, an
--                             overlapping cron, two API instances) collides on
--                             UNIQUE (scheduled_report_id, period_key) and
--                             learns the period is already taken. A failed
--                             delivery therefore keeps its row as 'failed'
--                             rather than being deleted: releasing the period
--                             would let the next sweep mail it again. Same
--                             device as campaign_sends' (campaign_id,
--                             customer_id), which stops a campaign firing twice
--                             at one visitor.
--
-- A run reaches its schedule through a COMPOSITE foreign key on
-- (license_id, scheduled_report_id), the agent_expertise pattern, and that is a
-- tenant guard rather than a formality. With a plain scheduled_report_id FK,
-- tenant A could insert a run carrying its own license_id while pointing at
-- tenant B's schedule: the RLS WITH CHECK would pass, because the row really is
-- A's, yet the claim would occupy B's (schedule, period) slot and B's report
-- would silently never be delivered for that period. RLS alone cannot see that
-- — it judges the row, not what the row points at — so the constraint carries
-- it. UNIQUE (license_id, id) on scheduled_reports exists to be its target.
--
-- The structural statements are exactly what `prisma migrate diff` emits for the
-- schema change (minus the unrelated pgvector index it always reports — see
-- check-drift.ts). The CHECK constraints, the RLS policies and the GRANTs are
-- invisible to Prisma and are added here by hand, the same way every other
-- tenant table does.

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "group_id" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_agent_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_at" TIMESTAMPTZ(6),

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_report_runs" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "scheduled_report_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "period_from" TIMESTAMPTZ(6) NOT NULL,
    "period_to" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_reports_license_id_enabled_idx" ON "scheduled_reports"("license_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_reports_license_id_id_key" ON "scheduled_reports"("license_id", "id");

-- CreateIndex
CREATE INDEX "scheduled_report_runs_license_id_scheduled_report_id_create_idx" ON "scheduled_report_runs"("license_id", "scheduled_report_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_report_runs_scheduled_report_id_period_key_key" ON "scheduled_report_runs"("scheduled_report_id", "period_key");

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_report_runs" ADD CONSTRAINT "scheduled_report_runs_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_report_runs" ADD CONSTRAINT "scheduled_report_runs_license_id_scheduled_report_id_fkey" FOREIGN KEY ("license_id", "scheduled_report_id") REFERENCES "scheduled_reports"("license_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The frequency is not decoration: the scheduler derives the period key from it
-- ('2026-07-31' daily, '2026-W31' weekly, '2026-07' monthly), and the period key
-- is the whole of the "have we already delivered this?" answer. An unrecognised
-- frequency would produce an undefined period and, with it, a schedule that
-- either never fires or fires without a dedupe key — mirrors
-- agent_memberships_routing_status_check.
ALTER TABLE scheduled_reports
  ADD CONSTRAINT scheduled_reports_frequency_check
    CHECK (frequency IN ('daily', 'weekly', 'monthly'));

-- A schedule with no recipients is not a harmless no-op: the run still claims
-- its period, so the report is marked delivered while nobody received it, every
-- period, silently. Mirrors oauth_clients_redirect_uris_check.
ALTER TABLE scheduled_reports
  ADD CONSTRAINT scheduled_reports_recipients_not_empty_check
    CHECK (cardinality(recipients) > 0);

-- The three deterministic period labels, pinned to their exact shapes. The
-- failure this prevents is quiet and total: an empty or free-form key would
-- collapse every period onto one row, so after the first delivery the unique
-- constraint would reject every later period and the report would never be sent
-- again. Same reasoning as groups_language_code_check — a format the rest of the
-- system parses belongs in a regex here.
ALTER TABLE scheduled_report_runs
  ADD CONSTRAINT scheduled_report_runs_period_key_check
    CHECK (period_key ~ '^[0-9]{4}-(W[0-9]{2}|[0-9]{2}(-[0-9]{2})?)$');

-- A run is claimed ('pending'), then resolved. The history screen
-- (07.9-sched-g) and the sweep both filter on this column, so an unrecognised
-- value would make a row invisible to one and ambiguous to the other.
ALTER TABLE scheduled_report_runs
  ADD CONSTRAINT scheduled_report_runs_status_check
    CHECK (status IN ('pending', 'sent', 'failed'));

-- A period is a real window, and the CSV is built by querying it. from >= to
-- would export nothing while the row claims a successful delivery.
ALTER TABLE scheduled_report_runs
  ADD CONSTRAINT scheduled_report_runs_period_range_check
    CHECK (period_from < period_to);

-- Row level security. Both tables carry their own license_id, so the policy is
-- the plain license match every other tenant table uses. What is behind it is a
-- workspace's reporting: the definition names the recipients (who inside the
-- company receives business figures) and the run history is the delivery record.
-- A cross-tenant write would be worse than a read — adding one's own address to
-- another workspace's recipient list turns their scheduler into a standing
-- exfiltration channel for their own numbers.
ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY scheduled_reports_tenant ON scheduled_reports
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE scheduled_report_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY scheduled_report_runs_tenant ON scheduled_report_runs
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app and reaches both tables only through those
-- policies. Granted explicitly: the schema-wide GRANT in 20260722154008 covered
-- only the tables that existed then.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_reports TO nexa_app;
GRANT SELECT, INSERT, UPDATE ON public.scheduled_report_runs TO nexa_app;

-- Runs get no DELETE, and withholding it takes an explicit REVOKE: the ALTER
-- DEFAULT PRIVILEGES in 20260722090000 hands SELECT, INSERT, UPDATE, DELETE to
-- nexa_app on every table created after it, so the narrower GRANT above is a
-- no-op on its own. Mirrors `REVOKE UPDATE, DELETE ON audit_log`.
--
-- The reason is the claim, not just record-keeping: a deletable run is a way to
-- release a period that was already claimed and mail the same report a second
-- time. A run is therefore resolved (UPDATE to 'sent' or 'failed'), never
-- erased. Cancelling the schedule still clears its runs — the ON DELETE CASCADE
-- above is carried out by the referencing table's owner, not by nexa_app — and
-- so does erasing the workspace, which is what NFR-C8 needs. Nothing prunes
-- these rows on a timer today; a later window that wants a retention window can
-- follow audit_prune_expired rather than loosen this grant.
REVOKE DELETE ON public.scheduled_report_runs FROM nexa_app;
