-- tm 383 · INVOICE-PDF-PROFILE (BL-02 · K24): the workspace's billing profile,
-- a gapless invoice number per issuer and year, the two parties frozen onto
-- each statement, the informational PDF's storage key, how the period was paid
-- (K16), and the (mock) e-invoice receipt in its own table.
--
-- Expand-only (CONVENTIONS §6.3): nullable columns on `invoices`, two new
-- tables, one function. A statement frozen before this migration keeps its
-- `SIYAHTUS-<yyyymm>` number and has no PDF; nothing old code writes is
-- refused.

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "buyer_snapshot" JSONB,
ADD COLUMN     "issuer" TEXT,
ADD COLUMN     "payment_method" TEXT,
ADD COLUMN     "payment_reference" TEXT,
ADD COLUMN     "pdf_storage_key" TEXT,
ADD COLUMN     "seller_snapshot" JSONB,
ADD COLUMN     "serial" INTEGER,
ADD COLUMN     "serial_year" INTEGER;

-- CreateTable
CREATE TABLE "billing_profiles" (
    "license_id" BIGINT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "postal_code" TEXT,
    "country" CHAR(2) NOT NULL,
    "tax_office" TEXT,
    "tax_id" TEXT,
    "vat_id" TEXT,
    "invoice_email" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("license_id")
);

-- CreateTable
CREATE TABLE "invoice_number_counters" (
    "issuer" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_serial" INTEGER NOT NULL,

    CONSTRAINT "invoice_number_counters_pkey" PRIMARY KEY ("issuer","year")
);

-- CreateTable
CREATE TABLE "invoice_e_submissions" (
    "invoice_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_e_submissions_pkey" PRIMARY KEY ("invoice_id")
);

