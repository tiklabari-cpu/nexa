-- Brands — the Multibrand surface (PRD §5.3 · NFR-S4).
--
-- A license-scoped table shaped like `websites`: a uuid id, a `license_id` FK
-- with ON DELETE CASCADE, and the same tenant RLS policy so one license can
-- neither read nor write another's brands. Two uniqueness rules apply: a slug is
-- unique within a license, and — via the partial index below — at most one
-- brand per license may be the default.
--
-- The structural statements (table, unique index, foreign key) are exactly what
-- `prisma migrate diff` emits for the schema change. The partial unique index,
-- the RLS policy and the GRANT are invisible to Prisma and are added here by
-- hand, the same way every other tenant table does. The partial index is the
-- one structural statement Prisma cannot model, so it is registered in
-- `scripts/check-drift.ts` (KNOWN_UNMODELLABLE) alongside the pgvector index.

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_license_id_slug_key" ON "brands"("license_id", "slug");

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one default brand per license. Prisma has no syntax for a partial
-- index, so this is hand-written and allowed by check-drift.ts.
CREATE UNIQUE INDEX "brands_one_default_per_license" ON "brands"("license_id") WHERE "is_default";

-- License-scoped like websites and widget_settings: a brand is visible and
-- writable only within its own license.
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY brands_tenant ON brands
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The application role reaches the table only through that policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON brands TO nexa_app;

-- Backfill: give every existing license exactly one `Default` brand, so the
-- single-brand behaviour is preserved byte-for-byte for all current data. The
-- NOT EXISTS guard keeps the statement safe to re-run.
INSERT INTO "brands" ("id", "license_id", "name", "slug", "is_default", "updated_at")
SELECT gen_random_uuid(), l."id", 'Default', 'default', true, CURRENT_TIMESTAMP
FROM "licenses" l
WHERE NOT EXISTS (
  SELECT 1 FROM "brands" b WHERE b."license_id" = l."id" AND b."is_default"
);
