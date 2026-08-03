-- Public knowledge base data model (PRD §5.3, v2) — PUBKB-a.
--
-- Three new, license-scoped tables. Deliberately separate from
-- `knowledge_sources`/`knowledge_chunks` (§C-PUBKB-1): those feed the AI
-- Agent's RAG retrieval, these are reader-facing SEO'lu self-servis content —
-- the two never share rows and `knowledge_sources` is untouched here.
--
--   kb_categories  a taxonomy readers browse (KK "self-servis gezinme"). A
--                  slug is unique within a license, like brands/expertise.
--   kb_articles    a license-scoped article: `seo_title`/`seo_description`
--                  carry the KK "SEO'lu" half, `status` the "public" half —
--                  a draft is never served by the anonymous read path built
--                  in PUBKB-c. `category_id` is optional and cleared (not
--                  cascaded) when its category is deleted.
--   kb_settings    a per-license singleton (keyed and shaped like
--                  `payment_methods`) carrying the enable switch and the
--                  public address. `public_slug` is GLOBAL unique — unlike
--                  every other slug in this schema — because it is the path
--                  segment on one shared public host (§C-PUBKB-4), not a
--                  value scoped inside a single license's own namespace.
--
-- The structural statements below are exactly what `prisma migrate diff`
-- emits for the schema change. The CHECK constraint, the RLS policies and the
-- GRANTs are invisible to Prisma and are added here by hand, the same way
-- every other tenant table does.

-- CreateTable
CREATE TABLE "kb_categories" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "category_id" UUID,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "excerpt" TEXT,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_settings" (
    "license_id" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "public_slug" TEXT NOT NULL,
    "site_title" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kb_settings_pkey" PRIMARY KEY ("license_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kb_categories_license_id_slug_key" ON "kb_categories"("license_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "kb_articles_license_id_slug_key" ON "kb_articles"("license_id", "slug");

-- CreateIndex
CREATE INDEX "kb_articles_license_id_status_published_at_idx" ON "kb_articles"("license_id", "status", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "kb_settings_public_slug_key" ON "kb_settings"("public_slug");

-- AddForeignKey
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "kb_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_settings" ADD CONSTRAINT "kb_settings_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An article is either being drafted or already published; any other value is
-- a bug in the admin endpoint, refused at the boundary. Prisma cannot express
-- a CHECK — added by hand.
ALTER TABLE "kb_articles"
  ADD CONSTRAINT "kb_articles_status_check" CHECK ("status" IN ('draft', 'published'));

-- All three tables are license-scoped like ticket_email_templates/brands: a
-- category, article or settings row is visible and writable only within its
-- own license (NFR-S5). `public_slug` being globally unique does not weaken
-- this — the anonymous resolver (PUBKB-c) reads through a SECURITY DEFINER
-- function, the same pre-tenant-context pattern as channel_resolve_license.
ALTER TABLE kb_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_categories_tenant ON kb_categories
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_articles_tenant ON kb_articles
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE kb_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_settings_tenant ON kb_settings
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The application role reaches the tables only through those policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_categories TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_articles TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_settings TO nexa_app;
