-- SAML 2.0 identity providers a license federates sign-in to (NFR-S11) — the
-- data layer for S11-a. Nothing reads this yet: the write surface is S11-a2,
-- assertion validation S11-b, the SP endpoints (`/auth/saml/{id}/login`,
-- `/acs`) S11-d. This migration creates the storage and closes it to its tenant.
--
-- The table is new. There is no SAML or SCIM anything in the pre-S11 schema; the
-- only part of federated sign-in already modelled is `accounts.password_hash`
-- being nullable ("Null for accounts that only sign in via SSO"), which is what
-- S11-d's JIT provisioning and S11-h's password shutdown will build on. No
-- second "passwordless account" concept is invented here.
--
-- License-scoped only, not brand-scoped. Multibrand widened the three settings
-- singletons that predated it; federation is not appearance or behaviour that
-- varies per brand — an identity boundary belongs to the workspace, and a brand
-- that could carry its own IdP would be a second way into the same accounts.
-- The same call `goals`, `goal_achievements` and the sales-tracker tables made.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change. The CHECK constraints and the RLS policy are invisible
-- to Prisma and are added here by hand, the same way every other tenant table
-- does.

-- CreateTable
CREATE TABLE "sso_connections" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "idp_entity_id" TEXT NOT NULL,
    "idp_sso_url" TEXT NOT NULL,
    "idp_certificate_pem" TEXT NOT NULL,
    "attribute_mapping" JSONB NOT NULL DEFAULT '{}',
    "allow_idp_initiated" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("id")
);

-- One connection per IdP within a license. Two rows carrying one EntityID would
-- make "which connection issued this assertion?" ambiguous exactly where the
-- answer decides whose certificate is allowed to verify it. The index also
-- serves the only read this table has — the connections of one license — so no
-- separate license_id index is created.
--
-- CreateIndex
CREATE UNIQUE INDEX "sso_connections_license_id_idp_entity_id_key" ON "sso_connections"("license_id", "idp_entity_id");

-- AddForeignKey
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The constraints below are storage invariants, not input validation: the write
-- endpoint (S11-a2) will reject far more than this and say why. What they buy is
-- that no path — an endpoint written later, a migration, a console session —
-- can leave behind a row that looks like a configured identity provider while
-- being unusable or unsafe as one.

-- A blank name is a row an admin cannot tell apart from another in the picker
-- S11-g renders; a blank EntityID matches every assertion's Issuer or none.
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_name_check" CHECK (char_length(btrim("name")) > 0);
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_idp_entity_id_check" CHECK (char_length(btrim("idp_entity_id")) > 0);

-- The SSO URL is handed to a browser as a redirect target (S11-d). Anchoring it
-- to an absolute http(s) URL at the storage layer closes the scheme surface —
-- `javascript:`, `data:`, a protocol-relative `//evil.example` — so a redirect
-- built from this column can never be turned into script execution on our own
-- origin, whatever the endpoint above it does or forgets to do.
--
-- Deliberately http OR https rather than https-only: requiring TLS is a policy
-- the write endpoint enforces, where a loopback IdP harness (S11-c) can be
-- excepted. Baking https into the table would make that exception a migration.
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_idp_sso_url_check" CHECK ("idp_sso_url" ~ '^https?://');

-- The certificate must at least be a PEM certificate block. Signature
-- verification (S11-b) parses it properly; this only stops a row that holds a
-- fingerprint, a private key or an empty string from sitting in the list looking
-- like a trust anchor.
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_idp_certificate_pem_check" CHECK ("idp_certificate_pem" LIKE '%-----BEGIN CERTIFICATE-----%');

-- `attribute_mapping` is read by key. A JSON scalar or array there would make
-- every lookup silently miss, which reads as "the IdP sent no e-mail" rather
-- than as the misconfiguration it is.
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_attribute_mapping_check" CHECK (jsonb_typeof("attribute_mapping") = 'object');

-- License-scoped like every other tenant table. What is behind this policy is
-- the workspace's identity boundary: a cross-tenant read hands over which IdP a
-- competitor trusts and where it lives (reconnaissance for a targeted phish),
-- and a cross-tenant write plants an identity provider — an attacker-controlled
-- certificate — against someone else's accounts. The second is the one that
-- ends in a session, which is why WITH CHECK matters as much as USING here.
ALTER TABLE sso_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY sso_connections_tenant ON sso_connections
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- No GRANT statement: the ALTER DEFAULT PRIVILEGES in 20260722090000 already
-- hands nexa_app SELECT, INSERT, UPDATE, DELETE on every table created after
-- it, and the write surface this table gets in S11-a2 needs all four.
