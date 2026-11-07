-- Visitor typing preview switch (tm 417.1 · K8).
--
-- widget_settings.sneak_peek_enabled: whether the assigned human agent may see
-- the visitor's unsent draft. On by default (owner, 2026-11-06): rows that
-- already exist read the same as a row made from now on
-- (DEFAULT_WIDGET_APPEARANCE.sneak_peek_enabled in @siyahtus/types). A
-- HIPAA-scoped workspace has the preview off whatever this column says; that is
-- decided on read from the licence, not stored here.
--
-- Additive only (CONVENTIONS 6.3): a NOT NULL column with a default, so a
-- replica of the previous release that never writes it is unaffected.
ALTER TABLE "widget_settings"
    ADD COLUMN "sneak_peek_enabled" BOOLEAN NOT NULL DEFAULT true;
