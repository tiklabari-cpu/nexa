-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside the implicit transaction Postgres opens for a multi-statement
-- migration, so it gets a file of its own.
--
-- Serves the per-address activity the forwarding-address list reports
-- (FR-MOD-08.5.3): how many tickets each address has received and when the last
-- one arrived. Without it that aggregate is a sequential scan of the licence's
-- tickets, and it runs every time an admin opens the Email card.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_inbound_address_idx" ON "tickets" ("inbound_address_id");
