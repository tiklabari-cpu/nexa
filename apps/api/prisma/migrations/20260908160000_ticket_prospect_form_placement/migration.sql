-- Ticket and prospect form placements — FR-MOD-08.7.7 (the "ticket/prospect"
-- half of "pre-chat/post-chat/ticket/prospect").
--
-- `20260726210000_prechat_form` created the CHECK admitting one placement and
-- `20260821100000_post_chat_form` widened it to two; both were contact-only,
-- because both forms ask a visitor about themselves. The two the PRD still
-- names are asked in one moment — the visitor leaves a message because nobody
-- is available — but about two different things, so they land on two different
-- entities:
--
--   * 'prospect' — about the person who left the message, on the contact,
--     exactly where 'pre_chat' and 'post_chat' answers already go.
--   * 'ticket'   — about the request itself, on the ticket that message opens
--     (KK "widget'ta gösterim -> contact/ticket'a yazma").
--
-- This is a WIDENING and nothing else. The column, the data, the indexes and
-- RLS are untouched; only which strings may reach the column changes, and every
-- combination the old constraint admitted (NULL, and 'pre_chat'/'post_chat' on
-- a contact field) still passes unchanged. So there is no backfill, no rewrite
-- and no row that the new constraint invalidates — the rule CONVENTIONS §6.3
-- asks of a constraint added while the previous version is still serving
-- traffic. The constraint is invisible to Prisma, as in both earlier
-- migrations, so it is dropped and re-added by hand rather than emitted by
-- `migrate diff`, and `db:check-drift` stays clean because the model is
-- untouched.

ALTER TABLE "custom_field_definitions"
  DROP CONSTRAINT "custom_field_definitions_form_placement_check";

ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_form_placement_check"
  CHECK (
    "form_placement" IS NULL
    OR ("form_placement" IN ('pre_chat', 'post_chat', 'prospect') AND "entity" = 'contact')
    OR ("form_placement" = 'ticket' AND "entity" = 'ticket')
  );
