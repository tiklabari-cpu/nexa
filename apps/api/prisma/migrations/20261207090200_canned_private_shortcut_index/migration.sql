-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside the implicit transaction Postgres opens for a multi-statement
-- migration, so it gets a file of its own.
--
-- Saved replies (IN-06 · tm 363), step 3 of 4: a personal reply's shortcut is
-- unique per author — two agents may each own `#selam`, one agent may not own
-- it twice.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "canned_responses_private_shortcut_key" ON "canned_responses" ("license_id", "scope", "owner_account_id", "shortcut") WHERE visibility = 'private';
