-- Whether the inactivity sweep stops routing to an agent it took an unanswered
-- connection from (WG-03 · tm 340.2): on, the agent goes `not_accepting_chats`
-- (and a presence row says so) until they switch back; off, they keep their
-- status and only lose that one connection. On unless a workspace turns it
-- off -- the analysis' decision 2, adjustable because a status changed behind
-- an agent's back can sit badly with a team.
--
-- Expand only (CONVENTIONS 6.3): a constant default is a catalog change, and
-- the code still serving traffic neither reads nor writes the column.
ALTER TABLE inbox_settings
  ADD COLUMN pause_unresponsive_agents BOOLEAN NOT NULL DEFAULT true;
