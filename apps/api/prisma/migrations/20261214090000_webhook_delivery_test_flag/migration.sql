-- Webhook delivery log screen (KN-03 · tm 375).
--
-- A "send test event" attempt is written to `webhook_deliveries` so the screen
-- shows it beside real deliveries — but it is not a workspace event, so it must
-- be told apart: an automation card's "last run" counts successful attempts,
-- and a test ping that reached the receiver must not make an unused zap look
-- as if it had run. `is_test` is that marker.
--
-- Additive and backward compatible: the column is NOT NULL with a constant
-- default (no table rewrite on PG11+), so the previous release keeps inserting
-- rows without naming it. RLS is untouched — `webhook_deliveries_tenant`
-- already covers the table. The index the list reads by
-- (`license_id, webhook_id, created_at`) exists since the table was created.

ALTER TABLE "webhook_deliveries" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN webhook_deliveries.is_test IS
  'A signed test ping sent from the delivery log screen, not a workspace event: never queued for retry, never counted as an automation run.';
