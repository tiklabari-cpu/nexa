-- brand_id propagation — websites + the three singleton settings tables
-- (MULTIBRAND-c · PRD §5.3 · NFR-S4/S5).
--
-- 78.2 (`brand_context`) laid down the isolation boundary and proved it on
-- `channels`. This carries the same pattern to the four tables that still assumed
-- "one license = one brand": `websites`, and the three per-license singletons
-- `security_settings` / `inbox_settings` / `widget_settings`, whose `license_id`
-- primary key made a single row per license a schema-level fact.
--
-- Every table gains `brand_id`, added nullable → backfilled to the license
-- default → set NOT NULL, so existing rows land on the one brand 78.1 gave every
-- license and single-brand behaviour is preserved byte-for-byte. The websites
-- unique key widens to include the brand (the same domain may be added once per
-- brand); the three singletons swap their `license_id` primary key for the
-- composite `(license_id, brand_id)` — a row per brand. Each table's `_tenant`
-- policy is rewritten with the brand condition 78.2 introduced: a set brand
-- context narrows to that brand, an empty one (no brand selected) still sees the
-- whole license.
--
-- The structural statements (the column, the FK, the swapped unique index, the
-- new composite primary key) are what `prisma migrate diff` emits for the schema
-- change; the three-step add→backfill→NOT NULL and the policy rewrites are
-- invisible to Prisma and written here by hand, the same way every tenant table
-- does. `nexa_current_brand()` already exists (78.2).

-- ---------------------------------------------------------------------------
-- websites.brand_id — add nullable, backfill to the license default, enforce
-- ---------------------------------------------------------------------------
ALTER TABLE "websites" ADD COLUMN "brand_id" UUID;

-- Every existing website belongs to its license's default brand. 78.1's backfill
-- guarantees each license has exactly one `is_default` brand, so this resolves to
-- a single row per website.
UPDATE "websites" w
SET "brand_id" = b."id"
FROM "brands" b
WHERE b."license_id" = w."license_id" AND b."is_default";

ALTER TABLE "websites" ALTER COLUMN "brand_id" SET NOT NULL;

ALTER TABLE "websites"
  ADD CONSTRAINT "websites_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A domain is unique per brand, not per license: a license may now add the same
-- domain once for each of its brands.
DROP INDEX "websites_license_id_domain_key";
CREATE UNIQUE INDEX "websites_license_id_brand_id_domain_key"
  ON "websites"("license_id", "brand_id", "domain");

-- ---------------------------------------------------------------------------
-- security_settings.brand_id — add, backfill, enforce, then a row per brand
-- ---------------------------------------------------------------------------
ALTER TABLE "security_settings" ADD COLUMN "brand_id" UUID;

UPDATE "security_settings" s
SET "brand_id" = b."id"
FROM "brands" b
WHERE b."license_id" = s."license_id" AND b."is_default";

ALTER TABLE "security_settings" ALTER COLUMN "brand_id" SET NOT NULL;

ALTER TABLE "security_settings"
  ADD CONSTRAINT "security_settings_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Swap the license-only primary key for the composite: one settings row per
-- brand rather than one per license.
ALTER TABLE "security_settings" DROP CONSTRAINT "security_settings_pkey";
ALTER TABLE "security_settings" ADD CONSTRAINT "security_settings_pkey" PRIMARY KEY ("license_id", "brand_id");

-- ---------------------------------------------------------------------------
-- inbox_settings.brand_id — add, backfill, enforce, then a row per brand
-- ---------------------------------------------------------------------------
ALTER TABLE "inbox_settings" ADD COLUMN "brand_id" UUID;

UPDATE "inbox_settings" s
SET "brand_id" = b."id"
FROM "brands" b
WHERE b."license_id" = s."license_id" AND b."is_default";

ALTER TABLE "inbox_settings" ALTER COLUMN "brand_id" SET NOT NULL;

ALTER TABLE "inbox_settings"
  ADD CONSTRAINT "inbox_settings_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbox_settings" DROP CONSTRAINT "inbox_settings_pkey";
ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_pkey" PRIMARY KEY ("license_id", "brand_id");

-- ---------------------------------------------------------------------------
-- widget_settings.brand_id — add, backfill, enforce, then a row per brand
-- ---------------------------------------------------------------------------
ALTER TABLE "widget_settings" ADD COLUMN "brand_id" UUID;

UPDATE "widget_settings" s
SET "brand_id" = b."id"
FROM "brands" b
WHERE b."license_id" = s."license_id" AND b."is_default";

ALTER TABLE "widget_settings" ALTER COLUMN "brand_id" SET NOT NULL;

ALTER TABLE "widget_settings"
  ADD CONSTRAINT "widget_settings_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "widget_settings" DROP CONSTRAINT "widget_settings_pkey";
ALTER TABLE "widget_settings" ADD CONSTRAINT "widget_settings_pkey" PRIMARY KEY ("license_id", "brand_id");

-- ---------------------------------------------------------------------------
-- Brand-scoped RLS on all four tables
-- ---------------------------------------------------------------------------
-- NULL brand context = "all brands of the license", so a license-wide query is
-- unchanged. A set brand context narrows both read and write to that brand — a
-- row from another brand is invisible (SELECT/UPDATE/DELETE see zero rows) and
-- unwritable (WITH CHECK rejects a row for a different brand). This is the exact
-- condition 78.2 added to `channels_tenant`.
DROP POLICY websites_tenant ON websites;
CREATE POLICY websites_tenant ON websites
  USING (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  )
  WITH CHECK (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  );

DROP POLICY security_settings_tenant ON security_settings;
CREATE POLICY security_settings_tenant ON security_settings
  USING (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  )
  WITH CHECK (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  );

DROP POLICY inbox_settings_tenant ON inbox_settings;
CREATE POLICY inbox_settings_tenant ON inbox_settings
  USING (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  )
  WITH CHECK (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  );

DROP POLICY widget_settings_tenant ON widget_settings;
CREATE POLICY widget_settings_tenant ON widget_settings
  USING (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  )
  WITH CHECK (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  );
