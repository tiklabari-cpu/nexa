-- Widget colour scheme default: 'auto' -> 'light' (owner decision, 2026-10-12).
--
-- 'auto' followed the visitor's OS, so the same site showed a light widget to
-- one visitor and a dark one to the next. The default is now light; 'auto'
-- stays a valid choice (the check constraint is unchanged).
--
-- The backfill follows the 20260811100000 brand-colour precedent: a row still
-- holding the old default is treated as "never chose", because the appearance
-- screen gives no way to tell an explicit 'auto' from an untouched one. A
-- workspace that wants 'auto' back picks it again in Settings -> Widget.
ALTER TABLE "widget_settings" ALTER COLUMN "theme" SET DEFAULT 'light';

UPDATE "widget_settings" SET "theme" = 'light' WHERE "theme" = 'auto';
