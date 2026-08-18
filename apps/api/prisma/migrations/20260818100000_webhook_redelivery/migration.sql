-- Durable webhook redelivery (M-SCHED-e · FR-MOD-08.8.4 / NFR-S7 · §D113/K1).
--
-- `webhook_deliveries` was a pure attempt log: a row per send, and a
-- `permanent` flag on the one that used up the three in-request retries. That
-- made the retry promise NFR-S7 and PRD §08.8.4 state only as durable as the
-- request that happened to trigger it — a process restart between attempt two
-- and three lost the delivery with no record that anything was still owed.
--
-- This adds the four columns that turn the newest row of a delivery into a
-- queue entry, without disturbing what the table already recorded:
--
--   * event_id        groups the attempts of one logical delivery (one domain
--                     event to one webhook), so "has this event been delivered"
--                     is a question with an answer.
--   * state           pending | delivered | failed | exhausted. `pending` is
--                     the only queued value; `failed` is a failed attempt that
--                     a later attempt has already superseded.
--   * next_attempt_at when the delivery is next owed a try — and, pushed
--                     forward by whoever claims it, the lease that keeps a
--                     second worker off the same row.
--   * payload         the exact bytes to re-sign and re-send.
--
-- Three properties this migration is responsible for, all enforced here rather
-- than hoped for in the application:
--
--   1. **An event is queued in exactly one place.** The partial unique index
--      below allows one `pending` row per (license, event). A second worker
--      that tried to queue the same event again would be refused by the
--      database, so "the same event delivered twice" is not a race the sweep
--      can lose — it is an error the storage layer will not accept.
--   2. **A queued row is actually retryable.** `pending` requires an event id,
--      a payload and a next-attempt time. A row that says it is owed a retry
--      but carries nothing to send cannot exist.
--   3. **`permanent` and `state` cannot disagree.** `permanent` used to mean
--      "the third in-request attempt failed"; with a scheduler carrying the row
--      on, that is no longer "gave up". It is now exactly `state = 'exhausted'`
--      and the CHECK keys the two together, so the old column keeps meaning
--      what its name claims rather than quietly becoming a lie.
--
-- Existing rows are backfilled to terminal states (delivered / exhausted /
-- failed), never `pending`: they predate `payload`, so there is nothing to
-- re-send and queueing them would be a promise the row cannot keep.
--
-- Additive throughout — no column is dropped or narrowed, and RLS is untouched:
-- `webhook_deliveries_tenant` covers the table, so the new columns are inside
-- the same tenant boundary the day they appear. The GRANT already includes
-- UPDATE, which the claim/settle path needs.

-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN     "event_id" UUID,
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(6),
ADD COLUMN     "payload" TEXT,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'failed';

-- Backfill, then drop the default: `state` has no default in schema.prisma on
-- purpose, so a writer has to name which of the four states it means. The
-- default exists only to make this ALTER possible on a table with rows in it.
UPDATE "webhook_deliveries"
   SET "state" = CASE
                   WHEN "ok" THEN 'delivered'
                   WHEN "permanent" THEN 'exhausted'
                   ELSE 'failed'
                 END;
ALTER TABLE "webhook_deliveries" ALTER COLUMN "state" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "webhook_deliveries_license_id_state_next_attempt_at_idx"
    ON "webhook_deliveries"("license_id", "state", "next_attempt_at");

-- The one-queued-attempt-per-event guarantee (1). Partial, so the millions of
-- terminal rows a busy workspace accumulates are not in it — and invisible to
-- Prisma, which has no syntax for a WHERE predicate, so `scripts/check-drift.ts`
-- names it alongside the two partial indexes that came before.
CREATE UNIQUE INDEX "webhook_deliveries_one_pending_per_event"
    ON "webhook_deliveries"("license_id", "event_id") WHERE "state" = 'pending';

-- The closed vocabulary. A typo in the application becomes a refused write
-- rather than a row that no query will ever match again.
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_state_check
  CHECK (state IN ('pending', 'delivered', 'failed', 'exhausted'));

-- (2) A queued row carries everything a retry needs …
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_pending_check
  CHECK (state <> 'pending'
         OR (event_id IS NOT NULL AND payload IS NOT NULL AND next_attempt_at IS NOT NULL));

-- … and a row that is not queued is not carrying a due date that would make a
-- sweep look at it again.
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_settled_check
  CHECK (state = 'pending' OR next_attempt_at IS NULL);

-- (3) `permanent` is the boolean shadow of `state = 'exhausted'`.
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_permanent_check
  CHECK (permanent = (state = 'exhausted'));

COMMENT ON COLUMN webhook_deliveries.state IS
  'Queue state of this attempt: pending (another try is owed at next_attempt_at) | delivered | failed (a later attempt superseded it) | exhausted (gave up). Only the newest row of an event is ever pending (M-SCHED-e).';
COMMENT ON COLUMN webhook_deliveries.payload IS
  'The exact serialized body to re-sign and re-send, held only while state = pending and cleared on settle. Text, not jsonb: these are the bytes the HMAC commits to, and jsonb would reorder them.';
