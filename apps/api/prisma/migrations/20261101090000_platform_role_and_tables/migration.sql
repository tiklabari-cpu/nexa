-- Platform (root panel) role and tables (tm 389.1 · docs/platform-admin/design.md §B1, §B2).
--
-- Two separations, and the tests in test/integration/platform-rls.test.ts pin
-- both of them:
--
--   * The tenant role cannot see the platform. Every platform_* table below has
--     row level security enabled, no policy, and no privilege for
--     siyahtus_app (the default privileges the baseline migration set up would
--     otherwise grant it SELECT/INSERT/UPDATE/DELETE on each new table). The
--     tenant API reaches platform data only through the four platform_*
--     SECURITY DEFINER readers at the end of this file, each of which returns
--     a closed row type.
--
--   * The platform role sees every tenant, but cannot rewrite the evidence.
--     siyahtus_platform is BYPASSRLS, so it reads tenant tables without
--     set_config('app.license_id'), and it may write them — except the audit
--     trail, the issued invoices and the members' second factor, where UPDATE
--     and DELETE are revoked. Its own trail, platform_audit_log, refuses
--     UPDATE and DELETE by trigger for every role, the owner included.
--
-- NOTE for any later migration that adds a platform_* table: the default
-- privileges still grant siyahtus_app on it, so the same ENABLE ROW LEVEL
-- SECURITY + REVOKE ALL ... FROM siyahtus_app has to be repeated there.
--
-- BYPASSRLS needs a superuser. The development and pilot containers run
-- migrations as the image's superuser, so it is granted; on a managed Postgres
-- whose migration role is not a superuser the ALTER is refused and only a
-- WARNING is raised — the role then exists without it and reads tenant tables
-- as an RLS-subject role (zero rows). The way out there is a separate
-- migration adding `OR current_user = 'siyahtus_platform'` to the tenant
-- policies; see docs/production-checklist.md.

-- ---------------------------------------------------------------------------
-- The role. Cluster-wide, so it may already exist: infra/db/init creates it on
-- a fresh container, and another database in the same cluster (an isolated
-- test database migrating in parallel) may be creating it right now — the
-- second CREATE waits for the first and then fails with 23505, and a second
-- ALTER fails with "tuple concurrently updated" (XX000). Both are success.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    BEGIN
      CREATE ROLE siyahtus_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
        PASSWORD 'siyahtus_platform_dev_password';
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;

  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    BEGIN
      EXECUTE 'ALTER ROLE siyahtus_platform BYPASSRLS';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE WARNING 'siyahtus_platform: BYPASSRLS could not be granted (the migration role is not a superuser); see docs/production-checklist.md';
      WHEN internal_error THEN
        IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
          RAISE;
        END IF;
    END;
  END IF;
END
$$;

-- The database name differs per environment (siyahtus, siyahtus_test_<id>, a
-- restored copy), so CONNECT is granted on whichever one is being migrated.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO siyahtus_platform', current_database());
END
$$;

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "totp_secret_ciphertext" TEXT,
    "totp_enrolled_at" TIMESTAMPTZ(6),
    "disabled_at" TIMESTAMPTZ(6),
    "invited_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_recovery_codes" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_invites" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'password',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totp_verified_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_log" (
    "chain_seq" BIGINT NOT NULL,
    "admin_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "license_id" BIGINT,
    "reason" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("chain_seq")
);

