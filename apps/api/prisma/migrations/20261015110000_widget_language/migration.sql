-- Widget language (WG-02, tm 280).
--
-- widget_settings.language: what the panel pinned -- 'auto' (the visitor's
-- browser decides) or one of the widget's eight UI languages (K25: no more).
-- widget_settings.fallback_language: what 'auto' falls back to when the
-- browser speaks none of them. The column default is 'en' on purpose: rows that
-- existed before this migration keep rendering the way they always did
-- (English), while a row created from now on is written with the application
-- default 'tr' (DEFAULT_WIDGET_APPEARANCE in @siyahtus/types).
--
-- customers.locale: the language of the widget the visitor chose to write from,
-- recorded on the message that opens a chat. Nullable -- every customer made
-- before this, and every one reached through a channel other than the widget,
-- has none -- and it is what the visitor's transcript e-mail is written in.
-- Not an identity attribute and not verified: it is the widget's own say-so.
--
-- The CHECK lists mirror WIDGET_UI_LOCALES in @siyahtus/types, so a value the
-- endpoint refuses cannot reach the table by another road. Additive only:
-- nothing is dropped or narrowed, and a replica of the previous release that
-- never writes these columns is unaffected (NOT NULL columns carry defaults).
ALTER TABLE "widget_settings"
    ADD COLUMN "language" TEXT NOT NULL DEFAULT 'auto',
    ADD COLUMN "fallback_language" TEXT NOT NULL DEFAULT 'en',
    ADD CONSTRAINT "widget_settings_language_check"
        CHECK ("language" IN ('auto', 'en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar')),
    ADD CONSTRAINT "widget_settings_fallback_language_check"
        CHECK ("fallback_language" IN ('en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar'));

ALTER TABLE "customers"
    ADD COLUMN "locale" TEXT,
    ADD CONSTRAINT "customers_locale_check"
        CHECK ("locale" IS NULL OR "locale" IN ('en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar'));
