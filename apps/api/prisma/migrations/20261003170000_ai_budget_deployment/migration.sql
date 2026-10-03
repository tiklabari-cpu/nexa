-- The daily AI caps for operator work (tm 257.20 · ADR
-- docs/adr/pilot-public-readiness.md K-e(3) · PLAN §D203).
--
-- `knowledge:reembed` moves every workspace's stored knowledge into the space
-- the configured embedding provider writes. It is an operator's migration, not
-- something a workspace asked for, so it must not spend any workspace's daily
-- allowance — a re-embed run on the morning a provider is switched would
-- otherwise switch every workspace's AI off for the rest of the day. It still
-- spends the deployment's key, so it counts on the deployment row and stops
-- when that is full.
--
-- `ai_budget_reserve` and `ai_budget_settle` (20261002150000) take the
-- workspace from the transaction and always write its row, so they cannot do
-- this. These two are their deployment-only halves: the same statement shape,
-- the same row lock, the deployment row (license_id NULL) alone.
--
-- Expand-only (CONVENTIONS §6.3): two new functions; nothing the previous
-- release reads or calls changes.

-- --------------------------------------------------------------------------
-- 1. ai_budget_reserve_deployment — check and count the deployment row
-- --------------------------------------------------------------------------
-- NULL when the estimate was reserved, 'global' when it would cross the
-- deployment's cap (and nothing was reserved). One `INSERT … ON CONFLICT DO
-- UPDATE … WHERE` whose WHERE is the cap, as in ai_budget_reserve, so a re-embed
-- and the API's own calls queue on the same row and none slips past the line.
-- No tenant is read: whoever runs this is spending the deployment's allowance,
-- not a workspace's.
CREATE FUNCTION ai_budget_reserve_deployment(
  p_day        TEXT,
  p_meter      TEXT,
  p_estimate   BIGINT,
  p_global_cap BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_meter NOT IN ('llm', 'embedding') OR p_day !~ '^[0-9]{8}$'
     OR p_estimate IS NULL OR p_estimate < 0
     OR p_global_cap IS NULL OR p_global_cap < 1 THEN
    RAISE EXCEPTION 'ai_budget_reserve_deployment: invalid argument' USING ERRCODE = '22023';
  END IF;

  INSERT INTO ai_daily_usage AS u (id, license_id, day, meter, reserved, used, updated_at)
  SELECT gen_random_uuid(), NULL, p_day, p_meter, p_estimate, 0, now()
   WHERE p_estimate <= p_global_cap
  ON CONFLICT (license_id, day, meter) DO UPDATE
     SET reserved = u.reserved + EXCLUDED.reserved, updated_at = now()
   WHERE u.reserved + u.used + EXCLUDED.reserved <= p_global_cap;
  IF NOT FOUND THEN
    RETURN 'global';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_budget_reserve_deployment(TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_budget_reserve_deployment(TEXT, TEXT, BIGINT, BIGINT) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. ai_budget_settle_deployment — the estimate handed back, the cost kept
-- --------------------------------------------------------------------------
-- ai_budget_settle's deployment half: the reservation's day, never below zero.
CREATE FUNCTION ai_budget_settle_deployment(
  p_day      TEXT,
  p_meter    TEXT,
  p_reserved BIGINT,
  p_used     BIGINT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_reserved IS NULL OR p_reserved < 0 OR p_used IS NULL OR p_used < 0 THEN
    RAISE EXCEPTION 'ai_budget_settle_deployment: invalid argument' USING ERRCODE = '22023';
  END IF;

  UPDATE ai_daily_usage u
     SET reserved = GREATEST(u.reserved - p_reserved, 0), used = u.used + p_used, updated_at = now()
   WHERE u.license_id IS NULL AND u.day = p_day AND u.meter = p_meter;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_budget_settle_deployment(TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_budget_settle_deployment(TEXT, TEXT, BIGINT, BIGINT) TO siyahtus_app;
