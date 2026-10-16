-- Wake the AI job workers when there is something to take (tm 289.3 ·
-- ADR-11a §2.4 · SiyahTuş analysis GV-02).
--
-- The worker (`services/ai/ai-job-worker.ts`) polls `ai_jobs_claim` every
-- 500 ms and keeps one connection of its own on `LISTEN ai_jobs`; this is what
-- talks to that connection. Two moments are worth a wake-up:
--
--   * a job is enqueued `pending` — the visitor's message is waiting for it;
--   * a job leaves `running` or `pending` for anything but `running` — its
--     chat's next job may have become the head (`ai_jobs_claim` takes one job
--     per chat, oldest first), or a released job is due again.
--
-- The claim's own move into `running` is not one: nothing became due.
--
-- NOTIFY is delivered only when the writing transaction commits, so a message
-- that rolled back wakes nobody, and identical notifications of one
-- transaction are folded into one. The payload is empty on purpose: a
-- wake-up is "look", never data — the worker still goes through the claim,
-- and a lost wake-up costs at most one poll interval. Nothing depends on this
-- for correctness.
--
-- Expand-only (CONVENTIONS 6.3): a function and two triggers.

CREATE FUNCTION ai_jobs_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM pg_notify('ai_jobs', '');
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_jobs_notify() FROM PUBLIC;

CREATE TRIGGER ai_jobs_notify_enqueued
  AFTER INSERT ON ai_jobs
  FOR EACH ROW
  WHEN (NEW.state = 'pending')
  EXECUTE FUNCTION ai_jobs_notify();

CREATE TRIGGER ai_jobs_notify_released
  AFTER UPDATE OF state ON ai_jobs
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.state <> 'running')
  EXECUTE FUNCTION ai_jobs_notify();
