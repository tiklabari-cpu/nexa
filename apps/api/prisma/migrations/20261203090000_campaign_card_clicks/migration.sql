-- A campaign card's buttons (EN-02 · tm 353): when the visitor first pressed one.
-- Expand only: a nullable column, read by nothing older.
ALTER TABLE "campaign_sends" ADD COLUMN "clicked_at" TIMESTAMPTZ(6);
