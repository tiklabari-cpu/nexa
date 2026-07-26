-- Ticket e-mail templates (FR-MOD-08.7.5): branded, variabled ticket mail.
--
-- A template is reusable subject + body text a workspace authors once, carrying
-- `{{ group.field }}` placeholders filled in per ticket at send time. Both
-- halves are validated against the fixed variable catalogue in the service on
-- every create and edit, so a template naming a variable the product cannot
-- fill, or a malformed placeholder, is rejected rather than stored (KK "Geçersiz
-- değişken/format engeli"). Nothing about that is expressible in DDL — the table
-- just holds the authored text.
--
-- License-scoped like `ticket_rules`: a template is visible and writable only
-- within its own license. The RLS policy and GRANT below are invisible to
-- Prisma and are added by hand, the same way every other tenant table does.

-- CreateTable
CREATE TABLE "ticket_email_templates" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ticket_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_email_templates_license_id_created_at_idx" ON "ticket_email_templates"("license_id", "created_at");

-- AddForeignKey
ALTER TABLE "ticket_email_templates" ADD CONSTRAINT "ticket_email_templates_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ticket_email_templates is license-scoped like ticket_rules: a template is
-- visible and writable only within its own license.
ALTER TABLE ticket_email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticket_email_templates_tenant ON ticket_email_templates
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The application role reaches the table only through that policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_email_templates TO nexa_app;
