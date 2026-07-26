-- Campaigns trigger engine (FR-MOD-03.3.2/.3): one row per visitor a campaign
-- has fired to. The unique (campaign_id, customer_id) pair stops a campaign
-- firing twice at the same person, and the rows are the source of the card's
-- Displayed / Chats / Conversion numbers.

-- CreateTable
CREATE TABLE "campaign_sends" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "campaign_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "chat_id" VARCHAR(12),
    "engaged" BOOLEAN NOT NULL DEFAULT false,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_sends_license_id_campaign_id_idx" ON "campaign_sends"("license_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_sends_campaign_id_customer_id_key" ON "campaign_sends"("campaign_id", "customer_id");

-- AddForeignKey
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: a send is visible and writable only within its own
-- license, exactly like campaigns and every other tenant-scoped table.
ALTER TABLE campaign_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_sends_tenant ON campaign_sends
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());
