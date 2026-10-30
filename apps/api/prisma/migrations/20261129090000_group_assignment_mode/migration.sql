-- Manual assignment mode (WG-07 · tm 346).
--
--   groups.assignment_mode        how the team's conversations reach its agents
--       (`GROUP_ASSIGNMENT_MODES`): 'auto' — routing picks the agent, what
--       every team did until now; 'manual' — routing picks nobody, the
--       conversation waits in the team's queue and the first member to take
--       it (`POST /chats/{id}/claim`) has it.
--   threads.unclaimed_alerted_at  when the team's leads were told nobody took
--       the connection from a manual team's queue; once per stay.
--
-- The Responsible Gambling team is never manual (WG-07 decision 1): its
-- conversations are taken without waiting for someone to choose them. The API
-- refuses it with a 400; the second CHECK holds it for any other writer.
--
-- Expand only (CONVENTIONS 6.3): a constant default and a nullable column are
-- catalog changes, and the code still serving traffic neither reads nor
-- writes either. Every existing team holds 'auto', so both CHECKs pass on the
-- handful of `groups` rows they scan.
ALTER TABLE "groups" ADD COLUMN "assignment_mode" TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE "threads" ADD COLUMN "unclaimed_alerted_at" TIMESTAMPTZ(6);

-- `GROUP_ASSIGNMENT_MODES` (`@siyahtus/types`); `manual-assignment.test.ts`
-- compares the list with this one.
ALTER TABLE groups ADD CONSTRAINT groups_assignment_mode_check
  CHECK (assignment_mode IN ('auto', 'manual'));

ALTER TABLE groups ADD CONSTRAINT groups_rg_assignment_mode_check
  CHECK (NOT (topic_role IS NOT DISTINCT FROM 'responsible_gambling' AND assignment_mode = 'manual'));
