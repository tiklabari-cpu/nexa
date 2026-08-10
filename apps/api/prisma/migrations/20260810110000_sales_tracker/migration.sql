-- Sales tracker: per-license configuration + tracked orders (FR-MOD-13.5) —
-- the data layer for 13.5-a. Two tables, no data written yet: the settings
-- endpoint is 13.5-b, the ingest + attribution core is 13.5-c.
--
--   * sales_tracker_settings — one row per license: is tracking on, what
--     currency, how many days after a chat still counts as attributed.
--   * tracked_sales — one row per order the widget snippet reports, whether
--     or not it has been matched to a chat yet.
--
-- Neither table exists today: there is no order/sale model anywhere in the
-- pre-13.5 schema, and `reports.ts`'s ecommerce block hard-codes
-- `configured: false` for exactly that reason.
--
-- Both tables are license-scoped only, not brand-scoped. MULTIBRAND-c
-- (brand_scoped_settings) widened `security_settings` / `inbox_settings` /
-- `widget_settings` to `(license_id, brand_id)` because those three already
-- existed as license-only singletons when Multibrand shipped and had to keep
-- a row per brand for appearance/behaviour that genuinely differs by brand.
-- `sales_tracker_settings` is new after that migration, and FR-MOD-13.5 gives
-- no indication tracking should vary by brand — the same call already made
-- for `goals`/`goal_achievements` (13.3), the other tenant table introduced
-- since Multibrand.
--
-- The structural statements below are exactly what `prisma migrate diff`
-- emits for the schema change. The CHECK constraints and the RLS policies are
-- invisible to Prisma and are added here by hand, the same way every other
-- tenant table does.

-- CreateTable
CREATE TABLE "sales_tracker_settings" (
    "license_id" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "attribution_window_days" INTEGER NOT NULL DEFAULT 7,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_tracker_settings_pkey" PRIMARY KEY ("license_id")
);

-- CreateTable
CREATE TABLE "tracked_sales" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "chat_id" VARCHAR(12),
    "customer_id" UUID,
    "external_order_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "attributed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_sales_pkey" PRIMARY KEY ("id")
);

-- The ingest endpoint (13.5-c) is called by the merchant's own backend; an
-- at-least-once retry (network timeout, redelivery) must not double-count the
-- same order against the report.
--
-- CreateIndex
CREATE UNIQUE INDEX "tracked_sales_license_id_external_order_id_key" ON "tracked_sales"("license_id", "external_order_id");

-- Every read this table exists for is "sales in *this* license, in this
-- window" — the Reports Ecommerce block (13.5-d) filters and sums by exactly
-- this pair.
--
-- CreateIndex
CREATE INDEX "tracked_sales_license_id_created_at_idx" ON "tracked_sales"("license_id", "created_at");

-- AddForeignKey
ALTER TABLE "sales_tracker_settings" ADD CONSTRAINT "sales_tracker_settings_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_sales" ADD CONSTRAINT "tracked_sales_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The chat pointer does NOT cascade: chats are purged on a retention schedule
-- the sale history must outlive, so deleting the chat should drop only the
-- pointer, not the sale — the same choice `goal_achievements.chat_id` and
-- `tickets.source_chat_id` already make.
--
-- AddForeignKey
ALTER TABLE "tracked_sales" ADD CONSTRAINT "tracked_sales_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same reasoning for the customer pointer: attribution may resolve a
-- customer after the fact, and erasing that customer (retention, GDPR) must
-- not erase the revenue already recorded against them.
--
-- AddForeignKey
ALTER TABLE "tracked_sales" ADD CONSTRAINT "tracked_sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A negative order value cannot exist — the widget snippet reports whatever
-- the storefront checkout charged, which is never negative. Zero (a
-- fully-discounted order) is representable.
ALTER TABLE "tracked_sales" ADD CONSTRAINT "tracked_sales_amount_cents_check" CHECK ("amount_cents" >= 0);

-- Currency is an ISO 4217 code (USD, EUR, …), always three letters — the same
-- shape the settings endpoint and the ingest endpoint will both normalise to
-- before either table is written.
ALTER TABLE "tracked_sales" ADD CONSTRAINT "tracked_sales_currency_check" CHECK (char_length("currency") = 3);
ALTER TABLE "sales_tracker_settings" ADD CONSTRAINT "sales_tracker_settings_currency_check" CHECK (char_length("currency") = 3);

-- A zero or negative attribution window can never attribute anything (a sale
-- created after the chat it belongs to would never fall inside it), so the
-- settings endpoint must never be able to write one.
ALTER TABLE "sales_tracker_settings" ADD CONSTRAINT "sales_tracker_settings_attribution_window_days_check" CHECK ("attribution_window_days" > 0);

-- License-scoped like every other tenant table: a workspace's tracking
-- configuration and the sales it has recorded are visible and writable only
-- within its own license. What is behind the policy is revenue — a
-- cross-tenant read hands a competitor another workspace's sales figures, and
-- a cross-tenant write plants a fabricated order in a report nobody there
-- earned.
ALTER TABLE sales_tracker_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_tracker_settings_tenant ON sales_tracker_settings
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE tracked_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY tracked_sales_tenant ON tracked_sales
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- No GRANT statement: the ALTER DEFAULT PRIVILEGES in 20260722090000 already
-- hands nexa_app SELECT, INSERT, UPDATE, DELETE on every table created after
-- it, and both write paths this table serves (the settings upsert, and the
-- ingest endpoint's later attribution update) need all four.
