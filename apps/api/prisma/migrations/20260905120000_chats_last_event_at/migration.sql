-- The conversation list orders by *last activity*, not by when the conversation
-- was opened (PRD FR-MOD-02.2.2 -- "Tiklama transcript acar; RTM'de yukari
-- tasinir + unread"). `chats.created_at` never moves, so before this column a
-- visitor who wrote stayed exactly where they started: at the bottom of a busy
-- inbox, under conversations that had said nothing for hours.
--
-- The key is maintained here rather than derived from `events` on read. Derived
-- keeps the write path clean, but the read is the side under a budget (NFR-P2,
-- p99 < 150 ms) and "max(events.created_at) per chat" cannot be an ordering
-- index: every candidate row would have to be probed before the sort could
-- start, and a keyset cursor over it would have nothing stable to page on.
-- Maintained, the page is one index range scan -- measured in `chats.test.ts`,
-- "orders by last activity out of an index (EXPLAIN ANALYZE)".
--
-- Expand, do not narrow (CONVENTIONS 6.3): the column arrives nullable, is
-- filled, and only then gets its default and NOT NULL. Code from the previous
-- release never names the column, so its INSERTs take the DEFAULT -- which is
-- why the DEFAULT has to be in place before the NOT NULL.
ALTER TABLE "chats" ADD COLUMN "last_event_at" TIMESTAMPTZ(6);

-- The invariant the column carries, stated once: the `created_at` of the chat's
-- newest event, or the chat's own creation time while it has none. That is the
-- same instant the list already prints on the row (`last_event.created_at`), so
-- ordering by it re-uses a value the reader can see rather than inventing a
-- second, invisible notion of recency.
UPDATE "chats" c
SET "last_event_at" = COALESCE(
  (SELECT max(e."created_at") FROM "events" e WHERE e."chat_id" = c."id"),
  c."created_at"
);

ALTER TABLE "chats" ALTER COLUMN "last_event_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "chats" ALTER COLUMN "last_event_at" SET NOT NULL;
