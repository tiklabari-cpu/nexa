-- Post-chat form placement — FR-MOD-08.7.7 (the second half of "pre/post-chat").
--
-- `20260726210000_prechat_form` added `form_placement` and deliberately admitted
-- one value: the placement the product actually rendered at the time. This widens
-- the CHECK to the second one, now that the widget asks it and the Customer Chat
-- API stores the answers.
--
-- Nothing about the column, the data or RLS changes — only which strings may
-- reach it. Widening a CHECK cannot invalidate a stored row, so no backfill and
-- no rewrite: every existing 'pre_chat' and NULL still passes. The constraint is
-- invisible to Prisma (as in the original migration), so it is dropped and
-- re-added by hand rather than emitted by `migrate diff`, and `db:check-drift`
-- stays clean because the model is untouched.

ALTER TABLE "custom_field_definitions"
  DROP CONSTRAINT "custom_field_definitions_form_placement_check";

ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_form_placement_check"
  CHECK (
    "form_placement" IS NULL
    OR ("form_placement" IN ('pre_chat', 'post_chat') AND "entity" = 'contact')
  );
