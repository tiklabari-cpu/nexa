-- Session policy columns on `security_settings` (FR-MOD-08.9.6), read-only
-- skeleton: this adds the columns and the GET surface reads them, but nothing
-- writes or enforces them yet (that is 08.9.6-e/-f/-g).
--
--   * ip_allowlist_enforced — whether `banned_customer_ips` is enforced as an
--     allowlist rather than a blocklist. Defaults to false.
--   * session_idle_timeout_seconds — seconds of inactivity before a session is
--     force-expired. Null (the default) disables the policy.
--   * max_concurrent_sessions — per-owner cap on simultaneous active sessions.
--     Null (the default) falls back to the fixed `MAX_ACTIVE_TOKENS_PER_OWNER`
--     constant (25).
--
-- Additive only — no existing row changes shape, and the table already has its
-- RLS policy and grant from the migration that created it.

-- AlterTable
ALTER TABLE "security_settings"
  ADD COLUMN "ip_allowlist_enforced" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "session_idle_timeout_seconds" INTEGER,
  ADD COLUMN "max_concurrent_sessions" INTEGER;
