-- A one-message skill's `transfer_to_team` step names its team by id (tm 307.1
-- · SiyahTuş analysis AI-12: "Ad tabanlı eski adım id'ye taşınır").
--
-- The step held the team's name (`{ type, group: 'Finance' }`), so renaming
-- the team broke every skill that handed over to it. From this release the
-- step carries `group_id` beside the name, the API fills it on every write,
-- and the hand-over looks the team up by id first and by name only for a
-- step that has none (`handoff-service.ts`). This is the "move" step after
-- that expand (CONVENTIONS §6.3), in a file of its own so it can be read —
-- and replayed by `handoff-routes.test.ts` — as the one statement it is.
--
-- The name stays: the previous release reads it, and a step whose name names
-- no team (the team was deleted or renamed before this ran) keeps only the
-- name, which the hand-over handles as before. Two teams of one name: the
-- lowest id, the one a lookup by name settles on (`handoff-service.ts` orders
-- by id).
--
-- Idempotent: a step that has a `group_id` is not touched, so a re-run (or a
-- row the new code wrote first) changes nothing. `updated_at` is not stamped:
-- the skill behaves as it did. `skills_steps_is_array_check` guarantees the
-- column is an array.

UPDATE skills s
SET steps = (
  SELECT jsonb_agg(
           CASE
             WHEN e.step ->> 'type' = 'transfer_to_team'
              AND NOT (e.step ? 'group_id')
              AND named.id IS NOT NULL
             THEN e.step || jsonb_build_object('group_id', named.id)
             ELSE e.step
           END
           ORDER BY e.ord
         )
  FROM jsonb_array_elements(s.steps) WITH ORDINALITY AS e(step, ord)
  LEFT JOIN LATERAL (
    SELECT MIN(g.id) AS id
    FROM groups g
    WHERE g.license_id = s.license_id AND g.name = e.step ->> 'group'
  ) named ON true
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(s.steps) AS x(step)
  JOIN groups g ON g.license_id = s.license_id AND g.name = x.step ->> 'group'
  WHERE x.step ->> 'type' = 'transfer_to_team'
    AND NOT (x.step ? 'group_id')
);
