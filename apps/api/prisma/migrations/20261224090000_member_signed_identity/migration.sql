-- Operator-signed member identity (SiyahTuş analysis ID-03, the operator's way
-- in · owner decision K28 · tm 388 · PLAN §D446 ·
-- docs/adr/member-recognition.md §11).
--
-- K4 (tm 287) recognises a returning *browser* by a member token SiyahTuş
-- signs; the same player on another device is a new customer until an agent
-- links the two. K28 adds the second way in K4 kept for later: the operator's
-- server signs the logged-in member's id with a secret only it and SiyahTuş
-- hold, the page hands the signature to the widget (`siyahtus('identify', …)`),
-- and `POST /customer/token` checks it. A valid one makes the visitor the
-- customer that carries that id, on every device.
--
--   1. member_recognition_settings.signed_identity_enabled — the switch, off.
--      Until a workspace turns it on *and* issues a secret, an identify call is
--      ignored and the K4 flow is exactly what it was.
--   2. member_identity_secrets — the workspace's identity secret, sealed, beside
--      the one a rotation is phasing out. The `member_token_keys` pattern, as a
--      separate table: the two keys have different owners (one is SiyahTuş's
--      alone, the other is shared with the operator's server) and must never be
--      the same key or rotate together.
--   3. customers.platform_user_id + identity_verified_at — the verified member
--      id and when it was last vouched for; username_verified — the username
--      came from the signed identity, not the player's typing.
--
-- Expand-only (CONVENTIONS §6.3): one new table, new nullable or defaulted
-- columns; nothing existing changes meaning, so a release from before this
-- reads exactly as it did. The uniqueness of a member id per organization is
-- the next migration's index, alone in its file because it is built
-- CONCURRENTLY.

-- --------------------------------------------------------------------------
-- 1. The switch
-- --------------------------------------------------------------------------
-- A constant default: Postgres 11+ stores it in the catalogue and rewrites no
-- row. A workspace with no settings row reads the same `false` (the read's
-- fallback, `member-recognition.ts`).
ALTER TABLE "member_recognition_settings"
    ADD COLUMN "signed_identity_enabled" BOOLEAN NOT NULL DEFAULT false;

-- --------------------------------------------------------------------------
-- 2. member_identity_secrets
-- --------------------------------------------------------------------------
-- One row per licence, created by the first "Issue secret". The secret is never
-- in the clear here: `secret_ciphertext` is AES-256-GCM in the
-- `lib/credential-cipher.ts` format (`v1:<iv>:<tag>:<ciphertext>`), its
-- additional data binding it to this licence and this version, under a
-- key-encryption key derived from the deployment's environment with its own
-- label — a dump of this table verifies no signature, and a ciphertext moved
-- to another licence's row or swapped between the slots does not open. The
-- prefix CHECK stops a raw secret from being stored by mistake: `sti_…` has no
-- colon after a `v<n>`.
--
-- Rotation moves the current secret into the `previous_*` slot with a deadline,
-- so signatures the operator's servers still make with it are accepted while
-- the new one is deployed. One slot: rotating again inside the window drops
-- the oldest secret at once.
CREATE TABLE "member_identity_secrets" (
    "license_id"                  BIGINT         NOT NULL,
    "secret_version"              INTEGER        NOT NULL,
    "secret_ciphertext"           TEXT           NOT NULL,
    "secret_created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previous_secret_version"     INTEGER,
    "previous_secret_ciphertext"  TEXT,
    "previous_secret_valid_until" TIMESTAMPTZ(6),

    CONSTRAINT "member_identity_secrets_pkey" PRIMARY KEY ("license_id"),
    CONSTRAINT "member_identity_secrets_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT member_identity_secrets_version_check CHECK (secret_version >= 1),
    -- The previous secret is a version, a ciphertext and a deadline, or nothing.
    CONSTRAINT member_identity_secrets_previous_check CHECK (
      (previous_secret_version IS NULL) = (previous_secret_ciphertext IS NULL)
      AND (previous_secret_version IS NULL) = (previous_secret_valid_until IS NULL)
    ),
    CONSTRAINT member_identity_secrets_previous_older_check
      CHECK (previous_secret_version IS NULL OR previous_secret_version < secret_version),
    CONSTRAINT member_identity_secrets_sealed_check CHECK (
      secret_ciphertext ~ '^v[0-9]+:'
      AND (previous_secret_ciphertext IS NULL OR previous_secret_ciphertext ~ '^v[0-9]+:')
    )
);

ALTER TABLE "member_identity_secrets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_identity_secrets_tenant ON "member_identity_secrets"
  USING (license_id = siyahtus_current_license())
  WITH CHECK (license_id = siyahtus_current_license());

-- Issued and replaced in place. Never removed by the application: turning the
-- feature off is the switch, and a leaked secret is retired by a rotation with
-- no grace.
GRANT SELECT, INSERT, UPDATE ON "member_identity_secrets" TO siyahtus_app;
REVOKE DELETE, TRUNCATE ON "member_identity_secrets" FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 3. The verified member on the customer
-- --------------------------------------------------------------------------
-- `platform_user_id` is the operator's own id for the member, exactly as
-- signed; it finds the customer (next migration's unique index, per
-- organization — a member of one workspace is nobody in another).
-- `identity_verified_at` is the last time a valid signature named it: the two
-- are set together or not at all. `username_verified` says the username on the
-- record is the one the operator signed — only a verified member has one, and
-- an agent editing the username clears it (`routes/customers.ts`).
--
-- No RLS change: `customers` carries its organization policy, and new columns
-- inherit it. The CHECKs scan `customers` once under this migration's lock —
-- the new columns are NULL/false everywhere, so they hold trivially, and at the
-- pilot's size the scan is milliseconds (the 20261015160000 precedent).
ALTER TABLE "customers"
    ADD COLUMN "platform_user_id" TEXT,
    ADD COLUMN "identity_verified_at" TIMESTAMPTZ(6),
    ADD COLUMN "username_verified" BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT "customers_platform_identity_check"
        CHECK (("platform_user_id" IS NULL) = ("identity_verified_at" IS NULL)),
    ADD CONSTRAINT "customers_platform_user_id_check"
        CHECK (
          "platform_user_id" IS NULL
          OR (char_length("platform_user_id") BETWEEN 1 AND 128
              AND "platform_user_id" !~ '[[:cntrl:]]')
        ),
    ADD CONSTRAINT "customers_username_verified_check"
        CHECK (NOT "username_verified" OR "platform_user_id" IS NOT NULL);
