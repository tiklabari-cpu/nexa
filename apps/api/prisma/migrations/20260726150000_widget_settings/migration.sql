-- Widget appearance settings (FR-MOD-11.7 — "Widget customization").
--
-- A per-license singleton, keyed and shaped like `inbox_settings`. It carries
-- the whole customisable surface of the widget: brand colour, corner, colour
-- scheme, mobile-fullscreen and the removable "Powered by" footer (FR-MOD-11.5).
--
-- The three CHECK constraints are the database's own copy of the normaliser in
-- `@nexa/types`: a colour is only ever a `#rrggbb` hex, position and theme only
-- ever their enums. These values are embedded verbatim in the install snippet
-- and applied to CSS, so the shape is guarded at the last layer as well.
--
-- Isolation is the same as every other tenant table: RLS scopes each row to the
-- workspace that owns it, so one license can neither read nor write another's
-- appearance. The application role reaches it only through that policy.

CREATE TABLE "widget_settings" (
    "license_id" BIGINT NOT NULL,
    "primary_color" TEXT NOT NULL DEFAULT '#2f6bff',
    "position" TEXT NOT NULL DEFAULT 'bottom-right',
    "theme" TEXT NOT NULL DEFAULT 'auto',
    "mobile_fullscreen" BOOLEAN NOT NULL DEFAULT true,
    "powered_by" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "widget_settings_pkey" PRIMARY KEY ("license_id"),
    CONSTRAINT "widget_settings_color_check" CHECK ("primary_color" ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT "widget_settings_position_check" CHECK ("position" IN ('bottom-right', 'bottom-left')),
    CONSTRAINT "widget_settings_theme_check" CHECK ("theme" IN ('auto', 'light', 'dark'))
);

ALTER TABLE "widget_settings" ADD CONSTRAINT "widget_settings_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE widget_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY widget_settings_tenant ON widget_settings
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

GRANT SELECT, INSERT, UPDATE, DELETE ON widget_settings TO nexa_app;
