-- Alone in this file on purpose. `CREATE INDEX CONCURRENTLY` cannot run inside a
-- transaction block, and PostgreSQL wraps a multi-statement simple query in an
-- implicit one -- a second statement beside this one fails the whole migration
-- with 25001 (CONVENTIONS 6.3). Concurrently, because `chats` is read by every
-- open inbox and a plain `CREATE INDEX` holds ACCESS EXCLUSIVE for the build:
-- during a rollout the pods still serving traffic are the ones it would block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chats_license_id_last_event_at_idx" ON "chats" ("license_id", "last_event_at" DESC);
