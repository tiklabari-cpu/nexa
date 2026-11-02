-- Page events the host site reports with siyahtus('trackEvent', …) (EN-06).
--
-- A new table only: nothing existing is read differently, so old and new code
-- both run against it (CONVENTIONS §6.3).
--
-- The rows are unverified browser data. They exist so a goal that names an event
-- ("registration_completed") can convert the visitor; billing, limits and
-- authorisation never read them. There is deliberately no amount column.

-- CreateTable
CREATE TABLE "visitor_events" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "value" VARCHAR(100) NOT NULL DEFAULT '',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_events_pkey" PRIMARY KEY ("id")
);

-- A page repeating an event records nothing new. The key's prefix
-- (license, customer, name) is also the matcher's lookup.
--
-- CreateIndex
CREATE UNIQUE INDEX "visitor_events_license_id_customer_id_name_value_key" ON "visitor_events"("license_id", "customer_id", "name", "value");

-- AddForeignKey
ALTER TABLE "visitor_events" ADD CONSTRAINT "visitor_events_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The events describe the visitor, so erasing the visitor erases them
-- (retention / GDPR) — unlike a sale, nothing here is revenue to preserve.
--
-- AddForeignKey
ALTER TABLE "visitor_events" ADD CONSTRAINT "visitor_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The same name shape the API enforces: the table is never a place a page can
-- put free text under a key a report later prints.
ALTER TABLE "visitor_events" ADD CONSTRAINT "visitor_events_name_check" CHECK ("name" ~ '^[a-z0-9_]{1,40}$');

-- License-scoped like every other tenant table.
ALTER TABLE visitor_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY visitor_events_tenant ON visitor_events
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- No GRANT statement: the ALTER DEFAULT PRIVILEGES in 20260722090000 already
-- hands siyahtus_app SELECT, INSERT, UPDATE, DELETE on every table created
-- after it, and the ingest path needs the first two (retention needs DELETE).
