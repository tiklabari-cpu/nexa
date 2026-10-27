-- Operator alerts (tm 389.20 · FR-ADMIN-24): the language an operator's alert mail
-- is written in. Null reads as English; the preferences screen writes it with the
-- kinds, so an operator who never saved a choice has no row at all.
ALTER TABLE "platform_alert_prefs" ADD COLUMN "locale" TEXT;

ALTER TABLE "platform_alert_prefs" ADD CONSTRAINT "platform_alert_prefs_locale_check"
  CHECK (locale IS NULL OR locale IN ('en', 'tr'));
