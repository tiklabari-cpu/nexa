-- When a source was last confirmed, for the sources that predate the review
-- step (tm 309.1 · AI-14-S3 · `docs/adr/single-knowledge-store.md` §2.8).
--
-- 20261020220000 gave every existing source the migration's moment as
-- `reviewed_at` — the column's default, which is right for a source added from
-- now on and wrong for one nobody has looked at in a year: it would read as
-- freshly reviewed and stay out of "review needed" for another 90 days. A
-- source added before reviews existed was last looked at when it was last
-- edited, so that is its review. The ADR files this under the "move" step
-- (tm 309.2); it runs here because this release already lists the sources due
-- a review (`?stale=`, `review_due_at`), and a later backfill would overwrite
-- reviews recorded in between.
--
-- In a file of its own so `knowledge-store-schema.test.ts` can replay it as
-- the one statement it is. `updated_at` is not touched: nothing about the
-- source changed. Run once, right after the column arrives: a re-run would
-- undo the reviews since.

UPDATE knowledge_sources SET reviewed_at = updated_at;
