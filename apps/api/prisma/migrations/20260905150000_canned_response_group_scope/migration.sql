-- Canned responses: `visibility` and `group_id` become a matched pair
-- (FR-MOD-08.7.2).
--
-- Both columns shipped with the domain model and neither was ever written:
-- every row in existence is ('all', NULL), and the code that produced them
-- cannot spell anything else. That is what makes adding a CHECK in a single
-- release safe under CONVENTIONS §6.3 — the constraint is not something the
-- *old* pods can violate while the rollout is half-done, because the old pods
-- only ever insert the defaults.
--
-- The pairing itself is the decision. `visibility = 'group'` with no team is a
-- reply nobody can reach; `visibility = 'all'` carrying a team is ownership
-- metadata dressed up as a scope, and a reader deciding which of the two
-- columns to trust would have to guess. Refusing both leaves exactly two
-- legal states, so the list filter can branch on `visibility` alone.
--
-- `visibility` is constrained to a value set for the same reason `scope` is
-- (`canned_responses_scope_check`, same table): a free-form string collects
-- three spellings of the same idea within a year, and the filter silently
-- stops matching one of them.
ALTER TABLE canned_responses
  ADD CONSTRAINT canned_responses_visibility_check
    CHECK (
      (visibility = 'all' AND group_id IS NULL)
      OR (visibility = 'group' AND group_id IS NOT NULL)
    );
