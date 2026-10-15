-- Conversation day boundary (tm 285 · SiyahTuş analysis ID-04, decision K3).
--
-- Which calendar day a conversation belongs to is a workspace fact, not a server
-- one: the server is UTC, Istanbul is UTC+3, and a player writing at 00:30 local
-- time would otherwise be filed under yesterday. Two columns on the settings row
-- that already carries the chat-timeout (`inbox_settings`, one per licence+brand
-- and read with `findFirst` like the timeout is, so in effect workspace-level):
--
--   * `day_boundary_tz`   — IANA zone the day is counted in. Defaults to
--     Europe/Istanbul (K3). Whether a value is a real zone is the API's check
--     (`Intl`), not the database's: the list changes with the tz database, and a
--     CHECK against a frozen list would refuse a zone a newer engine accepts.
--   * `day_boundary_hour` — the local hour a day starts at, 0-23. Defaults to 0.
--
-- The defaults are `DEFAULT_DAY_BOUNDARY` in `@siyahtus/types` value-for-value,
-- and a workspace with no row at all reads that constant — three places, one
-- boundary. Changing the setting affects only connections that start afterwards
-- (the day key is written once per chat and never recomputed).
--
-- Expand-only (CONVENTIONS §6.3): two NOT NULL columns with constant
-- defaults — a metadata-only change on Postgres 11+, no rewrite — which an
-- earlier release neither reads nor writes.

ALTER TABLE "inbox_settings"
    ADD COLUMN "day_boundary_tz"   TEXT     NOT NULL DEFAULT 'Europe/Istanbul',
    ADD COLUMN "day_boundary_hour" SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE "inbox_settings"
    ADD CONSTRAINT "inbox_settings_day_boundary_hour_check"
    CHECK ("day_boundary_hour" BETWEEN 0 AND 23);

ALTER TABLE "inbox_settings"
    ADD CONSTRAINT "inbox_settings_day_boundary_tz_check"
    CHECK (length(btrim("day_boundary_tz")) > 0);
