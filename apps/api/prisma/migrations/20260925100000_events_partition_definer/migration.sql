-- `events` partition maintenance runs as the runtime role (tm 255.14 · PLAN
-- §D131 → §D187 · SEMA-MIMARI.8.4c).
--
-- plugins/database.ts opens the months ahead of "now" at boot and every six
-- hours, through DATABASE_APP_URL -- siyahtus_app, the role that owns nothing.
-- Until this migration events_ensure_partition ran with its caller's rights,
-- and the caller has neither of the two it needs. Measured 2026-09-25 on the
-- development database, connected as siyahtus_app:
--
--   SELECT events_ensure_partition(now() + interval '20 months');
--     -> 42501 permission denied for schema public
--   ... and with GRANT CREATE ON SCHEMA public TO siyahtus_app added by hand:
--     -> 42501 must be owner of table events
--
-- So no narrower grant can fix it: attaching a partition is the table owner's
-- act. It stayed silent only because every month the maintenance pass asked
-- for already existed (the domain migration's one-off window reached 2027-02
-- on that database). The first month it would have had to open itself failed
-- inside the plugin's catch, and every event after it went to events_default.
--
-- The fix is the narrow SECURITY DEFINER pattern the auth_* resolvers already
-- use: the two functions that run DDL run with the owner's rights, and are
-- written so those rights can do exactly one thing each.
--
-- What SECURITY DEFINER hands the runtime role here, and why that is safe:
--
--   events_ensure_partition(p_when)  opens the monthly partition of
--     public.events containing p_when, and secures it. Its only input is a
--     timestamptz: the table name, the schema, the bounds and the statements
--     are derived or fixed, and quoted with %I / %L. p_when must be a finite
--     instant within 60 months of the current month, so however it is driven
--     the runtime role can open at most 121 partitions -- all of events, all
--     born with row level security and the tenant policy, all owned by the
--     owner of events and never by the caller (an owner is exempt from its own
--     table's row level security, so a partition siyahtus_app owned would be one it
--     could read across tenants).
--
--   events_secure_partition(p_name)  enables row level security on p_name and
--     gives it the tenant policy -- only when p_name is a partition of
--     public.events, as pg_inherits knows it (not a name pattern: a partition
--     an operator attached under another name is still covered). Anything else
--     -- another tenant table, the parent, NULL, a crafted string -- is refused
--     before any DDL runs. Aimed at audit_log, the unchecked body would have
--     added a FOR ALL policy to the append-only trail. The runtime role is not
--     granted EXECUTE on it at all: it is reached only from inside
--     events_ensure_partition, already as the owner.
--
-- Both pin search_path (public, pg_temp; pg_catalog is implicitly searched
-- first, pg_temp last and never for functions), and every function in this
-- family loses PUBLIC's EXECUTE: PostgreSQL grants it to PUBLIC by default, so
-- until now any role that could connect could call all three.
--
-- Three behaviours come with the rights, because from now on the runtime role
-- really runs this DDL against the live table:
--
--   * lock_timeout = 1s.  CREATE ... PARTITION OF takes ACCESS EXCLUSIVE on
--     events. Waiting behind a long reader (a report, an export) would queue
--     every new event write behind the waiting CREATE. The pass gives up
--     instead -- 55P03 on /health -- and is retried six hours later, three
--     months ahead of need.
--   * A second instance racing for the same month (both booting as it falls
--     due) waits on the first one's lock and then finds the table there: that
--     is success, not "relation already exists".
--   * A month whose rows already sit in events_default cannot get a partition
--     until they move -- PostgreSQL refuses a partition that rows in the
--     default partition would violate (23514, measured). The error now names
--     the month and the way out. The move is the owner's decision, not the
--     timer's: it rewrites customer rows under ACCESS EXCLUSIVE, so it is
--     events_release_default_month below, granted to nobody, run by hand
--     (docs/runbooks/event-partitions.md).
--
-- Compatible with the code already running (CONVENTIONS §6.3): every
-- signature and return type is unchanged, and the old plugin's single
-- events_maintain_partitions(3, 1) call now succeeds where it used to fail.

