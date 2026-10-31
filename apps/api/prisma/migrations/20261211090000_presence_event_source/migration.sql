-- What wrote each row of the presence log (RP-03 · tm 370).
--
--   agent_presence_events.source  manual | disconnect | unresponsive |
--       suspension | login (`PRESENCE_SOURCES`). The availability and agent
--       activity reports draw an `offline` the RTM wrote after a dropped
--       connection (`disconnect`) as "no connection" rather than as a choice.
--
-- Expand only (CONVENTIONS 6.3): a NOT NULL column with a constant DEFAULT is
-- a catalog change on PostgreSQL 11+, no rewrite, and the code still serving
-- traffic inserts without naming it and gets 'manual'. Every existing row reads
-- 'manual' -- the writers before this did not say, and the reports treat a
-- pre-existing `offline` as a chosen one. NOT VALID, then VALIDATE (the
-- `threads_missed_reason_check` pattern).
ALTER TABLE agent_presence_events ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE agent_presence_events ADD CONSTRAINT agent_presence_events_source_check
  CHECK (source IN ('manual', 'disconnect', 'unresponsive', 'suspension', 'login')) NOT VALID;
ALTER TABLE agent_presence_events VALIDATE CONSTRAINT agent_presence_events_source_check;
