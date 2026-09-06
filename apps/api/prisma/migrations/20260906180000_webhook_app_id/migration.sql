-- A webhook subscription that belongs to a connected automation card
-- (FR-MOD-09.4 — Zapier/Make, tm 202.3).
--
-- One nullable column, expand-only (CONVENTIONS §6.3): every row that already
-- exists is a hand-registered webhook and keeps `NULL`, which is exactly what
-- it means — "not attached to a marketplace card". Old code that never selects
-- the column is unaffected, so this is safe with both versions running.
--
-- The value is a catalogue id from @nexa/types (`zapier`, `make`), not a
-- foreign key: the catalogue is static data in the type package, and it is the
-- *connection* (`app_installations`) that is a row. Holding the link by id
-- keeps the gate in the service — a subscription may only be created while the
-- card is connected, and disconnecting deletes them — rather than in a cascade
-- that would silently drop a workspace's automations.
ALTER TABLE webhooks ADD COLUMN "app_id" TEXT;

-- Reads are always "this licence's subscriptions for this card": the count the
-- card shows, and the delete that disconnecting performs.
CREATE INDEX "webhooks_license_id_app_id_idx" ON webhooks ("license_id", "app_id");
