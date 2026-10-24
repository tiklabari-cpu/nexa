-- The human check the widget asks for only when a visitor looks scripted
-- (tm 339.2 · SiyahTuş analysis GV-01). Two pieces:
--
--   1. `security_settings.captcha_mode` — when the workspace asks: `off`,
--      `risk` (the default: only when the risk signals fire) or
--      `always_on_chat_start`.
--   2. `customers.challenge_passed_at` — when the member last passed a check;
--      the API spares them another for 12 hours.
--
-- Expand-only (CONVENTIONS §6.3): a defaulted column and a nullable one,
-- nothing an earlier release reads or writes. The CHECK holds the vocabulary
-- `CAPTCHA_MODES` (`@siyahtus/types`); every existing row takes the default,
-- which satisfies it.

ALTER TABLE security_settings
  ADD COLUMN "captcha_mode" TEXT NOT NULL DEFAULT 'risk';
ALTER TABLE security_settings
  ADD CONSTRAINT security_settings_captcha_mode_check
  CHECK (captcha_mode IN ('off', 'risk', 'always_on_chat_start'));

ALTER TABLE customers
  ADD COLUMN "challenge_passed_at" TIMESTAMPTZ(6);
