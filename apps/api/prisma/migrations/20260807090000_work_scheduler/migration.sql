-- Work scheduler / staffing prediction (PRD §5.3-Vardiya · NFR-S4) — the data
-- layer for WORKSCHED. Two tables, no data written; the code paths that fill
-- them come later (route in WORKSCHED-c, presence writer in WORKSCHED-d).
--
--   * work_schedules        — an agent's standing weekly plan: a timezone plus
--                             the `WorkScheduleSlot[]` of `@nexa/types` as
--                             JSONB. Keyed `(license_id, agent_id)` like
--                             agent_memberships, so one agent working in two
--                             workspaces keeps two independent plans. The
--                             absence of a row is meaningful — it reads as
--                             `DEFAULT_WORK_SCHEDULE`, so nothing needs to be
--                             back-filled for existing agents.
--   * agent_presence_events — the append-only history of routing-status
--                             changes, shaped like webhook_deliveries: a row
--                             is a fact about a moment, so it has a
--                             `changed_at` and no `updated_at`. The forecast
--                             (WORKSCHED-g) compares this against the plan —
--                             "rostered until 18:00, actually went offline at
--                             16:20" — which is why the history is kept at all
--                             rather than reading `agent_memberships.
--                             routing_status`, a single mutable cell that
--                             remembers nothing.
--
-- Retention/pruning of the event log is deliberately not decided here (open
-- question 5); the table therefore keeps the ordinary tenant grants rather than
-- the audit_log's REVOKE UPDATE, DELETE, so a later window can choose its
-- policy without a second migration to loosen this one.
--
-- The structural statements are exactly what `prisma migrate diff` emits for
-- the schema change. The CHECK constraints, the RLS policies and the GRANTs are
-- invisible to Prisma and are added here by hand, the same way every other
-- tenant table does.

-- CreateTable
CREATE TABLE "work_schedules" (
    "license_id" BIGINT NOT NULL,
    "agent_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "schedule" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("license_id","agent_id")
);

-- CreateTable
CREATE TABLE "agent_presence_events" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "agent_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_presence_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_schedules_agent_id_idx" ON "work_schedules"("agent_id");

-- CreateIndex
CREATE INDEX "agent_presence_events_license_id_agent_id_changed_at_idx" ON "agent_presence_events"("license_id", "agent_id", "changed_at");

-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_presence_events" ADD CONSTRAINT "agent_presence_events_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_presence_events" ADD CONSTRAINT "agent_presence_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The plan is read and written whole, never slot-by-slot, so the database's
-- share of the validation is the shape it would otherwise be impossible to
-- recover from: an array. A `{"monday": …}` object stored here would make every
-- reader's `.map()` throw at runtime, far from the request that wrote it. The
-- per-slot rules (known weekday, no repeats, `HH:MM`, start < end) stay in
-- `normalizeWorkSchedule()` — mirrors skills_steps_is_array_check.
ALTER TABLE work_schedules
  ADD CONSTRAINT work_schedules_schedule_is_array_check CHECK (jsonb_typeof(schedule) = 'array');

-- A presence event records one of the three routing statuses and nothing else:
-- the exact domain of agent_memberships_routing_status_check, repeated here
-- because a forecast that silently counts an unknown status as "available"
-- would over-report coverage — the one error this feature must not make.
ALTER TABLE agent_presence_events
  ADD CONSTRAINT agent_presence_events_status_check
    CHECK (status IN ('accepting_chats', 'not_accepting_chats', 'offline'));

-- Row level security. Both tables carry their own license_id, so the policy is
-- the plain license match every other tenant table uses — a workspace can
-- neither read nor write another workspace's rosters or presence history.
-- Without it, staffing (who works when, and who was actually at their desk) is
-- exactly the kind of internal operating detail one competitor could read off
-- another's workspace.
ALTER TABLE work_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_schedules_tenant ON work_schedules
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE agent_presence_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_presence_events_tenant ON agent_presence_events
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app and reaches both tables only through those
-- policies. Granted explicitly: the schema-wide GRANT in 20260722154008 covered
-- only the tables that existed then.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_schedules TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_presence_events TO nexa_app;
