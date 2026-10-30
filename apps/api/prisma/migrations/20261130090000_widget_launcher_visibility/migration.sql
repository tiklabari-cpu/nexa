-- Launcher visibility and widget logo (WG-10, tm 347).
--
-- widget_settings.launcher_visibility: when the chat bubble is drawn.
-- 'always' -- from the first paint, what every install did until now;
-- 'until_opened' -- hidden until the host page opens the panel itself
-- (`siyahtus('open')`), shown from then on; 'never' -- no bubble, the panel
-- opens only through the page's own button.
-- widget_settings.show_logo: show the brand's logo (brands.logo_url) in the
-- panel header; off by default so a brand that already has a logo on file does
-- not suddenly wear it in the widget.
--
-- Expand only (CONVENTIONS 6.3): two columns with constant defaults, so every
-- existing row reads 'always' / false and a replica of the previous release
-- that never writes them is unaffected. The CHECK mirrors
-- WIDGET_LAUNCHER_VISIBILITIES in @siyahtus/types.
ALTER TABLE "widget_settings"
    ADD COLUMN "launcher_visibility" TEXT NOT NULL DEFAULT 'always',
    ADD COLUMN "show_logo" BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT "widget_settings_launcher_visibility_check"
        CHECK ("launcher_visibility" IN ('always', 'until_opened', 'never'));
