-- channel_messages(license_id, chat_id) index (07.5-c · FR-MOD-07.5 · NFR-P2).
--
-- The reports breakdown's channel dimension (07.5-d) will join channel_messages
-- to a chat by (license_id, chat_id). The table's only existing index is
-- (license_id, channel_type, created_at) — chat_id is unindexed, so that join
-- would fall back to a sequential scan as the table grows. Pure index add, no
-- data change, reversible with DROP INDEX.
CREATE INDEX "channel_messages_license_id_chat_id_idx" ON "channel_messages"("license_id", "chat_id");