-- CreateIndex
CREATE INDEX "invoice_e_submissions_license_id_idx" ON "invoice_e_submissions"("license_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_issuer_serial_year_serial_key" ON "invoices"("issuer", "serial_year", "serial");

-- AddForeignKey
ALTER TABLE "invoice_e_submissions" ADD CONSTRAINT "invoice_e_submissions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_e_submissions" ADD CONSTRAINT "invoice_e_submissions_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- 1. billing_profiles — the rules of `billingProfileProblem` (@siyahtus/types)
-- --------------------------------------------------------------------------
-- The API normalises before writing (trimmed text, tax and VAT numbers without
-- spaces, upper case), so these see the stored form. Turkey needs a tax number
-- of 10 (VKN) or 11 (TCKN) digits; elsewhere it is optional, 2–32 letters and
-- digits. The TCKN check digits are the API's alone — a CHECK states the shape.
ALTER TABLE billing_profiles
  ADD CONSTRAINT billing_profiles_lengths_check CHECK (
    char_length(legal_name) BETWEEN 1 AND 200
    AND char_length(address_line1) BETWEEN 1 AND 200
    AND (address_line2 IS NULL OR char_length(address_line2) BETWEEN 1 AND 200)
    AND char_length(city) BETWEEN 1 AND 100
    AND (postal_code IS NULL OR char_length(postal_code) BETWEEN 1 AND 20)
    AND (tax_office IS NULL OR char_length(tax_office) BETWEEN 1 AND 100)
    AND (invoice_email IS NULL OR char_length(invoice_email) BETWEEN 3 AND 254)
  ),
  ADD CONSTRAINT billing_profiles_country_check CHECK (country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT billing_profiles_tax_id_check CHECK (
    CASE
      WHEN country = 'TR' THEN tax_id IS NOT NULL AND tax_id ~ '^[0-9]{10,11}$'
      ELSE tax_id IS NULL OR tax_id ~ '^[A-Z0-9]{2,32}$'
    END
  ),
  ADD CONSTRAINT billing_profiles_vat_id_check CHECK (
    vat_id IS NULL OR vat_id ~ '^[A-Z]{2}[A-Z0-9]{2,13}$'
  ),
  ADD CONSTRAINT billing_profiles_invoice_email_check CHECK (
    invoice_email IS NULL OR invoice_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

ALTER TABLE billing_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_profiles_tenant ON billing_profiles
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- No DELETE: a profile is corrected, never removed — an invoice issued
-- without one says so on its face, and that is what removing it would cause.
-- The schema's default privileges (20260722090000) hand every new table all
-- four, so the one withheld is revoked, not merely left out.
GRANT SELECT, INSERT, UPDATE ON public.billing_profiles TO siyahtus_app;
REVOKE DELETE ON public.billing_profiles FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. invoices — the new columns agree with each other
-- --------------------------------------------------------------------------
-- `siyahtus_app` still holds SELECT and INSERT only on `invoices`: a statement,
-- its number, its parties and its PDF key are written once.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_serial_check CHECK (
    (issuer IS NULL AND serial_year IS NULL AND serial IS NULL)
    OR (
      issuer IS NOT NULL AND serial_year BETWEEN 2000 AND 9999 AND serial > 0
      AND number = serial_year::text || '-' || CASE
        WHEN serial < 1000000 THEN lpad(serial::text, 6, '0') ELSE serial::text END
    )
  ),
  ADD CONSTRAINT invoices_snapshots_check CHECK (
    (seller_snapshot IS NULL AND buyer_snapshot IS NULL)
    OR (jsonb_typeof(seller_snapshot) = 'object' AND jsonb_typeof(buyer_snapshot) = 'object')
  ),
  ADD CONSTRAINT invoices_pdf_storage_key_check CHECK (
    pdf_storage_key IS NULL
    OR pdf_storage_key ~ '^[0-9]{1,19}-i-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  ),
  ADD CONSTRAINT invoices_payment_check CHECK (
    (payment_method IS NULL OR payment_method IN ('swift_manual', 'crypto_manual', 'stripe'))
    AND (payment_reference IS NULL OR payment_method IS NOT NULL)
  );

-- --------------------------------------------------------------------------
-- 3. invoice_e_submissions — the e-invoice receipt, written once
-- --------------------------------------------------------------------------
ALTER TABLE invoice_e_submissions
  ADD CONSTRAINT invoice_e_submissions_fields_check CHECK (
    provider ~ '^[a-z0-9_]{1,40}$' AND char_length(reference) BETWEEN 1 AND 200
  );

ALTER TABLE invoice_e_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_e_submissions_tenant ON invoice_e_submissions
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- Like `invoices`: SELECT and INSERT only.
GRANT SELECT, INSERT ON public.invoice_e_submissions TO siyahtus_app;
REVOKE UPDATE, DELETE ON public.invoice_e_submissions FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 4. billing_next_invoice_serial — the next serial of the year, locked
-- --------------------------------------------------------------------------
-- Called by the period-close sweep in the transaction that writes the
-- statement. The upsert takes the series row's lock and keeps it until that
-- transaction ends, so:
--   - two statements issued at once get consecutive serials (the second waits);
--   - a statement that fails to commit rolls the increment back with it, so a
--     serial is either on a committed statement or was never given out.
-- SECURITY DEFINER because no tenant role may touch the counter table; the
-- caller must still be inside a tenant context, like every billing function.
CREATE FUNCTION billing_next_invoice_serial(p_issuer TEXT, p_year INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_serial INTEGER;
BEGIN
  IF siyahtus_current_license() IS NULL THEN
    RAISE EXCEPTION 'billing_next_invoice_serial needs a tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_issuer IS NULL OR p_issuer !~ '^[a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'billing_next_invoice_serial: bad issuer' USING ERRCODE = '22023';
  END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'billing_next_invoice_serial: bad year' USING ERRCODE = '22023';
  END IF;

  INSERT INTO invoice_number_counters AS c (issuer, year, last_serial)
  VALUES (p_issuer, p_year, 1)
  ON CONFLICT (issuer, year) DO UPDATE SET last_serial = c.last_serial + 1
  RETURNING c.last_serial INTO v_serial;
  RETURN v_serial;
END;
$$;

-- Nobody but the function touches the series: not even a read, since a
-- workspace has no business knowing how many invoices the issuer has sent.
REVOKE ALL ON TABLE invoice_number_counters FROM PUBLIC;
REVOKE ALL ON TABLE invoice_number_counters FROM siyahtus_app;
-- Row level security on, no policy: every table in the schema carries it
-- (`data-model.test.ts`), and with no policy a role that somehow held a
-- privilege would still see nothing. The function runs as the table's owner,
-- which RLS exempts.
ALTER TABLE invoice_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE EXECUTE ON FUNCTION billing_next_invoice_serial(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_next_invoice_serial(TEXT, INTEGER) TO siyahtus_app;
