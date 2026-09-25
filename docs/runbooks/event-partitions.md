# Runbook: `events` partition maintenance failing

`events` (every chat message, system message and form a customer ever sent) is
partitioned by month. Each API process opens the months from one before the
current month to three after it — at boot and every six hours — through the
runtime role `nexa_app` (`apps/api/src/services/chat/event-partitions.ts`). An
event whose month has no partition is not lost: it lands in the catch-all
`events_default`. But that table is read whole by every range query that cannot
rule it out, it grows without bound, and once it holds rows for a month
PostgreSQL refuses to open that month's partition at all. Three months of runway
means a failing pass is on `/health` for a quarter before any event is affected —
this runbook is for that quarter.

## Symptom

- The admin `/health` body shows `event_partitions.last_status: "error"` and a
  non-empty `failed_months` (each `{ month, error_code }`). The status code stays
  `200` and `/health/ready` is unaffected, deliberately: the process still
  serves, and restarting it fixes nothing.
- The API log has a line at level `error` (50) with
  `msg: "event partition maintenance failed"` and `component: "event-partitions"`,
  carrying `window`, `consecutive_errors` and `failed_months[]` — each with the
  month, the SQLSTATE and the database's own message. One line per failed pass,
  every six hours per process.
- Left alone past the runway: range queries on `events` slow down as
  `events_default` grows, and the blocked months stay blocked.

## Diagnosis

All queries via `make psql` (dev stack) or the demo stack's `db` container
(`docker compose exec db psql -U nexa nexa`) — as the **owner**. The runtime role
sees no row of `events_default` without a tenant context (row level security), so
counting there as `nexa_app` always says 0.

1. Read the block, with an admin bearer token:

   ```bash
   curl -s -H "Authorization: Bearer $ADMIN_TOKEN" http://127.0.0.1:4000/api/v1/health \
     | jq '.event_partitions'
   ```

2. Act on `error_code`:
   - **`42501`** — the runtime role is running the functions without the owner's
     rights. Either migration `20260925100000_events_partition_definer` is not
     applied, or a later migration re-created a function without
     `SECURITY DEFINER`, or `nexa_app` lost `EXECUTE` on `events_ensure_partition`.
     Every month of the window fails at once — that is by design: the check runs
     on every pass, not only when a month is missing. Confirm:

     ```sql
     SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner,
            has_function_privilege('nexa_app', p.oid, 'EXECUTE') AS runtime_can_execute
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'events\_%'
     ORDER BY p.proname;
     ```

     Expected: `events_ensure_partition` and `events_secure_partition` have
     `prosecdef = t`; every owner is the owner of `events`; `runtime_can_execute`
     is `t` for `events_ensure_partition` and `events_maintain_partitions` only.

   - **`23514`** — rows for that month already sit in `events_default` (they
     arrived while it had no partition), and PostgreSQL will not create a
     partition those rows would violate. Go to **Response → blocked month**.
   - **`55P03`** — the partition's `CREATE` needs `ACCESS EXCLUSIVE` on `events`
     and could not get it within one second, because a long transaction was
     reading or writing events. The function gives up rather than queue every
     event write behind itself. Transient: the next pass retries. Only a streak
     over days matters — find what holds the table:

     ```sql
     SELECT pid, now() - xact_start AS age, state, left(query, 80) AS query
     FROM pg_stat_activity
     WHERE xact_start < now() - interval '1 minute'
     ORDER BY xact_start;
     ```

   - **`22023`** — the pass asked for a month more than 60 months from now,
     which the function refuses. A code or configuration error in the window, not
     an operational one.
   - **Anything else** (`P1001`, a class name) — the database did not answer at
     all; see [`postgres-down.md`](postgres-down.md).

3. How much runway is left — every partition and its bounds:

   ```sql
   SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bounds
   FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
   WHERE i.inhparent = 'public.events'::regclass
   ORDER BY c.relname;
   ```

4. What `events_default` holds, by month:

   ```sql
   SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, count(*)
   FROM events_default GROUP BY 1 ORDER BY 1;
   ```

   A month inside the window (last month to three ahead) with rows here is
   blocked. Rows far outside it — a skewed clock, a bad import dated 2098 — are
   the catch-all doing its job; they block nothing and can stay.

## Response

- **`42501`** — apply the migrations as the migration role (the Helm `migrate`
  Job, or the compose `init` service; `prisma migrate deploy`). Then open the
  window at once, as the owner, rather than wait six hours for the next pass:

  ```sql
  SELECT events_maintain_partitions(3, 1);
  ```

  Do **not** reach for a narrower grant instead.
  `GRANT CREATE ON SCHEMA public TO nexa_app` does not work — measured, the next
  error is `must be owner of table events` — and pointing the API at the owner
  role switches off row level security for every tenant.

- **Blocked month (`23514`)** — release it, as the owner, in a quiet window:

  ```sql
  SET lock_timeout = '5s';
  SELECT events_release_default_month('2026-12-01');  -- any instant in the blocked month
  ```

  It moves that month's rows out of `events_default`, opens the partition and
  writes the rows back through `events` so they land in it: one transaction,
  every column kept (the generated `event_sequence` recomputed), all of it or
  none. It returns the number of rows moved. It holds `ACCESS EXCLUSIVE` on
  `events` for its whole duration — **every event read and write waits** —
  which is why it is the owner's decision and never the six-hourly pass's.
  Measured on a private database (tm 255.14): 10 000 rows in 0.26 s, 100 000 rows
  in 1.6 s (about 60 000 rows a second). If the lock is not free within five
  seconds it fails without changing anything; run it again.

  `nexa_app` cannot run it (no grant), and the function refuses NULL and
  infinite instants. A month more than 60 months from now cannot be released
  this way — its partition would be refused anyway; leave those rows where they
  are.

- **`55P03`** — end or wait out the long transaction step 2 found; the next pass
  opens the month. With three months of runway, a few failed passes cost
  nothing.

## After

- `/health` reports the API's own passes, not yours: after the fix, its next pass
  (within six hours, or at once on a restart — the boot pass) shows
  `last_status: "ok"`, `consecutive_errors: 0` and `failed_months: []`. A process
  that failed and then recovers also logs one
  `event partition maintenance recovered` line; a restarted one starts its count
  afresh and just reports ok.
- Diagnosis step 4 shows no month inside the window.
- If the cause was `42501`, find out how the functions lost their rights before
  closing: that is a migration defect, and
  `apps/api/test/integration/event-partition-maintenance.test.ts` is the suite
  that should have gone red.
