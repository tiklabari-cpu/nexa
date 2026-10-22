-- The permission matrix's store (tm 325.2 · SiyahTuş analysis RL-02, owner
-- decision K7 · `@siyahtus/types` `capabilities.ts`, `permission-matrix.ts`).
--
--   - `role_capability_overrides`: a workspace's choices, one row per cell
--     that differs from the catalogue's default (`PUT /settings/permissions`
--     deletes a row set back to its default, so a later change of default
--     reaches every workspace that never chose otherwise). `role` is a matrix
--     column the Founder may change — the Kurucu column is locked whole, so no
--     row can name it. `capability` and `value` are TEXT on purpose: the
--     catalogue lives in code and grows without a migration, and the
--     resolution ignores a row it does not recognise rather than trusting it.
--   - `licenses.permissions_version`: the matrix's revision, bumped in the
--     transaction that changes a row. A cache keyed by licence and version
--     cannot hold rows the database no longer has once a reader asks for the
--     current version.
--
-- Expand only (CONVENTIONS §6.3): a defaulted column and a table the previous
-- release does not read.
ALTER TABLE "licenses" ADD COLUMN "permissions_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "role_capability_overrides" (
    "license_id" BIGINT NOT NULL,
    "role" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_capability_overrides_pkey" PRIMARY KEY ("license_id","role","capability")
);

-- AddForeignKey
ALTER TABLE "role_capability_overrides" ADD CONSTRAINT "role_capability_overrides_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `MATRIX_ROLES` without `owner` (`permission-matrix.test.ts` compares them).
ALTER TABLE role_capability_overrides
  ADD CONSTRAINT role_capability_overrides_role_check
    CHECK (role IN ('admin', 'team_lead', 'agent'));

ALTER TABLE role_capability_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_capability_overrides_tenant ON role_capability_overrides
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());
-- Written by `PUT /settings/permissions` (an upsert and a delete), read by the
-- matrix and the caches.
REVOKE ALL ON role_capability_overrides FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_capability_overrides TO siyahtus_app;
