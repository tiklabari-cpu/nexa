-- Apps marketplace (FR-MOD-09.1): which third-party integrations a workspace has
-- connected. The catalogue of available apps is static (in @nexa/types); this
-- table records only the connections — one row per (license, app).
--
--   * app_installations — a license-scoped connection: the `app_id` from the
--     catalogue, a `status` (only 'connected' in v1), the `external_account`
--     label the mock OAuth grant returned, and when it was connected. Unique per
--     (license, app), so an app is connected at most once per workspace.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change. The CHECK constraint, the RLS policy and the GRANT are
-- invisible to Prisma and are added here by hand, the same way every other
-- tenant table does.

-- CreateTable
CREATE TABLE "app_installations" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "app_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "external_account" TEXT NOT NULL,
    "connected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_installations_license_id_app_id_key" ON "app_installations"("license_id", "app_id");

-- AddForeignKey
ALTER TABLE "app_installations" ADD CONSTRAINT "app_installations_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A connection is only ever 'connected' in v1 (disconnecting deletes the row),
-- so the column is constrained to the known catalogue of one. Prisma cannot
-- express a CHECK — added by hand.
ALTER TABLE "app_installations"
  ADD CONSTRAINT "app_installations_status_check" CHECK ("status" IN ('connected'));

-- License-scoped like every other tenant table: a connection is visible and
-- writable only within its own license.
ALTER TABLE app_installations ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_installations_tenant ON app_installations
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The application role reaches the table only through that policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON app_installations TO nexa_app;
