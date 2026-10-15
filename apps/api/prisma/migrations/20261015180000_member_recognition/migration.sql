-- Member recognition (SiyahTuş analysis ID-03 · owner decision K4 · tm 287.1 ·
-- PLAN §D240 · docs/adr/member-recognition.md).
--
-- Today the widget recognises a returning visitor by the `customer_id` it keeps
-- in localStorage, and `POST /customer/token` mints for any id it is handed:
-- whoever learns a member's id can open their conversation. K4 replaces that key
-- with a signed member token the server gives the widget — the browser keeps it
-- (a partitioned cookie, localStorage as the fallback) and a returning visitor
-- is recognised only when the signature, the expiry, the licence and the
-- revocation list all agree. A username or e-mail typed into the pre-chat form
-- never joins two records on its own; an agent may confirm that two records are
-- the same person, for the agent's own history view only.
--
-- This migration lays down the four stores that needs. Nothing writes them yet:
-- the token is minted and checked from tm 287.2, the matches and links are
-- served from tm 287.4.
--
--   1. member_token_keys — the licence's signing key, encrypted, beside the key
--      it replaced and the moment that one stops being accepted (rotation).
--   2. member_token_revocations — the revocation list: "tokens this licence
--      issued before T, for this member or for every member, are refused".
--   3. member_recognition_settings — the licence's choices: how long a token
--      lives without a visit, and whether agents see possible matches.
--   4. customer_identity_links — an agent's confirmation that two customer
--      records are the same person. Organization-scoped, like `customers`.
--
-- Expand-only (CONVENTIONS §6.3): four new tables; no existing table, column or
-- constraint changes, so a release from before this reads exactly as it did.

-- --------------------------------------------------------------------------
-- 1. member_token_keys
-- --------------------------------------------------------------------------
-- One row per licence, created by the first mint. The key itself is never in
-- the clear here: `key_ciphertext` is AES-256-GCM in the `lib/credential-
-- cipher.ts` format (`v1:<iv>:<tag>:<ciphertext>`), its additional data binding
-- it to this licence and this version, under a key-encryption key that lives in
-- the deployment's environment. A dump of this table signs nothing, and a
-- ciphertext moved to another licence's row, or swapped between the two slots,
-- does not open. The CHECK on the prefix is what stops a raw key from being
-- stored by mistake: a base64url key has no colon.
--
-- Rotation moves the current key into the `previous_*` slot with a validity
-- window, so a member whose token it signed is still recognised — and re-signed
-- under the new key — during the grace period. One slot: a second rotation
-- inside the window drops the oldest key at once, which is the point of an
-- emergency rotation. The token names the version that signed it, so a check
-- never has to try both keys.
CREATE TABLE member_token_keys (
    "license_id"               BIGINT         NOT NULL,
    "key_version"              INTEGER        NOT NULL,
    "key_ciphertext"           TEXT           NOT NULL,
    "key_created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previous_key_version"     INTEGER,
    "previous_key_ciphertext"  TEXT,
    "previous_key_valid_until" TIMESTAMPTZ(6),

    CONSTRAINT "member_token_keys_pkey" PRIMARY KEY ("license_id"),
    CONSTRAINT "member_token_keys_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT member_token_keys_version_check CHECK (key_version >= 1),
    -- The previous key is a version, a ciphertext and a deadline, or nothing.
    CONSTRAINT member_token_keys_previous_check CHECK (
      (previous_key_version IS NULL) = (previous_key_ciphertext IS NULL)
      AND (previous_key_version IS NULL) = (previous_key_valid_until IS NULL)
    ),
    CONSTRAINT member_token_keys_previous_older_check
      CHECK (previous_key_version IS NULL OR previous_key_version < key_version),
    CONSTRAINT member_token_keys_sealed_check CHECK (
      key_ciphertext ~ '^v[0-9]+:'
      AND (previous_key_ciphertext IS NULL OR previous_key_ciphertext ~ '^v[0-9]+:')
    )
);

ALTER TABLE member_token_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_token_keys_tenant ON member_token_keys
  USING (license_id = siyahtus_current_license())
  WITH CHECK (license_id = siyahtus_current_license());

