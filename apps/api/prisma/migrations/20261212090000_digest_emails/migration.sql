-- Daily / weekly summary e-mails (RP-05 · tm 372).
--
--   agent_memberships.notify_digest_daily / notify_digest_weekly
--       The member's own switch. NULL = follow the workspace default for their
--       role (digest_settings), so a member nobody asked stays on the default
--       when the Founder changes it; true / false = they chose.
--   digest_settings
--       One row per workspace, written on first save: which roles receive the
--       daily and the weekly summary by default. A workspace with no row reads
--       the shipped default (`DEFAULT_DIGEST_ROLES`): the Founder, the
--       Administrators and the Team Leads get the daily summary, nobody gets
--       the weekly one.
--   digest_deliveries
--       One row per (member, period): the claim written BEFORE the mail goes
--       out. UNIQUE (license_id, agent_id, period_key) turns a second sweep,
--       or two instances sweeping at once, into a constraint violation that
--       means "already taken". The same shape as scheduled_report_runs.
--
-- Expand only (CONVENTIONS 6.3): nullable columns and new tables; the code
-- still serving traffic never names them.
ALTER TABLE agent_memberships ADD COLUMN notify_digest_daily BOOLEAN;
ALTER TABLE agent_memberships ADD COLUMN notify_digest_weekly BOOLEAN;

CREATE TABLE "digest_settings" (
    "license_id" BIGINT NOT NULL,
    "daily_roles" TEXT[] NOT NULL DEFAULT ARRAY['owner', 'viceowner', 'admin', 'team_lead']::TEXT[],
    "weekly_roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digest_settings_pkey" PRIMARY KEY ("license_id")
);

CREATE TABLE "digest_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "license_id" BIGINT NOT NULL,
    "agent_id" UUID NOT NULL,
    "frequency" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "period_from" TIMESTAMPTZ(6) NOT NULL,
    "period_to" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "digest_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "digest_deliveries_license_id_agent_id_period_key_key"
  ON "digest_deliveries"("license_id", "agent_id", "period_key");
CREATE INDEX "digest_deliveries_license_id_created_at_idx"
  ON "digest_deliveries"("license_id", "created_at");

ALTER TABLE "digest_settings" ADD CONSTRAINT "digest_settings_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The composite key is a tenant guard, not a formality (see ScheduledReportRun):
-- a delivery can only name a member of its own workspace.
ALTER TABLE "digest_deliveries" ADD CONSTRAINT "digest_deliveries_membership_fkey"
  FOREIGN KEY ("license_id", "agent_id") REFERENCES "agent_memberships"("license_id", "agent_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE digest_settings ADD CONSTRAINT digest_settings_daily_roles_check
  CHECK (daily_roles <@ ARRAY['owner', 'viceowner', 'admin', 'team_lead', 'agent']::TEXT[]);
ALTER TABLE digest_settings ADD CONSTRAINT digest_settings_weekly_roles_check
  CHECK (weekly_roles <@ ARRAY['owner', 'viceowner', 'admin', 'team_lead', 'agent']::TEXT[]);

ALTER TABLE digest_deliveries ADD CONSTRAINT digest_deliveries_frequency_check
  CHECK (frequency IN ('daily', 'weekly'));
-- `D2026-10-31` (daily: the local day covered), `W2026-10-26` (weekly: the
-- local Monday that opens the week covered). The prefix makes the two
-- frequencies one key space, which is what the unique index relies on.
ALTER TABLE digest_deliveries ADD CONSTRAINT digest_deliveries_period_key_check
  CHECK (period_key ~ '^[DW][0-9]{4}-[0-9]{2}-[0-9]{2}$');
ALTER TABLE digest_deliveries ADD CONSTRAINT digest_deliveries_status_check
  CHECK (status IN ('pending', 'sent', 'failed'));
ALTER TABLE digest_deliveries ADD CONSTRAINT digest_deliveries_period_range_check
  CHECK (period_from < period_to);

ALTER TABLE digest_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY digest_settings_tenant ON digest_settings
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE digest_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY digest_deliveries_tenant ON digest_deliveries
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT, INSERT, UPDATE ON public.digest_settings TO siyahtus_app;
GRANT SELECT, INSERT, UPDATE ON public.digest_deliveries TO siyahtus_app;
