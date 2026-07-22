-- Tenancy, authentication and the customer/trusted-domain tables the
-- widget token endpoint depends on (slice 2).
--
-- Table DDL is Prisma-generated from schema.prisma; everything after the
-- 'Tenant isolation' banner is hand-written, because row level security,
-- CHECK constraints and SECURITY DEFINER functions have no Prisma syntax
-- and are the part that actually enforces isolation.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'eu',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'growth',
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "trial_ends_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "password_hash" TEXT,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memberships" (
    "license_id" BIGINT NOT NULL,
    "agent_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "routing_status" TEXT NOT NULL DEFAULT 'offline',
    "concurrent_chats_limit" INTEGER NOT NULL DEFAULT 6,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "awaiting_approval" BOOLEAN NOT NULL DEFAULT false,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "last_assigned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_memberships_pkey" PRIMARY KEY ("license_id","agent_id")
);

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "secret_hash" TEXT,
    "redirect_uris" TEXT[],
    "client_type" TEXT NOT NULL DEFAULT 'public',
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "organization_id" UUID NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scopes" TEXT[],
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL DEFAULT 'S256',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("code_hash")
);

-- CreateTable
CREATE TABLE "oauth_refresh_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "organization_id" UUID NOT NULL,
    "scopes" TEXT[],
    "family_id" UUID NOT NULL,
    "replaced_by_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT,
    "email" CITEXT,
    "phone" TEXT,
    "country_code" CHAR(2),
    "country" TEXT,
    "is_lead" BOOLEAN NOT NULL DEFAULT false,
    "chats_count" INTEGER NOT NULL DEFAULT 0,
    "tickets_count" INTEGER NOT NULL DEFAULT 0,
    "last_activity_at" TIMESTAMPTZ(6),
    "banned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_domains" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "domain" TEXT NOT NULL,
    "include_subdomains" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "name" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "client_id" TEXT,
    "family_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "licenses_organization_id_idx" ON "licenses"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "agent_memberships_agent_id_idx" ON "agent_memberships"("agent_id");

