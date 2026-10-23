-- Where a widget visit came from (tm 330 · SiyahTuş analysis IN-02, EN-03,
-- AU-02 · GEOIP-COUNTRY).
--
-- The visitor's address is looked up once, when the visit starts, in an
-- offline database inside the API process (`services/geo/`); the answer is
-- kept here and the contact's empty `customers.country_code` is filled from
-- it. Country and city only (IN-02-S1: no map, no coordinates) — a visit is
-- not re-located on every page.
--
-- Expand-only (CONVENTIONS §6.3): two nullable columns the previous release
-- neither reads nor writes. NULL = not known: no database configured, an
-- address the database does not hold, and every visit recorded before this
-- migration — not backfilled. No index: read with its visit, never searched
-- (country filters run on `customers.country_code`, which has one). No RLS
-- change: `visits` carries its tenant policy and new columns inherit it.

ALTER TABLE visits ADD COLUMN country_code CHAR(2);
ALTER TABLE visits ADD COLUMN city TEXT;
