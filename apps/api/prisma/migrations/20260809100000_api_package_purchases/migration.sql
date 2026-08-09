-- Purchased API request packages (FR-MOD-09.3 · NFR-S4) — the data layer for
-- 09.3-b. One table, no data written; the code paths that fill it come later
-- (the purchase core in 09.3-d, the read surface in 09.3-c, the invoice line
-- item in 09.3-e).
--
--   * api_package_purchases — one row per sale: which license bought which
--     catalogue package, for how many calls, at what price, into which period.
--
-- The row is the *record of the sale*, not the quota. The quota lands in
-- usage_records.included, which 09.3-d raises in the same transaction — and
-- that column is a running total with no trace of what raised it. Payment is
-- mocked (ADR-13), so no external processor keeps a receipt either. Drop this
-- table and a workspace can be charged with nothing to show for what, and the
-- invoice line item has nothing to derive from.
--
-- `package_id` names an API_PACKAGE_CATALOG entry in code rather than a row, so
-- it carries no foreign key and no domain CHECK — the same call scheduled_reports
-- makes for `group_id`, and for the same reason: the catalogue lives in
-- @nexa/types and every tier added to it would otherwise cost a migration. The
-- purchase route validates the id instead. `api_calls` and `price_cents` are
-- copied from the catalogue at sale time rather than looked up on read, so
-- re-pricing a package in code can never rewrite what a workspace already paid.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change. The CHECK constraints, the RLS policy and the grants
-- are invisible to Prisma and are added here by hand, the same way every other
-- tenant table does.

-- CreateTable
CREATE TABLE "api_package_purchases" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "package_id" TEXT NOT NULL,
    "api_calls" BIGINT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "period" CHAR(6) NOT NULL,
    "purchased_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_package_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_package_purchases_license_id_period_idx" ON "api_package_purchases"("license_id", "period");

-- AddForeignKey
ALTER TABLE "api_package_purchases" ADD CONSTRAINT "api_package_purchases_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `period` is the join key back to the usage_records row this purchase credited
-- ((license_id, metric, period), yyyymm). A free-form or short value would
-- record a sale against a period nothing ever bills: the money is taken, the
-- quota is credited somewhere unreachable, and the invoice for the real period
-- never shows the line. Mirrors usage_records_period_check exactly, because the
-- two columns have to agree for the pair to be readable at all.
ALTER TABLE api_package_purchases
  ADD CONSTRAINT api_package_purchases_period_check CHECK (period ~ '^\d{6}$');

-- A package that adds no calls is a charge for nothing. Every catalogue entry
-- carries a positive quota (@nexa/types asserts it), so a zero or negative row
-- can only arrive through a bug in the purchase path.
ALTER TABLE api_package_purchases
  ADD CONSTRAINT api_package_purchases_api_calls_check CHECK (api_calls > 0);

-- A negative price is a refund, and refunds are deliberately out of scope for
-- this slice: giving quota back means *lowering* usage_records.included, which
-- can fall below what the workspace has already spent and turn settled usage
-- into retroactive overage. Until that is designed, the schema refuses to
-- represent it rather than letting a sign error do it silently.
ALTER TABLE api_package_purchases
  ADD CONSTRAINT api_package_purchases_price_cents_check CHECK (price_cents >= 0);

-- License-scoped like every other tenant table: a purchase is visible and
-- writable only within its own license. What is behind the policy is money — a
-- cross-tenant read exposes what another workspace spends, and a cross-tenant
-- write bills them for a package they never asked for while crediting the
-- quota to whoever wrote the row.
ALTER TABLE api_package_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_package_purchases_tenant ON api_package_purchases
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app and reaches the table only through that policy.
-- It may record a sale and read the history, nothing more.
GRANT SELECT, INSERT ON public.api_package_purchases TO nexa_app;

-- Withholding UPDATE and DELETE takes an explicit REVOKE: the ALTER DEFAULT
-- PRIVILEGES in 20260722090000 hands nexa_app SELECT, INSERT, UPDATE, DELETE on
-- every table created after it, so the narrower GRANT above is a no-op on its
-- own. Mirrors `REVOKE UPDATE, DELETE ON audit_log`, and for the same reason: a
-- purchase is the only surviving evidence of a charge, so an actor who can edit
-- it can quietly lower the price on an invoice that was already issued, or
-- delete the row and leave the credited quota unexplained. A sale is recorded
-- once and never rewritten — reversing one is a new row's job (a refund), and
-- that is a slice of its own.
--
-- Erasing the workspace still clears these rows: the ON DELETE CASCADE above is
-- carried out by the referencing table's owner, not by nexa_app, which is what
-- NFR-C9 needs.
REVOKE UPDATE, DELETE ON public.api_package_purchases FROM nexa_app;
