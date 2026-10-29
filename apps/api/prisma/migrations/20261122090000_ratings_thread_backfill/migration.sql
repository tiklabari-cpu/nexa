-- A rating belongs to a connection (AR-03 · WG-11 · tm 337): the archive row,
-- the Inbox's Details panel and the Reviews comments read it by `thread_id`.
-- Rows written before every rating carried one (a chat with no thread yet)
-- are given the connection they were most likely about, once: the newest of
-- the chat's connections that had started by the rating's time (a minute of
-- slack for clocks that disagree), or the chat's first one when none had.
-- A chat with no connection at all keeps NULL; nothing reads it by thread.
--
-- Data only, no schema change: old and new code read the column the same way
-- (CONVENTIONS 6.3). Small by construction (only threadless chats wrote NULL),
-- so one statement rather than batches.
UPDATE "ratings" r
   SET "thread_id" = COALESCE(
         (SELECT t."id" FROM "threads" t
           WHERE t."chat_id" = r."chat_id"
             AND t."created_at" <= r."created_at" + interval '1 minute'
           ORDER BY t."created_at" DESC, t."id" DESC
           LIMIT 1),
         (SELECT t."id" FROM "threads" t
           WHERE t."chat_id" = r."chat_id"
           ORDER BY t."created_at", t."id"
           LIMIT 1))
 WHERE r."thread_id" IS NULL;
