-- Live Apps connections and the live Telegram channel (tm 263).
--
-- Expand-only (CONVENTIONS §6.3). Every column is nullable or defaulted, no
-- existing row is rewritten, and no constraint is narrowed: an installation
-- written before this keeps reading exactly as it did. A mock install of a card
-- the deployment later switches live still holds only `api_key_hash`, which
-- cannot be presented to the provider — the service reads such a row as
-- "reconnect needed" (status `needs_reconnect` in the API) and never deletes it.
--
-- app_installations
--   * credential_ciphertext — the provider credential, AES-256-GCM under
--     APPS_CREDENTIAL_KEY (`lib/credential-cipher.ts`), bound to this row by
--     its additional data (`app:<license>:<app>`). The key lives in the
--     deployment's environment, never here: a dump of this table opens nothing.
--   * credential_config — the non-secret half of a credential (Freshdesk's
--     subdomain), kept in the clear so it can be shown and re-used.
--   * verified_at — when the provider last accepted the credential.
--   * live — set exactly when a credential is held (the CHECK below), so
--     "live" can never describe a row with nothing to present.
ALTER TABLE app_installations
  ADD COLUMN "credential_ciphertext" TEXT,
  ADD COLUMN "credential_config" JSONB,
  ADD COLUMN "verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "live" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE app_installations
  ADD CONSTRAINT app_installations_live_credential_check
    CHECK ("live" = ("credential_ciphertext" IS NOT NULL)),
  ADD CONSTRAINT app_installations_live_verified_check
    CHECK (NOT "live" OR "verified_at" IS NOT NULL);

-- channels
--   * credential_ciphertext — a live Telegram bot token, encrypted like the
--     above and bound to `channel:<license>:<channel id>`. The mock adapters
--     still never persist a token (`channel-adapter.ts`: config holds no secret).
--   * webhook_secret_hash — SHA-256 of the `secret_token` handed to Telegram's
--     setWebhook. Telegram presents it on every update; the hash is what the
--     public webhook compares against, so the database never holds a value that
--     would let a reader forge an update.
-- Both or neither: a token with no webhook secret would be a channel whose
-- inbound door cannot be authenticated.
ALTER TABLE channels
  ADD COLUMN "credential_ciphertext" TEXT,
  ADD COLUMN "webhook_secret_hash" TEXT;

ALTER TABLE channels
  ADD CONSTRAINT channels_live_credential_pair_check
    CHECK (("credential_ciphertext" IS NULL) = ("webhook_secret_hash" IS NULL));

-- The live Telegram webhook names its channel by id in the path
-- (`/channels/telegram/webhook/{id}`), and no session exists when Telegram calls
-- — so, like `channel_resolve_license`, the id must resolve before any tenant
-- context is set. One question, SECURITY DEFINER, only a connected channel with
-- a webhook secret answers, and the answer is the hash (never the token).
CREATE OR REPLACE FUNCTION channel_webhook_target(p_channel_id UUID)
RETURNS TABLE (
  license_id BIGINT,
  organization_id UUID,
  license_status TEXT,
  channel_type TEXT,
  address TEXT,
  webhook_secret_hash TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ch.license_id, l.organization_id, l.status, ch.type, ch.config->>'address',
         ch.webhook_secret_hash
  FROM channels ch
  JOIN licenses l ON l.id = ch.license_id
  WHERE ch.id = p_channel_id
    AND ch.status = 'connected'
    AND ch.webhook_secret_hash IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION channel_webhook_target(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_webhook_target(UUID) TO siyahtus_app;
