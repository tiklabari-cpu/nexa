-- Delivery timestamp for campaign sends (M-CAMP-a · FR-MOD-03.3.2 · denetim K2
-- · tm 176.1).
--
-- Today a `campaign_sends` row only ever means "the trigger engine matched
-- this visitor" — nothing downstream ever tells the widget, so nothing is
-- ever actually delivered. `delivered_at` is what the poll handler
-- (`GET /customer/chat`, tm 176.2) will stamp, in the same transaction it
-- carries the message to the visitor: NULL means still owed, non-null means
-- delivered. It is deliberately not backdated to `created_at` (when the
-- trigger matched) — a visitor cannot have seen a message before the poll
-- that could have shown it ran.

-- AlterTable
ALTER TABLE "campaign_sends" ADD COLUMN     "delivered_at" TIMESTAMPTZ(6);

-- The poll handler's query is `WHERE license_id = ? AND customer_id = ? AND
-- delivered_at IS NULL ORDER BY created_at LIMIT 1`, run on every 4-second
-- poll from every active widget session, against a table with no retention
-- sweep — it only ever grows. Measured (176k-row synthetic table, one busy
-- tenant at 119k rows / 3.6k pending): unindexed, that is a parallel seq
-- scan, ~12 ms. A plain (license_id, customer_id, delivered_at) btree drops
-- that to ~2.3 ms but is 6.4 MB and indexes every row ever sent, delivered or
-- not, so it keeps growing with the table's full history forever.
--
-- A **partial** index — only the still-pending rows — measured 224 KB and
-- ~0.07 ms: its size tracks the pending backlog, not history, so it stays
-- small no matter how long a tenant has been running campaigns. Same shape
-- as `webhook_deliveries_one_pending_per_event`
-- (20260818100000_webhook_redelivery): a pending-queue lookup gets a partial
-- index keyed on what makes a row "still owed", not a general-purpose index
-- over the whole table.
CREATE INDEX "campaign_sends_pending_by_customer_idx"
    ON "campaign_sends"("license_id", "customer_id") WHERE "delivered_at" IS NULL;