-- Created by the mint, replaced in place by a rotation. Never removed by the
-- application: a licence that loses its key loses every member it recognises.
GRANT SELECT, INSERT, UPDATE ON member_token_keys TO siyahtus_app;
REVOKE DELETE, TRUNCATE ON member_token_keys FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. member_token_revocations
-- --------------------------------------------------------------------------
-- Member tokens are signed, not stored — one row per browser that ever opened
-- the widget would dwarf the conversations — so a token cannot be revoked by
-- id. A row here revokes by issue time instead: every token this licence issued
-- before `revoked_at` for `customer_id` (an agent or admin forgetting one
-- member's browsers), or for every member when `customer_id` is NULL (the
-- settings screen's bulk revoke), is refused, and that browser's next mint
-- gets a new anonymous identity. The check is the latest matching row, which
-- the index below answers from its leading columns for both cases.
--
-- Append-only for the application: a revocation is not taken back. Rows go
-- with their licence or their customer (GDPR erasure), nothing else.
CREATE TABLE member_token_revocations (
    "id"          UUID           NOT NULL,
    "license_id"  BIGINT         NOT NULL,
    "customer_id" UUID,
    "revoked_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- The account that revoked, NULL for the system. No foreign key: the audit
    -- trail is the record of who did what, and it outlives the account.
    "revoked_by"  UUID,

    CONSTRAINT "member_token_revocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "member_token_revocations_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "member_token_revocations_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "member_token_revocations_license_id_customer_id_revoked_at_idx"
  ON "member_token_revocations"("license_id", "customer_id", "revoked_at");

ALTER TABLE member_token_revocations ENABLE ROW LEVEL SECURITY;
-- The member named must be one of this licence's organization's customers. A
-- revocation for someone else's customer would refuse nothing (no token of
-- theirs is signed by this licence's key), but a row that cannot be true is
-- refused rather than kept.
CREATE POLICY member_token_revocations_tenant ON member_token_revocations
  USING (license_id = siyahtus_current_license())
  WITH CHECK (
    license_id = siyahtus_current_license()
    AND (
      customer_id IS NULL
      OR EXISTS (
        SELECT 1 FROM customers c
        WHERE c.id = member_token_revocations.customer_id
          AND c.organization_id = siyahtus_current_organization()
      )
    )
  );

GRANT SELECT, INSERT ON member_token_revocations TO siyahtus_app;
REVOKE UPDATE, DELETE, TRUNCATE ON member_token_revocations FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 3. member_recognition_settings
-- --------------------------------------------------------------------------
-- Settings › Security › "Member recognition". A licence singleton rather than a
-- brand one: the token and its key belong to the licence, and a member — an
-- organization-level customer — is the same person on every brand's site. Like
-- `inbox_settings`, no row until the first save; a read with no row gets these
-- column defaults, which `@siyahtus/types` `MEMBER_TOKEN_TTL` mirrors.
--
--   * token_ttl_seconds — how long a token lives without a visit. Sliding: each
--     mint re-signs it for this long. 1 day at least, so a member is still the
--     same member for the rest of the day (ID-02's daily thread); a year at most.
--   * possible_matches_enabled — whether agents see other customers with the
--     same pre-chat username or e-mail, marked unverified.
CREATE TABLE member_recognition_settings (
    "license_id"               BIGINT         NOT NULL,
    "token_ttl_seconds"        INTEGER        NOT NULL DEFAULT 2592000,
    "possible_matches_enabled" BOOLEAN        NOT NULL DEFAULT true,
    "updated_at"               TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "member_recognition_settings_pkey" PRIMARY KEY ("license_id"),
    CONSTRAINT "member_recognition_settings_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT member_recognition_settings_ttl_check
      CHECK (token_ttl_seconds BETWEEN 86400 AND 31536000)
);

ALTER TABLE member_recognition_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_recognition_settings_tenant ON member_recognition_settings
  USING (license_id = siyahtus_current_license())
  WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT, INSERT, UPDATE ON member_recognition_settings TO siyahtus_app;
REVOKE DELETE, TRUNCATE ON member_recognition_settings FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 4. customer_identity_links
-- --------------------------------------------------------------------------
-- A member who arrives from another device, or from a browser that dropped its
-- token, is a new customer. An agent who recognises them confirms it here
-- (team lead and above; admin and above until RL-01 adds the role). The link
-- joins the agent's history view only: the day's conversation (ID-02) and the
-- AI's memory stay keyed by the customer number, so a linked record's
-- conversations never reach the AI.
--
-- One row per pair, in canonical order — `customer_a_id < customer_b_id`, which
-- is also what refuses a link to oneself — so "A with B" and "B with A" are the
-- same row and the unique key holds both directions. Writers should order the
-- pair in SQL (`LEAST`/`GREATEST` on the uuids) rather than in application code.
-- Unlinking stamps `unlinked_at` + `unlinked_by` (both or neither); linking the
-- pair again clears them. Who linked and when lives on the row so the panel can
-- say so; every link and unlink is also an audit entry.
CREATE TABLE customer_identity_links (
    "id"              UUID           NOT NULL,
    "organization_id" UUID           NOT NULL,
    "customer_a_id"   UUID           NOT NULL,
    "customer_b_id"   UUID           NOT NULL,
    -- Account ids, no foreign key — the same reason as `revoked_by` above.
    "linked_by"       UUID           NOT NULL,
    "linked_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinked_by"     UUID,
    "unlinked_at"     TIMESTAMPTZ(6),

    CONSTRAINT "customer_identity_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_identity_links_customer_a_id_fkey"
      FOREIGN KEY ("customer_a_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "customer_identity_links_customer_b_id_fkey"
      FOREIGN KEY ("customer_b_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT customer_identity_links_order_check CHECK (customer_a_id < customer_b_id),
    CONSTRAINT customer_identity_links_unlinked_check
      CHECK ((unlinked_at IS NULL) = (unlinked_by IS NULL))
);

CREATE UNIQUE INDEX "customer_identity_links_customer_a_id_customer_b_id_key"
  ON "customer_identity_links"("customer_a_id", "customer_b_id");
CREATE INDEX "customer_identity_links_customer_b_id_idx"
  ON "customer_identity_links"("customer_b_id");

ALTER TABLE customer_identity_links ENABLE ROW LEVEL SECURITY;
-- Reading needs only the organization. Writing also needs both customers to be
-- this organization's: a link is the one row here that names two people, and a
-- link to someone in another workspace is the cross-tenant join this whole
-- feature exists to keep out. The subqueries run under `customers_tenant` too.
CREATE POLICY customer_identity_links_tenant ON customer_identity_links
  USING (organization_id = siyahtus_current_organization())
  WITH CHECK (
    organization_id = siyahtus_current_organization()
    AND EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = customer_identity_links.customer_a_id
        AND c.organization_id = siyahtus_current_organization()
    )
    AND EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = customer_identity_links.customer_b_id
        AND c.organization_id = siyahtus_current_organization()
    )
  );

-- Linked, unlinked and relinked by UPDATE; a row leaves only with a customer.
GRANT SELECT, INSERT, UPDATE ON customer_identity_links TO siyahtus_app;
REVOKE DELETE, TRUNCATE ON customer_identity_links FROM siyahtus_app;
