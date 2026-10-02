-- Daily AI token caps (tm 257.8 · ADR docs/adr/pilot-public-readiness.md
-- K-e(3) · PLAN §D203).
--
-- Sign-up is public in the pilot: a stranger can open a workspace, put the
-- widget on any page and have visitors talk to the model on the deployment's
-- key. Nothing counted that spend per day; `usage_records` is the monthly
-- invoice's meter and refuses nothing. This table is the day's count, per
-- workspace and for the whole deployment, and the three functions below are
-- the only things that write or decide on it.
--
-- Expand-only (CONVENTIONS §6.3): a new table and new functions; nothing an
-- API from the previous release reads changes.

-- --------------------------------------------------------------------------
-- 1. ai_daily_usage
-- --------------------------------------------------------------------------
-- One row per (workspace, UTC day, meter), and one per (day, meter) with
-- license_id NULL for the deployment. `reserved` is what calls in flight were
-- allowed to spend (their estimate), `used` what finished calls cost. A new
-- day is a new row, so nothing ever has to reset a counter at midnight.
--
-- The unique key is NULLS NOT DISTINCT so the deployment row is one row per
-- day and meter, and `ON CONFLICT` finds it like any other. Prisma has no
-- syntax for that clause and describes the index by its three columns, which
-- is what schema.prisma declares.
--
-- No database-side id default (the functions supply gen_random_uuid(), as
-- 20261002120000 does for email_verification_tokens) and `ON UPDATE CASCADE`
-- like every other foreign key, so the drift check has nothing to report.
CREATE TABLE ai_daily_usage (
    "id"         UUID           NOT NULL,
    "license_id" BIGINT,
    "day"        CHAR(8)        NOT NULL,
    "meter"      TEXT           NOT NULL,
    "reserved"   BIGINT         NOT NULL DEFAULT 0,
    "used"       BIGINT         NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_daily_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_daily_usage_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX ai_daily_usage_license_id_day_meter_key
    ON ai_daily_usage (license_id, day, meter) NULLS NOT DISTINCT;

-- A workspace may read its own rows (an admin screen can show today's count);
-- the deployment row matches no licence, so no tenant ever sees it. Nothing
-- but the functions below writes: the application role keeps SELECT only, so
-- the check and the increment cannot be split into two statements by a later
-- caller that found the table writable.
ALTER TABLE ai_daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_daily_usage_tenant ON ai_daily_usage
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT ON ai_daily_usage TO siyahtus_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ai_daily_usage FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. ai_budget_reserve — check and count in one statement per row
-- --------------------------------------------------------------------------
-- Called before a provider call with the call's estimate. Reserves it on the
-- calling workspace's row and on the deployment row, or on neither, and
-- answers NULL (reserved), 'workspace' or 'global' (which cap would be
-- crossed; the workspace is asked first).
--
-- Each row is one `INSERT … ON CONFLICT DO UPDATE … WHERE` whose WHERE is the
-- cap: Postgres locks the conflicting row and evaluates the WHERE against its
-- latest committed version, so concurrent calls queue on the row and the last
-- one that fits is the last one counted — no read-then-write window. An
-- estimate over the cap on a row that does not exist yet inserts nothing.
-- When the workspace fits and the deployment does not, the workspace's
-- reservation is handed back in the same transaction. Rows are always taken
-- workspace first, deployment second (here and in ai_budget_settle), so two
-- calls never wait on each other in opposite orders.
--
-- The workspace is the transaction's tenant (`app.current_license`), never a
-- parameter: a caller can only spend its own allowance. Without a tenant the
-- call is refused.
CREATE FUNCTION ai_budget_reserve(
  p_day           TEXT,
  p_meter         TEXT,
  p_estimate      BIGINT,
  p_workspace_cap BIGINT,
  p_global_cap    BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license BIGINT := siyahtus_current_license();
BEGIN
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'ai_budget_reserve needs a tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_meter NOT IN ('llm', 'embedding') OR p_day !~ '^[0-9]{8}$'
     OR p_estimate IS NULL OR p_estimate < 0
     OR p_workspace_cap IS NULL OR p_workspace_cap < 1
     OR p_global_cap IS NULL OR p_global_cap < 1 THEN
    RAISE EXCEPTION 'ai_budget_reserve: invalid argument' USING ERRCODE = '22023';
  END IF;

  INSERT INTO ai_daily_usage AS u (id, license_id, day, meter, reserved, used, updated_at)
  SELECT gen_random_uuid(), v_license, p_day, p_meter, p_estimate, 0, now()
   WHERE p_estimate <= p_workspace_cap
  ON CONFLICT (license_id, day, meter) DO UPDATE
     SET reserved = u.reserved + EXCLUDED.reserved, updated_at = now()
   WHERE u.reserved + u.used + EXCLUDED.reserved <= p_workspace_cap;
  IF NOT FOUND THEN
    RETURN 'workspace';
  END IF;

  INSERT INTO ai_daily_usage AS u (id, license_id, day, meter, reserved, used, updated_at)
  SELECT gen_random_uuid(), NULL, p_day, p_meter, p_estimate, 0, now()
   WHERE p_estimate <= p_global_cap
  ON CONFLICT (license_id, day, meter) DO UPDATE
     SET reserved = u.reserved + EXCLUDED.reserved, updated_at = now()
   WHERE u.reserved + u.used + EXCLUDED.reserved <= p_global_cap;
  IF NOT FOUND THEN
    UPDATE ai_daily_usage u
       SET reserved = u.reserved - p_estimate, updated_at = now()
     WHERE u.license_id = v_license AND u.day = p_day AND u.meter = p_meter;
    RETURN 'global';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_budget_reserve(TEXT, TEXT, BIGINT, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_budget_reserve(TEXT, TEXT, BIGINT, BIGINT, BIGINT) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 3. ai_budget_settle — the estimate handed back, the real cost kept
-- --------------------------------------------------------------------------
-- Called once per reservation when the call has ended, with the day the
-- reservation was made on (a call that crosses midnight settles yesterday's
-- row) and what it cost: the provider's own count when it reported one, the
-- estimate when it could not say. Never below zero — a reservation is handed
-- back once, and a defect that handed one back twice must not mint allowance.
CREATE FUNCTION ai_budget_settle(
  p_day      TEXT,
  p_meter    TEXT,
  p_reserved BIGINT,
  p_used     BIGINT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license BIGINT := siyahtus_current_license();
BEGIN
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'ai_budget_settle needs a tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_reserved IS NULL OR p_reserved < 0 OR p_used IS NULL OR p_used < 0 THEN
    RAISE EXCEPTION 'ai_budget_settle: invalid argument' USING ERRCODE = '22023';
  END IF;

  UPDATE ai_daily_usage u
     SET reserved = GREATEST(u.reserved - p_reserved, 0), used = u.used + p_used, updated_at = now()
   WHERE u.license_id = v_license AND u.day = p_day AND u.meter = p_meter;

  UPDATE ai_daily_usage u
     SET reserved = GREATEST(u.reserved - p_reserved, 0), used = u.used + p_used, updated_at = now()
   WHERE u.license_id IS NULL AND u.day = p_day AND u.meter = p_meter;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_budget_settle(TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_budget_settle(TEXT, TEXT, BIGINT, BIGINT) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 4. ai_budget_exhausted — the question asked before any work starts
-- --------------------------------------------------------------------------
-- Whether a call of at least `p_minimum` could still fit: 'workspace' or
-- 'global' when it could not, NULL when it might. Asked before a visitor's
-- question is embedded and before a Copilot or Preview handler runs, so a
-- capped workspace costs no embedding and no work. Reads only; a SECURITY
-- DEFINER because the deployment row is invisible to the application role.
CREATE FUNCTION ai_budget_exhausted(
  p_day           TEXT,
  p_meter         TEXT,
  p_minimum       BIGINT,
  p_workspace_cap BIGINT,
  p_global_cap    BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license BIGINT := siyahtus_current_license();
BEGIN
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'ai_budget_exhausted needs a tenant context' USING ERRCODE = '42501';
  END IF;

  IF p_minimum > p_workspace_cap OR EXISTS (
    SELECT 1 FROM ai_daily_usage u
     WHERE u.license_id = v_license AND u.day = p_day AND u.meter = p_meter
       AND u.reserved + u.used + p_minimum > p_workspace_cap
  ) THEN
    RETURN 'workspace';
  END IF;

  IF p_minimum > p_global_cap OR EXISTS (
    SELECT 1 FROM ai_daily_usage u
     WHERE u.license_id IS NULL AND u.day = p_day AND u.meter = p_meter
       AND u.reserved + u.used + p_minimum > p_global_cap
  ) THEN
    RETURN 'global';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_budget_exhausted(TEXT, TEXT, BIGINT, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_budget_exhausted(TEXT, TEXT, BIGINT, BIGINT, BIGINT) TO siyahtus_app;
