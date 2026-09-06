-- Purchased AI-resolution overage packs (FR-MOD-10.1.4 · NFR-S4).
--
--   * ai_package_purchases — one row per sale: which license bought how many
--     packs, for how many resolutions, at what price, into which period.
--
-- The sibling of api_package_purchases (20260809100000), and deliberately a
-- second table rather than a `metric` column on the first. The two sell
-- different things in different units — a named catalogue tier of API calls
-- versus a quantity of fixed-size AI packs — so one table would need `packs`
-- and `api_calls` to be nullable in opposite rows, and every CHECK below would
-- have to be conditional on the metric. Splitting keeps each constraint
-- unconditional, which is the only way they actually hold.
--
-- The row is the *record of the sale*, not the quota. The quota lands in
-- usage_records.included for (license_id, 'ai_resolutions', period), raised in
-- the same transaction — and that column is a running total with no trace of
-- what raised it. Payment is mocked (ADR-13), so no external processor keeps a
-- receipt either. Drop this table and a workspace can be charged with nothing
-- to show for what, and the invoice line item has nothing to derive from.
--
-- `resolutions` is stored even though it is `packs × AI_RESOLUTION_PACK_SIZE`.
-- The pack size is a code constant, so the derivation is only correct until
-- someone changes it — at which point every past sale would silently restate
-- how much quota it granted. Same reasoning as api_package_purchases copying
-- the catalogue's quota and price at sale time.
--
-- Expand-only (CONVENTIONS §6.3): a new table with no reference from any
-- existing one, so the previous release runs unchanged against this schema.

-- CreateTable
CREATE TABLE "ai_package_purchases" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "packs" INTEGER NOT NULL,
    "resolutions" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "period" CHAR(6) NOT NULL,
    "purchased_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_package_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_package_purchases_license_id_idempotency_key_key" ON "ai_package_purchases"("license_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "ai_package_purchases_license_id_period_idx" ON "ai_package_purchases"("license_id", "period");

-- AddForeignKey
ALTER TABLE "ai_package_purchases" ADD CONSTRAINT "ai_package_purchases_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The unique index above is the whole of the idempotency guarantee, and it is
-- in the database rather than in the service on purpose: this is a money write
-- reachable from a double-clicked button, and two requests that overlap by
-- milliseconds are not serialised by any check the application could make
-- before inserting. The purchase path inserts with ON CONFLICT DO NOTHING, so
-- the loser of that race is told "already bought" instead of crediting a second
-- allowance. Scoped to the license: keys are chosen by clients, and one
-- workspace's key must not be able to block or replay another's purchase.

-- `period` is the join key back to the usage_records row this purchase credited
-- ((license_id, metric, period), yyyymm). A free-form or short value would
-- record a sale against a period nothing ever bills: the money is taken, the
-- quota is credited somewhere unreachable, and the invoice for the real period
-- never shows the line. Mirrors usage_records_period_check exactly.
ALTER TABLE ai_package_purchases
  ADD CONSTRAINT ai_package_purchases_period_check CHECK (period ~ '^\d{6}$');

-- A sale of zero packs is a charge for nothing, and the route's own ceiling
-- (AI_PACKAGE_MAX_PACKS) is restated here so a future caller that bypasses the
-- route cannot write a purchase the product does not sell.
ALTER TABLE ai_package_purchases
  ADD CONSTRAINT ai_package_purchases_packs_check CHECK (packs > 0 AND packs <= 20);

-- Quota actually granted. Zero resolutions with a non-zero price is the shape
-- of a bug that bills for nothing, so the schema refuses it.
ALTER TABLE ai_package_purchases
  ADD CONSTRAINT ai_package_purchases_resolutions_check CHECK (resolutions > 0);

-- A negative price is a refund, and refunds are deliberately out of scope here
-- for the same reason as on api_package_purchases: giving quota back means
-- *lowering* usage_records.included, which can fall below what the workspace
-- has already spent and turn settled usage into retroactive overage.
ALTER TABLE ai_package_purchases
  ADD CONSTRAINT ai_package_purchases_price_cents_check CHECK (price_cents >= 0);

-- License-scoped like every other tenant table. What is behind the policy is
-- money — a cross-tenant read exposes what another workspace spends, and a
-- cross-tenant write bills them for capacity they never asked for while
-- crediting the quota to whoever wrote the row.
ALTER TABLE ai_package_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_package_purchases_tenant ON ai_package_purchases
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app and reaches the table only through that policy.
-- It may record a sale and read the history, nothing more.
GRANT SELECT, INSERT ON public.ai_package_purchases TO nexa_app;

-- Withholding UPDATE and DELETE takes an explicit REVOKE: the ALTER DEFAULT
-- PRIVILEGES in 20260722090000 hands nexa_app the full set on every table
-- created after it, so the narrower GRANT above is a no-op on its own. Mirrors
-- api_package_purchases, and for the same reason: a purchase is the only
-- surviving evidence of a charge, and an actor who can edit it can quietly
-- lower the price on an invoice that was already issued — or delete the row and
-- leave the credited quota unexplained. Deleting it would also erase the
-- idempotency key, which is what makes a retry safe.
--
-- Erasing the workspace still clears these rows: the ON DELETE CASCADE above is
-- carried out by the referencing table's owner, not by nexa_app (NFR-C9).
REVOKE UPDATE, DELETE ON public.ai_package_purchases FROM nexa_app;
