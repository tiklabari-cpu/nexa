-- Messenger and Instagram as real channels (tm 381 · KN-02 · FR-MOD-08.5.4 ·
-- FR-MOD-08.5.7).
--
-- Expand-only (CONVENTIONS §6.3): the one constraint replaced is replaced by a
-- wider one. Code written before this never stores a Messenger or Instagram
-- credential, so it can neither trip the wider check nor read anything it does
-- not understand.
--
-- Everything else the live channels need is already here since tm 380 and is
-- shared, not copied: `channel_messages (channel_id, provider_message_id)`
-- unique takes a Messenger / Instagram `mid` in once per channel exactly as a
-- WhatsApp wamid, `channel_identities.last_customer_message_at` runs their
-- 24-hour window, `channels.reconnect_required_at` marks a page token Meta
-- refused (Graph error 190).
--
-- channels
--   * The live-credential pair check is widened for Messenger and Instagram. A
--     live Telegram has a per-channel webhook secret (its hash beside the
--     token); the Meta channels' webhook is one per Meta app, signed with the
--     app secret from the deployment's environment, so a live Messenger or
--     Instagram row holds a page token and no hash — and may never hold a hash.
ALTER TABLE channels DROP CONSTRAINT channels_live_credential_pair_check;
ALTER TABLE channels
  ADD CONSTRAINT channels_live_credential_pair_check
    CHECK (
      CASE WHEN "type" IN ('whatsapp', 'messenger', 'instagram')
        THEN "webhook_secret_hash" IS NULL
        ELSE ("credential_ciphertext" IS NULL) = ("webhook_secret_hash" IS NULL)
      END
    );
