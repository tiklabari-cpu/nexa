-- Asking the player for an e-mail while nobody answers (WG-08, tm 342).
--
--   inbox_settings.ask_email_after_seconds  how long a connection may wait for a
--       person's first reply before the player is asked for an e-mail. NULL: off.
--   inbox_settings.ask_email_when_offline   whether a connection that waits for a
--       person while nobody is accepting chats asks at once. Off by default.
--
-- Additive only: the first column is nullable, the second carries its default,
-- so a replica of the previous release that never writes them is unaffected.
-- The CHECK keeps the window positive; a zero would ask every waiting player
-- at once (the same rule as the WG-03 windows).
ALTER TABLE inbox_settings ADD COLUMN ask_email_after_seconds INTEGER;
ALTER TABLE inbox_settings ADD COLUMN ask_email_when_offline BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE inbox_settings
  ADD CONSTRAINT inbox_settings_ask_email_after_seconds_check
  CHECK (ask_email_after_seconds IS NULL OR ask_email_after_seconds > 0);
