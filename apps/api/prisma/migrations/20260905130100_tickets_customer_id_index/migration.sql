-- Alone in this file on purpose (CONVENTIONS 6.3) -- see the sibling
-- migration in this pair for why `CONCURRENTLY` cannot share a file.
--
-- Serves the Contacts filter panel's `has_tickets` condition (FR-MOD-03.2.1):
-- an EXISTS check against this license's tickets for a candidate customer.
-- Nothing indexed `customer_id` before this, so that probe was a sequential
-- scan of the license's tickets per row. Measured in `customers.test.ts`
-- ("serves the has_tickets filter out of an index (EXPLAIN ANALYZE)").
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_license_customer_idx" ON "tickets" ("license_id", "customer_id");
