-- The player's answer by e-mail joins its ticket (tm 358 · SiyahTuş analysis HD-03).
--
-- Until now every inbound mail opened a ticket: a reply went out with no
-- address to answer to, and the answer that came back anyway was a stranger.
-- Matching itself needs nothing new from the schema — a reply address carries
-- its ticket and an HMAC, an `In-Reply-To` finds `ticket_messages.email_message_id`
-- — but what happens after a match does:
--
--   1. `tickets.related_ticket_id` — an answer to a closed ticket, or to one
--      quiet longer than the reopen window, opens a new ticket that names the
--      old one rather than reopening it. Same shape as `merged_into_id`:
--      `ON DELETE SET NULL`, never itself, indexed for the cascade.
--   2. `ticket_messages.sender_mismatch` — a reply address or a thread
--      reference matched, the sender is not the ticket's player: kept, flagged
--      for the console. Only a player's message can carry it.
--   3. `inbox_settings.ticket_reopen_window_days` — the window, per workspace,
--      30 days unless set.
--
-- Expand-only (CONVENTIONS §6.3): two nullable/defaulted columns and a
-- defaulted one, an index on a column every row holds NULL in, CHECKs every
-- existing row passes. Nothing an earlier release reads changes. The index is
-- built in this transaction (not CONCURRENTLY): `tickets` is small, as in
-- 20261025100000_ticket_messages. The app role already writes every column of
-- `tickets` and inserts every column of `ticket_messages`; `sender_mismatch`
-- is not added to its column-level UPDATE grant — a message's flags are
-- written once.

-- 1. tickets.related_ticket_id
ALTER TABLE "tickets" ADD COLUMN     "related_ticket_id" VARCHAR(12);

CREATE INDEX "tickets_related_ticket_idx" ON "tickets"("related_ticket_id");

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_related_ticket_id_fkey" FOREIGN KEY ("related_ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_related_not_self_check"
  CHECK ("related_ticket_id" IS NULL OR "related_ticket_id" <> "id");

-- 2. ticket_messages.sender_mismatch
ALTER TABLE "ticket_messages" ADD COLUMN     "sender_mismatch" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_sender_mismatch_customer_only_check"
  CHECK (NOT "sender_mismatch" OR "kind" = 'customer_message');

-- 3. inbox_settings.ticket_reopen_window_days
ALTER TABLE "inbox_settings" ADD COLUMN     "ticket_reopen_window_days" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_ticket_reopen_window_days_check"
  CHECK ("ticket_reopen_window_days" BETWEEN 1 AND 365);
