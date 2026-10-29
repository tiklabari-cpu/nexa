-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside the implicit transaction Postgres opens for a multi-statement
-- migration, so it gets a file of its own.
--
-- Serves the conversation timeline (ID-09 · tm 334.1): the audit rows whose
-- target is one chat (`chat:<id>`), in time order, a page at a time. Without it
-- that read walks the workspace's whole trail by date and filters on `target`.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_log_license_id_target_created_at_idx" ON "audit_log" ("license_id", "target", "created_at");
