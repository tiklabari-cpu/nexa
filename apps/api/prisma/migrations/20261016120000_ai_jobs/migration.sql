-- The durable AI job queue (tm 289.1 · ADR-11a `docs/adr/durable-ai-jobs.md` ·
-- SiyahTuş analysis GV-02, GV-02-S1).
--
-- The automatic reply a visitor message is owed (rule bot, AI Agent, the
-- assignee's notification) waits today in process memory
-- (`services/chat/follow-ups.ts`, "Not durable, on purpose"): a restart, an
-- update or a stuck process loses every answer queued at that moment. This is
-- where that work will wait instead:
--
--   1. `ai_jobs` — a tenant table. One row per message and kind; the outbox
--      (tm 289.2) writes it in the message's own transaction, so a committed
--      message has its job and a rolled-back one has none.
--   2. `ai_jobs_claim(limit, lease_seconds, max_attempts)` — the worker's one
--      cross-tenant read, the way `retention_list_tenants()` is the sweeps'
--      (`services/webhooks/redelivery.ts` pattern). Takes due jobs under
--      `FOR UPDATE SKIP LOCKED` and leases them; one chat at a time, oldest
--      first; re-takes a job whose worker died once its lease runs out.
--   3. `ai_jobs_settle(job, attempts, state, outcome, error, retry_after)` —
--      records the result, inside the job's tenant, only for the claim that
--      still holds the job.
--
-- The application role reads its tenant's rows and enqueues; it cannot move a
-- job between states by itself. Only the two functions do, so "who may run
-- this job now" has one answer, written in one place.
--
-- Wake-ups (`LISTEN/NOTIFY`) belong to the worker (tm 289.3): NOTIFY is an
-- accelerator over a 500 ms poll, never a correctness condition (ADR-11a §2.4),
-- and nothing here depends on it.
--
-- Retention: every row names its thread and goes with it (CASCADE), so the
-- retention sweep's thread delete and a customer's erasure take the queue's
-- history with the conversation (ID-08-S1's rule for the decision record).
--
-- Expand-only (CONVENTIONS 6.3): a new table and two new functions, nothing an
-- earlier release reads or writes.

-- --------------------------------------------------------------------------
-- 1. ai_jobs
-- --------------------------------------------------------------------------
-- `created_at` defaults to clock_timestamp(), not CURRENT_TIMESTAMP: it is the
-- per-chat order, and the transaction start would let two sends on one thread
-- that took the thread's sequence lock in one order sort in the other.
--
-- No foreign key on `organization_id` (the licence's cascade already takes
-- the rows) and none on `trigger_event_id` (`events` is partitioned and keyed
-- by (id, created_at)).
CREATE TABLE "ai_jobs" (
    "id"               UUID           NOT NULL,
    "license_id"       BIGINT         NOT NULL,
    "organization_id"  UUID           NOT NULL,
    "chat_id"          VARCHAR(12)    NOT NULL,
    "thread_id"        VARCHAR(12)    NOT NULL,
    "trigger_event_id" VARCHAR(40)    NOT NULL,
    "kind"             TEXT           NOT NULL,
    "state"            TEXT           NOT NULL DEFAULT 'pending',
    "attempts"         INTEGER        NOT NULL DEFAULT 0,
    "available_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until"      TIMESTAMPTZ(6),
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "started_at"       TIMESTAMPTZ(6),
    "finished_at"      TIMESTAMPTZ(6),
    "outcome"          TEXT,
    "last_error"       TEXT,
    "request_id"       VARCHAR(64),

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_jobs_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_jobs_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_jobs_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `AI_JOB_KINDS` (`services/ai/ai-jobs.ts`). One kind for now (ADR-11a §2.9).
    CONSTRAINT ai_jobs_kind_check CHECK (kind IN ('visitor_message')),
    -- `AI_JOB_STATES`.
    CONSTRAINT ai_jobs_state_check CHECK (
      state IN ('pending', 'running', 'done', 'expired', 'failed')
    ),
    -- What each state carries. A `running` job without a lease could never be
    -- re-taken if its worker died; a finished one without `finished_at` would
    -- have no age for the queue's metrics.
    CONSTRAINT ai_jobs_state_shape_check CHECK (
      CASE state
        WHEN 'pending' THEN lease_until IS NULL AND finished_at IS NULL
        WHEN 'running' THEN lease_until IS NOT NULL AND started_at IS NOT NULL
                            AND finished_at IS NULL
        ELSE lease_until IS NULL AND finished_at IS NOT NULL
      END
    ),
    CONSTRAINT ai_jobs_attempts_check CHECK (attempts >= 0),
    -- A code, not prose: the queue never holds conversation text (the ID-08
    -- rule), and a code is something a dashboard can group by.
    CONSTRAINT ai_jobs_outcome_check CHECK (
      outcome IS NULL OR outcome ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
    CONSTRAINT ai_jobs_last_error_check CHECK (
      last_error IS NULL OR char_length(last_error) <= 1000
    )
);

-- One job per message and kind: a second enqueue of the same event is a
-- refused write, not a race.
CREATE UNIQUE INDEX "ai_jobs_license_id_trigger_event_id_kind_key"
  ON "ai_jobs"("license_id", "trigger_event_id", "kind");
-- The claim's entry point (the unfinished rows) and the queue's depth and age.
CREATE INDEX "ai_jobs_state_available_at_idx" ON "ai_jobs"("state", "available_at");
-- One chat's jobs in order (the outbox's per-chat ceiling), and the chat's cascade.
CREATE INDEX "ai_jobs_chat_id_created_at_idx" ON "ai_jobs"("chat_id", "created_at");
-- The thread's cascade (the retention sweep deletes threads).
CREATE INDEX "ai_jobs_thread_id_idx" ON "ai_jobs"("thread_id");

-- Two policies, no FOR ALL: the role reads its tenant's rows and enqueues
-- into them, and an enqueue is a new job — `pending`, or `expired` at the door
-- (the per-chat ceiling, ADR-11a §2.5) — never one that is already running.
-- Both tenant ids are checked: the worker opens the job's tenant context from
-- the row, so a row filed under another organization would run there.
ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_jobs_tenant_read ON ai_jobs FOR SELECT
  USING (license_id = siyahtus_current_license()
         AND organization_id = siyahtus_current_organization());
CREATE POLICY ai_jobs_tenant_enqueue ON ai_jobs FOR INSERT
  WITH CHECK (license_id = siyahtus_current_license()
              AND organization_id = siyahtus_current_organization()
              AND state IN ('pending', 'expired')
              AND attempts = 0
              AND started_at IS NULL);

-- The default privileges (20260722090000) granted UPDATE and DELETE too.
-- State moves through the functions below; rows leave with their thread.
GRANT SELECT, INSERT ON ai_jobs TO siyahtus_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ai_jobs FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. ai_jobs_claim — take due jobs, one chat at a time
-- --------------------------------------------------------------------------
-- Called by the worker outside any tenant context. Returns at most `p_limit`
-- jobs, each now `running` with a lease of `p_lease_seconds`, `attempts`
-- counted up, and the tenant ids the worker opens `withTenant` with. A job is
-- due when it is the oldest unfinished job of its chat and either `pending`
-- past its `available_at`, or `running` with a lease that ran out (its worker
-- died). Oldest jobs first across the fleet.
--
-- Why two workers cannot take the same job, or two jobs of one chat:
--
--   * The chat's head is chosen from every unfinished row, locked or not, so
--     a head another worker is holding is skipped (SKIP LOCKED) and the chat
--     with it — the next job is never promoted past a head in flight.
--   * The lock re-checks the row's state against its newest committed
--     version (READ COMMITTED), so a head that another worker claimed or
--     settled in the meantime no longer qualifies.
--   * A chat whose head is `running` under a live lease has no due head.
--
-- Attempts. `p_max_attempts` is how many times a job may be run (ADR-11a §2.2:
-- two). A job whose worker died after its last allowed attempt is claimed once
-- more, with `attempts` = `p_max_attempts` + 1: that pass must not run the
-- model again, only hand the conversation to a human and settle `failed`
-- (`AiJobClaim.exhausted`). If that pass dies too, the next claim settles the
-- job `failed` itself, so a job can never hold its chat forever.
--
-- `clock_timestamp()`, not `now()`, so "due" and the leases are right even
-- when a caller runs this inside a longer transaction.
CREATE FUNCTION ai_jobs_claim(
  p_limit         INTEGER,
  p_lease_seconds INTEGER,
  p_max_attempts  INTEGER DEFAULT 2
)
RETURNS TABLE (
  id               UUID,
  license_id       BIGINT,
  organization_id  UUID,
  chat_id          VARCHAR,
  thread_id        VARCHAR,
  trigger_event_id VARCHAR,
  kind             TEXT,
  attempts         INTEGER,
  created_at       TIMESTAMPTZ,
  request_id       VARCHAR
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600
     OR p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'ai_jobs_claim: invalid argument' USING ERRCODE = '22023';
  END IF;

  -- A job past its last pass: failed, so its chat moves on. SKIP LOCKED — a
  -- row another claim is touching is that claim's to decide.
  UPDATE ai_jobs r
     SET state = 'failed',
         lease_until = NULL,
         finished_at = v_now,
         outcome = 'attempts_exhausted',
         last_error = COALESCE(r.last_error, 'the worker stopped during every attempt')
   WHERE r.id IN (
           SELECT x.id
             FROM ai_jobs x
            WHERE x.attempts > p_max_attempts
              AND (x.state = 'pending'
                   OR (x.state = 'running' AND x.lease_until <= v_now))
              FOR UPDATE SKIP LOCKED);

  RETURN QUERY
  WITH heads AS (
    SELECT DISTINCT ON (h.chat_id)
           h.id, h.state, h.available_at, h.lease_until, h.attempts
      FROM ai_jobs h
     WHERE h.state IN ('pending', 'running')
     ORDER BY h.chat_id, h.created_at, h.id
  ),
  picked AS (
    SELECT j.id
      FROM ai_jobs j
     WHERE j.id IN (
             SELECT d.id
               FROM heads d
              WHERE d.attempts <= p_max_attempts
                AND ((d.state = 'pending' AND d.available_at <= v_now)
                     OR (d.state = 'running' AND d.lease_until <= v_now)))
       AND j.attempts <= p_max_attempts
       AND ((j.state = 'pending' AND j.available_at <= v_now)
            OR (j.state = 'running' AND j.lease_until <= v_now))
     ORDER BY j.created_at, j.id
     LIMIT p_limit
       FOR UPDATE OF j SKIP LOCKED
  ),
  claimed AS (
    -- The row's own clock, not `v_now`: a head settled after `v_now` was read
    -- but before this statement's snapshot is gone by now, and its successor
    -- must not look as if it started before that head finished.
    UPDATE ai_jobs c
       SET state = 'running',
           attempts = c.attempts + 1,
           lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
           started_at = COALESCE(c.started_at, clock_timestamp())
      FROM picked p
     WHERE c.id = p.id
    RETURNING c.id, c.license_id, c.organization_id, c.chat_id, c.thread_id,
              c.trigger_event_id, c.kind, c.attempts, c.created_at, c.request_id
  )
  SELECT k.id, k.license_id, k.organization_id, k.chat_id, k.thread_id,
         k.trigger_event_id, k.kind, k.attempts, k.created_at, k.request_id
    FROM claimed k
   ORDER BY k.created_at, k.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_jobs_claim(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_jobs_claim(INTEGER, INTEGER, INTEGER) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 3. ai_jobs_settle — record the result of a claim
-- --------------------------------------------------------------------------
-- Called inside the job's tenant (`withTenant`), ideally in the transaction
-- that writes the reply, so "reply written" and "job done" commit together.
-- Without a tenant the call is refused; another tenant's job is not found.
--
-- `p_attempts` is the number the claim returned. It is the fence: once a
-- lease runs out and another worker re-claims the job, the first worker's
-- number is stale and its settle changes nothing (returns false) — the job
-- belongs to whoever holds the newest claim.
--
-- `done`, `expired`, `failed` finish the job. `pending` hands it back to be
-- claimed again after `p_retry_after_seconds` (the attempt still counts).
-- `last_error` keeps the previous one when this settle names none.
CREATE FUNCTION ai_jobs_settle(
  p_job_id              UUID,
  p_attempts            INTEGER,
  p_state               TEXT,
  p_outcome             TEXT,
  p_last_error          TEXT DEFAULT NULL,
  p_retry_after_seconds INTEGER DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license BIGINT := siyahtus_current_license();
  v_now     TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'ai_jobs_settle needs a tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_job_id IS NULL OR p_attempts IS NULL OR p_attempts < 1
     OR p_state IS NULL OR p_state NOT IN ('done', 'expired', 'failed', 'pending')
     OR (p_outcome IS NOT NULL AND p_outcome !~ '^[a-z][a-z0-9_]{0,63}$')
     OR p_retry_after_seconds IS NULL
     OR p_retry_after_seconds < 0 OR p_retry_after_seconds > 3600 THEN
    RAISE EXCEPTION 'ai_jobs_settle: invalid argument' USING ERRCODE = '22023';
  END IF;

  UPDATE ai_jobs j
     SET state = p_state,
         lease_until = NULL,
         finished_at = CASE WHEN p_state = 'pending' THEN NULL ELSE v_now END,
         available_at = CASE WHEN p_state = 'pending'
                             THEN v_now + make_interval(secs => p_retry_after_seconds)
                             ELSE j.available_at END,
         outcome = p_outcome,
         last_error = COALESCE(left(p_last_error, 1000), j.last_error)
   WHERE j.id = p_job_id
     AND j.license_id = v_license
     AND j.state = 'running'
     AND j.attempts = p_attempts;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_jobs_settle(UUID, INTEGER, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_jobs_settle(UUID, INTEGER, TEXT, TEXT, TEXT, INTEGER) TO siyahtus_app;
