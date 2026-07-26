-- Custom fields for tickets and contacts (FR-MOD-08.7.6): the extra fields a
-- workspace defines that the product does not ship with — a player id, a KYC
-- status, an account balance — shown on the ticket Details pane and in the CRM.
--
--   * custom_field_definitions — a license-scoped field: an `entity` it hangs
--     off ('ticket' | 'contact'), a `label`, a `type` that decides how a value
--     is validated ('text' | 'number' | 'boolean' | 'date') and whether it is
--     `required`. The two that carry the requirement are `type` and `required`
--     (KK "Tip/zorunluluk"). A label is unique per (license, entity).
--   * custom_field_values — one value for one field on one ticket or one
--     contact. Exactly one of `ticket_id` / `customer_id` is set, matching the
--     definition's entity (the CHECK below), and the value is kept as text in
--     its canonical form. One value per field per entity (the partial-null
--     unique indexes). A value inherits its license from the row.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change (minus the unrelated pgvector index it always reports —
-- see check-drift.ts). The CHECK constraints, the RLS policies and the GRANTs
-- are invisible to Prisma and are added here by hand, the same way every other
-- tenant table does.

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "entity" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "definition_id" UUID NOT NULL,
    "ticket_id" VARCHAR(12),
    "customer_id" UUID,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_license_id_entity_label_key" ON "custom_field_definitions"("license_id", "entity", "label");

-- CreateIndex
CREATE INDEX "custom_field_values_ticket_id_idx" ON "custom_field_values"("ticket_id");

-- CreateIndex
CREATE INDEX "custom_field_values_customer_id_idx" ON "custom_field_values"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_definition_id_ticket_id_key" ON "custom_field_values"("definition_id", "ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_definition_id_customer_id_key" ON "custom_field_values"("definition_id", "customer_id");

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A definition's entity and value type are constrained to the known catalogue,
-- so a bad string cannot reach the table (the service parses the same set, but
-- the column is the last word). Prisma cannot express a CHECK — added by hand.
ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_entity_check" CHECK ("entity" IN ('ticket', 'contact'));
ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_type_check" CHECK ("type" IN ('text', 'number', 'boolean', 'date'));

-- A value hangs off exactly one entity: either a ticket or a contact, never
-- both and never neither. Without this a row could point nowhere and be
-- unreachable, or point at both and be ambiguous.
ALTER TABLE "custom_field_values"
  ADD CONSTRAINT "custom_field_values_one_entity_check"
  CHECK ((("ticket_id" IS NOT NULL))::int + (("customer_id" IS NOT NULL))::int = 1);

-- Both tables are license-scoped like ticket_email_templates: a definition and
-- a value are visible and writable only within their own license.
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_field_definitions_tenant ON custom_field_definitions
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_field_values_tenant ON custom_field_values
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The application role reaches the tables only through those policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_field_definitions TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_field_values TO nexa_app;
