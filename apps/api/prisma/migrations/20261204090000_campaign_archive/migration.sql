-- Archiving a campaign (EN-05 · tm 354): the soft delete. The row stays so its sends keep
-- feeding the report; the list hides it and the trigger/delivery paths read it as inactive.
-- Expand only: a nullable column, read by nothing older.
ALTER TABLE "campaigns" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
