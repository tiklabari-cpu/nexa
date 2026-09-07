-- Row-inline custom columns on the Contacts table — FR-MOD-03.2.3.
--
-- A custom field already shows on the Details/CRM panel (FR-MOD-08.7.6), but a
-- workspace with many definitions cannot make every one of them a table column
-- without breaking the table — the same "genişlet, sonra dar" choice
-- `form_placement` made for widget forms. `show_in_table` opts one field in;
-- the default (false) means a newly defined field never widens the table.
--
--   * show_in_table — true when this field also renders as a row-inline column
--     on the Contacts table. Reserved for `entity = 'contact'` — the table has
--     no row to hang a ticket field off, matching `form_placement`'s own
--     restriction (see 20260726210000_prechat_form).
--
-- The ADD COLUMN is what `prisma migrate diff` emits for the schema change
-- (minus the unrelated pgvector index it always reports — see check-drift.ts);
-- the CHECK is invisible to Prisma and added by hand.

-- AlterTable
ALTER TABLE "custom_field_definitions" ADD COLUMN "show_in_table" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_show_in_table_check"
  CHECK ("show_in_table" = false OR "entity" = 'contact');
