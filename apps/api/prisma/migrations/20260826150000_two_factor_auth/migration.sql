-- Two-factor authentication: TOTP secret storage + recovery codes
-- (NFR-S11 · FR-MOD-00.1 · S11-2FA, Faz-5 tm 152). Migration + type skeleton
-- ONLY — no route or OpenAPI path lands here. `contract-parity.test.ts` runs
-- both directions (an undocumented route fails it, but so does a documented
-- path nothing serves), so every new path arrives in the same subtask as the
-- route that serves it (S11-2FA-d, tm 152.4). This one just gives the later
-- subtasks somewhere to write.
--
-- Both tables are per-ACCOUNT, not per-license: `accounts` sits above the
-- tenant boundary (PRD §8.4) and cannot be filtered by `nexa_current_license()`.
-- `agent_memberships.two_factor_enabled` (added in 20260722151255) is the
-- per-MEMBERSHIP flag PRD §8.4 actually specifies; it is a DERIVED copy of
-- `account_two_factor.activated_at`, kept in sync by the enrollment/removal
-- functions that land with them (S11-2FA-d/e). This migration does not touch
-- it and creates no second source of truth for the same fact.
--
-- The structural statements below are exactly what `prisma migrate diff`
-- emits for the schema change, the same way every other tenant table does
-- (e.g. 20260810110000_sales_tracker). The CHECK-equivalent access pattern,
-- the RLS and the GRANTs are invisible to Prisma and are added here by hand.

-- CreateTable
CREATE TABLE "account_two_factor" (
    "account_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_two_factor_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factor_recovery_codes_account_id_idx" ON "two_factor_recovery_codes"("account_id");

-- AddForeignKey
ALTER TABLE "account_two_factor" ADD CONSTRAINT "account_two_factor_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- KARAR (secret storage): a TOTP secret has to be read back byte-for-byte to
-- compute the next 30s code, so it cannot be hashed the way `token_hash` is —
-- hashing is for a value the database only ever compares, never reproduces.
-- The alternative to hashing is application-layer encryption (`pgcrypto` is
-- already enabled by 20260722090000), which would need a key-management story
-- — where the key lives, how it rotates — that nothing else in this schema
-- has yet. Inventing one for a single column, in a migration-only subtask
-- with no enrollment code to use it, would be exactly the speculative
-- infrastructure CONVENTIONS §5 rules out. So `secret` is stored as plain
-- base32 text and the ONLY protection is the access pattern below: no query
-- path reaches the column except through a SECURITY DEFINER function.
-- Encrypting it at rest, if decided later, is a new task, not a silent
-- addition here.
COMMENT ON COLUMN account_two_factor.secret IS
  'Base32 TOTP secret, plain text — must be read back to compute codes, so it cannot be hashed. Protected only by RLS + SECURITY DEFINER-only access (see migration comment), not by encryption at rest.';
COMMENT ON COLUMN account_two_factor.last_used_step IS
  'RFC 6238 §5.2 replay guard: the TOTP step counter of the last code accepted. A verification must reject any step at or before this one.';

-- ACCESS PATTERN — copied from `password_reset_tokens` (20260724090000_account_lifecycle):
-- no permissive RLS policy at all. Every row is invisible to `nexa_app`
-- through an ordinary query; only a SECURITY DEFINER function — added
-- alongside the enrollment/verification logic that needs one (S11-2FA-b/c/d/e)
-- — can read or write one, the same way `auth_request_password_reset` /
-- `auth_consume_password_reset` are the only path to a reset token.
ALTER TABLE account_two_factor ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON account_two_factor TO nexa_app;

-- Recovery codes, unlike the secret above, are presented once and never read
-- back — so they follow `password_reset_tokens`'s example instead: stored only
-- as a SHA-256 hash, not the access pattern's problem to solve a second time.
-- `id` has no database-level default (Prisma's `@default(uuid())` is not
-- backed by `gen_random_uuid()` here, same shape as `password_reset_tokens`
-- vs. its own hand-written migration): the SECURITY DEFINER function that
-- inserts a batch of codes (S11-2FA-c) must supply `gen_random_uuid()` for
-- `id` itself.
ALTER TABLE two_factor_recovery_codes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON two_factor_recovery_codes TO nexa_app;
