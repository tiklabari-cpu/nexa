-- AU-03 (tm 374): when a ticket rule runs, and what a bad vote sets off.
-- Expand only. `ticket_rules.on` defaults to `created` — the one moment every
-- rule ran at before — so every stored rule keeps its behaviour, and the code
-- before this release, which never reads the column, writes rows the default
-- fills. `TICKET_RULE_EVENTS` holds the same list.
ALTER TABLE "ticket_rules"
  ADD COLUMN "on" TEXT NOT NULL DEFAULT 'created',
  ADD CONSTRAINT "ticket_rules_on_check"
    CHECK ("on" IN ('created', 'updated', 'status_changed', 'message_added'));

-- The bad-rating automation per brand (`BadRatingActions`). Null: the
-- defaults (`DEFAULT_BAD_RATING_ACTIONS` — tell the leads, queue for QA, no
-- ticket); a stored object missing a switch reads that switch's default.
ALTER TABLE "inbox_settings"
  ADD COLUMN "bad_rating_actions" JSONB,
  ADD CONSTRAINT "inbox_settings_bad_rating_actions_object"
    CHECK ("bad_rating_actions" IS NULL OR jsonb_typeof("bad_rating_actions") = 'object');
