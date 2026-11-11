-- One named outbox row, sent now (tm 464.2 · G-05 / NY-44).
--
-- 464.1 built the queue and its sender; 464.2 moves the callers onto it. A
-- request that queues a mail — an invitation, a password reset, a ticket reply
-- — should not wait up to a scheduler interval for it to leave: the process
-- that queued it sends it straight after its commit, the way it used to send
-- it directly, and the `mail_outbox` job is what is left for a mail whose
-- first try failed or whose process went away.
--
-- `mail_outbox_claim_one` is `mail_outbox_claim` narrowed to one id: the same
-- due/attempts rules, the same lease, the same `FOR UPDATE SKIP LOCKED` — so a
-- row the scheduler's pass is taking at this moment is skipped, not waited
-- for, and is sent once, by that pass. No row comes back when the id is not
-- due (already leased, settled or backing off): the caller then leaves it to
-- whoever holds it.
--
-- Expand-only (CONVENTIONS §6.3): a new function; nothing earlier reads it.
CREATE FUNCTION mail_outbox_claim_one(
  p_id            UUID,
  p_lease_seconds INTEGER,
  p_max_attempts  INTEGER
)
RETURNS TABLE (
  id          UUID,
  license_id  BIGINT,
  kind        TEXT,
  recipient   TEXT,
  payload     JSONB,
  attempts    INTEGER,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_id IS NULL
     OR p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600
     OR p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 20 THEN
    RAISE EXCEPTION 'mail_outbox_claim_one: invalid argument' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE mail_outbox r
     SET attempts = r.attempts + 1,
         next_attempt_at = v_now + make_interval(secs => p_lease_seconds)
   WHERE r.id IN (
     SELECT o.id FROM mail_outbox o
      WHERE o.id = p_id
        AND o.status = 'pending'
        AND o.next_attempt_at <= v_now
        AND o.attempts < p_max_attempts
      FOR UPDATE SKIP LOCKED)
  RETURNING r.id, r.license_id, r.kind, r.recipient, r.payload, r.attempts, r.created_at;
END
$$;

REVOKE EXECUTE ON FUNCTION mail_outbox_claim_one(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mail_outbox_claim_one(UUID, INTEGER, INTEGER) TO siyahtus_app;
