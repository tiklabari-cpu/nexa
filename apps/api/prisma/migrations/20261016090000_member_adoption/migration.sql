-- Member recognition: the way off the bare `customer_id` (SiyahTuş analysis
-- ID-03 · owner decision K4 · tm 287.2 · PLAN §D241 ·
-- docs/adr/member-recognition.md §5).
--
-- From this release a returning visitor is recognised by the signed member
-- token `POST /customer/token` hands their browser, never by the `customer_id`
-- the widget kept in localStorage: an id identifies, it does not authenticate,
-- and whoever learned a member's id could open their conversation with it.
--
-- The visitors who were here before have only that id. Each of them may trade
-- it for a member token ONCE, inside a transition window (trust on first use):
-- the first mint that presents the id adopts the customer and clears this
-- column, so the id alone never opens the record again — not for the member,
-- and not for anybody who copied it. A customer created from now on is born
-- without the column set, so its id never opened anything.
--
-- How the window is laid down without rewriting the table: a column added with
-- a non-volatile default (`now()` is stable) has that default evaluated ONCE,
-- at this statement, and stored in the catalogue as the value of every
-- existing row (Postgres 11+, "fast default"); dropping the default straight
-- after leaves those rows with it and gives every later row NULL. So exactly
-- the customers that exist at deploy time are adoptable, for 30 days from the
-- deploy — the default member-token lifetime (`MEMBER_TOKEN_TTL`), so a
-- visitor who comes back within the time a token would have kept them is the
-- visitor the window keeps.
--
-- Expand-only (CONVENTIONS §6.3): a nullable column the previous release never
-- reads; nothing is dropped, narrowed or constrained.

ALTER TABLE customers
  ADD COLUMN member_adoptable_until TIMESTAMPTZ(6) DEFAULT (now() + interval '30 days');
ALTER TABLE customers ALTER COLUMN member_adoptable_until DROP DEFAULT;

-- A customer who reached the workspace through a channel (e-mail, WhatsApp,
-- SMS, Telegram, Messenger) never had a widget id to trade in, so nothing
-- legitimate would ever adopt them — the window would only leave their
-- conversation open, for its whole length, to whoever learned their id. They
-- are taken out of it here. Touches only those rows.
UPDATE customers
SET member_adoptable_until = NULL
WHERE member_adoptable_until IS NOT NULL
  AND EXISTS (SELECT 1 FROM channel_identities ci WHERE ci.customer_id = customers.id);
