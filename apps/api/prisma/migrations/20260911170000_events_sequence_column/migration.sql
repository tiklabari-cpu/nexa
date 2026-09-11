-- The column a transcript page is actually ordered by (NFR-P6).
--
-- `chat-service.ts#listEvents` and `apps/rtm/src/sync.ts` both page a thread by
-- the per-thread sequence, and that sequence lives *inside* the event id
-- (`<thread_id>_<seq>`) rather than in a column -- deliberately, and the reason
-- is written beside both queries: several events can share a millisecond, so
-- `created_at` cannot decide what "next" means. Until now both dug it back out
-- with `(split_part(id, '_', 2))::bigint`, nothing indexed that expression, and
-- every page read the whole thread and sorted it. Measured on a scratch
-- database (`pnpm --filter @nexa/api measure:transcript-page 2000`, PostgreSQL
-- 17.10): growing one thread from 2 000 to 20 000 events multiplied the page's
-- shared buffers by 10.03 (35 -> 351) and its time by 10.4 (1.4 ms -> 14.9 ms).
-- The PRD asks for the opposite of that ("sabit-zaman").
--
-- A COLUMN RATHER THAN AN EXPRESSION INDEX, and the reason is a measurement
-- rather than a preference. An index on `(thread_id, (split_part(id,'_',2))
-- ::bigint)` was built and measured first, and under `nexa` -- the owner, which
-- bypasses row level security -- it is perfect:
--
--   Index Cond: thread_id = $1 AND (split_part(id,'_',2))::bigint > $2
--
-- Under `nexa_app`, which is the role the product runs as, the same index on
-- the same rows gives:
--
--   Index Cond: thread_id = $1
--   Filter:     license_id = ... AND (split_part(id,'_',2))::bigint > $2
--
-- `events` carries RLS, RLS makes the table a security barrier, and PostgreSQL
-- will not push a non-leakproof qual below a barrier. `split_part` is not
-- leakproof (`pg_proc.proleakproof = false`); `int8gt` is. So the cursor bound
-- falls out of the index condition into a row filter, and the plan still reads
-- `Index Scan` while the scan starts at event one and discards everything
-- before the cursor -- constant only for the first page, and quietly linear for
-- every page after it. Three ways out were considered: marking `split_part`
-- LEAKPROOF (superuser, and it loosens the barrier that NFR-S4 is about, to win
-- an index), a leakproof wrapper function (same superuser requirement), and a
-- real column (none). The comparison then happens on `bigint`, which is
-- leakproof, and the bound rides into the index condition.
--
-- GENERATED, not written by the application. This is the expand step of
-- CONVENTIONS 6.3 and it has to be safe while old and new code run side by
-- side: a plain column would be NULL on every row an old replica inserts, and
-- `event_sequence > $2` is false against NULL, so those messages would vanish
-- from the transcript that is meant to show them. Generating it in the database
-- means every writer fills it -- the service, the seed, a fixture, a replica
-- from the previous release -- and it cannot drift from the id it is derived
-- from. Nothing is dropped or narrowed here; `id` keeps carrying the sequence
-- and stays the public cursor.
--
-- TOTAL, never throwing, and that is the same rule rather than a second one. A
-- bare `(split_part(id, '_', 2))::bigint` raises `22P02 invalid input syntax
-- for type bigint: ""` on any id without the separator, and a generated column
-- evaluates on INSERT -- so it would have rejected a row the previous release
-- accepted, which is precisely what 6.3 forbids in one deploy. Not
-- hypothetical: `test/integration/chat-transcript.test.ts` mints ids as
-- `e0000000...` and 21 tests failed on the write before this CASE was added.
-- `events.id` has no format CHECK, so nothing but convention keeps a caller to
-- `buildEventId`. An id that carries no sequence now yields NULL and is simply
-- not a member of any page; under the expression it made the whole page raise,
-- so this is strictly the smaller failure, and the one that cannot take a
-- write down with it.
--
-- Two statements in one file on purpose, and neither may become
-- `CONCURRENTLY`: measured on this server rather than assumed --
--
--   CREATE INDEX CONCURRENTLY ... ON <partitioned table>
--   ERROR:  cannot create index on partitioned table "ev" concurrently
--
-- PostgreSQL 17.10 still refuses it, and the documented way around it (`ON
-- ONLY` the parent, `CONCURRENTLY` per partition, then `ALTER INDEX ... ATTACH
-- PARTITION`) cannot live in a migration file: the partition set is not fixed
-- (`events_ensure_partition` mints a month at a time from the scheduler), so
-- the per-partition step would have to loop, a loop is a DO block, and
-- `CONCURRENTLY` inside a transaction block is exactly the 25001 the rule is
-- about. Both statements therefore take ACCESS EXCLUSIVE while they run -- the
-- ADD COLUMN rewrites each partition, the index builds over each. What keeps
-- that bounded is the partitioning itself: the work is per month of history,
-- and every partition created after this migration inherits both the generated
-- column and the index for free from the parent, so `events_ensure_partition`
-- needs no change and cannot forget.
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "event_sequence" BIGINT
  GENERATED ALWAYS AS (
    CASE
      WHEN split_part("id", '_', 2) ~ '^[0-9]+$' THEN (split_part("id", '_', 2))::bigint
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS "events_thread_id_event_sequence_idx"
  ON "events" ("thread_id", "event_sequence");
