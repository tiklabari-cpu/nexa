-- Website crawling, the runner's half (tm 312.3 · SiyahTuş analysis AI-17).
--
-- `knowledge_jobs` (20261110090000_knowledge_crawl) is the queue; this is how
-- a runner takes from it, the `ai_test_runs_claim` pattern (20261022090000):
--
--   1. `knowledge_jobs_running_license_key` — at most one job `running` per
--      workspace. A workspace's second crawl waits for its first, so one
--      tenant with ten sites cannot hold every runner while the others wait;
--      the runners' own concurrency is the global limit.
--   2. `knowledge_jobs_claim(lease_seconds, max_attempts)` — the runner's one
--      cross-tenant read. Takes the oldest due job — `queued` or
--      `waiting_budget` past its `available_at`, or `running` under a lease
--      that ran out (its runner died) — under `FOR UPDATE SKIP LOCKED`, and
--      leases it. Everything after the claim (progress, the frontier, the
--      end) is written inside the job's tenant, where the application role's
--      own policy lets it, fenced by the attempt number the claim returned.
--
-- A job every claim died on fails (`attempts_exhausted`) and its source stops
-- saying `crawling`: `partial` when it still has chunks that answer, `failed`
-- when it has none.
--
-- Expand-only (CONVENTIONS §6.3): a new index on a table no release has
-- written to yet, and a new function.

CREATE UNIQUE INDEX knowledge_jobs_running_license_key
  ON knowledge_jobs (license_id)
  WHERE status = 'running';

CREATE FUNCTION knowledge_jobs_claim(
  p_lease_seconds INTEGER,
  p_max_attempts  INTEGER
)
RETURNS TABLE (
  id              UUID,
  license_id      BIGINT,
  organization_id UUID,
  source_id       UUID,
  kind            TEXT,
  attempts        INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600
     OR p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'knowledge_jobs_claim: invalid argument' USING ERRCODE = '22023';
  END IF;

  -- Every claim died with its runner: the job fails, its source says what it
  -- has, and the workspace's next job can run. SKIP LOCKED — a row another
  -- claim holds is that claim's.
  WITH exhausted AS (
    UPDATE knowledge_jobs r
       SET status = 'failed',
           lease_until = NULL,
           finished_at = v_now,
           updated_at = v_now,
           error = 'attempts_exhausted'
     WHERE r.id IN (
             SELECT x.id
               FROM knowledge_jobs x
              WHERE x.status = 'running'
                AND x.lease_until <= v_now
                AND x.attempts >= p_max_attempts
                FOR UPDATE SKIP LOCKED)
    RETURNING r.source_id
  )
  UPDATE knowledge_sources s
     SET status = CASE WHEN EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.source_id = s.id)
                       THEN 'partial' ELSE 'failed' END,
         updated_at = v_now
    FROM exhausted e
   WHERE s.id = e.source_id
     AND s.status = 'crawling';

  BEGIN
    RETURN QUERY
    WITH picked AS (
      SELECT r.id
        FROM knowledge_jobs r
       WHERE ((r.status IN ('queued', 'waiting_budget') AND r.available_at <= v_now)
              OR (r.status = 'running' AND r.lease_until <= v_now
                  AND r.attempts < p_max_attempts))
         -- One job at a time per workspace: a due one waits for the one
         -- running — or for its lease to run out, when this claim takes that
         -- one over instead.
         AND NOT EXISTS (
               SELECT 1
                 FROM knowledge_jobs o
                WHERE o.license_id = r.license_id
                  AND o.status = 'running'
                  AND o.id <> r.id)
       ORDER BY r.available_at, r.created_at, r.id
       LIMIT 1
         FOR UPDATE OF r SKIP LOCKED
    )
    UPDATE knowledge_jobs c
       SET status = 'running',
           started_at = COALESCE(c.started_at, v_now),
           lease_until = v_now + make_interval(secs => p_lease_seconds),
           attempts = c.attempts + 1,
           updated_at = v_now
      FROM picked p
     WHERE c.id = p.id
    RETURNING c.id, c.license_id, c.organization_id, c.source_id, c.kind, c.attempts;
  EXCEPTION WHEN unique_violation THEN
    -- Another claim started this workspace's other job a moment ago
    -- (`knowledge_jobs_running_license_key`): nothing to take now.
    RETURN;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION knowledge_jobs_claim(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION knowledge_jobs_claim(INTEGER, INTEGER) TO siyahtus_app;
