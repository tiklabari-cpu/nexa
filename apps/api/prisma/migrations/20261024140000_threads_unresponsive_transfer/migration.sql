-- What the inactivity sweep needs (WG-03 · tm 340.1): when an assigned agent
-- has gone too long without answering, the connection goes to someone else in
-- the team; a quiet connection stops counting against its agent's limit.
--
--   inbox_settings.unanswered_transfer_seconds  how long an assigned connection
--       may wait for its agent's first reply. NULL: off.
--   inbox_settings.inactive_after_seconds       how long without an event before
--       a connection is inactive. NULL: off.
--   threads.assigned_at             when the current assignee was given it --
--       the sweep's clock. Kept by the trigger below.
--   threads.inactive_since          since when it is inactive; NULL while lively.
--   threads.unresponsive_transfers  how often the sweep took it from a silent
--       agent, so it can stop the connection bouncing between them.
--
-- Expand only (CONVENTIONS 6.3): nullable columns and a constant default are
-- catalog changes, and nothing the code still serving traffic reads or writes.
-- The threads CHECK is NOT VALID: every existing row holds the default 0, and
-- validating would scan the table under its lock for nothing; new and updated
-- rows are checked all the same. No backfill: a connection assigned before
-- this has no recorded moment, and reads NULL.
ALTER TABLE inbox_settings ADD COLUMN unanswered_transfer_seconds INTEGER;
ALTER TABLE inbox_settings ADD COLUMN inactive_after_seconds INTEGER;
ALTER TABLE inbox_settings
  ADD CONSTRAINT inbox_settings_unanswered_transfer_seconds_check
  CHECK (unanswered_transfer_seconds IS NULL OR unanswered_transfer_seconds > 0);
ALTER TABLE inbox_settings
  ADD CONSTRAINT inbox_settings_inactive_after_seconds_check
  CHECK (inactive_after_seconds IS NULL OR inactive_after_seconds > 0);

ALTER TABLE threads ADD COLUMN assigned_at TIMESTAMPTZ(6);
ALTER TABLE threads ADD COLUMN inactive_since TIMESTAMPTZ(6);
ALTER TABLE threads ADD COLUMN unresponsive_transfers SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE threads
  ADD CONSTRAINT threads_unresponsive_transfers_check
  CHECK (unresponsive_transfers >= 0) NOT VALID;

-- Every way a connection gets an agent -- opened to one, drained from the
-- queue, transferred, taken over, reopened, handed over by the AI -- writes
-- `assignee_id`, so the moment is stamped here once rather than at each of
-- them, and a path added later cannot forget it. A write that sets
-- `assigned_at` itself keeps its value (the API moves it to the hand-over
-- moment when the AI hands a connection to the agent already holding it).
-- Losing the assignee clears it. Touches only the row being written: no
-- table access, so row level security has nothing to say.
CREATE FUNCTION threads_assigned_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assignee_id IS NOT NULL AND NEW.assigned_at IS NULL THEN
      NEW.assigned_at := now();
    END IF;
  ELSIF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    IF NEW.assigned_at IS NOT DISTINCT FROM OLD.assigned_at THEN
      NEW.assigned_at := CASE WHEN NEW.assignee_id IS NULL THEN NULL ELSE now() END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER threads_assigned_at
  BEFORE INSERT OR UPDATE OF assignee_id ON threads
  FOR EACH ROW
  EXECUTE FUNCTION threads_assigned_at();
