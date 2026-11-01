-- tm 382 · BILLING-PAYMENT-METHODS (BL-01 · ADR-13a): three ways to pay — a
-- bank transfer the platform marks paid (`swift_manual`), a crypto transfer
-- requested by the owner and confirmed by its TXID (`crypto_manual`), and a
-- Stripe charge (`stripe`, mock/sandbox only in this build).
--
-- Expand-only (CONVENTIONS §6.3): four nullable columns on `subscriptions` and
-- two new tables. Nothing existing is read differently by old code.

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "past_due_since" TIMESTAMPTZ(6),
ADD COLUMN     "payment_provider" TEXT,
ADD COLUMN     "provider_customer_id" TEXT,
ADD COLUMN     "provider_payment_method_id" TEXT;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_payment_provider_check
    CHECK (payment_provider IS NULL OR payment_provider IN ('swift_manual', 'crypto_manual', 'stripe'));

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "license_id" BIGINT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider_ref" TEXT,
    "provider_event_id" TEXT,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "period" CHAR(6) NOT NULL,
    "billing_cycle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failure_code" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "term_start" TIMESTAMPTZ(6),
    "term_end" TIMESTAMPTZ(6),
    "handled_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_payment_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "license_id" BIGINT NOT NULL,
    "network" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "billing_cycle" TEXT NOT NULL,
    "billing_name" TEXT NOT NULL,
    "billing_details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "wallet_address" TEXT,
    "address_sent_at" TIMESTAMPTZ(6),
    "txid" TEXT,
    "txid_submitted_at" TIMESTAMPTZ(6),
    "transaction_id" UUID,
    "requested_by" UUID,
    "handled_by" TEXT,
    "closed_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "crypto_payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_reference_key" ON "payment_transactions"("reference");

