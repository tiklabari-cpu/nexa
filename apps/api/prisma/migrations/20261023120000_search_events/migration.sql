-- Message text search, part two: the search (ID-07 · tm 333.2).
--
-- `search_events` finds messages whose text contains every word of a query,
-- inside one workspace, inside what the caller may see, and returns one row per
-- conversation day: its newest match and how many matches it holds. Part one
-- (20261023100000_event_text_search_index) built the trigram index this reads;
-- part three (tm 333.3) is the API that calls it.
--
-- WHY SECURITY DEFINER. Under `siyahtus_app` row level security turns `events`
-- into a security barrier, and PostgreSQL only lets a leakproof qual through a
-- barrier into an index condition. `textlike` -- the LIKE the trigram index
-- serves -- is not leakproof, so as the runtime role the LIKE stays a row filter
-- above the barrier and every search reads every message in the date range.
-- The same trap, measured on `split_part`, is why `events.event_sequence`
-- exists (20260911170000, transcript-page-plan.test.ts). Run as the owner of
-- `events`, which row level security does not apply to (ENABLE, not FORCE), the
-- LIKE reaches `events_text_search_idx`. The price is that RLS no longer guards
-- this read, so the function carries both of the guards RLS and the API would
-- otherwise apply, and the test file is what holds them in place
-- (test/integration/search-events.test.ts).
--
-- WHAT THE OWNER'S RIGHTS HAND THE RUNTIME ROLE, AND WHY THAT IS SAFE.
--
--   The tenant. `p_license` must equal `siyahtus_current_license()` -- the
--   tenant `withTenant` set for this transaction, the one value every RLS
--   policy reads -- or the call is refused (42501), as it is with no tenant at
--   all. So the function reads exactly the workspace a plain `SELECT` under RLS
--   would have read in the same transaction, and never another one. The
--   explicit `license_id = $1` in the statement is the same fence a second time,
--   where the planner can use it.
--
--   The visibility. Within the workspace the API decides who sees which
--   conversation (`services/chat/access.ts`): an unrestricted caller sees every
--   one; anyone else sees a conversation one of their teams has in
--   `chat_access`, or one they are personally in as an agent (`chat_users`,
--   `user_type = 'agent'`). The three parameters `resolveVisibility` produces
--   (`unrestricted`, `groupIds`, `actorId`) are applied here, per message,
--   before anything is counted or capped, so neither a result nor a refusal
--   says anything about a conversation the caller cannot open. Every NULL
--   closes: no flag is not unrestricted, no team list is no team, no actor is
--   nobody. A customer-shaped call (not unrestricted, no team, the customer's
--   id) finds nothing: a customer is in `chat_users` as 'customer', never as
--   'agent'. Internal notes (`recipients = 'agents'`) come back only when
--   `p_include_notes` says so.
--
--   No SQL from the caller. The statement is fixed text; the only thing that
--   varies is how many LIKE conditions it carries, one per word, written from
--   a loop counter. Every value -- the words included -- travels as a
--   parameter of `EXECUTE ... USING`.
--
--   Only what a result needs: the conversation, the connection and the message
--   (ids), when, whether it is an internal note, the message text (tm 333.3
--   cuts the +-60 character snippet from it, in the API, where characters are
--   characters -- under SQL_ASCII `substr` counts bytes), and the number of
--   matches in that conversation.
--
--   `search_path` pinned (public, pg_temp; pg_catalog is searched first,
--   pg_temp never for functions or operators); `siyahtus_app` has no CREATE on
--   `public`, so nothing it creates can shadow a name used here. PUBLIC loses
--   the default EXECUTE; `siyahtus_app` gets it.
--
-- THE QUERY'S RULES.
--
--   Words. The query is split on whitespace; each word is folded by
--   `siyahtus_search_fold` -- the function the index stores, so "İSTANBUL"
--   finds "istanbul" and "cagri" finds "çağrı" -- duplicates dropped, and LIKE's
--   own characters (`\`, `%`, `_`) escaped after folding, so "100%" and
--   "user_name" mean themselves. A message must contain every word, in any
--   order and anywhere: "papara 5000" finds "Papara ile 5000 TL". At least one
--   word must hold three letters or digits in a row -- what a trigram is made of
--   under the C locale (non-ASCII bytes are separators to pg_trgm here) -- or
--   the index has nothing to narrow with and the search would read the whole
--   range; such a query is refused (22023), as are more than 8 words and more
--   than 1000 bytes. No stemming (ID-07-S3).
--
--   Dates. `[p_from, p_to)`. A missing `p_to` is now, a missing `p_from` is 90
--   days before `p_to` (ID-07-S1); more than 400 days is refused, which also
--   bounds how many monthly partitions one search opens.
--
--   Order and pages. Conversations come newest match first; `p_limit` of them
--   (1..100, default 50), then the next page from `(p_cursor_at, p_cursor_id)`:
--   the `created_at` and `event_id` of the last row returned. Both or neither.
--   `created_at` here is truncated to the millisecond -- in the ordering, in the
--   cursor comparison and in what is returned -- because that is all a
--   JavaScript `Date` holds: with microseconds in the key, a cursor that came
--   back through the API would land a fraction of a millisecond off and skip or
--   repeat rows. The tie is broken by the event id.
--
--   Matches only messages (`type = 'message'`: the visitor's, the agent's, the
--   AI's, internal notes), the partial predicate of the index; never system
--   lines.
--
-- THE CAP. A word as common as "merhaba" matches most of a workspace, and a
-- result grouped by conversation has to see every match before it can name the
-- newest. So at most 20 000 *visible* matches are read (`LIMIT` on the matches,
-- which stops the heap scan); if there are more the search is refused with
-- 54000 (program_limit_exceeded) -- whichever page was asked for, an empty one
-- included -- and the API asks for more words or a shorter range. A returned
-- result is therefore always exact. Measured on a scratch database (1 000 000
-- messages over three monthly partitions, PostgreSQL 17, this function): a rare
-- phrase ("papara 5000", ~100 matches) 22-39 ms; a common word over three days
-- (~3 800 matches) ~145 ms; the same word over 90 days (190 000 matches)
-- refused in 68 ms unrestricted, 157 ms for a team member -- where the same
-- search without the cap took 587 ms and spilled an 11 MB sort to disk.
--
-- A STATEMENT TIMEOUT IS A PRECONDITION. The cap bounds the matches the caller
-- may see; it cannot bound the candidates read to find them. A team member
-- sees part of the workspace, so for a common word the matches they may not
-- see -- and other workspaces' (below) -- are fetched and discarded until the
-- range runs out. The function cannot time itself out: PostgreSQL arms
-- `statement_timeout` when the calling statement starts, so a
-- `SET statement_timeout` on the function, or `set_config` inside it, changes
-- nothing for the call already running (measured on PostgreSQL 17: both let a
-- 2 s sleep finish under a 300 ms setting). So it refuses (55000,
-- object_not_in_prerequisite_state) unless the caller's transaction already
-- holds a statement timeout between 1 ms and 30 s; the API runs
-- `SET LOCAL statement_timeout` before the call. A caller that forgets fails on
-- its first test instead of shipping a search with no ceiling.
--
-- KNOWN COSTS, not defects. The index is not per workspace and not per day, so
-- a month's matching rows from other workspaces, and from the part of a month
-- outside the range, are fetched and then discarded -- work bounded by the
-- month's matching rows and the caller's timeout, not by the cap. That also
-- makes the time a search takes depend, coarsely, on how often other
-- workspaces wrote the same word: a timing signal that cannot single out one
-- message (one row is a single heap fetch). A `btree_gin` index leading with
-- `license_id` would remove both.
--
-- PL/pgSQL with `EXECUTE ... USING` rather than a static statement: each call is
-- planned with its own values, so partition pruning happens at plan time and
-- each LIKE pattern is estimated as itself rather than as a generic parameter,
-- and the number of words can vary. STABLE: it can only read, so it also runs in
-- `withTenantRead`'s READ ONLY transaction and on a standby.
CREATE FUNCTION search_events(
  p_license       BIGINT,
  p_query         TEXT,
  p_from          TIMESTAMPTZ,
  p_to            TIMESTAMPTZ,
  p_unrestricted  BOOLEAN,
  p_group_ids     BIGINT[],
  p_actor_id      TEXT,
  p_include_notes BOOLEAN,
  p_limit         INTEGER,
  p_cursor_at     TIMESTAMPTZ,
  p_cursor_id     TEXT
)
RETURNS TABLE (
  chat_id     TEXT,
  thread_id   TEXT,
  event_id    TEXT,
  created_at  TIMESTAMPTZ,
  recipients  TEXT,
  text        TEXT,
  match_count INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
ROWS 50
AS $fn$
#variable_conflict use_column
DECLARE
  c_hit_cap   CONSTANT INTEGER := 20000;
  c_max_words CONSTANT INTEGER := 8;
  v_tenant    BIGINT := siyahtus_current_license();
  v_to        TIMESTAMPTZ := coalesce(p_to, now());
  v_from      TIMESTAMPTZ := coalesce(p_from, v_to - interval '90 days');
  v_limit     INTEGER := coalesce(p_limit, 50);
  v_words     TEXT[] := '{}';
  v_patterns  TEXT[];
  v_word      TEXT;
  v_indexable BOOLEAN := false;
  v_likes     TEXT := '';
  v_timeout   BIGINT;
  v_row       RECORD;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'search_events needs a tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_license IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'search_events: the licence is not this transaction''s tenant'
      USING ERRCODE = '42501';
  END IF;

  -- In milliseconds; 0 is "no timeout".
  SELECT s.setting::BIGINT INTO v_timeout FROM pg_settings s WHERE s.name = 'statement_timeout';
  IF v_timeout IS NULL OR v_timeout < 1 OR v_timeout > 30000 THEN
    RAISE EXCEPTION 'search_events needs a statement_timeout between 1 ms and 30 s'
      USING ERRCODE = '55000';
  END IF;

  IF NOT isfinite(v_from) OR NOT isfinite(v_to) OR v_from >= v_to
     OR v_to - v_from > interval '400 days' THEN
    RAISE EXCEPTION 'search_events: the range must be finite, ordered and at most 400 days'
      USING ERRCODE = '22023';
  END IF;
  IF v_limit < 1 OR v_limit > 100
     OR (p_cursor_at IS NULL) <> (p_cursor_id IS NULL)
     OR NOT isfinite(p_cursor_at) THEN
    RAISE EXCEPTION 'search_events: invalid page' USING ERRCODE = '22023';
  END IF;
  IF p_query IS NULL OR octet_length(p_query) > 1000 THEN
    RAISE EXCEPTION 'search_events: the query is missing or too long' USING ERRCODE = '22023';
  END IF;

  -- `[[:space:]]` and `chr(92)` rather than `\s` and '\': nothing here depends
  -- on how the session parses backslashes in a literal.
  FOREACH v_word IN ARRAY regexp_split_to_array(p_query, '[[:space:]]+') LOOP
    v_word := siyahtus_search_fold(v_word);
    CONTINUE WHEN v_word = '' OR v_word = ANY (v_words);
    v_words := array_append(v_words, v_word);
    v_indexable := v_indexable OR v_word ~ '[a-z0-9]{3}';
  END LOOP;
  IF cardinality(v_words) > c_max_words THEN
    RAISE EXCEPTION 'search_events: at most 8 words' USING ERRCODE = '22023';
  END IF;
  IF NOT v_indexable THEN
    RAISE EXCEPTION 'search_events: needs a word with three letters or digits in a row'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(
           '%' || replace(replace(replace(w, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'),
                          '_', chr(92) || '_') || '%'
           ORDER BY n)
    INTO v_patterns
    FROM unnest(v_words) WITH ORDINALITY AS u(w, n);

  FOR i IN 1 .. cardinality(v_patterns) LOOP
    v_likes := v_likes || format(' AND siyahtus_search_fold(e.text) LIKE ($8)[%s]', i);
  END LOOP;

  FOR v_row IN EXECUTE
    'WITH hits AS MATERIALIZED (
       SELECT e.id, e.chat_id, e.thread_id, e.created_at,
              date_trunc(''milliseconds'', e.created_at, ''UTC'') AS at, e.recipients
       FROM events e
       WHERE e.license_id = $1
         AND e.type = ''message''
         AND e.created_at >= $2 AND e.created_at < $3' || v_likes || '
         AND ($4 OR e.recipients = ''all'')
         AND ($5
              OR EXISTS (SELECT 1 FROM chat_access a
                         WHERE a.chat_id = e.chat_id AND a.group_id = ANY ($6))
              OR EXISTS (SELECT 1 FROM chat_users u
                         WHERE u.chat_id = e.chat_id AND u.user_id = $7
                           AND u.user_type = ''agent''))
       LIMIT $12
     ), ranked AS (
       SELECT h.*,
              count(*) OVER (PARTITION BY h.chat_id) AS match_count,
              row_number() OVER (PARTITION BY h.chat_id ORDER BY h.at DESC, h.id DESC) AS rn
       FROM hits h
     ), page AS (
       SELECT r.* FROM ranked r
       WHERE r.rn = 1 AND ($9::timestamptz IS NULL OR (r.at, r.id) < ($9, $10))
       ORDER BY r.at DESC, r.id DESC
       LIMIT $11
     )
     SELECT p.chat_id::text AS chat_id, p.thread_id::text AS thread_id, p.id::text AS event_id,
            p.at AS created_at, p.recipients, e.text, p.match_count::integer AS match_count,
            t.hit_count
     FROM (SELECT count(*) AS hit_count FROM hits) t
     LEFT JOIN (page p
                JOIN events e
                  ON e.id = p.id AND e.created_at = p.created_at AND e.license_id = $1)
       ON true
     ORDER BY p.at DESC, p.id DESC'
  USING p_license, v_from, v_to, coalesce(p_include_notes, false),
        coalesce(p_unrestricted, false), coalesce(p_group_ids, '{}'::BIGINT[]), p_actor_id,
        v_patterns, p_cursor_at, p_cursor_id, v_limit, c_hit_cap + 1
  LOOP
    -- Checked before any row goes out, on every call -- an empty page still
    -- brings back the count, as one row without a message: past the cap the
    -- matches read were an arbitrary subset, so no row of this page may be
    -- trusted.
    IF v_row.hit_count > c_hit_cap THEN
      RAISE EXCEPTION 'search_events: the query matches too many messages'
        USING ERRCODE = '54000';
    END IF;
    CONTINUE WHEN v_row.event_id IS NULL;
    chat_id := v_row.chat_id;
    thread_id := v_row.thread_id;
    event_id := v_row.event_id;
    created_at := v_row.created_at;
    recipients := v_row.recipients;
    text := v_row.text;
    match_count := v_row.match_count;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION search_events(
  BIGINT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BIGINT[], TEXT, BOOLEAN, INTEGER, TIMESTAMPTZ, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_events(
  BIGINT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BIGINT[], TEXT, BOOLEAN, INTEGER, TIMESTAMPTZ, TEXT
) TO siyahtus_app;
