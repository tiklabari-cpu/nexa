-- Outbound webhook delivery log (FR-MOD-08.8.4 · NFR-M5).
--
-- The `webhooks` table records *what* to send; this records every *attempt* to
-- send it — the first try and each retry — so there is a complete trail of what
-- left the system and how the far end responded. `permanent` flags the attempt
-- that exhausted the retries, the one signal that separates "gave up" from
-- "succeeded" / "still retrying".
--
-- Tenant-scoped by `license_id` under the same RLS model as every other table
-- (a delivery row is as sensitive as the webhook it belongs to), and cascaded
-- from both the license and the webhook so removing either takes its log with
-- it.

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "webhook_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status_code" INTEGER,
    "error" TEXT,
    "permanent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_deliveries_license_id_webhook_id_created_at_idx"
    ON "webhook_deliveries"("license_id", "webhook_id", "created_at");

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey"
    FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The attempt counter is 1-based and never negative; a row that claims to be
-- attempt 0 or -1 is a bug in the dispatcher, refused at the boundary.
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_attempt_check CHECK (attempt >= 1);

-- Row level security: a delivery row belongs to exactly one license and is only
-- visible inside that tenant's transaction (mirrors webhooks_tenant).
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_tenant ON webhook_deliveries
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app. Default privileges already cover new tables,
-- but grant explicitly so this migration is correct regardless of who owns it.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_deliveries TO nexa_app;
