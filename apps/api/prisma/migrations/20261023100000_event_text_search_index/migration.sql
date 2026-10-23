-- Message text search, part one: the index (ID-07 · tm 333.1).
--
-- Nothing searched message text before this. The search itself -- the
-- SECURITY DEFINER `search_events` function, its tenant and visibility
-- filters -- is tm 333.2; this file gives it something to search with: a
-- trigram GIN index over the folded text of every message, on every monthly
-- partition of `events`.
--
-- WHY TRIGRAMS. The questions this answers are substrings, not words: "the
-- player who wrote 'Papara 5000' last week", a TXID, the last digits of an
-- IBAN. A `tsvector` cannot find `5000` inside `TL5000`, and stemming is out
-- of scope (ID-07-S3). `pg_trgm` serves `LIKE '%...%'` from an index. It is a
-- *trusted* extension since PostgreSQL 13 (`pg_available_extension_versions
-- .trusted`), so a database owner without superuser can create it -- the same
-- line `infra/db/init/00-extensions.sql` now runs on a fresh data directory.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- WHY A FOLD FUNCTION, AND WHY `replace` RATHER THAN `translate` OR `lower`.
-- Every database this product runs on is created `LANG: C`, which makes it
-- SQL_ASCII (docker-compose.yml, docker-compose.pilot.yml; the 20261019210000
-- note). There a string is bytes: `lower()` folds A-Z and nothing else, so
-- "İSTANBUL" and "istanbul" never meet, and `translate()` maps byte to byte,
-- so a Turkish letter -- two bytes in UTF-8 -- comes out as garbage. Measured
-- on the development database (PostgreSQL 17.10):
--
--   lower(translate('İSTANBUL Çağrı', 'ÇçĞğİIıÖöŞşÜü', 'ccggiiioossuu'))
--     -> 'isstanbul ccaioriu'
--
-- `replace()` matches a whole byte sequence, and UTF-8 never lets one letter's
-- bytes start inside another's, so a chain of replacements is exact under
-- SQL_ASCII and gives the same answer under a UTF8 database. The Turkish
-- letters go to their ASCII base and the rest goes through `lower()`, so:
--
--   'İSTANBUL' -> 'istanbul'    'Çağrı' -> 'cagri'    'ŞIK' -> 'sik'
--
-- Folding the diacritics as well as the case is deliberate, for two reasons.
-- People search Turkish text without Turkish letters ("cagri" for "çağrı") and
-- should find it. And under a C locale `pg_trgm` counts a byte above 127 as a
-- word separator, so an unfolded "çağrı" splits into the useless fragments "a"
-- and "r" and the index can no longer narrow anything. The cost is that `ı`
-- and `i` (and `s`/`ş`, ...) become one letter for search -- more matches,
-- never fewer. `E'\xCC\x87'` is U+0307 COMBINING DOT ABOVE, which is what
-- JavaScript's `'İ'.toLowerCase()` leaves behind ("i̇"): dropped so that text a
-- browser lower-cased still finds the plain `i`.
--
-- LANGUAGE sql, IMMUTABLE, no `SET search_path`: a SQL function with a SET
-- clause is never inlined, and the index only works if the planner sees the
-- same expression in the query that it stored in the index. `lower` and
-- `replace` resolve to `pg_catalog`, which is searched before any schema on the
-- path unless the path names it explicitly later.
--
-- CREATE, NOT CREATE OR REPLACE, and that matters more than it looks: every
-- index built on this function stores its output. Replacing the body in place
-- would leave each index answering for the old fold while queries ask with the
-- new one -- silently wrong results, no error. A different fold is a new
-- function and a new index.
CREATE FUNCTION siyahtus_search_fold(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT lower(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(
      p_text,
      'İ', 'i'), 'ı', 'i'), 'Î', 'i'), 'î', 'i'),
      'Ç', 'c'), 'ç', 'c'),
      'Ğ', 'g'), 'ğ', 'g'),
      'Ö', 'o'), 'ö', 'o'),
      'Ş', 's'), 'ş', 's'),
      'Ü', 'u'), 'ü', 'u'), 'Û', 'u'), 'û', 'u'),
      'Â', 'a'), 'â', 'a'),
      E'\xCC\x87', '')
  )
$$;

