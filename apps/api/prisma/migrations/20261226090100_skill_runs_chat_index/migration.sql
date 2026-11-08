-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside a transaction block, and a second statement beside it
-- would fail the whole migration with 25001. Concurrently, because every AI
-- turn writes `skill_runs`, and a plain build would block those writes.
--
-- The lookup for `skill_runs.chat_id` (tm 424): a customer erasure clears the
-- text of the runs on the subject's conversations before deleting them, and
-- the `ON DELETE SET NULL` that delete then fires for every chat — without it
-- each of those scans the table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "skill_runs_chat_id_idx" ON "skill_runs"("chat_id");
