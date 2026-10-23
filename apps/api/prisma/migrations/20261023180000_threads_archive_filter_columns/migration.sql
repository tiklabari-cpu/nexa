-- The archive's agent and risk filters (AR-02 · tm 336.1): two arrays on the
-- connection, so a filter is one `&&` on the row rather than a probe into
-- `events` or `risk_flags` per candidate.
--
-- No GIN index on either (PLAN §D350): `arrayoverlap` is not leakproof, so
-- under row level security PostgreSQL never makes `&&` an index condition --
-- measured as `siyahtus_app`, the index is ignored even with seqscan off. The
-- filters narrow the rows the date and team indexes already read.
--
--   agent_ids   the agents who wrote to the player in the connection (an
--               internal note is not writing to the player). Written once,
--               beside `handled_by`, in the transaction that closes the
--               thread (`agentIdsSql`, services/archive/archive-filters.ts);
--               NULL while open -- the archive reads an open one live.
--   risk_flags  the flag types raised in the connection, cleared ones
--               included (the row's `risk_flags`). Kept by the trigger below
--               as each flag is raised, whoever raises it.
--
-- Expand only (CONVENTIONS 6.3): a nullable column, and a column whose default
-- is a constant, are catalog changes; the code still serving traffic neither
-- reads nor writes them. Rows that closed before this are filled by
-- 20261023180100_threads_archive_backfill.
ALTER TABLE threads ADD COLUMN agent_ids UUID[];
ALTER TABLE threads ADD COLUMN risk_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A raised flag adds its type to its connection's list, once, kept sorted.
-- Runs as the writer, under the writer's row level security -- the same
-- workspace's thread, which `risk_flags_before_write` has already checked the
-- flag belongs to. Clearing a flag leaves the type: the archive lists the
-- flags a conversation had, cleared ones included.
CREATE FUNCTION risk_flags_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.thread_id IS NOT NULL THEN
    UPDATE threads t
       SET risk_flags = ARRAY(
             SELECT DISTINCT x FROM unnest(t.risk_flags || NEW.type) AS x ORDER BY x
           )
     WHERE t.id = NEW.thread_id
       AND t.license_id = NEW.license_id
       AND NOT (NEW.type = ANY (t.risk_flags));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER risk_flags_after_insert
  AFTER INSERT ON risk_flags
  FOR EACH ROW
  EXECUTE FUNCTION risk_flags_after_insert();
