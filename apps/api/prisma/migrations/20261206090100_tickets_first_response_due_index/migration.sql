-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside the implicit transaction Postgres opens for a multi-statement
-- migration, so it gets a file of its own.
--
-- Serves the ticket list's "nearest to SLA" order (HD-05 · tm 360): a licence's
-- tickets by first-response due moment.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_license_first_response_due_idx" ON "tickets" ("license_id", "first_response_due_at");
