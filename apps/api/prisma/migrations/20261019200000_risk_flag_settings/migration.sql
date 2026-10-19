-- Risk flag settings (tm 302.2 · SiyahTuş analysis AI-27, Ayarlar › Risk
-- bayrakları): which team is the workspace's Responsible Gaming team, and the
-- addresses an urgent flag is mailed to besides the members (AI-27-S4).
--
-- One row per workspace; no row is no team and no address — an urgent flag
-- then reaches the supervisors only. The team's members read a flag's note
-- and evidence and hear of an urgent flag (`routes/risk-flags.ts`).
--
-- `rg_group_id` is a soft reference: `groups` is keyed by (license_id, id),
-- and a deleted team must leave the setting at "none" rather than take the
-- row with it — the reader looks the team up and treats a missing one as
-- none; the writer refuses a team that is not this workspace's. Group ids are
-- never reused (identity), so a stale id cannot name another team.
--
-- Expand only (CONVENTIONS §6.3): a new table the previous release does not read.

CREATE TABLE "risk_flag_settings" (
    "license_id"    BIGINT         NOT NULL,
    "rg_group_id"   BIGINT,
    "notify_emails" TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updated_by"    UUID,
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_flag_settings_pkey" PRIMARY KEY ("license_id"),
    CONSTRAINT "risk_flag_settings_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `RISK_FLAG_NOTIFY_EMAILS_MAX`.
    CONSTRAINT risk_flag_settings_notify_emails_check CHECK (cardinality(notify_emails) <= 5)
);

ALTER TABLE risk_flag_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY risk_flag_settings_tenant ON risk_flag_settings
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- Written by upsert; never deleted by the workspace (no row and an empty row
-- read the same).
GRANT SELECT, INSERT, UPDATE ON risk_flag_settings TO siyahtus_app;
REVOKE DELETE, TRUNCATE ON risk_flag_settings FROM siyahtus_app;
