-- Widget availability (WG-09, tm 341).
--
-- widget_settings.availability_mode: when a visitor may start a chat.
-- 'always' -- a chat opens whoever is there and waits unassigned when nobody
-- is; 'agents_only' -- with no AI to answer and nobody accepting chats the
-- widget offers the offline form instead. The server turns this into
-- `can_start_chat` on GET /customer/chat; an AI that would answer keeps the
-- chat open under either.
--
-- Additive only: the column carries its default, so every existing row reads
-- 'always' and a replica of the previous release that never writes it is
-- unaffected. The CHECK mirrors WIDGET_AVAILABILITY_MODES in @siyahtus/types.
ALTER TABLE "widget_settings"
    ADD COLUMN "availability_mode" TEXT NOT NULL DEFAULT 'always',
    ADD CONSTRAINT "widget_settings_availability_mode_check"
        CHECK ("availability_mode" IN ('always', 'agents_only'));
