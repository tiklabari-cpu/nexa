-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside the implicit transaction Postgres opens for a multi-statement
-- migration, so it gets a file of its own.
--
-- Report filters (RP-01 · tm 368): the agent filter narrows a report window to
-- `threads.assignee_id = ANY(...)`. The licence-and-date indexes read every
-- connection of the window and drop the other agents' rows; this one reads only
-- the filtered agents' connections, by date, inside the licence.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "threads_license_id_assignee_id_created_at_idx" ON "threads" ("license_id", "assignee_id", "created_at");
