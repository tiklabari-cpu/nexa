-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside the implicit transaction Postgres opens for a multi-statement
-- migration, so it gets a file of its own.
--
-- Saved replies (IN-06 · tm 363), step 2 of 4: a shared reply's shortcut stays
-- unique per licence and scope — the rule the old unique index kept for every
-- row — but only among shared replies, so a personal `#selam` no longer
-- collides with the team's. Built before the old index is dropped (step 4), so
-- the rule never lapses.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "canned_responses_shared_shortcut_key" ON "canned_responses" ("license_id", "scope", "shortcut") WHERE visibility <> 'private';
