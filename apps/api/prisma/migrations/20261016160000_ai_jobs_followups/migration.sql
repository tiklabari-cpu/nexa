-- The visitor's follow-up moves onto the durable queue (tm 289.5 · ADR-11a ·
-- SiyahTuş analysis GV-02).
--
-- Until now the rule bot, the AI Agent and the assignee's notice ran from
-- process memory (`services/chat/follow-ups.ts`) with what the route still
-- held: the page the visitor wrote from and whether the message opened the
-- connection. A job is run by whichever process claims it, later, so the two
-- facts travel with it:
--
--   1. `page_url` — the page the message was sent from (the widget's `url`,
--      at most 2048 characters like the route accepts), for the rule bot's
--      page conditions. Null when the widget sent none.
--   2. `opened_connection` — the message opened a connection (the day's first,
--      or a return), so the assignee's handset says "new chat" rather than
--      "new message". The outbox knows it (`OutboxEvent.openedVia`); nothing
--      in the conversation records it per message.
--
-- And `/health` reads the queue's depth and age across every workspace:
--
--   3. `ai_jobs_health()` — SECURITY DEFINER, like `ai_jobs_claim` is the
--      worker's one cross-tenant read; counts only, no tenant ids, nothing of
--      any conversation. The age is the database's clock, so it is right
--      whichever process asks.
--
-- Expand-only (CONVENTIONS 6.3): two nullable/defaulted columns an earlier
-- release neither reads nor writes, and a new function.

ALTER TABLE ai_jobs
  ADD COLUMN page_url TEXT,
  ADD COLUMN opened_connection BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ai_jobs
  ADD CONSTRAINT ai_jobs_page_url_check CHECK (
    page_url IS NULL OR char_length(page_url) <= 2048
  );

-- The queue at a glance. `state` leads `ai_jobs_state_available_at_idx`, so
-- each count reads the unfinished rows only, however long the history.
CREATE FUNCTION ai_jobs_health()
RETURNS TABLE (
  pending      BIGINT,
  running      BIGINT,
  oldest_age_s DOUBLE PRECISION
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*) FILTER (WHERE state = 'pending'),
         count(*) FILTER (WHERE state = 'running'),
         extract(epoch FROM clock_timestamp() - min(created_at))::double precision
    FROM ai_jobs
   WHERE state IN ('pending', 'running')
$$;

REVOKE EXECUTE ON FUNCTION ai_jobs_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_jobs_health() TO siyahtus_app;
