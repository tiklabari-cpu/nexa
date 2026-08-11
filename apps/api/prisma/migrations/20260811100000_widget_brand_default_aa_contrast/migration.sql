-- Widget brand colour default: #2f6bff -> #2d67fa (NFR-A11Y1, tm 115).
--
-- The widget draws white text on this colour — the header, the visitor's own
-- bubbles, the launcher glyph. axe measured white on #2f6bff at 4.49:1, one
-- rounding step under the WCAG 2.1 AA floor of 4.5:1, on the shipped default
-- for every workspace that never opened the appearance panel. #2d67fa is
-- 4.74:1 and is visually within a hair of it.
--
-- `DEFAULT_WIDGET_APPEARANCE` in `@nexa/types` and the widget's own `--nx-brand`
-- move with it; this column exists to mirror them value-for-value.
ALTER TABLE "widget_settings" ALTER COLUMN "primary_color" SET DEFAULT '#2d67fa';

-- A stored row holding the old default is a workspace that accepted the shipped
-- look, so it moves too. A workspace that deliberately picked #2f6bff is
-- indistinguishable from one that accepted it, and the accessible colour is the
-- better answer for both.
UPDATE "widget_settings" SET "primary_color" = '#2d67fa' WHERE "primary_color" = '#2f6bff';
