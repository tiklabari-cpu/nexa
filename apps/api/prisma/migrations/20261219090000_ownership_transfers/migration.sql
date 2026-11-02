-- Handing the workspace over (RL-05 · tm 328): the owner names a member, the
-- member accepts within 72 hours with the token mailed to them. A new table
-- only — nothing existing is read differently, so old and new code both run
-- against it (CONVENTIONS §6.3).

-- CreateTable
CREATE TABLE "ownership_transfers" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ownership_transfers_license_id_created_at_idx" ON "ownership_transfers"("license_id", "created_at");

-- CreateIndex
CREATE INDEX "ownership_transfers_from_account_id_idx" ON "ownership_transfers"("from_account_id");

-- CreateIndex
CREATE INDEX "ownership_transfers_to_account_id_idx" ON "ownership_transfers"("to_account_id");

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- 1. The shape of a transfer
-- --------------------------------------------------------------------------
-- `decided_at` is set exactly when the transfer stops being pending, and a
-- member is never offered the workspace by themselves.
ALTER TABLE ownership_transfers
  ADD CONSTRAINT ownership_transfers_state_check CHECK (
    state IN ('pending', 'accepted', 'cancelled', 'expired')
  ),
  ADD CONSTRAINT ownership_transfers_decided_check CHECK (
    (state = 'pending') = (decided_at IS NULL)
  ),
  ADD CONSTRAINT ownership_transfers_parties_check CHECK (from_account_id <> to_account_id),
  ADD CONSTRAINT ownership_transfers_expiry_check CHECK (expires_at > created_at);

-- --------------------------------------------------------------------------
-- 2. One pending transfer per workspace
-- --------------------------------------------------------------------------
-- Partial, so the decided ones pile up as history. Prisma cannot express a
-- partial index and does not compare one in a drift check; it lives here.
CREATE UNIQUE INDEX uq_ownership_transfers_pending
  ON ownership_transfers (license_id)
  WHERE state = 'pending';

-- --------------------------------------------------------------------------
-- 3. Tenancy
-- --------------------------------------------------------------------------
-- Readable and writable within the caller's licence only.
ALTER TABLE ownership_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ownership_transfers_tenant ON ownership_transfers
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- No DELETE: a transfer is decided, never removed. The schema's default
-- privileges (20260722090000) hand every new table all four, so the one
-- withheld is revoked, not merely left out.
GRANT SELECT, INSERT, UPDATE ON public.ownership_transfers TO siyahtus_app;
REVOKE DELETE ON public.ownership_transfers FROM siyahtus_app;
