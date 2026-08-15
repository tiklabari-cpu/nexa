-- SIEM export: where the trail goes, and how far it has got (NFR-C6 · C6-b).
--
-- The audit log has had a writer since slice 23 and a reader since 08.9.7-a.
-- What it has never had is a way *out*: SOC 2 CC7.2 and ISO 27001 A.8.15 are
-- not satisfied by a log that only exists inside the system it is auditing, and
-- the first thing an attacker with access does is stop generating evidence in a
-- place the defender can still read. This migration is the data layer for the
-- way out — one table, plus the index the export scans on.
--
--   * siem_export_cursors — one row per (licence, target). The row is BOTH the
--                           configuration and the delivery position, on
--                           purpose. Split across two tables they could
--                           disagree: repointing the export at a new
--                           destination while the old position carried on would
--                           leave the trail looking delivered to somewhere it
--                           had never reached.
--
-- No rows are written by the delivery job yet. The settings surface
-- (`GET|PATCH /settings/siem`) creates and edits the configuration half here;
-- the scheduled sink that advances the position is C6-d, and the integrity
-- chain that makes a delivered export *provably* complete is C6-c. The pull
-- endpoint (`GET /audit-log/export`) deliberately never touches this row: there
-- the caller holds the cursor, and two consumers sharing one position would
-- each silently skip the rows the other took.
--
-- The structural statements are exactly what `prisma migrate diff` emits for the
-- schema change (minus the unrelated pgvector index it always reports — see
-- check-drift.ts). The CHECK constraints, the RLS policies and the GRANTs are
-- invisible to Prisma and are added here by hand, the same way every other
-- tenant table does.

-- CreateTable
CREATE TABLE "siem_export_cursors" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_exported_id" UUID,
    "last_exported_at" TIMESTAMPTZ(6),
    "last_run_at" TIMESTAMPTZ(6),
    "exported_count" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "siem_export_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "siem_export_cursors_license_id_target_key" ON "siem_export_cursors"("license_id", "target");

-- CreateIndex
CREATE INDEX "audit_log_license_id_created_at_id_idx" ON "audit_log"("license_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "siem_export_cursors" ADD CONSTRAINT "siem_export_cursors_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE siem_export_cursors IS
  'Where a workspace ships its audit trail (NFR-C6), and the keyset position of the last entry delivered there. One row per (licence, target).';

-- The ascending index above is not a duplicate of the two the read surface
-- already has. Those are (license_id, created_at DESC) and
-- (license_id, action, created_at DESC), which serve a screen reading newest
-- first. An export reads the other way — oldest first, resuming from a keyset
-- position — and a backwards index scan cannot satisfy the `(created_at, id)`
-- tiebreak that keyset depends on without sorting. Without this index every
-- poll would sort the workspace's whole trail to return the next thousand rows.

-- ---------------------------------------------------------------------------
-- What a target may be
-- ---------------------------------------------------------------------------
-- Mirrors SIEM_EXPORT_TARGETS in @nexa/types. A workspace that could save an
-- arbitrary string would get a settings screen showing a configured, enabled
-- export to a destination no delivery job knows how to reach — and the failure
-- is silent by construction, because the evidence that it is not working is
-- precisely the evidence that is not arriving. Same reasoning as
-- scheduled_reports_frequency_check.
--
-- One value today. Real SIEM connectors (Splunk, Sentinel, Datadog) are a
-- project boundary — external services are mocked — so `file`, the .data/siem
-- sink C6-d writes, is the whole of what this deployment can honestly offer.
ALTER TABLE siem_export_cursors
  ADD CONSTRAINT siem_export_cursors_target_check
    CHECK (target IN ('file'));

-- The cursor is a keyset: an id AND the timestamp that orders it. Half of one
-- is not a weaker position, it is an ambiguous one — resuming from a timestamp
-- with no id cannot break ties at that timestamp (so it either re-sends or
-- skips every row sharing it), and an id with no timestamp cannot be placed in
-- the ordering at all. Both, or neither.
ALTER TABLE siem_export_cursors
  ADD CONSTRAINT siem_export_cursors_cursor_halves_check
    CHECK ((last_exported_id IS NULL) = (last_exported_at IS NULL));

-- A count of rows delivered cannot go backwards through zero. Cheap, and it
-- catches the arithmetic slip that would otherwise be reported to an auditor as
-- a figure.
ALTER TABLE siem_export_cursors
  ADD CONSTRAINT siem_export_cursors_exported_count_check
    CHECK (exported_count >= 0);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- The table carries its own license_id, so the policy is the plain licence
-- match every other tenant table uses. What is behind it is worth naming: a
-- cross-tenant WRITE here is the serious one. Moving another workspace's cursor
-- forward would make their delivery job skip every entry it stepped over —
-- permanently, since the position only advances — so a tenant boundary failure
-- on this table does not leak evidence, it destroys it.
ALTER TABLE siem_export_cursors ENABLE ROW LEVEL SECURITY;
CREATE POLICY siem_export_cursors_tenant ON siem_export_cursors
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app and reaches the table only through that policy.
-- Granted explicitly: the schema-wide GRANT in 20260722154008 covered only the
-- tables that existed then.
GRANT SELECT, INSERT, UPDATE ON public.siem_export_cursors TO nexa_app;

-- No DELETE, and withholding it takes an explicit REVOKE: the ALTER DEFAULT
-- PRIVILEGES in 20260722090000 hands SELECT, INSERT, UPDATE, DELETE to nexa_app
-- on every table created after it, so the narrower GRANT above is a no-op on its
-- own. Mirrors `REVOKE DELETE ON scheduled_report_runs`.
--
-- The reason is the position, not the configuration. Turning the export off is
-- `enabled = false`, which keeps the cursor; deleting the row would discard it,
-- and re-enabling afterwards would resume from nothing — either re-delivering
-- the entire retained trail or, worse, starting at "now" and losing every entry
-- written while the feed was off, with no record that anything was missed. A
-- workspace that genuinely wants to start over can be given a deliberate reset
-- later; it should not be the accidental consequence of switching a destination
-- off. Erasing the workspace still clears these rows — the ON DELETE CASCADE
-- above is carried out by the referencing table's owner, not by nexa_app —
-- which is what NFR-C8 needs.
REVOKE DELETE ON public.siem_export_cursors FROM nexa_app;
