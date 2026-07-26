-- Inbox behaviour settings (FR-MOD-08.7 — "Settings/Inbox tools").
--
-- A per-license singleton, keyed and shaped like `security_settings`. The first
-- field it carries is `chat_timeout_seconds` (FR-MOD-08.7.3): after that many
-- seconds with no activity a chat is auto-closed by the sweep. Null disables it.
--
-- Isolation is the same as every other tenant table: RLS scopes each row to the
-- workspace that owns it, so one license can neither read nor write another's
-- timeout. The application role reaches it only through that policy.

CREATE TABLE "inbox_settings" (
    "license_id" BIGINT NOT NULL,
    "chat_timeout_seconds" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inbox_settings_pkey" PRIMARY KEY ("license_id")
);

ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE inbox_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_settings_tenant ON inbox_settings
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

GRANT SELECT, INSERT, UPDATE, DELETE ON inbox_settings TO nexa_app;
