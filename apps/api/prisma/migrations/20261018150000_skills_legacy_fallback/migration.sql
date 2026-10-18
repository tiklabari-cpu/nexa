-- The one-message skills that answer every message become fallbacks (tm 297.2 ·
-- SiyahTuş analysis AI-05 §5).
--
-- A `single` skill without a `detect_intent` step has no gate: before
-- procedures it matched every message, and since the turn tried skills
-- newest-edited first, one saved last swallowed the conversations a skill
-- with a matching intent was written for. From this release the turn tries
-- a fallback only after everything else — no procedure reached the agent's
-- `clarify_thresholds.low`, no gated skill matched — so marking these rows
-- `is_fallback` keeps them answering what nothing else answers, and nothing
-- more. The Playbook list flags them.
--
-- An agent may end up with more than one: the API refuses a new second
-- fallback (`procedure_fallback_taken`), but rows that were already there are
-- left as they are, and the turn takes the first in its order. Procedure
-- skills are not touched: their selection is the understanding call's.
--
-- Data only; the column exists since 20261018090000. The previous release does
-- not read it, so it is unaffected (CONVENTIONS §6.3).
UPDATE skills
SET is_fallback = true
WHERE kind = 'ai_agent'
  AND mode = 'single'
  AND NOT is_fallback
  -- An empty list is a draft that answers nothing yet; it is not a catch-all.
  -- (CASE, not AND: Postgres does not promise to test the type first.)
  AND CASE WHEN jsonb_typeof(steps) = 'array' THEN jsonb_array_length(steps) > 0 ELSE false END
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(steps) = 'array' THEN steps ELSE '[]'::jsonb END
    ) AS step
    WHERE step ->> 'type' = 'detect_intent'
  );
