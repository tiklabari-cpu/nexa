-- The waiting timer on the inbox row (IN-03, tm 361).
--
--   threads.awaiting_reply_since   since when the player has waited for an answer.
--       NULL: nobody waits. Kept by the event-append path in the same write as
--       the event (the player's message starts it, an agent's or a bot's reply
--       clears it, the AI handing over starts it, the close clears it).
--   inbox_settings.waiting_warn_seconds / waiting_alert_seconds   when the row
--       turns to a warning and to an alert. NULL: the defaults, 120 and 300.
--
-- Additive only: every column is nullable and carries no default, so a replica
-- of the previous release that never writes them is unaffected. Open
-- connections start empty (nobody is reported as waiting until the next player
-- message). The CHECKs keep a threshold positive; a zero would paint every row.
ALTER TABLE threads ADD COLUMN awaiting_reply_since TIMESTAMPTZ;
ALTER TABLE inbox_settings ADD COLUMN waiting_warn_seconds INTEGER;
ALTER TABLE inbox_settings ADD COLUMN waiting_alert_seconds INTEGER;
ALTER TABLE inbox_settings
  ADD CONSTRAINT inbox_settings_waiting_warn_seconds_check
  CHECK (waiting_warn_seconds IS NULL OR waiting_warn_seconds > 0);
ALTER TABLE inbox_settings
  ADD CONSTRAINT inbox_settings_waiting_alert_seconds_check
  CHECK (waiting_alert_seconds IS NULL OR waiting_alert_seconds > 0);
