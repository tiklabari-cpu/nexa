-- Choice field types and form ordering — WG-04 (tm 343).
--
-- Three new custom-field types pick their value from the definition's own
-- `options`: 'select' (one), 'multiselect' (any number, stored as a JSON array)
-- and 'topic' (one, and the choice may route the conversation to a team — an
-- option's `target_group_id`). And every field gets a `position`, so a form is
-- asked in the order its admin arranged rather than the order it was typed in.
--
-- A WIDENING (CONVENTIONS §6.3). The two columns are added nullable / with a
-- default, the type CHECK admits more strings than before, and the new CHECKs
-- hold for every row the previous version can write: it writes only the four
-- old types, with `options` left NULL — exactly what the options CHECK demands
-- of them — and never a topic. The backfill below only numbers the existing
-- rows by their old order (created_at), so nothing an older reader sees moves.

ALTER TABLE "custom_field_definitions"
  ADD COLUMN "options" JSONB,
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Today's order, made explicit: per form (or, for CRM-only fields, per entity),
-- oldest first — what every list read before this migration.
UPDATE "custom_field_definitions" AS d
   SET "position" = n.rn - 1
  FROM (
    SELECT "id",
           row_number() OVER (
             PARTITION BY "license_id", "entity", "form_placement"
             ORDER BY "created_at", "id"
           ) AS rn
      FROM "custom_field_definitions"
  ) AS n
 WHERE d."id" = n."id";

ALTER TABLE "custom_field_definitions"
  DROP CONSTRAINT "custom_field_definitions_type_check";

ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_type_check"
  CHECK ("type" IN ('text', 'number', 'boolean', 'date', 'select', 'multiselect', 'topic'));

-- A choice field's options: a JSON array of 1–50 objects, each with a value and
-- a label of 1–80 characters (`customFieldOptionsProblem` in @siyahtus/types
-- says the same to the admin, and adds "distinct" and "only a topic routes").
-- CASE rather than AND so a non-array never reaches `jsonb_array_length`, which
-- would raise instead of answering false.
CREATE FUNCTION custom_field_options_valid(p_options JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_options IS NULL OR jsonb_typeof(p_options) <> 'array' THEN false
    WHEN jsonb_array_length(p_options) NOT BETWEEN 1 AND 50 THEN false
    ELSE NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_options) AS o(item)
       WHERE CASE
               WHEN jsonb_typeof(o.item) <> 'object' THEN true
               ELSE char_length(coalesce(o.item ->> 'value', '')) NOT BETWEEN 1 AND 80
                 OR char_length(coalesce(o.item ->> 'label', '')) NOT BETWEEN 1 AND 80
             END
    )
  END
$$;

ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_options_check"
  CHECK (
    CASE
      WHEN "type" IN ('select', 'multiselect', 'topic') THEN custom_field_options_valid("options")
      ELSE "options" IS NULL
    END
  );

-- A topic is asked before the conversation exists — the moment routing decides
-- who takes it — so it is a pre-chat question and nothing else.
ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_topic_placement_check"
  CHECK ("type" <> 'topic' OR "form_placement" = 'pre_chat');

-- One topic per workspace: two would be two answers to "which team".
CREATE UNIQUE INDEX "custom_field_definitions_one_topic"
  ON "custom_field_definitions" ("license_id")
  WHERE "type" = 'topic';
