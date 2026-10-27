-- How the player asked for a person outside their own words (tm 308 · AI-29):
-- `button` is the widget's "Talk to an agent". Null on every other hand-over —
-- the AI's own decision, or what the player wrote — which is every existing
-- row. The CHECK mirrors HUMAN_REQUEST_VIAS in @siyahtus/types; the hand-over
-- card and AI-25's press rate read it.
ALTER TABLE "ai_handoffs"
    ADD COLUMN "requested_via" TEXT,
    ADD CONSTRAINT "ai_handoffs_requested_via_check"
        CHECK ("requested_via" IS NULL OR "requested_via" IN ('button'));
