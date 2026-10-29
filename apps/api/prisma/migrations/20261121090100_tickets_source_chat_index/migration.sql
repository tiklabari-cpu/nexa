-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside the implicit transaction Postgres opens for a multi-statement
-- migration, so it gets a file of its own.
--
-- Serves the conversation timeline (ID-09 · tm 334.1): the tickets opened from
-- one chat. Nothing indexed `source_chat_id` before this, so the read — and the
-- `ON DELETE SET NULL` of a deleted chat — scanned the licence's tickets.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_source_chat_idx" ON "tickets" ("source_chat_id");
