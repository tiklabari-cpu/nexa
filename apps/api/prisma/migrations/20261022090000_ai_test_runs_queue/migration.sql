-- The AI test bench's queue (tm 314.2 · SiyahTuş analysis AI-19 §2, §7; the
-- runner `services/ai/simulation/run-worker.ts`).
--
-- A run is queued by `POST /ai/test-runs` and played in the background by
-- whichever API process claims it, its results written scenario by scenario —
-- so a run outlives the process that started it:
--
--   - `scenario_ids` — the scenarios the run plays, fixed when it is queued, in
--     the order they are played. A worker that takes a run over plays the ones
--     that have no result yet (`ai_test_run_results` is unique per run and key);
--   - `lease_until` — how long the claim holds the run; the worker moves it on
--     as it goes, and a run past it is taken again by the next claim;
--   - `attempts` — how many claims the run has had; past the last it fails, so
--     a run no worker survives does not hold its workspace's queue for ever.
--
-- Two partial unique indexes say what the API promises, so two processes
-- cannot break it between them:
--
--   - at most one open (queued or running) run per agent and target — a second
--     `POST /ai/test-runs` is `409 ai_test_run_in_progress`;
--   - at most one running run per workspace, which plays two scenarios at a time
--     (AI-19-S2 "kiracı başına 2 eşzamanlı senaryo"): another queued run of the
--     workspace waits for it.
--
-- And two SECURITY DEFINER functions are the worker's only reads and writes
-- across workspaces (the `ai_jobs_claim` pattern, 20261016120000):
--
--   - `ai_test_runs_claim(lease, max_attempts)` — the oldest run that is due
--     (queued, or running past its lease) of a workspace with no other run
--     playing, locked, leased and counted; first, a run past its last attempt
--     is failed;
--   - `ai_sandbox_sessions_purge(limit)` — "talk like a player" sessions past
--     their `expires_at` (24 hours after their last turn), deleted by the
--     scheduler's `ai_sandbox_sessions` sweep.
--
-- Expand only (CONVENTIONS §6.3): three columns with defaults, a CHECK no
-- earlier release can break (nothing wrote a run before this one), indexes and
-- functions. A run's `status`, counts and times keep their 20261021200000
-- CHECKs.

ALTER TABLE ai_test_runs
  ADD COLUMN scenario_ids UUID[]         NOT NULL DEFAULT '{}',
  ADD COLUMN lease_until  TIMESTAMPTZ(6),
  ADD COLUMN attempts     INTEGER        NOT NULL DEFAULT 0;

-- `AI_TEST_RUN_SCENARIOS_MAX`; a running run holds a lease, an ended one none.
ALTER TABLE ai_test_runs
  ADD CONSTRAINT ai_test_runs_queue_check CHECK (
    cardinality(scenario_ids) <= 200
    AND attempts >= 0
    AND (status <> 'running' OR lease_until IS NOT NULL)
    AND (status NOT IN ('completed', 'failed', 'cancelled') OR lease_until IS NULL)
  );

CREATE UNIQUE INDEX ai_test_runs_open_key
  ON ai_test_runs (license_id, ai_agent_id, config_target)
  WHERE status IN ('queued', 'running');

CREATE UNIQUE INDEX ai_test_runs_running_license_key
  ON ai_test_runs (license_id)
  WHERE status = 'running';

-- The claim's scan: the unfinished runs only, however long the history.
CREATE INDEX ai_test_runs_due_idx
  ON ai_test_runs (created_at, id)
  WHERE status IN ('queued', 'running');

CREATE FUNCTION ai_test_runs_claim(
  p_lease_seconds INTEGER,
  p_max_attempts  INTEGER
)
RETURNS TABLE (
  id              UUID,
  license_id      BIGINT,
  organization_id UUID,
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
    RAISE EXCEPTION 'ai_test_runs_claim: invalid argument' USING ERRCODE = '22023';
  END IF;

  -- Every claim died with its worker: the run fails, and its workspace's next
  -- run can play. SKIP LOCKED — a row another claim holds is that claim's.
  UPDATE ai_test_runs r
     SET status = 'failed',
         lease_until = NULL,
         finished_at = v_now,
         error = 'The run was interrupted every time it was played.'
   WHERE r.id IN (
           SELECT x.id
             FROM ai_test_runs x
            WHERE x.status = 'running'
              AND x.lease_until <= v_now
              AND x.attempts >= p_max_attempts
              FOR UPDATE SKIP LOCKED);

  BEGIN
    RETURN QUERY
    WITH picked AS (
      SELECT r.id
        FROM ai_test_runs r
       WHERE (r.status = 'queued'
              OR (r.status = 'running' AND r.lease_until <= v_now AND r.attempts < p_max_attempts))
         -- One run at a time per workspace: a queued one waits for the one
         -- playing — or for its lease to run out, when this claim takes that
         -- one over instead.
         AND NOT EXISTS (
               SELECT 1
                 FROM ai_test_runs o
                WHERE o.license_id = r.license_id
                  AND o.status = 'running'
                  AND o.id <> r.id)
       ORDER BY r.created_at, r.id
       LIMIT 1
         FOR UPDATE OF r SKIP LOCKED
    )
    UPDATE ai_test_runs c
       SET status = 'running',
           started_at = COALESCE(c.started_at, v_now),
           lease_until = v_now + make_interval(secs => p_lease_seconds),
           attempts = c.attempts + 1
      FROM picked p, licenses l
     WHERE c.id = p.id
       AND l.id = c.license_id
    RETURNING c.id, c.license_id, l.organization_id, c.attempts;
  EXCEPTION WHEN unique_violation THEN
    -- Another claim started this workspace's other run a moment ago
    -- (`ai_test_runs_running_license_key`): nothing to take now.
    RETURN;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_test_runs_claim(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_test_runs_claim(INTEGER, INTEGER) TO siyahtus_app;

CREATE FUNCTION ai_sandbox_sessions_purge(p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gone INTEGER;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'ai_sandbox_sessions_purge: invalid argument' USING ERRCODE = '22023';
  END IF;
  DELETE FROM ai_sandbox_sessions s
   WHERE s.id IN (
           SELECT x.id
             FROM ai_sandbox_sessions x
            WHERE x.expires_at <= clock_timestamp()
            ORDER BY x.expires_at
            LIMIT p_limit
              FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  RETURN v_gone;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_sandbox_sessions_purge(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_sandbox_sessions_purge(INTEGER) TO siyahtus_app;
