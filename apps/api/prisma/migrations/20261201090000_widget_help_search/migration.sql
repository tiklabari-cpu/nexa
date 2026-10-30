-- The widget's "Help" tab (WG-12 · tm 348): a visitor searches the
-- workspace's published knowledge base articles with their customer token.
-- Three things, all expand-only (CONVENTIONS 6.3); the index that makes the
-- search fast is the next migration, alone in its file because it is built
-- CONCURRENTLY on a table that already holds rows.
--
-- 1. widget_settings.help_enabled -- the workspace's switch, per brand like
--    every widget setting. Constant default false: every existing row reads
--    "off", and a replica of the previous release that never writes it is
--    unaffected.
ALTER TABLE "widget_settings"
    ADD COLUMN "help_enabled" BOOLEAN NOT NULL DEFAULT false;

-- 2. kb_article_search_document -- what an article is searched by: its title
--    (weight A, so a title match ranks first) and its body (weight B), each
--    folded by `siyahtus_search_fold` and split into words by the `simple`
--    configuration.
--
--    WHY `siyahtus_search_fold` AND `simple`, NOT `unaccent` OR A TURKISH
--    DICTIONARY. Every database here is SQL_ASCII (20261023100000 explains):
--    the text search parser reads bytes, and a byte above 127 is not a letter
--    to it, so an unfolded "yatırım" would be indexed as "yat" and "r" and
--    "m". The fold turns the Turkish letters into their ASCII base first
--    ("Çekim" -> "cekim"), which also lets a player who types without Turkish
--    letters find the article -- and `unaccent` is not installed (it is not a
--    trusted extension). No stemming: a word's prefix is matched instead
--    (`:*` in the query below), which serves "yatır" -> "yatırım" without a
--    dictionary that would also have to be right for the other seven widget
--    languages. Letters outside the fold (Cyrillic, Arabic) still separate
--    words; their articles are found by their ASCII words only.
--
--    The body is the KB's markdown subset; its markers ("##", "**", "- ",
--    "[text](url)") are punctuation to the parser and drop out, a link's URL
--    becomes its host and path tokens.
--
--    LANGUAGE sql, IMMUTABLE, no SET clause: the planner inlines it into both
--    the index expression and the query, so the two are the same expression.
--    The fold is named with its schema: PostgreSQL 17 builds an index with
--    `search_path = pg_catalog, pg_temp`, and an unqualified name inside the
--    body fails to resolve there (42883, measured on the first try).
--    CREATE, not CREATE OR REPLACE: the index stores this function's output,
--    so a different document is a new function and a new index.
CREATE FUNCTION kb_article_search_document(p_title TEXT, p_body TEXT)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT setweight(to_tsvector('simple'::regconfig, public.siyahtus_search_fold(coalesce(p_title, ''))), 'A')
      || setweight(to_tsvector('simple'::regconfig, public.siyahtus_search_fold(coalesce(p_body, ''))), 'B')
$$;

-- 3. kb_search_published -- the search itself.
--
--    WHY SECURITY DEFINER. `@@` (ts_match_vq) is not leakproof, so under
--    `siyahtus_app` row level security keeps it above the security barrier as
--    a row filter and the GIN index is never used -- the trap 20261023120000
--    (`search_events`) measured for LIKE. Run as the owner of `kb_articles`,
--    which RLS does not apply to (ENABLE, not FORCE), the match reaches the
--    index. RLS no longer guards this read, so the function carries the guard
--    itself: `p_license` must be the transaction's tenant
--    (`siyahtus_current_license()`, the value every policy reads) or the call
--    is refused with 42501, as it is with no tenant at all; and the statement
--    filters `license_id = p_license` a second time where the planner can use
--    it. So it reads exactly the workspace a plain SELECT under RLS would.
--
--    Only published articles: `status = 'published'` AND a stamped
--    `published_at` -- the predicate `lib/kb-public-read.ts` holds for the
--    public KB. A draft is never a row here, so it cannot be told apart from
--    an article that does not exist.
--
--    THE QUERY. Folded the way the document is, split on everything that is
--    not an ASCII letter or digit, duplicates dropped, at most 8 words
--    (KB_SEARCH_MAX_WORDS; the rest are ignored), each a prefix (`word:*`),
--    all of them required. The words hold only [a-z0-9], so the tsquery text
--    built from them cannot carry tsquery syntax of its own. A query with no
--    word at all is an empty result, not an error.
--
--    Best first: `ts_rank` (title weight A over body B), then the newest
--    publication, then the id so the order is total. `p_limit` 1..20.
--
--    Returns what a result line needs -- the excerpt and the first 1000 bytes
--    of the body, from which the API cuts a plain-text excerpt when the
--    article has none -- never `license_id`, `created_by` or the status.
--
--    `search_path` pinned; `siyahtus_app` has no CREATE on `public`, so
--    nothing it creates can shadow a name used here. PUBLIC loses EXECUTE,
--    `siyahtus_app` gets it. STABLE: it only reads, so it also runs inside a
--    READ ONLY transaction.
CREATE FUNCTION kb_search_published(p_license BIGINT, p_query TEXT, p_limit INTEGER)
RETURNS TABLE (
  id         UUID,
  slug       TEXT,
  title      TEXT,
  excerpt    TEXT,
  body_start TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
ROWS 10
AS $fn$
#variable_conflict use_column
DECLARE
  c_max_words CONSTANT INTEGER := 8;
  v_tenant    BIGINT := siyahtus_current_license();
  v_words     TEXT[];
  v_query     tsquery;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'kb_search_published needs a tenant context' USING ERRCODE = '42501';
  END IF;
  IF p_license IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'kb_search_published: the licence is not this transaction''s tenant'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'kb_search_published: invalid limit' USING ERRCODE = '22023';
  END IF;
  IF p_query IS NULL OR octet_length(p_query) > 1000 THEN
    RAISE EXCEPTION 'kb_search_published: the query is missing or too long'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(w ORDER BY n)
    INTO v_words
    FROM (
      SELECT w, min(n) AS n
      FROM regexp_split_to_table(siyahtus_search_fold(p_query), '[^a-z0-9]+')
           WITH ORDINALITY AS t(w, n)
      WHERE w <> ''
      GROUP BY w
      ORDER BY min(n)
      LIMIT c_max_words
    ) words;
  IF v_words IS NULL THEN
    RETURN;
  END IF;

  v_query := to_tsquery('simple'::regconfig,
               array_to_string(ARRAY(SELECT u || ':*' FROM unnest(v_words) AS u), ' & '));

  RETURN QUERY
    SELECT a.id, a.slug, a.title, a.excerpt, left(a.body, 1000)
    FROM kb_articles a
    WHERE a.license_id = p_license
      AND a.status = 'published'
      AND a.published_at IS NOT NULL
      AND kb_article_search_document(a.title, a.body) @@ v_query
    ORDER BY ts_rank(kb_article_search_document(a.title, a.body), v_query) DESC,
             a.published_at DESC,
             a.id DESC
    LIMIT p_limit;
END
$fn$;

REVOKE EXECUTE ON FUNCTION kb_search_published(BIGINT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kb_search_published(BIGINT, TEXT, INTEGER) TO siyahtus_app;
