-- Message text search, part two and a half: the conversation count (ID-07 ·
-- tm 333.3).
--
-- `GET /chats?query=` answers with the list envelope every chat list has --
-- `items` and `total`, the number of matching conversations across all pages
-- -- and only the function can count those: it is the one place that may read
-- every visible match (20261023120000_search_events explains why it runs as
-- the owner). It already reads them all -- a result grouped by conversation has
-- to -- so the count is `count(DISTINCT chat_id)` over the same `hits` the cap
-- is checked on: the visible matches inside the range, nothing else, and no
-- second read. It goes out as `chat_count` on every row.
--
-- Everything else -- the guards, the rules, the cap, the timeout precondition
-- -- is 20261023120000's function word for word; read the reasoning there.
--
-- DROP and CREATE rather than CREATE OR REPLACE: a function's result columns
-- cannot change in place. Nothing calls `search_events` before this release
-- (tm 333.3 is its first caller), so no running code loses it in between, and
-- the privileges are restated below exactly as before.
DROP FUNCTION search_events(BIGINT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BIGINT[], TEXT, BOOLEAN, INTEGER, TIMESTAMPTZ, TEXT);

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
  match_count INTEGER,
  chat_count  INTEGER
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
            t.hit_count, t.chat_count::integer AS chat_count
     FROM (SELECT count(*) AS hit_count, count(DISTINCT chat_id) AS chat_count FROM hits) t
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
    chat_count := v_row.chat_count;
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