-- CreateIndex
CREATE INDEX "payment_transactions_license_id_created_at_idx" ON "payment_transactions"("license_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_provider_provider_event_id_key" ON "payment_transactions"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "payment_transactions_provider_provider_ref_idx" ON "payment_transactions"("provider", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_payment_requests_transaction_id_key" ON "crypto_payment_requests"("transaction_id");

-- CreateIndex
CREATE INDEX "crypto_payment_requests_license_id_created_at_idx" ON "crypto_payment_requests"("license_id", "created_at");

-- CreateIndex
CREATE INDEX "crypto_payment_requests_status_created_at_idx" ON "crypto_payment_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_payment_requests_network_txid_key" ON "crypto_payment_requests"("network", "txid");

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_payment_requests" ADD CONSTRAINT "crypto_payment_requests_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_payment_requests" ADD CONSTRAINT "crypto_payment_requests_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- payment_transactions — what the database refuses on its own.
-- ---------------------------------------------------------------------------
ALTER TABLE payment_transactions
  ADD CONSTRAINT payment_transactions_provider_check
    CHECK (provider IN ('swift_manual', 'crypto_manual', 'stripe')),
  -- Only a saved card renews by itself; a manual payment is always started.
  ADD CONSTRAINT payment_transactions_kind_check
    CHECK (kind = 'checkout' OR (kind = 'renewal' AND provider = 'stripe')),
  ADD CONSTRAINT payment_transactions_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled', 'disputed')),
  ADD CONSTRAINT payment_transactions_reference_check
    CHECK (reference ~ '^ST-[0-9A-Z]{4}-[0-9A-Z]{4}$'),
  ADD CONSTRAINT payment_transactions_amount_check CHECK (amount_minor > 0),
  ADD CONSTRAINT payment_transactions_currency_check CHECK (currency ~ '^[a-z]{3}$'),
  ADD CONSTRAINT payment_transactions_period_check CHECK (period ~ '^[0-9]{6}$'),
  ADD CONSTRAINT payment_transactions_billing_cycle_check
    CHECK (billing_cycle IN ('monthly', 'annual')),
  ADD CONSTRAINT payment_transactions_attempt_check CHECK (attempt BETWEEN 1 AND 10),
  -- A code, never processor prose (it may carry card or customer detail).
  ADD CONSTRAINT payment_transactions_failure_code_check
    CHECK (failure_code IS NULL OR (status = 'failed' AND failure_code ~ '^[a-z][a-z0-9_]{0,63}$')),
  ADD CONSTRAINT payment_transactions_settled_check
    CHECK ((status = 'pending') = (settled_at IS NULL)),
  ADD CONSTRAINT payment_transactions_term_pair_check
    CHECK ((term_start IS NULL) = (term_end IS NULL) AND (term_end IS NULL OR term_end > term_start)),
  -- Money taken pays a term; a failed or pending attempt paid nothing.
  ADD CONSTRAINT payment_transactions_term_check
    CHECK ((status IN ('succeeded', 'disputed')) = (term_start IS NOT NULL)),
  ADD CONSTRAINT payment_transactions_provider_ref_check
    CHECK (provider_ref IS NULL OR char_length(provider_ref) BETWEEN 1 AND 255),
  ADD CONSTRAINT payment_transactions_provider_event_id_check
    CHECK (provider_event_id IS NULL OR char_length(provider_event_id) BETWEEN 1 AND 255),
  ADD CONSTRAINT payment_transactions_handled_by_check
    CHECK (handled_by IS NULL OR char_length(handled_by) BETWEEN 1 AND 64);

-- One SWIFT reference waiting per workspace: the reference is per term, and a
-- second one open beside it would be two descriptions for one transfer.
CREATE UNIQUE INDEX payment_transactions_one_pending_swift
  ON payment_transactions (license_id)
  WHERE provider = 'swift_manual' AND status = 'pending';

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_transactions_tenant ON payment_transactions
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT, INSERT, UPDATE ON public.payment_transactions TO siyahtus_app;

-- ---------------------------------------------------------------------------
-- crypto_payment_requests — "Adres isteyin".
-- ---------------------------------------------------------------------------
ALTER TABLE crypto_payment_requests
  ADD CONSTRAINT crypto_payment_requests_network_check
    CHECK (network IN ('usdt_trc20', 'usdt_erc20')),
  ADD CONSTRAINT crypto_payment_requests_status_check
    CHECK (status IN ('requested', 'address_sent', 'paid', 'rejected', 'canceled')),
  ADD CONSTRAINT crypto_payment_requests_amount_check CHECK (amount_minor > 0),
  ADD CONSTRAINT crypto_payment_requests_currency_check CHECK (currency ~ '^[a-z]{3}$'),
  ADD CONSTRAINT crypto_payment_requests_billing_cycle_check
    CHECK (billing_cycle IN ('monthly', 'annual')),
  ADD CONSTRAINT crypto_payment_requests_billing_name_check
    CHECK (char_length(btrim(billing_name)) BETWEEN 1 AND 200),
  ADD CONSTRAINT crypto_payment_requests_billing_details_check
    CHECK (billing_details IS NULL OR char_length(billing_details) <= 1000),
  -- The address is the team's answer: never there before it was sent, always
  -- there once it was (ADR-13a §3 — no address is shown by itself).
  ADD CONSTRAINT crypto_payment_requests_address_check
    CHECK (
      (wallet_address IS NULL) = (address_sent_at IS NULL)
      AND (status <> 'requested' OR wallet_address IS NULL)
      AND (status NOT IN ('address_sent', 'paid') OR wallet_address IS NOT NULL)
      AND (wallet_address IS NULL OR char_length(wallet_address) BETWEEN 26 AND 64)
    ),
  -- A TXID answers an address, lower-case hex (with `0x` on Ethereum).
  ADD CONSTRAINT crypto_payment_requests_txid_check
    CHECK (
      (txid IS NULL) = (txid_submitted_at IS NULL)
      AND (txid IS NULL OR wallet_address IS NOT NULL)
      AND (txid IS NULL OR txid ~ '^(0x)?[0-9a-f]{64}$')
    ),
  ADD CONSTRAINT crypto_payment_requests_paid_check
    CHECK (status <> 'paid' OR (txid IS NOT NULL AND transaction_id IS NOT NULL)),
  ADD CONSTRAINT crypto_payment_requests_closed_check
    CHECK ((status IN ('paid', 'rejected', 'canceled')) = (closed_at IS NOT NULL)),
  ADD CONSTRAINT crypto_payment_requests_closed_reason_check
    CHECK (closed_reason IS NULL OR char_length(closed_reason) <= 500),
  ADD CONSTRAINT crypto_payment_requests_handled_by_check
    CHECK (handled_by IS NULL OR char_length(handled_by) BETWEEN 1 AND 64);

-- One open request per workspace — the queue holds a question, not a pile.
CREATE UNIQUE INDEX crypto_payment_requests_one_open
  ON crypto_payment_requests (license_id)
  WHERE status IN ('requested', 'address_sent');

ALTER TABLE crypto_payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY crypto_payment_requests_tenant ON crypto_payment_requests
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT, INSERT, UPDATE ON public.crypto_payment_requests TO siyahtus_app;

-- ---------------------------------------------------------------------------
-- Lookups that run before any tenant is known.
-- ---------------------------------------------------------------------------

-- A processor webhook names our transaction (its metadata) or the processor's
-- own id for it (a dispute names only the payment intent), and no session
-- exists when it calls — so, like `whatsapp_resolve_phone_number`, the tenant
-- is found here and everything after runs under RLS.
CREATE FUNCTION payment_transaction_locate(p_provider TEXT, p_id UUID, p_provider_ref TEXT)
RETURNS TABLE (transaction_id UUID, license_id BIGINT, organization_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.license_id, l.organization_id
  FROM payment_transactions t
  JOIN licenses l ON l.id = t.license_id
  WHERE t.provider = p_provider
    AND (t.id = p_id OR (p_provider_ref IS NOT NULL AND t.provider_ref = p_provider_ref))
  ORDER BY (t.id = p_id) DESC, t.created_at DESC
  LIMIT 1;
$$;

-- The workspaces the dunning job has something to do for: a Stripe-paid term
-- that has run out, or a renewal already failing. The job decides per
-- workspace whether a charge is due today.
CREATE FUNCTION billing_dunning_due_tenants(p_now TIMESTAMPTZ)
RETURNS TABLE (license_id BIGINT, organization_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT s.license_id, l.organization_id
  FROM subscriptions s
  JOIN licenses l ON l.id = s.license_id
  WHERE s.payment_provider = 'stripe'
    AND l.status IN ('active', 'past_due')
    AND (
      s.past_due_since IS NOT NULL
      OR (s.current_period_end IS NOT NULL AND s.current_period_end <= p_now)
    )
  ORDER BY s.license_id
  LIMIT 500;
$$;

REVOKE EXECUTE ON FUNCTION payment_transaction_locate(TEXT, UUID, TEXT),
  billing_dunning_due_tenants(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_transaction_locate(TEXT, UUID, TEXT),
  billing_dunning_due_tenants(TIMESTAMPTZ) TO siyahtus_app;