-- CreateTable
CREATE TABLE "platform_audit_chain_head" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "hash" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_chain_head_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform_notes" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "admin_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_blocklist" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_blocklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_impersonation_sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "account_id" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'read_only',
    "handoff_code_hash" TEXT,
    "handoff_expires_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" TEXT,

    CONSTRAINT "platform_impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_credits" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "admin_id" UUID NOT NULL,
    "invoice_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_alert_prefs" (
    "admin_id" UUID NOT NULL,
    "kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_alert_prefs_pkey" PRIMARY KEY ("admin_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE INDEX "platform_admin_recovery_codes_admin_id_idx" ON "platform_admin_recovery_codes"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_invites_token_hash_key" ON "platform_admin_invites"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "platform_sessions_token_hash_key" ON "platform_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "platform_sessions_admin_id_idx" ON "platform_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "platform_audit_log_license_id_chain_seq_idx" ON "platform_audit_log"("license_id", "chain_seq");

-- CreateIndex
CREATE INDEX "platform_audit_log_admin_id_chain_seq_idx" ON "platform_audit_log"("admin_id", "chain_seq");

-- CreateIndex
CREATE INDEX "platform_notes_license_id_created_at_idx" ON "platform_notes"("license_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "platform_blocklist_kind_value_key" ON "platform_blocklist"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "platform_impersonation_sessions_handoff_code_hash_key" ON "platform_impersonation_sessions"("handoff_code_hash");

-- CreateIndex
CREATE INDEX "platform_impersonation_sessions_license_id_started_at_idx" ON "platform_impersonation_sessions"("license_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "platform_impersonation_sessions_admin_id_started_at_idx" ON "platform_impersonation_sessions"("admin_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "platform_credits_license_id_created_at_idx" ON "platform_credits"("license_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_credits_invoice_id_idx" ON "platform_credits"("invoice_id");

-- AddForeignKey
ALTER TABLE "platform_admin_recovery_codes" ADD CONSTRAINT "platform_admin_recovery_codes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_notes" ADD CONSTRAINT "platform_notes_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_notes" ADD CONSTRAINT "platform_notes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_impersonation_sessions" ADD CONSTRAINT "platform_impersonation_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_impersonation_sessions" ADD CONSTRAINT "platform_impersonation_sessions_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_impersonation_sessions" ADD CONSTRAINT "platform_impersonation_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credits" ADD CONSTRAINT "platform_credits_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credits" ADD CONSTRAINT "platform_credits_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credits" ADD CONSTRAINT "platform_credits_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_alert_prefs" ADD CONSTRAINT "platform_alert_prefs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECKs (Prisma cannot express them; db:check-drift does not see them).
-- ---------------------------------------------------------------------------
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_role_check"
  CHECK (role IN ('superadmin', 'support', 'billing', 'readonly'));
ALTER TABLE "platform_admin_invites" ADD CONSTRAINT "platform_admin_invites_role_check"
  CHECK (role IN ('superadmin', 'support', 'billing', 'readonly'));
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_stage_check"
  CHECK (stage IN ('password', 'active'));
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_active_needs_totp_check"
  CHECK (stage <> 'active' OR totp_verified_at IS NOT NULL);

-- The action list itself is closed in code (389.5); here only its shape, so a
-- free-text sentence cannot end up where a filterable verb belongs.
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_action_check"
  CHECK (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$');
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_chain_seq_check"
  CHECK (chain_seq > 0);
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_payload_check"
  CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE "platform_audit_chain_head" ADD CONSTRAINT "platform_audit_chain_head_singleton_check"
  CHECK (id = 1 AND seq >= 0);

-- The key dictionary of design.md §B2. A new key is a migration, on purpose:
-- the readers below and the admin SPA both have to learn it.
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_key_check"
  CHECK (key IN (
    'signup_enabled', 'trial_days', 'announcement', 'maintenance',
    'billing.swift_bank_details', 'billing.providers', 'billing.issuer_profile',
    'ai.llm', 'ai.embedding', 'ai.caps', 'ai.prices', 'ai.crisis_text_drafts'
  ));
-- The two scalar keys are read with a cast by platform_public_settings, so
-- their type is held here rather than trusted; everything else is an object.
-- CASE, not AND: Postgres does not promise to evaluate AND left to right, and
-- the numeric cast of a non-number raises instead of returning false.
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_value_check"
  CHECK (CASE key
    WHEN 'signup_enabled' THEN jsonb_typeof(value) = 'boolean'
    WHEN 'trial_days' THEN CASE
      WHEN jsonb_typeof(value) = 'number'
        THEN value::numeric BETWEEN 0 AND 365 AND value::numeric = trunc(value::numeric)
      ELSE false
    END
    ELSE jsonb_typeof(value) = 'object'
  END);
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_version_check"
  CHECK (version > 0);

-- Stored normalised, so the unique index is the duplicate check and the
-- reader below compares plainly.
ALTER TABLE "platform_blocklist" ADD CONSTRAINT "platform_blocklist_kind_check"
  CHECK (kind IN ('email', 'domain', 'ip'));
ALTER TABLE "platform_blocklist" ADD CONSTRAINT "platform_blocklist_value_check"
  CHECK (CASE kind
    WHEN 'email' THEN value = lower(btrim(value)) AND value ~ '^[^@\s]+@[^@\s]+$'
    WHEN 'domain' THEN value = lower(btrim(value)) AND value ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'
    WHEN 'ip' THEN pg_input_is_valid(value, 'inet')
    ELSE false
  END);

ALTER TABLE "platform_impersonation_sessions" ADD CONSTRAINT "platform_impersonation_sessions_mode_check"
  CHECK (mode IN ('read_only', 'full'));
ALTER TABLE "platform_impersonation_sessions" ADD CONSTRAINT "platform_impersonation_sessions_window_check"
  CHECK (ends_at > started_at);

ALTER TABLE "platform_credits" ADD CONSTRAINT "platform_credits_amount_check"
  CHECK (amount_minor <> 0);
ALTER TABLE "platform_credits" ADD CONSTRAINT "platform_credits_currency_check"
  CHECK (currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- platform_audit_log is append-only for every role. Statement-level, so even
-- an UPDATE that matches nothing is refused; TRUNCATE (the test harness's
-- reset) is a different event and is not covered.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_audit_log_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_log is append-only: % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER platform_audit_log_append_only
  BEFORE UPDATE OR DELETE ON "platform_audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION platform_audit_log_append_only();

-- ---------------------------------------------------------------------------
-- Isolation from the tenant role.
-- ---------------------------------------------------------------------------
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_admin_recovery_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_admin_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_audit_chain_head" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_blocklist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_impersonation_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_credits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_alert_prefs" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "platform_admins", "platform_admin_recovery_codes", "platform_admin_invites",
  "platform_sessions", "platform_audit_log", "platform_audit_chain_head", "platform_settings",
  "platform_notes", "platform_blocklist", "platform_impersonation_sessions",
  "platform_credits", "platform_alert_prefs"
  FROM siyahtus_app, PUBLIC;

-- ---------------------------------------------------------------------------
-- The platform role's privileges (design.md §B1). After the tables above, so
-- "ALL TABLES" includes them.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO siyahtus_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO siyahtus_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO siyahtus_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO siyahtus_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO siyahtus_platform;

-- The evidence the platform must not be able to rewrite. (design.md names the
-- recovery codes `account_two_factor_recovery_codes`; the table is
-- `two_factor_recovery_codes`.)
REVOKE UPDATE, DELETE ON audit_log, invoices, invoice_line_items, account_two_factor,
  two_factor_recovery_codes FROM siyahtus_platform;
-- The migration bookkeeping is nobody's runtime business.
REVOKE INSERT, UPDATE, DELETE ON "_prisma_migrations" FROM siyahtus_platform;

GRANT EXECUTE ON FUNCTION auth_revoke_refresh_family, auth_two_factor_disable,
  purge_unverified_signups, sandbox_reset, events_ensure_partition TO siyahtus_platform;

-- ---------------------------------------------------------------------------
-- What the tenant API may read of the platform: four SECURITY DEFINER readers,
-- each a closed row type, executable by siyahtus_app only. A key nobody set is
-- NULL — the caller keeps its env value or built-in default (the owner's rule
-- of 2026-10-10: a missing platform setting never stops the tenant API). The
-- consumers are 389.13 (public + blocklist), 389.17 (ai) and 389.18 (billing).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_public_settings()
RETURNS TABLE (
  signup_enabled BOOLEAN,
  trial_days INTEGER,
  announcement JSONB,
  maintenance JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT s.value::boolean FROM platform_settings s WHERE s.key = 'signup_enabled'),
    (SELECT s.value::integer FROM platform_settings s WHERE s.key = 'trial_days'),
    (SELECT s.value FROM platform_settings s WHERE s.key = 'announcement'),
    (SELECT s.value FROM platform_settings s WHERE s.key = 'maintenance');
$$;

-- One row, always: whether the address or the IP is on the blocklist, and by
-- which kind of entry (email before domain before ip). A domain entry also
-- covers its subdomains; an ip entry may be a CIDR. An IP that is not one
-- (NULL, garbage) simply matches nothing.
CREATE FUNCTION platform_signup_blocked(p_email TEXT, p_ip TEXT)
RETURNS TABLE (blocked BOOLEAN, matched_kind TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT := lower(btrim(coalesce(p_email, '')));
  v_domain TEXT := split_part(lower(btrim(coalesce(p_email, ''))), '@', 2);
  v_ip INET;
BEGIN
  IF p_ip IS NOT NULL AND pg_input_is_valid(p_ip, 'inet') THEN
    v_ip := p_ip::inet;
  END IF;

  IF v_email <> '' AND EXISTS (
    SELECT 1 FROM platform_blocklist b WHERE b.kind = 'email' AND b.value = v_email
  ) THEN
    RETURN QUERY SELECT true, 'email'::text;
    RETURN;
  END IF;

  IF v_domain <> '' AND EXISTS (
    SELECT 1 FROM platform_blocklist b
    WHERE b.kind = 'domain'
      AND (b.value = v_domain OR right(v_domain, length(b.value) + 1) = '.' || b.value)
  ) THEN
    RETURN QUERY SELECT true, 'domain'::text;
    RETURN;
  END IF;

  -- The CHECK guarantees every stored ip value casts.
  IF v_ip IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform_blocklist b WHERE b.kind = 'ip' AND v_ip <<= b.value::inet
  ) THEN
    RETURN QUERY SELECT true, 'ip'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::text;
END;
$$;

-- API keys come back as ciphertext (`api_key_ciphertext`); decrypting them
-- with PLATFORM_SETTINGS_KEY is the tenant process's job (389.17).
CREATE FUNCTION platform_ai_settings()
RETURNS TABLE (
  llm JSONB,
  embedding JSONB,
  caps JSONB,
  prices JSONB,
  crisis_text_drafts JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT s.value FROM platform_settings s WHERE s.key = 'ai.llm'),
    (SELECT s.value FROM platform_settings s WHERE s.key = 'ai.embedding'),
    (SELECT s.value FROM platform_settings s WHERE s.key = 'ai.caps'),
    (SELECT s.value FROM platform_settings s WHERE s.key = 'ai.prices'),
    (SELECT s.value FROM platform_settings s WHERE s.key = 'ai.crisis_text_drafts');
$$;

CREATE FUNCTION platform_billing_settings()
RETURNS TABLE (
  providers JSONB,
  swift_bank_details JSONB,
  issuer_profile JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT s.value FROM platform_settings s WHERE s.key = 'billing.providers'),
    (SELECT s.value FROM platform_settings s WHERE s.key = 'billing.swift_bank_details'),
    (SELECT s.value FROM platform_settings s WHERE s.key = 'billing.issuer_profile');
$$;

REVOKE EXECUTE ON FUNCTION platform_public_settings(), platform_signup_blocked(TEXT, TEXT),
  platform_ai_settings(), platform_billing_settings()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_public_settings(), platform_signup_blocked(TEXT, TEXT),
  platform_ai_settings(), platform_billing_settings()
  TO siyahtus_app;
