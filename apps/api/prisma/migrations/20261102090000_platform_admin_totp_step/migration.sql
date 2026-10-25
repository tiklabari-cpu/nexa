-- Operator sign-in (tm 389.4 · docs/platform-admin/design.md §A · FR-ADMIN-01).
--
-- The replay floor of the operator's authenticator: the last 30-second TOTP
-- step a code was accepted for. A code stays valid for its step and, with the
-- one step of drift lib/totp.ts allows, for one more — so without this a code
-- read off a screen or replayed through a proxied sign-in page could be spent
-- twice within a minute. services/platform/admin-auth.ts advances it with one
-- conditional UPDATE (`... WHERE totp_last_used_step IS NULL OR < step`), which
-- is what decides between two requests presenting the same code. The tenant
-- twin is account_two_factor.last_used_step.
--
-- Expand-only (CONVENTIONS §6.3): a nullable column and two CHECKs every
-- existing row already satisfies (no operator has enrolled before this task).

-- AlterTable
ALTER TABLE "platform_admins" ADD COLUMN "totp_last_used_step" BIGINT;

ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_totp_last_used_step_check"
  CHECK (totp_last_used_step IS NULL OR totp_last_used_step >= 0);

-- An enrolled operator has a secret to verify against. The reverse does not
-- hold: a secret without totp_enrolled_at is an enrolment not yet confirmed.
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_enrolled_needs_secret_check"
  CHECK (totp_enrolled_at IS NULL OR totp_secret_ciphertext IS NOT NULL);
