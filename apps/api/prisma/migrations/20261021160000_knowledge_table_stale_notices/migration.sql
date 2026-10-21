-- The stale-row notice of the structured knowledge tables (tm 310.5 ·
-- SiyahTuş analysis AI-13-S2).
--
-- A row falls due for review `review_interval_days` after `reviewed_at` (a
-- bonus also at `active_to`); the daily sweep tells the workspace's owner and
-- admins once per lapse. The "once" is this table's unique key: the sweep whose
-- INSERT lands announces the row, every later pass finds it already claimed.
-- `due_at` is part of the key, so a row that is reviewed and lapses again is a
-- new lapse and is announced again.
--
-- Expand-only (CONVENTIONS §6.3): one new table, nothing an earlier release
-- reads or writes.

CREATE TABLE knowledge_table_stale_notices (
    "id"         UUID           NOT NULL,
    "license_id" BIGINT         NOT NULL,
    "table_name" TEXT           NOT NULL,
    "row_id"     UUID           NOT NULL,
    "due_at"     TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_table_stale_notices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_table_stale_notices_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT knowledge_table_stale_notices_table_check
      CHECK (table_name IN ('payment_methods', 'bonuses', 'kyc_documents', 'rules'))
);

CREATE UNIQUE INDEX "knowledge_table_stale_notices_once_key"
  ON "knowledge_table_stale_notices"("license_id", "table_name", "row_id", "due_at");

ALTER TABLE knowledge_table_stale_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_table_stale_notices_tenant ON knowledge_table_stale_notices
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- Claimed by the sweep in the workspace's own transaction. A claim for a row
-- that has since been deleted is dropped by the same sweep (DELETE), so the
-- table does not outlive the rows it speaks of; nothing edits one.
GRANT SELECT, INSERT, DELETE ON knowledge_table_stale_notices TO siyahtus_app;
REVOKE UPDATE, TRUNCATE ON knowledge_table_stale_notices FROM siyahtus_app;
