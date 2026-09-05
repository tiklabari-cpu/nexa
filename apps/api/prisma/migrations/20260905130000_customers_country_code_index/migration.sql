-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside a transaction block, and a second statement beside it
-- would fail the whole migration with 25001. Concurrently, because
-- `customers` is read by every open Contacts list and a plain `CREATE INDEX`
-- holds ACCESS EXCLUSIVE for the build.
--
-- Serves the Contacts filter panel's country condition (FR-MOD-03.2.1),
-- measured in `customers.test.ts` ("serves the country filter out of an
-- index (EXPLAIN ANALYZE)").
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customers_organization_id_country_code_idx" ON "customers" ("organization_id", "country_code");
