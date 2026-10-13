-- The widget's welcome message (owner decision, 2026-10-13): a bold first line
-- and the text under it, which a workspace writes in Settings -> Widget and the
-- widget shows as the team's first bubble. Both optional; null keeps the
-- widget's built-in line, which is every existing workspace.
--
-- The length checks mirror WIDGET_WELCOME_TITLE_MAX / WIDGET_WELCOME_TEXT_MAX
-- in @siyahtus/types, so a value the endpoint refuses cannot reach the table by
-- another road. char_length, not octet_length: the limit is what a person
-- typed, and Turkish letters are two bytes each.
ALTER TABLE "widget_settings"
    ADD COLUMN "welcome_title" TEXT,
    ADD COLUMN "welcome_text" TEXT,
    ADD CONSTRAINT "widget_settings_welcome_title_length"
        CHECK ("welcome_title" IS NULL OR char_length("welcome_title") <= 120),
    ADD CONSTRAINT "widget_settings_welcome_text_length"
        CHECK ("welcome_text" IS NULL OR char_length("welcome_text") <= 500);
