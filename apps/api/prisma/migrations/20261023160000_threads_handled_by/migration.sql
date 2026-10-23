-- Who answered a connection, for the archive (AR-01 · tm 335.1): `ai`,
-- `human` or `mixed`, written once in the transaction that closes the thread
-- (`ChatService` `#closeConversation`, `handledBySql` in
-- `services/billing/ai-resolution.ts`). `ai` is exactly ADR-09a's AI
-- resolution -- the predicate the invoice counts -- so the archive's "AI
-- solved" (AR-02) cannot disagree with the bill.
--
-- Expand only (CONVENTIONS 6.3): a nullable column without a default is a
-- catalog change, and the code still serving traffic neither reads nor
-- writes it. Threads closed before this stay NULL; the archive shows them as
-- "not recorded", and a backfill, if the owner wants one, is its own batched
-- job (AR-02, tm 336).
ALTER TABLE threads ADD COLUMN handled_by TEXT;

-- NOT VALID, then VALIDATE: the column is NULL on every existing row, so the
-- check holds, and VALIDATE scans under SHARE UPDATE EXCLUSIVE instead of the
-- ACCESS EXCLUSIVE an ADD CONSTRAINT with a scan would hold over `threads`.
ALTER TABLE threads ADD CONSTRAINT threads_handled_by_check
  CHECK (handled_by IS NULL OR handled_by IN ('ai', 'human', 'mixed')) NOT VALID;
ALTER TABLE threads VALIDATE CONSTRAINT threads_handled_by_check;
