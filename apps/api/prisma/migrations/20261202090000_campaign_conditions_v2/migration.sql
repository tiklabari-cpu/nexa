-- Multi-condition campaign targeting (EN-03 · tm 352.1). Expand-only
-- (CONVENTIONS 6.3): a replica of the previous release keeps working on
-- every row this touches.
--
-- 1. visits.variables -- the session variables the site sets for a visit
--    (`siyahtus('setSessionVariables')`, `POST /customer/visit`): at most 20
--    keys, each key and value at most 100 characters, card numbers masked
--    before they are written. Read by campaign targeting only (`custom_var`
--    rules). Constant default: no table rewrite, and the previous release
--    never writes it.
ALTER TABLE "visits"
    ADD COLUMN "variables" JSONB NOT NULL DEFAULT '{}';

-- 2. campaigns.conditions -- the first shape `{ "url_contains": "x" }` becomes
--    the rule list `{ "match": "all", "rules": [{ "field": "current_url",
--    "op": "contains", "value": "x" }] }`, the meaning EN-04 gave it (the page
--    the visitor is on).
--
--    `url_contains` is KEPT beside the rules (`||` merges, it does not
--    replace): the previous release reads only that key, and a campaign
--    stripped of it would match nobody on a replica that has not been
--    replaced yet. The new reader takes `rules` whenever it is present. The
--    key goes in a later migration, once no release reads it.
--
--    Only rows that hold a non-empty text `url_contains` and no `rules` yet:
--    an empty trigger stays empty (it matches nobody either way), and a
--    second run of this statement changes nothing. The value is trimmed, as
--    the old reader trimmed it before matching; case is left alone (matching
--    ignores it).
UPDATE "campaigns"
SET "conditions" = "conditions" || jsonb_build_object(
        'match', 'all',
        'rules', jsonb_build_array(jsonb_build_object(
            'field', 'current_url',
            'op', 'contains',
            'value', btrim("conditions" ->> 'url_contains')
        ))
    )
WHERE jsonb_typeof("conditions") = 'object'
  AND jsonb_typeof("conditions" -> 'url_contains') = 'string'
  AND NOT ("conditions" ? 'rules')
  AND btrim("conditions" ->> 'url_contains') <> '';
