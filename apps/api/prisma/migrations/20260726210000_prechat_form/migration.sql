-- Forms builder (pre/post-chat) — FR-MOD-08.7.7.
--
-- A workspace can ask a visitor for details before the conversation starts, and
-- those answers are written to the contact. Rather than a parallel form table,
-- a pre-chat field IS a contact custom field flagged to appear on the widget:
-- the answer is then a normal custom-field value, validated by its `type` (KK
-- "tip validasyon") and visible in the CRM like any other (KK "contact'a
-- yazma"). This adds the one column that turns a CRM field into a form field.
--
--   * form_placement — 'pre_chat' when the field is asked on the widget's
--     pre-chat form, or NULL for a CRM-only field. Reserved for 'post_chat' in a
--     later slice; the CHECK admits only the placements wired end-to-end today.
--
-- The ADD COLUMN is what `prisma migrate diff` emits for the schema change; the
-- CHECK is invisible to Prisma and added by hand, the same way the other custom
-- field constraints are (see 20260726200000_custom_fields).

-- AlterTable
ALTER TABLE "custom_field_definitions" ADD COLUMN "form_placement" TEXT;

-- A placement is only meaningful on a contact field — there is no ticket to hang
-- a value on before a chat exists — and only the placements the product renders
-- are allowed, so a bad string cannot reach the column.
ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_form_placement_check"
  CHECK (
    "form_placement" IS NULL
    OR ("form_placement" IN ('pre_chat') AND "entity" = 'contact')
  );
