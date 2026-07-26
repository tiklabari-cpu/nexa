-- Payment method on file (FR-MOD-10.3 — "ödeme yöntemi güncelleme").
--
-- A per-license singleton, keyed and shaped like `security_settings` /
-- `inbox_settings`. Billing is mocked (ADR-13) and real card entry is out of
-- scope (PRD §11.1/1), so this holds only the masked representation a processor
-- would return after tokenising a card — brand, last four, expiry, holder —
-- never a full card number. Nothing here is PCI-sensitive.
--
-- Isolation is the same as every other tenant table: RLS scopes each row to the
-- workspace that owns it, so one license can neither read nor write another's
-- payment method. The application role reaches it only through that policy.

CREATE TABLE "payment_methods" (
    "license_id" BIGINT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" CHAR(4) NOT NULL,
    "exp_month" INTEGER NOT NULL,
    "exp_year" INTEGER NOT NULL,
    "holder_name" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("license_id")
);

ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_methods_tenant ON payment_methods
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_methods TO nexa_app;
