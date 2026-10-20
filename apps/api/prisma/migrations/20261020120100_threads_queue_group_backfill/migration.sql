-- Which team's queue the conversations waiting right now are in (tm 305.1 ·
-- AU-01 "mevcut kuyruktaki oturumlar için queue_group_id geri doldurması").
--
-- The "move" step after 20261020120000_team_queues expanded the schema
-- (CONVENTIONS §6.3), in a file of its own so it can be read — and replayed by
-- `team-queue-schema.test.ts` — as the one statement it is.
--
-- Only connections in the queue now: active, unassigned, with a position.
-- Their team is the one routing queued them for — `threads.group_id`, which
-- records routing's choice (tm 286.3) — and failing that the chat's first
-- access group: the lowest id, since group ids come from a sequence and
-- `chat_access` keeps no time. Either must still be a team of the licence; a
-- connection with neither keeps NULL, and routing treats it as it does a
-- connection an old replica queues mid-rollout (tm 305.2).
--
-- Idempotent: a connection that already has a queue team is not touched, so a
-- re-run (or a row the new code wrote first) changes nothing.

UPDATE threads t
SET queue_group_id = COALESCE(
  (SELECT g.id FROM groups g WHERE g.license_id = t.license_id AND g.id = t.group_id),
  (SELECT MIN(ca.group_id) FROM chat_access ca
     JOIN groups g ON g.license_id = t.license_id AND g.id = ca.group_id
   WHERE ca.chat_id = t.chat_id)
)
WHERE t.active
  AND t.assignee_id IS NULL
  AND t.queue_position IS NOT NULL
  AND t.queue_group_id IS NULL;
