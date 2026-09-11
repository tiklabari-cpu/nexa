-- Persistent invoice history (FR-MOD-10.3 · NFR-S4).
--
--   * invoices           — one frozen statement per closed billing period.
--   * invoice_line_items — the amounts that explain that statement's total.
--
-- WHY THIS EXISTS. The invoice history was derived on read: every past period
-- was priced from whatever `subscriptions` said at the moment of the request.
-- The subscription is a single row that `updateSubscription` rewrites in place,
-- so changing plan, seats or cycle silently restated statements the workspace
-- had already been shown and already downloaded. Nothing in the schema recorded
-- what a period had actually cost, which means there was no version of the
-- history that a plan change could not move.
--
-- The fix is a row that is written once and never touched again. `nexa_app`
-- holds SELECT and INSERT on both tables and nothing else — the REVOKE at the
-- bottom is not tidiness, it is the guarantee: an actor who can UPDATE a
-- statement can lower the price on an invoice that has already been issued, and
-- one who can DELETE it can make a charge disappear from the only place it was
-- ever recorded.
--
-- WHAT IS DELIBERATELY NOT HERE. The *current* period gets no row. It has not
-- closed, nothing has been billed, and its figures are supposed to move as
-- usage accrues — freezing it would be a statement about a month that has not
-- happened. It is served as an `estimate`, computed on read, and the endpoint
-- says so. `origin` and `status` are constrained below so that "not yet closed"
-- cannot be spelled into this table at all.
--
-- BACKFILL. Periods that closed before this migration have no row, and none is
-- written here: reconstructing them needs the seat arithmetic that lives in
-- `subscription-service.ts`, and a second copy of that arithmetic in SQL is
-- exactly the kind of divergence this table exists to end. The period-close
-- sweep does it instead, on its first pass, and marks those rows
-- `origin = 'reconstructed'` — the metered and purchased lines are still exact
-- (every `usage_records` row carries the allowance and unit price that produced
-- it; every purchase row carries its own price), and only the seat line is
-- priced from the subscription as it stands at write time, because per-period
-- seat history was never retained. Marking it is the honest half: a
-- reconstruction that looked identical to an issued statement would be a worse
-- lie than the derivation it replaces, since it would also be permanent.
--
-- Expand-only (CONVENTIONS §6.3): two new tables that nothing existing
-- references, so the previous release runs unchanged against this schema — it
-- simply keeps deriving, as it always did.

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "number" TEXT NOT NULL,
    "period" CHAR(6) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_license_id_period_key" ON "invoices"("license_id", "period");

-- CreateIndex
CREATE INDEX "invoice_line_items_invoice_id_idx" ON "invoice_line_items"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_items_invoice_id_position_key" ON "invoice_line_items"("invoice_id", "position");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The unique index above is the whole of the sweep's idempotency guarantee, and
-- it is in the database rather than in the service for the same reason
-- ai_package_purchases puts its idempotency key there: two passes that overlap
-- by milliseconds — a second API instance, an operator retrying the CLI while
-- the scheduler ticks — are not serialised by any check the application could
-- make before inserting. The loser of that race is told "already closed" and
-- writes nothing, rather than issuing the workspace a second statement for a
-- month it has already been billed for.

-- Mirrors usage_records_period_check and both purchase tables: a free-form or
-- short period records a statement against a month nothing else in the schema
-- can join to, which is how an invoice ends up unreachable from the usage it is
-- supposed to explain.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_period_check CHECK (period ~ '^\d{6}$');

-- Half-open [start, end): the end is the first instant of the *next* month, so
-- two consecutive periods cannot both claim the same moment. A row whose window
-- is empty or inverted would make "which statement covers this timestamp"
-- unanswerable.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_period_window_check CHECK (period_end > period_start);

-- `estimate` is not storable, and that is the constraint doing the work rather
-- than the service: an estimate is by definition a period with no row here, so
-- a row claiming to be one would be a statement about a month that has not
-- closed. Widening this list later is allowed (CONVENTIONS §6.3 permits a wider
-- CHECK in one release); narrowing it is not.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_origin_check CHECK (origin IN ('issued', 'reconstructed'));

-- `open` is refused for the same reason as `estimate`. `trial` is kept rather
-- than folded into `paid`: a trial month owed nothing, and freezing that fact is
-- what stops a workspace's trial statements turning into paid ones the day the
-- trial ends — the derived path recomputed this from *today's* trial state and
-- did exactly that.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check CHECK (status IN ('paid', 'trial'));

-- Lower-case ISO-4217. CHAR(3) already fixes the width; this stops 'USD' and
-- 'usd' being two currencies to anything that groups by the column.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_currency_check CHECK (currency ~ '^[a-z]{3}$');

-- A negative statement is a refund, and refunds are out of scope here for the
-- same reason as on both purchase tables: giving money back means unwinding
-- quota that has already been spent. Zero is legitimate — that is what a trial
-- month is.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_amounts_check CHECK (subtotal_cents >= 0 AND total_cents >= 0);

-- Ordering is part of the statement: seats, then each overage, then each
-- package bought. A reordered statement reads as a different one, so the
-- position is stored and made unique per invoice rather than left to whatever
-- order a SELECT happens to return.
ALTER TABLE invoice_line_items
  ADD CONSTRAINT invoice_line_items_position_check CHECK (position >= 0);

-- Same reasoning as invoices_amounts_check, one line down: a negative line is a
-- credit, and a credit is a refund by another name.
ALTER TABLE invoice_line_items
  ADD CONSTRAINT invoice_line_items_amount_check CHECK (amount_cents >= 0);

-- An unlabelled line explains nothing, which defeats the only reason a
-- statement is itemised at all.
ALTER TABLE invoice_line_items
  ADD CONSTRAINT invoice_line_items_description_check CHECK (length(btrim(description)) > 0);

-- License-scoped like every other tenant table. What is behind the policy is
-- money: a cross-tenant read exposes what another workspace pays and how many
-- seats it runs, and a cross-tenant write puts a charge on their permanent
-- record. The line items carry their own license_id so this policy holds them
-- directly rather than through a join — isolation that depends on the parent
-- being joined correctly is isolation that a future query can forget.
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_tenant ON invoices
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_line_items_tenant ON invoice_line_items
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API and the sweep both connect as nexa_app and reach these tables only
-- through the policies above. They may freeze a statement and read the history,
-- nothing more.
GRANT SELECT, INSERT ON public.invoices TO nexa_app;
GRANT SELECT, INSERT ON public.invoice_line_items TO nexa_app;

-- Withholding UPDATE and DELETE takes an explicit REVOKE: the ALTER DEFAULT
-- PRIVILEGES in 20260722090000 hands nexa_app the full set on every table
-- created after it, so the narrower GRANTs above are a no-op on their own.
-- This is the whole point of the table. A statement that can be edited after
-- issue is exactly as retroactive as the derivation it replaces — worse, in
-- fact, because the edit leaves no trace where the derivation at least
-- recomputed from something visible.
--
-- Erasing the workspace still clears these rows: the ON DELETE CASCADE above is
-- carried out by the referencing table's owner, not by nexa_app (NFR-C9).
REVOKE UPDATE, DELETE ON public.invoices FROM nexa_app;
REVOKE UPDATE, DELETE ON public.invoice_line_items FROM nexa_app;