-- ---------------------------------------------------------------------------
-- Securing: only an events partition, by the catalog's own account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION events_secure_partition(p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy TEXT := format('%s_tenant', p_name);
BEGIN
  IF p_name IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_inherits i
    JOIN pg_class child ON child.oid = i.inhrelid
    JOIN pg_namespace cn ON cn.oid = child.relnamespace
    WHERE i.inhparent = 'public.events'::regclass
      AND cn.nspname = 'public'
      AND child.relname = p_name
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'invalid_parameter_value',
      MESSAGE = format(
        'events_secure_partition refuses %s: not a partition of public.events',
        coalesce(quote_literal(p_name), 'NULL')
      );
  END IF;

  -- Unchanged from 20260826090000: both steps guarded, because ALTER TABLE ...
  -- ENABLE ROW LEVEL SECURITY takes ACCESS EXCLUSIVE even when it changes
  -- nothing, and a healthy partition should cost two catalog lookups.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = p_name AND c.relrowsecurity
  ) THEN
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = p_name AND policyname = v_policy
  ) THEN
    EXECUTE format(
      'CREATE POLICY %I ON public.%I'
      ' USING (license_id = siyahtus_current_license())'
      ' WITH CHECK (license_id = siyahtus_current_license())',
      v_policy, p_name
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Opening a month: a finite instant near now, and nothing else.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION events_ensure_partition(p_when TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '1s'
AS $$
DECLARE
  v_current DATE := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_start   DATE;
  v_end     DATE;
  v_name    TEXT;
BEGIN
  IF p_when IS NULL OR NOT isfinite(p_when) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'invalid_parameter_value',
      MESSAGE = format(
        'events_ensure_partition refuses %s: needs a finite instant',
        coalesce(p_when::text, 'NULL')
      );
  END IF;

  v_start := date_trunc('month', p_when AT TIME ZONE 'UTC')::date;
  -- Every legitimate caller fits comfortably: the runtime's window is -1..+3,
  -- the domain migration's one-off -2..+6, the transcript measurement's
  -- 36-month fan-out starts 2026-06.
  IF v_start < v_current - INTERVAL '60 months' OR v_start > v_current + INTERVAL '60 months' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'invalid_parameter_value',
      MESSAGE = format(
        'events_ensure_partition refuses %s: more than 60 months from the current month',
        to_char(v_start, 'YYYY-MM')
      );
  END IF;

  v_end  := (v_start + INTERVAL '1 month')::date;
  v_name := format('events_%s', to_char(v_start, 'YYYY_MM'));

  IF to_regclass(format('public.%I', v_name)) IS NULL THEN
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.events FOR VALUES FROM (%L) TO (%L)',
        v_name, v_start, v_end
      );
    EXCEPTION
      WHEN duplicate_table OR unique_violation THEN
        -- Another pass opened it between the check above and this CREATE,
        -- which then waited on that pass's lock. Its partition is ours too.
        IF to_regclass(format('public.%I', v_name)) IS NULL THEN
          RAISE;
        END IF;
      WHEN check_violation THEN
        RAISE EXCEPTION USING
          ERRCODE = 'check_violation',
          MESSAGE = format(
            'events_default holds rows for %s, so that month''s partition cannot be opened',
            to_char(v_start, 'YYYY-MM')
          ),
          HINT = format(
            'As the owner of events: SELECT events_release_default_month(%L) -- docs/runbooks/event-partitions.md',
            v_start
          );
    END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO siyahtus_app', v_name);
  END IF;

  PERFORM events_secure_partition(v_name);
  RETURN v_name;
END;
$$;

-- ---------------------------------------------------------------------------
-- Releasing a blocked month: the owner's tool, granted to nobody.
-- ---------------------------------------------------------------------------
--
-- Moves the rows events_default holds for p_when's month out of the catch-all,
-- opens the month, and writes the rows back through the parent so they land in
-- it. One transaction: it either happens entirely or not at all.
--
-- SECURITY INVOKER and no grant, on purpose: this rewrites customer messages,
-- across tenants, under ACCESS EXCLUSIVE on events (every event read and write
-- waits for the duration). That is a decision for the owner in a quiet window,
-- never for a six-hourly timer. The runbook measures what it costs.
--
-- The column list is read from the catalog, not written out: event_sequence is
-- GENERATED ALWAYS and must be recomputed rather than copied, and a column
-- added later is carried without anyone editing this function.
CREATE OR REPLACE FUNCTION events_release_default_month(p_when TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start   DATE;
  v_end     DATE;
  v_default REGCLASS;
  v_columns TEXT;
  v_moved   BIGINT;
BEGIN
  IF p_when IS NULL OR NOT isfinite(p_when) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'invalid_parameter_value',
      MESSAGE = format(
        'events_release_default_month refuses %s: needs a finite instant',
        coalesce(p_when::text, 'NULL')
      );
  END IF;

  v_start := date_trunc('month', p_when AT TIME ZONE 'UTC')::date;
  v_end   := (v_start + INTERVAL '1 month')::date;

  SELECT NULLIF(pt.partdefid, 0)::regclass INTO v_default
  FROM pg_partitioned_table pt
  WHERE pt.partrelid = 'public.events'::regclass;
  IF v_default IS NULL THEN
    RETURN 0;
  END IF;

  -- The lock the partition's CREATE takes anyway, taken first: no row for this
  -- month can reach the default between the move and the create, and there is
  -- no lock upgrade halfway through to deadlock on.
  LOCK TABLE public.events IN ACCESS EXCLUSIVE MODE;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_columns
  FROM pg_attribute a
  WHERE a.attrelid = 'public.events'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attgenerated = '';

  EXECUTE format(
    'CREATE TEMP TABLE events_release_parked ON COMMIT DROP AS'
    ' SELECT %s FROM %s WHERE created_at >= %L AND created_at < %L',
    v_columns, v_default, v_start, v_end
  );
  EXECUTE format(
    'DELETE FROM %s WHERE created_at >= %L AND created_at < %L',
    v_default, v_start, v_end
  );
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  PERFORM events_ensure_partition(v_start);

  EXECUTE format(
    'INSERT INTO public.events (%s) SELECT %s FROM pg_temp.events_release_parked',
    v_columns, v_columns
  );
  DROP TABLE pg_temp.events_release_parked;
  RETURN v_moved;
END;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE: nobody by default, the runtime role only where it needs to be.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION events_ensure_partition(TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION events_secure_partition(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION events_maintain_partitions(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION events_release_default_month(TIMESTAMPTZ) FROM PUBLIC;

-- Reached only through events_ensure_partition, which already runs as the owner.
REVOKE EXECUTE ON FUNCTION events_secure_partition(TEXT) FROM siyahtus_app;

GRANT EXECUTE ON FUNCTION events_ensure_partition(TIMESTAMPTZ) TO siyahtus_app;
-- SECURITY INVOKER, a loop over events_ensure_partition: granting it hands the
-- runtime role nothing it does not already hold. Kept because the plugin still
-- running during a rollout calls it.
GRANT EXECUTE ON FUNCTION events_maintain_partitions(INT, INT) TO siyahtus_app;
