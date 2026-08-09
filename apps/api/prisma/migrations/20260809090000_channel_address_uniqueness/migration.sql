-- Channel address ownership: an address belongs to exactly one workspace
-- (NFR-S4 · NFR-S5 · FR-MOD-08.5.7).
--
-- A provider webhook is unauthenticated — the address it names as the recipient
-- is the *entire* basis on which the message is assigned to a tenant
-- (`channel_resolve_license`, 20260726120000_omnichannel_adapters). Nothing made
-- that address unique: two licenses could both connect page/number/IG account
-- `X`, the resolver would return two rows, and the service took `rows[0]` — an
-- undefined-order choice between tenants. Concretely: one workspace's customer
-- DMs opening chats in another workspace's inbox, and its agents replying to
-- them. Instagram is what made it urgent (an `ig_user_id` is public and
-- guessable, and the webhook carries no signature) but the hole is
-- channel-agnostic and equally open on messenger/twilio/whatsapp.
--
-- Two halves, both required:
--
--   1. The unique index below IS the invariant. Enforced by the database, so it
--      holds under concurrent connects and against any writer — including one
--      that never goes through ChannelService.
--   2. `channel_address_owner` lets the write path ask "who holds this address?"
--      *before* it writes. RLS deliberately hides other tenants' channels from
--      the app role, so without a SECURITY DEFINER answer the service could only
--      ever discover a conflict as an opaque constraint violation, and could not
--      tell "someone else has it" apart from "I have it" (the re-connect case).
--
-- Partial on two conditions, both load-bearing:
--
--   * `status = 'connected'` — disconnect keeps the row (its message-log history
--     outlives the connection) and only flips the status. A total index would
--     let a disconnected channel hold its address hostage forever, so no
--     workspace could ever take over an address it legitimately owns now.
--   * `config->>'address' IS NOT NULL` — the seeded `website_widget` channel is
--     `config = {}`. NULLs never collide in a unique index anyway; saying so
--     keeps the index off every address-less row and its intent readable.
--
-- Scope: `(type, address)` platform-wide, NOT per license. Two rows of the same
-- license (two brands) are a conflict too — the resolver answers with a license
-- but no brand, so a second row is exactly the ambiguity this closes.
--
-- If this migration ever fails with a uniqueness violation, that is the design:
-- two workspaces already share an address, and *which one loses it* is a support
-- decision, not something a migration may make silently.

CREATE UNIQUE INDEX "channels_connected_address_key"
  ON "channels" ("type", (config->>'address'))
  WHERE status = 'connected' AND config->>'address' IS NOT NULL;

-- The pre-tenant question the write path asks: which (license, brand) already
-- holds this address? Same small, reviewable shape as
-- `channel_resolve_license` — SECURITY DEFINER, one question, only connected
-- channels, and it returns ids the caller compares against its own rather than
-- anything it could show a user.
CREATE OR REPLACE FUNCTION channel_address_owner(p_type TEXT, p_address TEXT)
RETURNS TABLE (license_id BIGINT, brand_id UUID)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ch.license_id, ch.brand_id
  FROM channels ch
  WHERE ch.type = p_type
    AND ch.status = 'connected'
    AND ch.config->>'address' = p_address;
$$;

-- SECURITY DEFINER runs as the function owner, so EXECUTE is granted narrowly
-- and never to PUBLIC.
REVOKE EXECUTE ON FUNCTION channel_address_owner(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_address_owner(TEXT, TEXT) TO nexa_app;
