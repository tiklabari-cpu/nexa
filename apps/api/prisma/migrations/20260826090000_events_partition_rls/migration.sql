-- Row level security on every `events` partition, not just on the parent.
--
-- `events` is monthly RANGE partitioned. RLS on a partitioned table only
-- governs access that goes *through* the parent: a query naming a partition
-- directly is checked against that partition's own policies. The domain model
-- migration enabled RLS on `events` but never on its partitions, and it hands
-- every new partition `GRANT SELECT, INSERT, UPDATE, DELETE ... TO nexa_app` --
-- so the runtime role could read every tenant's rows with
-- `SELECT * FROM events_2026_08`. Measured on the development database
-- (2026-08-26, role nexa_app, no tenant context set):
--
--   SELECT count(*) FROM events;          -> 0     (parent policy holds)
--   SELECT count(*) FROM events_2026_08;  -> 113   (partition wide open)
--
-- Revoking the grant would not fix it: `ALTER DEFAULT PRIVILEGES` in
-- 20260722090000_init_extensions re-grants DML on every table created later, so
-- each new month would re-open the hole. The durable fix is to give each
-- partition the parent's policy, and to make partition creation itself do that
-- from now on.

-- ---------------------------------------------------------------------------
-- One place that knows what "a secured partition" means.
-- ---------------------------------------------------------------------------
--
-- The policy body is byte-for-byte the parent's `events_tenant`, so a query
-- through the parent -- where PostgreSQL applies both -- keeps its current
-- result rather than intersecting two subtly different rules.
--
-- Both steps are guarded rather than blindly re-run: `ALTER TABLE ... ENABLE
-- ROW LEVEL SECURITY` takes an ACCESS EXCLUSIVE lock even when it changes
-- nothing, and this runs from the partition scheduler every six hours against
-- the live table. Guarded, a healthy partition costs two catalog lookups and
-- takes no lock at all.
CREATE OR REPLACE FUNCTION events_secure_partition(p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy TEXT := format('%s_tenant', p_name);
BEGIN
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
      ' USING (license_id = nexa_current_license())'
      ' WITH CHECK (license_id = nexa_current_license())',
      v_policy, p_name
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION events_secure_partition(TEXT) TO nexa_app;

-- ---------------------------------------------------------------------------
-- Every partition created from now on is born protected.
-- ---------------------------------------------------------------------------
--
-- Unchanged from 20260722154008 except that securing now happens on *both*
-- paths. The old body returned early when the partition already existed, which
-- meant a partition created by any other route stayed unprotected forever; the
-- guards inside events_secure_partition make the unconditional call cheap, so
-- the function is self-healing instead.
CREATE OR REPLACE FUNCTION events_ensure_partition(p_when TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start DATE := date_trunc('month', p_when AT TIME ZONE 'UTC')::date;
  v_end   DATE := (date_trunc('month', p_when AT TIME ZONE 'UTC') + INTERVAL '1 month')::date;
  v_name  TEXT := format('events_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
  IF to_regclass(format('public.%I', v_name)) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.events FOR VALUES FROM (%L) TO (%L)',
      v_name, v_start, v_end
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO nexa_app', v_name);
  END IF;

  PERFORM events_secure_partition(v_name);
  RETURN v_name;
END;
$$;

-- ---------------------------------------------------------------------------
-- And every partition that already exists is fixed retroactively.
-- ---------------------------------------------------------------------------
--
-- Read from pg_inherits rather than from a name pattern, so `events_default`
-- (created directly, not by the function) is included and a partition named off
-- convention cannot slip through.
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT child.relname
    FROM pg_inherits i
    JOIN pg_class child  ON child.oid = i.inhrelid
    JOIN pg_class parent ON parent.oid = i.inhparent
    JOIN pg_namespace cn ON cn.oid = child.relnamespace
    JOIN pg_namespace pn ON pn.oid = parent.relnamespace
    WHERE parent.relname = 'events' AND pn.nspname = 'public' AND cn.nspname = 'public'
    ORDER BY child.relname
  LOOP
    PERFORM events_secure_partition(v_name);
  END LOOP;
END;
$$;
