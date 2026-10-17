-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside a transaction block, and a second statement beside it
-- would fail the whole migration with 25001. Concurrently, because every
-- message bumps its thread's row, and a plain build would block those writes.
--
-- The Inbox's AI views ask for a workspace's open connections in one mode
-- (20261017100000_thread_ai_mode, tm 293.1 · AI-11): "the AI is talking",
-- "a person has it". `(license_id, active, ai_mode)` answers that without
-- reading the workspace's other threads.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "threads_license_id_active_ai_mode_idx" ON "threads"("license_id", "active", "ai_mode");
