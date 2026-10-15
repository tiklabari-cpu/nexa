-- The widget's built-in pre-chat form becomes a per-brand setting (WG-01, tm
-- 279). Until now the form always opened and all four fields (name, username,
-- e-mail, message) were required (owner, 2026-10-14); that stays the default.
--
-- `prechat_enabled` defaults to true, so every existing row keeps the form.
-- `prechat_fields` is nullable on purpose and gets no default: NULL means "this
-- brand never saved the form", which reads as today's defaults
-- (DEFAULT_PRECHAT_CONFIG in @siyahtus/types) AND tells the API not to enforce
-- it server-side — a workspace's existing direct Customer Chat API callers keep
-- working until somebody actually saves a requirement. No existing row changes.
--
-- The CHECK pins the JSONB shape the API writes: exactly the four keys, each
-- {visible: bool, required: bool}, and never required while hidden. COALESCE
-- because a missing key makes jsonb_typeof NULL, and a NULL CHECK passes.
-- Old code never writes these columns, so the constraint cannot refuse it
-- (CONVENTIONS §6.3).
ALTER TABLE "widget_settings"
    ADD COLUMN "prechat_enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "prechat_fields" JSONB,
    ADD CONSTRAINT "widget_settings_prechat_fields_shape"
        CHECK (
            "prechat_fields" IS NULL
            OR COALESCE(
                jsonb_typeof("prechat_fields") = 'object'
                AND ("prechat_fields" - ARRAY['name', 'username', 'email', 'message']) = '{}'::jsonb
                AND jsonb_typeof("prechat_fields" -> 'name' -> 'visible') = 'boolean'
                AND jsonb_typeof("prechat_fields" -> 'name' -> 'required') = 'boolean'
                AND ("prechat_fields" -> 'name' -> 'visible' = 'true'::jsonb OR "prechat_fields" -> 'name' -> 'required' = 'false'::jsonb)
                AND jsonb_typeof("prechat_fields" -> 'username' -> 'visible') = 'boolean'
                AND jsonb_typeof("prechat_fields" -> 'username' -> 'required') = 'boolean'
                AND ("prechat_fields" -> 'username' -> 'visible' = 'true'::jsonb OR "prechat_fields" -> 'username' -> 'required' = 'false'::jsonb)
                AND jsonb_typeof("prechat_fields" -> 'email' -> 'visible') = 'boolean'
                AND jsonb_typeof("prechat_fields" -> 'email' -> 'required') = 'boolean'
                AND ("prechat_fields" -> 'email' -> 'visible' = 'true'::jsonb OR "prechat_fields" -> 'email' -> 'required' = 'false'::jsonb)
                AND jsonb_typeof("prechat_fields" -> 'message' -> 'visible') = 'boolean'
                AND jsonb_typeof("prechat_fields" -> 'message' -> 'required') = 'boolean'
                AND ("prechat_fields" -> 'message' -> 'visible' = 'true'::jsonb OR "prechat_fields" -> 'message' -> 'required' = 'false'::jsonb),
                false
            )
        );
