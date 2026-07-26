-- Omnichannel adapters (MOCK) — FR-MOD-08.5.4/.5/.6 (v1, Must).
--
-- The `channels` table already exists but had no consumer (PLAN §8): the MVP
-- channels (Website widget, e-mail forwarding) resolve a tenant their own way.
-- The v1 adapters — Messenger, Twilio SMS, WhatsApp — are the first real
-- consumers. Two supporting tables and one resolver make that work:
--
--   channel_identities  maps a provider's per-sender id (Messenger PSID, phone
--                       number) to a customer, so a returning contact reuses one
--                       history and an outbound reply can be addressed back.
--   channel_messages    the audit trail of what crossed an adapter — one row per
--                       inbound and per outbound message (mirrors the philosophy
--                       of webhook_deliveries: record what entered and left).
--   channel_resolve_license  a SECURITY DEFINER lookup that turns the workspace
--                       channel address a provider webhook names (page id /
--                       number) into a licence, the same pre-tenant hole the
--                       e-mail and hosted-chat paths use — no session exists when
--                       a provider calls in.
--
-- External providers are mocked in this build (MASTER-PROMPT §5); a production
-- deployment verifies the provider's signature at the edge (§9, out of scope).

-- CreateTable
CREATE TABLE "channel_identities" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_identities_license_id_channel_type_external_id_key"
    ON "channel_identities"("license_id", "channel_type", "external_id");

-- CreateTable
CREATE TABLE "channel_messages" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "chat_id" TEXT,
    "text" TEXT,
    "provider_message_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_messages_license_id_channel_type_created_at_idx"
    ON "channel_messages"("license_id", "channel_type", "created_at");

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A message is either inbound (from the customer) or outbound (to them); any
-- other value is a bug in an adapter, refused at the boundary. (chat_id is a
-- soft reference, not an FK: the audit row outlives the conversation it names.)
ALTER TABLE channel_messages
  ADD CONSTRAINT channel_messages_direction_check CHECK (direction IN ('inbound', 'outbound'));

-- Row level security: both tables are tenant-scoped by license_id under the same
-- model as every other table, so one workspace's identities and message log are
-- invisible to another (NFR-S5).
ALTER TABLE channel_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_identities_tenant ON channel_identities
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE channel_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_messages_tenant ON channel_messages
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- A provider webhook names the workspace's channel address (a page id, a phone
-- number) as the recipient, but no session exists yet — so the address must
-- resolve to a licence before any tenant context is set. This is the same kind
-- of small, reviewable pre-tenant hole as auth_resolve_organization_license:
-- SECURITY DEFINER, one question, only a connected ('on') channel matches.
CREATE OR REPLACE FUNCTION channel_resolve_license(p_type TEXT, p_address TEXT)
RETURNS TABLE (license_id BIGINT, organization_id UUID, license_status TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ch.license_id, l.organization_id, l.status
  FROM channels ch
  JOIN licenses l ON l.id = ch.license_id
  WHERE ch.type = p_type
    AND ch.status = 'connected'
    AND ch.config->>'address' = p_address;
$$;

-- SECURITY DEFINER runs as the function owner, so EXECUTE is granted narrowly and
-- never to PUBLIC.
REVOKE EXECUTE ON FUNCTION channel_resolve_license(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_resolve_license(TEXT, TEXT) TO nexa_app;

-- The API connects as nexa_app. Default privileges already cover new tables, but
-- grant explicitly so this migration is correct regardless of who owns it.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_identities TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_messages TO nexa_app;