-- CreateIndex
CREATE INDEX "oauth_clients_organization_id_idx" ON "oauth_clients"("organization_id");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_expires_at_idx" ON "oauth_authorization_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_refresh_tokens_token_hash_key" ON "oauth_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_refresh_tokens_family_id_idx" ON "oauth_refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "oauth_refresh_tokens_account_id_idx" ON "oauth_refresh_tokens"("account_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_last_activity_at_idx" ON "customers"("organization_id", "last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "customers_organization_id_email_idx" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE INDEX "trusted_domains_license_id_idx" ON "trusted_domains"("license_id");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_domains_organization_id_domain_key" ON "trusted_domains"("organization_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_license_id_kind_idx" ON "api_tokens"("license_id", "kind");

-- CreateIndex
CREATE INDEX "api_tokens_owner_id_idx" ON "api_tokens"("owner_id");

-- CreateIndex
CREATE INDEX "api_tokens_family_id_idx" ON "api_tokens"("family_id");

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memberships" ADD CONSTRAINT "agent_memberships_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memberships" ADD CONSTRAINT "agent_memberships_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation (NFR-S4) + domain CHECK constraints.
--
-- The application always filters by license/organization. This migration makes
-- the database enforce the same thing independently, so a forgotten WHERE
-- clause is an empty result set rather than a cross-tenant data leak.
--
-- How it works
-- ------------
-- The API opens a transaction, sets `app.current_license` / `app.current_organization`
-- with SET LOCAL, and runs its queries. Every policy compares the row's tenant
-- to those settings.
--
-- `current_setting(..., true)` returns NULL when the setting is absent, and
-- `tenant = NULL` is NULL, not true — so a query that forgets to establish a
-- tenant context sees **zero rows**. Fail-closed is the whole point: the
-- dangerous failure mode is a query that silently sees everything.
--
-- RLS is ENABLEd but not FORCEd. Postgres exempts the table owner, which is what
-- lets migrations and the seed script work; the API connects as `nexa_app`,
-- which is neither owner nor superuser and is therefore fully subject to the
-- policies. `apps/api/test/integration/tenant-isolation.test.ts` asserts this
-- rather than trusting it.

-- ---------------------------------------------------------------------------
-- License ids
-- ---------------------------------------------------------------------------
-- PRD §8.4 models licenses with a bigint id rather than a uuid. A sequence
-- starting well above zero keeps ids visually distinct from row counts and
-- test fixtures.
-- BIGSERIAL above already created licenses_id_seq and wired the default; this
-- only moves where it counts from, so Prisma still sees a plain autoincrement
-- column and does not report drift on every subsequent migration.
--
-- Both START WITH and RESTART WITH are needed: RESTART alone moves the current
-- value, but TRUNCATE ... RESTART IDENTITY resets to START WITH — so without
-- the former, the first truncate silently drops licence ids back to 1.
ALTER SEQUENCE licenses_id_seq START WITH 1000001 RESTART WITH 1000001;
GRANT USAGE, SELECT ON SEQUENCE licenses_id_seq TO nexa_app;

-- ---------------------------------------------------------------------------
-- Domain constraints (PRD §8.4 "CHECK kısıtları")
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD CONSTRAINT organizations_region_check CHECK (region IN ('eu'));

ALTER TABLE licenses
  ADD CONSTRAINT licenses_billing_cycle_check CHECK (billing_cycle IN ('monthly', 'annual')),
  ADD CONSTRAINT licenses_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'read_only', 'canceled'));

ALTER TABLE agent_memberships
  ADD CONSTRAINT agent_memberships_role_check
    CHECK (role IN ('owner', 'viceowner', 'admin', 'agent')),
  ADD CONSTRAINT agent_memberships_routing_status_check
    CHECK (routing_status IN ('accepting_chats', 'not_accepting_chats', 'offline')),
  ADD CONSTRAINT agent_memberships_concurrent_limit_check
    CHECK (concurrent_chats_limit BETWEEN 1 AND 100);

ALTER TABLE oauth_clients
  ADD CONSTRAINT oauth_clients_type_check CHECK (client_type IN ('public', 'confidential')),
  -- A confidential client without a secret would authenticate as a public one.
  ADD CONSTRAINT oauth_clients_secret_required_check
    CHECK (client_type = 'public' OR secret_hash IS NOT NULL),
  ADD CONSTRAINT oauth_clients_redirect_uris_check CHECK (cardinality(redirect_uris) > 0);

-- OAuth 2.1 removes `plain`; only S256 is acceptable.
ALTER TABLE oauth_authorization_codes
  ADD CONSTRAINT oauth_codes_challenge_method_check CHECK (code_challenge_method = 'S256');

ALTER TABLE api_tokens
  ADD CONSTRAINT api_tokens_kind_check CHECK (kind IN ('pat', 'oauth', 'bot'));

-- Exactly one owner per license. A partial unique index expresses this without
-- forbidding the other roles from repeating.
CREATE UNIQUE INDEX uq_license_single_owner
  ON agent_memberships (license_id)
  WHERE role = 'owner';

-- ---------------------------------------------------------------------------
-- Tenant context helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nexa_current_license() RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_license', true), '')::BIGINT;
$$;

CREATE OR REPLACE FUNCTION nexa_current_organization() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_organization', true), '')::UUID;
$$;

GRANT EXECUTE ON FUNCTION nexa_current_license() TO nexa_app;
GRANT EXECUTE ON FUNCTION nexa_current_organization() TO nexa_app;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant ON organizations
  USING (id = nexa_current_organization())
  WITH CHECK (id = nexa_current_organization());

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY licenses_tenant ON licenses
  USING (organization_id = nexa_current_organization())
  WITH CHECK (organization_id = nexa_current_organization());

ALTER TABLE agent_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_memberships_tenant ON agent_memberships
  USING (license_id = nexa_current_license())
  WITH CHECK (license_id = nexa_current_license());

-- `accounts` is global by design: one person may work for several licenses
-- (PRD §8.4). Visibility is therefore derived from shared membership rather
-- than from a column on the row.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounts_tenant ON accounts
  USING (
    EXISTS (
      SELECT 1 FROM agent_memberships m
      WHERE m.agent_id = accounts.id
        AND m.license_id = nexa_current_license()
    )
  );

-- Inserting a brand new person (an invite) happens before the membership row
-- exists, so INSERT is separated from the visibility rule above.
CREATE POLICY accounts_insert ON accounts FOR INSERT
  WITH CHECK (nexa_current_license() IS NOT NULL);

CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM agent_memberships m
      WHERE m.agent_id = accounts.id
        AND m.license_id = nexa_current_license()
    )
  );

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_clients_tenant ON oauth_clients
  USING (organization_id = nexa_current_organization())
  WITH CHECK (organization_id = nexa_current_organization());

ALTER TABLE oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_codes_tenant ON oauth_authorization_codes
  USING (organization_id = nexa_current_organization())
  WITH CHECK (organization_id = nexa_current_organization());

