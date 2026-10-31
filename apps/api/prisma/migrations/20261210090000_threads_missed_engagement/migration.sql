-- Missed conversations and who started them (RP-02 · tm 369.1).
--
--   threads.initiated_by       who started the connection -- customer, agent,
--       campaign, ai or channel (`THREAD_INITIATED_BY`). Written once, as it
--       opens. NULL: opened before this, or by a path that does not say.
--   threads.needs_human_since  since when the connection has needed a person:
--       its first queue entry, first assignee or the AI handing it over,
--       whichever came first. Kept by the trigger below for the queue and the
--       assignee; the AI hand-over writes it itself.
--   threads.missed_reason      why it was missed (`MISSED_REASONS`), written
--       once, in the transaction that closes it. NULL: not missed, or open.
--
-- Expand only (CONVENTIONS 6.3): nullable columns are catalog changes, and
-- nothing the code still serving traffic reads or writes. NOT VALID, then
-- VALIDATE (the `threads_handled_by_check` pattern): the columns are NULL on
-- every existing row, so the checks hold, and VALIDATE scans under SHARE UPDATE
-- EXCLUSIVE instead of the ACCESS EXCLUSIVE an ADD CONSTRAINT with a scan
-- would hold over `threads`. The partial backfill of closed connections is its
-- own migration (20261210090100_threads_missed_backfill).
ALTER TABLE threads ADD COLUMN initiated_by TEXT;
ALTER TABLE threads ADD COLUMN needs_human_since TIMESTAMPTZ(6);
ALTER TABLE threads ADD COLUMN missed_reason TEXT;

ALTER TABLE threads ADD CONSTRAINT threads_initiated_by_check
  CHECK (initiated_by IS NULL OR initiated_by IN ('customer', 'agent', 'campaign', 'ai', 'channel')) NOT VALID;
ALTER TABLE threads VALIDATE CONSTRAINT threads_initiated_by_check;

ALTER TABLE threads ADD CONSTRAINT threads_missed_reason_check
  CHECK (missed_reason IS NULL OR missed_reason IN ('queue_abandoned', 'unanswered_assigned', 'unanswered_after_ai')) NOT VALID;
ALTER TABLE threads VALIDATE CONSTRAINT threads_missed_reason_check;

-- Every way an open connection reaches a person -- opened to an agent or into
-- the queue, drained, transferred, taken over, handed over by the AI -- writes
-- `assignee_id` or `queue_position`, so the first such moment is stamped here
-- once rather than at each of them, and a path added later cannot forget it
-- (the `threads_assigned_at` reasoning). Never moved once set. Not on a closed
-- row: the close clears `queue_position`, and a connection open since before
-- this column must not read "needed a person" from its own close. Not on a
-- connection an agent started: the person is already there, and one that
-- closes without the agent writing is not a player left waiting. Touches only
-- the row being written: no table access, so row level security has nothing
-- to say.
CREATE FUNCTION threads_needs_human_since()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.needs_human_since IS NULL
     AND NEW.active
     AND NEW.initiated_by IS DISTINCT FROM 'agent'
     AND (NEW.assignee_id IS NOT NULL OR NEW.queue_position IS NOT NULL) THEN
    NEW.needs_human_since := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER threads_needs_human_since
  BEFORE INSERT OR UPDATE OF assignee_id, queue_position ON threads
  FOR EACH ROW
  EXECUTE FUNCTION threads_needs_human_since();
