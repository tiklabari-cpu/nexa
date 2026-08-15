-- SLA targets and the misses against them (FR-MOD-11.5 · §5.4 · 11.5-d).
--
-- The product has measured first-response and resolution time since the reports
-- slice — `threads.first_response_at`, `threads.closed_at` — but never against
-- anything. A number with no target is a number nobody is accountable for. This
-- migration is the target, and the record of what went over it.
--
--   * sla_policies — one row per licence, keyed BY the licence. A target is a
--                    workspace-wide policy, not a list of them; a second row
--                    would raise "which one applies?" with no answer written
--                    down anywhere.
--   * sla_breaches — one row per (subject, clock) that went over. The unique key
--                    is what makes marking idempotent, which matters because two
--                    different things mark: the clock stopping (an agent finally
--                    replied) and the sweep (nobody has replied yet and the
--                    target has passed). Without it a case left open over a
--                    weekend would collect one row per sweep.
--
-- It measures and marks; it does not enforce (§C-A27). Nothing here is read by
-- routing, and nothing here touches an invoice — NFR-U5's contractual uptime
-- commitment with its billing credit is a contract term this repo cannot
-- promise, and is deliberately not what `sla` means.
--
-- Business hours come from `work_schedules` (the WORKSCHED tables) — no second
-- calendar model was opened. That is a decision with a consequence worth
-- naming: the workspace is "open" when at least one agent is rostered, so the
-- calendar is the union of the saved plans, resolved in `business-hours.ts`.
--
-- The structural statements are exactly what `prisma migrate diff` emits for the
-- schema change (minus the unrelated pgvector index it always reports — see
-- check-drift.ts). The CHECK constraints, the RLS policies and the GRANTs are
-- invisible to Prisma and are added here by hand, the same way every other
-- tenant table does.

-- CreateTable
CREATE TABLE "sla_policies" (
    "license_id" BIGINT NOT NULL,
    "first_response_minutes" INTEGER,
    "resolution_minutes" INTEGER,
    "business_hours_only" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("license_id")
);

-- CreateTable
CREATE TABLE "sla_breaches" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "target_minutes" INTEGER NOT NULL,
    "elapsed_minutes" INTEGER NOT NULL,
    "business_hours_only" BOOLEAN NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMPTZ(6),

    CONSTRAINT "sla_breaches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sla_breaches_license_id_detected_at_idx" ON "sla_breaches"("license_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "sla_breaches_license_id_notified_at_idx" ON "sla_breaches"("license_id", "notified_at");

-- CreateIndex
CREATE UNIQUE INDEX "sla_breaches_subject_key" ON "sla_breaches"("license_id", "subject_type", "subject_id", "target");

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE sla_policies IS
  'A workspace''s first-response and resolution targets (FR-MOD-11.5). Measured and marked, never enforced (PLAN §C-A27).';
COMMENT ON TABLE sla_breaches IS
  'One recorded miss per (subject, clock). Append-only apart from notified_at; unique on the subject so marking is idempotent.';

-- The two indexes serve the two readers. Reports (11.5-e) lists misses newest
-- first over a window; the sweep asks only "what is still waiting to be
-- announced?", which is a tiny slice of a growing table and the reason the
-- second index exists rather than a filter over the first.

-- ---------------------------------------------------------------------------
-- What a target may be
-- ---------------------------------------------------------------------------
-- Null means *no target*, which is a different statement from a target of zero:
-- one says "do not measure this clock", the other would say "every case is
-- already late". A zero saved by a client that treats null and 0 as the same
-- thing would mark every conversation in the workspace as a breach the moment
-- it opened, so the database refuses it rather than trusting the boundary.
--
-- The ceiling is 90 days, matching SLA_MAX_TARGET_MINUTES in @nexa/types. It is
-- a typo guard rather than a business rule: a target past the retention window
-- can never be breached by anything still on disk, so saving one switches the
-- feature off while the settings screen goes on showing it as configured.
ALTER TABLE sla_policies
  ADD CONSTRAINT sla_policies_first_response_minutes_check
    CHECK (first_response_minutes IS NULL
           OR (first_response_minutes > 0 AND first_response_minutes <= 129600));
ALTER TABLE sla_policies
  ADD CONSTRAINT sla_policies_resolution_minutes_check
    CHECK (resolution_minutes IS NULL
           OR (resolution_minutes > 0 AND resolution_minutes <= 129600));

-- Mirrors SLA_SUBJECT_TYPES and SLA_TARGETS in @nexa/types. A row naming a
-- subject or a clock nothing knows how to render is a figure on a report with
-- no way back to the case it came from — the same reasoning as
-- siem_export_cursors_target_check.
ALTER TABLE sla_breaches
  ADD CONSTRAINT sla_breaches_subject_type_check
    CHECK (subject_type IN ('thread', 'ticket'));
ALTER TABLE sla_breaches
  ADD CONSTRAINT sla_breaches_target_check
    CHECK (target IN ('first_response', 'resolution'));

-- A miss is by definition strictly over the target. Writing that down here
-- rather than trusting the caller is the difference between a KPI an admin can
-- act on and a number that occasionally accuses the team of missing a promise
-- it kept. `subject_id` intentionally has no foreign key — it names a thread or
-- a ticket depending on `subject_type`, and a polymorphic column cannot carry
-- one; `subject_type` is constrained instead so it can always be resolved.
ALTER TABLE sla_breaches
  ADD CONSTRAINT sla_breaches_target_minutes_check CHECK (target_minutes > 0);
ALTER TABLE sla_breaches
  ADD CONSTRAINT sla_breaches_elapsed_check CHECK (elapsed_minutes > target_minutes);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Both tables carry their own license_id, so the policy is the plain licence
-- match every other tenant table uses. The write side is the one worth naming:
-- a cross-tenant INSERT into sla_breaches would put another workspace's misses
-- in this one's report — a number an admin is expected to act on, wrong in the
-- direction that manufactures a problem out of nothing.
ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY sla_policies_tenant ON sla_policies
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE sla_breaches ENABLE ROW LEVEL SECURITY;
CREATE POLICY sla_breaches_tenant ON sla_breaches
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app and reaches both tables only through those
-- policies. Granted explicitly: the schema-wide GRANT in 20260722154008 covered
-- only the tables that existed then.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_policies TO nexa_app;
GRANT SELECT, INSERT, UPDATE ON public.sla_breaches TO nexa_app;

-- No DELETE on the breaches, and withholding it takes an explicit REVOKE: the
-- ALTER DEFAULT PRIVILEGES in 20260722090000 hands all four verbs to nexa_app
-- on every table created after it, so the narrower GRANT above is a no-op on its
-- own. Mirrors `REVOKE DELETE ON scheduled_report_runs`.
--
-- The reason is what the row is for. A breach is evidence that a promise was
-- missed, and the party with the strongest motive to remove it is the one that
-- missed it. Retention still clears them — the ON DELETE CASCADE above is
-- carried out by the referencing table's owner, not by nexa_app — so NFR-C8 is
-- unaffected. The policy row keeps its DELETE: erasing a *target* destroys no
-- evidence, and a workspace that stops promising anything should be able to say
-- so.
REVOKE DELETE ON public.sla_breaches FROM nexa_app;
