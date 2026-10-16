-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside a transaction block, and a second statement beside it
-- would fail the whole migration with 25001. Concurrently, because every AI
-- turn writes `skill_runs`, and a plain build would block those writes.
--
-- The lookup for `skill_runs.thread_id` (20261016100000_ai_decision_logs, tm
-- 288.2): one connection's runs, and the `ON DELETE SET NULL` the retention
-- sweep fires for every thread it deletes — without it each of those deletes
-- scans the table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "skill_runs_thread_id_idx" ON "skill_runs"("thread_id");