ALTER TABLE oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_refresh_tokens_tenant ON oauth_refresh_tokens
  USING (organization_id = nexa_current_organization())
  WITH CHECK (organization_id = nexa_current_organization());

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_tokens_tenant ON api_tokens
  USING (license_id = nexa_current_license())
  WITH CHECK (license_id = nexa_current_license());

-- ---------------------------------------------------------------------------
-- Authentication bootstrap
-- ---------------------------------------------------------------------------
-- RLS creates a chicken-and-egg problem: resolving a bearer token is what tells
-- us the tenant, but the policies need the tenant to let us read the token.
--
-- Rather than exempting whole tables, the pre-authentication path goes through
-- these SECURITY DEFINER functions. Each answers exactly one question, returns
-- only the columns the caller needs, and is the complete list of ways to read
-- data without a tenant context — a small, reviewable hole instead of a large one.

CREATE OR REPLACE FUNCTION auth_resolve_token(p_token_hash TEXT)
RETURNS TABLE (
  id UUID,
  license_id BIGINT,
  organization_id UUID,
  owner_id TEXT,
  kind TEXT,
  scopes TEXT[],
  client_id TEXT,
  family_id UUID,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  license_status TEXT,
  organization_region TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.license_id, t.organization_id, t.owner_id, t.kind, t.scopes,
         t.client_id, t.family_id, t.expires_at, t.revoked_at,
         l.status, o.region
  FROM api_tokens t
  JOIN licenses l ON l.id = t.license_id
  JOIN organizations o ON o.id = t.organization_id
  WHERE t.token_hash = p_token_hash;
$$;

CREATE OR REPLACE FUNCTION auth_find_account_for_login(p_email CITEXT)
RETURNS TABLE (id UUID, email CITEXT, name TEXT, password_hash TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.email, a.name, a.password_hash
  FROM accounts a
  WHERE a.email = p_email;
$$;

-- Memberships an account can sign in to. Suspended and unapproved memberships
-- are filtered out here so no caller can forget to.
CREATE OR REPLACE FUNCTION auth_list_memberships(p_account_id UUID)
RETURNS TABLE (
  license_id BIGINT,
  organization_id UUID,
  role TEXT,
  license_status TEXT,
  organization_name TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.license_id, l.organization_id, m.role, l.status, o.name
  FROM agent_memberships m
  JOIN licenses l ON l.id = m.license_id
  JOIN organizations o ON o.id = l.organization_id
  WHERE m.agent_id = p_account_id
    AND NOT m.suspended
    AND NOT m.awaiting_approval
  ORDER BY m.license_id;
$$;

CREATE OR REPLACE FUNCTION auth_find_client(p_client_id TEXT)
RETURNS TABLE (
  id TEXT,
  organization_id UUID,
  display_name TEXT,
  secret_hash TEXT,
  redirect_uris TEXT[],
  client_type TEXT,
  scopes TEXT[]
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.organization_id, c.display_name, c.secret_hash,
         c.redirect_uris, c.client_type, c.scopes
  FROM oauth_clients c
  WHERE c.id = p_client_id;
$$;

-- Consuming an authorization code must be atomic: two concurrent redemptions of
-- the same code must not both succeed. The UPDATE ... WHERE consumed_at IS NULL
-- makes the database the arbiter — exactly one caller gets a row back.
CREATE OR REPLACE FUNCTION auth_consume_authorization_code(p_code_hash TEXT)
RETURNS TABLE (
  client_id TEXT,
  account_id UUID,
  license_id BIGINT,
  organization_id UUID,
  redirect_uri TEXT,
  scopes TEXT[],
  code_challenge TEXT,
  expires_at TIMESTAMPTZ,
  was_already_consumed BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing oauth_authorization_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM oauth_authorization_codes c WHERE c.code_hash = p_code_hash;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_existing.consumed_at IS NOT NULL THEN
    -- Replay. Reported rather than hidden so the caller can revoke anything
    -- already issued against this code (OAuth 2.1 §4.1.3).
    RETURN QUERY SELECT v_existing.client_id, v_existing.account_id, v_existing.license_id,
                        v_existing.organization_id, v_existing.redirect_uri, v_existing.scopes,
                        v_existing.code_challenge, v_existing.expires_at, TRUE;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE oauth_authorization_codes c
     SET consumed_at = now()
   WHERE c.code_hash = p_code_hash
     AND c.consumed_at IS NULL
  RETURNING c.client_id, c.account_id, c.license_id, c.organization_id,
            c.redirect_uri, c.scopes, c.code_challenge, c.expires_at, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION auth_resolve_refresh_token(p_token_hash TEXT)
RETURNS TABLE (
  id UUID,
  client_id TEXT,
  account_id UUID,
  license_id BIGINT,
  organization_id UUID,
  scopes TEXT[],
  family_id UUID,
  replaced_by_id UUID,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.client_id, r.account_id, r.license_id, r.organization_id,
         r.scopes, r.family_id, r.replaced_by_id, r.expires_at, r.revoked_at
  FROM oauth_refresh_tokens r
  WHERE r.token_hash = p_token_hash;
$$;

-- Reuse of a rotated refresh token means the token was captured. Refusing the
-- one request is not enough — the attacker may hold newer tokens too, so the
-- entire family dies, along with the access tokens minted from it.
CREATE OR REPLACE FUNCTION auth_revoke_refresh_family(p_family_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE oauth_refresh_tokens SET revoked_at = now()
   WHERE family_id = p_family_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE api_tokens SET revoked_at = now()
   WHERE family_id = p_family_id AND revoked_at IS NULL;

  RETURN v_count;
END;
$$;

-- Touching last_used_at on every request would otherwise need a tenant context
-- during authentication, before one exists.
CREATE OR REPLACE FUNCTION auth_touch_token(p_token_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE api_tokens SET last_used_at = now() WHERE id = p_token_id;
$$;

-- SECURITY DEFINER functions run as their owner, so EXECUTE must be granted
-- narrowly and never to PUBLIC.
REVOKE EXECUTE ON FUNCTION auth_resolve_token(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_find_account_for_login(CITEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_list_memberships(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_find_client(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_consume_authorization_code(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_resolve_refresh_token(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_revoke_refresh_family(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_touch_token(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_resolve_token(TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_find_account_for_login(CITEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_list_memberships(UUID) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_find_client(TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_consume_authorization_code(TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_resolve_refresh_token(TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_revoke_refresh_family(UUID) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_touch_token(UUID) TO nexa_app;

-- Tables created by the migration above were made by the owner, so the standing
-- grant in the baseline migration does not cover them retroactively.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexa_app;

-- Tenant isolation for the two tables above.
--
-- Customers are keyed by organization, trusted domains by license (a license
-- owns the widget installation), so each uses the setting that matches its key.

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_tenant ON customers
  USING (organization_id = nexa_current_organization())
  WITH CHECK (organization_id = nexa_current_organization());

ALTER TABLE trusted_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY trusted_domains_tenant ON trusted_domains
  USING (license_id = nexa_current_license())
  WITH CHECK (license_id = nexa_current_license());

ALTER TABLE customers
  ADD CONSTRAINT customers_country_code_check
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

-- Domains are stored normalised (lowercase hostname, no scheme, no port) so
-- the allowlist comparison is a plain equality test rather than a parser that
-- has to agree with the one used at write time.
ALTER TABLE trusted_domains
  ADD CONSTRAINT trusted_domains_format_check
    CHECK (domain = lower(domain) AND domain !~ '[/:]' AND length(domain) BETWEEN 4 AND 253);

-- Minting a customer token happens before any tenant context exists: the
-- organization id arrives in the request body and must be *proved* against the
-- allowlist, not trusted. Same narrow SECURITY DEFINER pattern as auth_*.
CREATE OR REPLACE FUNCTION auth_resolve_widget_origin(p_organization_id UUID, p_host TEXT)
RETURNS TABLE (license_id BIGINT, organization_id UUID, license_status TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT d.license_id, d.organization_id, l.status
  FROM trusted_domains d
  JOIN licenses l ON l.id = d.license_id
  WHERE d.organization_id = p_organization_id
    AND (
      d.domain = p_host
      -- Subdomain match is anchored to a dot so `evil-example.com` cannot
      -- satisfy a rule for `example.com`.
      OR (d.include_subdomains AND p_host LIKE ('%.' || d.domain))
    )
  ORDER BY length(d.domain) DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_find_customer(p_customer_id UUID, p_organization_id UUID)
RETURNS TABLE (id UUID, organization_id UUID, banned_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.organization_id, c.banned_at
  FROM customers c
  WHERE c.id = p_customer_id AND c.organization_id = p_organization_id;
$$;

REVOKE EXECUTE ON FUNCTION auth_resolve_widget_origin(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_find_customer(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_widget_origin(UUID, TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_find_customer(UUID, UUID) TO nexa_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexa_app;
