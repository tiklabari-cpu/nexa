-- WhatsApp as a real Cloud API channel (tm 380 · KN-01 · FR-MOD-08.5.6).
--
-- Expand-only (CONVENTIONS §6.3): every new column is nullable, the new table
-- is new, and the one constraint replaced is replaced by a wider one. Code
-- written before this never stores a WhatsApp credential, so it can neither
-- trip the wider check nor read anything it does not understand.
--
-- channels
--   * reconnect_required_at — when Meta last refused the channel's business
--     token (Graph error 190: expired, revoked, the password changed). Set
--     once per lapse, cleared by a reconnect; the Settings card reads it as
--     "reconnect needed" and its first setting is what mails the admins.
--   * The live-credential pair check is widened for WhatsApp. A live Telegram
--     has a per-channel webhook secret (its hash beside the token); WhatsApp's
--     webhook is one per Meta app, signed with the app secret from the
--     deployment's environment, so a live WhatsApp row holds a token and no
--     hash — and may never hold a hash.
ALTER TABLE channels
  ADD COLUMN "reconnect_required_at" TIMESTAMPTZ(6);

ALTER TABLE channels DROP CONSTRAINT channels_live_credential_pair_check;
ALTER TABLE channels
  ADD CONSTRAINT channels_live_credential_pair_check
    CHECK (
      CASE WHEN "type" = 'whatsapp'
        THEN "webhook_secret_hash" IS NULL
        ELSE ("credential_ciphertext" IS NULL) = ("webhook_secret_hash" IS NULL)
      END
    );

-- channel_messages
--   * channel_id — the channel row the message crossed (soft reference, like
--     chat_id: the log outlives a reconnect). Null for every row written
--     before this and for the mock adapters.
--   * (channel_id, provider_message_id) unique — a WhatsApp message id (wamid)
--     is taken in once per channel however often Meta delivers it. NULLs are
--     distinct, so the mock rows (no channel id) are untouched.
--   * status / status_at — what Meta last said about an outbound message:
--     sent → delivered → read, or failed. Forward only (the service decides).
ALTER TABLE channel_messages
  ADD COLUMN "channel_id" UUID,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "status_at" TIMESTAMPTZ(6);

ALTER TABLE channel_messages
  ADD CONSTRAINT channel_messages_status_check
    CHECK ("status" IS NULL OR "status" IN ('sent', 'delivered', 'read', 'failed'));
ALTER TABLE channel_messages
  ADD CONSTRAINT channel_messages_status_pair_check
    CHECK (("status" IS NULL) = ("status_at" IS NULL));

CREATE UNIQUE INDEX "channel_messages_channel_id_provider_message_id_key"
    ON "channel_messages"("channel_id", "provider_message_id");

-- channel_identities
--   * last_customer_message_at — when this sender last wrote to the workspace
--     on this channel: WhatsApp's 24-hour customer-service window runs from it,
--     per sender and business number, whichever chat the message landed in.
ALTER TABLE channel_identities
  ADD COLUMN "last_customer_message_at" TIMESTAMPTZ(6);

-- whatsapp_inbound_events — the webhook's durable inbox.
--
-- Meta wants a quick 200 and retries for days when it does not get one. The
-- webhook checks the signature, resolves the workspace, writes one row per
-- message or status here and answers; the slow part (a media download, the
-- chat write) happens after, and a row a crash left behind is taken again by
-- the sweep. `dedup_key` is `m:<wamid>` for a message and `s:<wamid>:<status>`
-- for a status, so a redelivered webhook adds nothing.
--
-- `payload` is the normalised item with its text already masked (AI-26): no raw
-- card number waits in a queue. It is emptied once the row is done.
CREATE TABLE "whatsapp_inbound_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "license_id" BIGINT NOT NULL,
    "channel_id" UUID NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "whatsapp_inbound_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_inbound_events_channel_id_dedup_key_key"
    ON "whatsapp_inbound_events"("channel_id", "dedup_key");
CREATE INDEX "whatsapp_inbound_events_license_id_state_next_attempt_at_idx"
    ON "whatsapp_inbound_events"("license_id", "state", "next_attempt_at");

ALTER TABLE "whatsapp_inbound_events" ADD CONSTRAINT "whatsapp_inbound_events_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_inbound_events" ADD CONSTRAINT "whatsapp_inbound_events_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE whatsapp_inbound_events
  ADD CONSTRAINT whatsapp_inbound_events_kind_check CHECK ("kind" IN ('message', 'status'));
ALTER TABLE whatsapp_inbound_events
  ADD CONSTRAINT whatsapp_inbound_events_state_check
    CHECK ("state" IN ('pending', 'done', 'failed'));
ALTER TABLE whatsapp_inbound_events
  ADD CONSTRAINT whatsapp_inbound_events_dedup_key_check
    CHECK ("dedup_key" ~ '^(m:[^:]{1,255}|s:[^:]{1,255}:(sent|delivered|read|failed))$');
-- A code, never text from the message (`whatsapp-inbound.ts`).
ALTER TABLE whatsapp_inbound_events
  ADD CONSTRAINT whatsapp_inbound_events_last_error_check
    CHECK ("last_error" IS NULL OR "last_error" ~ '^[a-z][a-z0-9_]{0,63}$');
ALTER TABLE whatsapp_inbound_events
  ADD CONSTRAINT whatsapp_inbound_events_done_check
    CHECK (("state" = 'pending') = ("processed_at" IS NULL));

ALTER TABLE whatsapp_inbound_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_inbound_events_tenant ON whatsapp_inbound_events
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_inbound_events TO siyahtus_app;

-- The webhook names a business phone number id (`metadata.phone_number_id`),
-- and no session exists when Meta calls — so, like `channel_resolve_license`,
-- the id resolves to a workspace before any tenant context is set. Only a
-- connected, live WhatsApp channel answers; the answer is ids, never the token.
CREATE OR REPLACE FUNCTION whatsapp_resolve_phone_number(p_phone_number_id TEXT)
RETURNS TABLE (
  license_id BIGINT,
  organization_id UUID,
  license_status TEXT,
  channel_id UUID
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ch.license_id, l.organization_id, l.status, ch.id
  FROM channels ch
  JOIN licenses l ON l.id = ch.license_id
  WHERE ch.type = 'whatsapp'
    AND ch.status = 'connected'
    AND ch.credential_ciphertext IS NOT NULL
    AND ch.config->>'address' = p_phone_number_id;
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_resolve_phone_number(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_resolve_phone_number(TEXT) TO siyahtus_app;

-- The sweep's one cross-tenant read: which workspaces have inbound rows that
-- are due (new, or left behind by a crash). Every read and write after it runs
-- inside that workspace's tenant context.
CREATE OR REPLACE FUNCTION whatsapp_inbound_due_tenants(p_limit INTEGER)
RETURNS TABLE (license_id BIGINT, organization_id UUID)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT e.license_id, l.organization_id
  FROM whatsapp_inbound_events e
  JOIN licenses l ON l.id = e.license_id
  WHERE e.state = 'pending'
    AND e.next_attempt_at <= now()
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

REVOKE EXECUTE ON FUNCTION whatsapp_inbound_due_tenants(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_inbound_due_tenants(INTEGER) TO siyahtus_app;