-- THE PARENT, `ON ONLY`, and the reason it is not one plain `CREATE INDEX`.
--
-- On a partitioned table a plain `CREATE INDEX` builds every partition's index
-- inside one statement while holding SHARE on `events` -- no message can be
-- written anywhere until the last month is indexed. `CONCURRENTLY` is refused
-- on a partitioned table outright (measured in 20260911170000: "cannot create
-- index on partitioned table concurrently"). The documented way through is
-- three steps: the parent `ON ONLY` (catalog only, instant, born INVALID), each
-- partition's index `CONCURRENTLY`, then `ALTER INDEX ... ATTACH PARTITION`;
-- once every partition has an attached index PostgreSQL marks the parent valid
-- by itself.
--
-- PARTIAL on `type = 'message'`: only messages are searched (agent and visitor
-- lines, AI replies, internal notes). System lines ("Chat closed at the end of
-- the day") are a large share of the rows and nobody looks for them. The
-- search must state the same predicate to reach the index -- tm 333.2 does.
-- Prisma cannot express an expression or partial index;
-- `scripts/check-drift.ts` allows it by name if Prisma ever reports it.
--
-- A partition created after this statement -- `events_ensure_partition`, every
-- month, from the scheduler -- is born with its own copy of the index, already
-- attached: PostgreSQL clones a partitioned index into a new partition even
-- while the parent is invalid (measured, and asserted in
-- `test/integration/event-text-search-index.test.ts`). So
-- `events_ensure_partition` needs no change.
CREATE INDEX IF NOT EXISTS "events_text_search_idx"
  ON ONLY "events" USING gin (siyahtus_search_fold("text") gin_trgm_ops)
  WHERE "type" = 'message';

-- THE PARTITIONS THAT ARE EMPTY, here; THE ONES THAT HOLD ROWS, outside any
-- migration file.
--
-- `CREATE INDEX CONCURRENTLY` must be the only statement in its migration
-- (CONVENTIONS 6.3, else 25001), and it needs a literal table name. The set of
-- partitions is not something a file can list: the domain model opened two
-- months behind to six ahead of whenever *that* database was created, and the
-- scheduler opens one more a month (measured today: the development database
-- holds 2026-07 .. 2027-03 plus `events_default`; a test database made now
-- starts at 2026-08). A file per month would fail wherever that month does not
-- exist, and a loop is a DO block -- a transaction.
--
-- So the work splits on what it costs. An empty partition is indexed here, in
-- the migration's transaction: nothing to scan, the build is instant, and on a
-- fresh database -- every test database, every new install -- the parent is
-- valid the moment migrations finish. A partition that holds rows is skipped
-- with a NOTICE and left to `scripts/partition-indexes.ts`, which builds each
-- one `CONCURRENTLY` (one statement per call, outside any transaction) and
-- attaches it. `apps/api/docker-entrypoint.sh` and the Helm migrate Job run it
-- right after `prisma migrate deploy`; until it has, the parent stays invalid,
-- every search stays correct, and the months still waiting are read without
-- the index. Runbook: `docs/runbooks/event-partitions.md`, "Message search
-- index".
--
-- The child's name is `<partition>_text_search_idx`, the same one the builder
-- derives, so whichever of the two gets to a partition the other recognises
-- what it left. The emptiness check reads as the owner, which row level
-- security does not apply to (`events` is ENABLE, not FORCE).
DO $$
DECLARE
  v_schema TEXT;
  v_name   TEXT;
  v_empty  BOOLEAN;
  v_child  TEXT;
BEGIN
  FOR v_schema, v_name IN
    SELECT n.nspname, c.relname
    FROM pg_inherits h
    JOIN pg_class c ON c.oid = h.inhrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE h.inhparent = 'public.events'::regclass
      AND NOT EXISTS (
        SELECT 1
        FROM pg_inherits ih
        JOIN pg_index ci ON ci.indexrelid = ih.inhrelid
        WHERE ih.inhparent = 'public.events_text_search_idx'::regclass
          AND ci.indrelid = c.oid
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT NOT EXISTS (SELECT 1 FROM ONLY %I.%I)', v_schema, v_name) INTO v_empty;
    IF v_empty THEN
      v_child := v_name || '_text_search_idx';
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.%I USING gin (siyahtus_search_fold("text") gin_trgm_ops)'
        ' WHERE "type" = ''message''',
        v_child, v_schema, v_name
      );
      EXECUTE format(
        'ALTER INDEX public.events_text_search_idx ATTACH PARTITION %I.%I',
        v_schema, v_child
      );
    ELSE
      RAISE NOTICE 'events_text_search_idx: % holds rows, left for scripts/partition-indexes.ts (CONCURRENTLY)', v_name;
    END IF;
  END LOOP;
END
$$;
