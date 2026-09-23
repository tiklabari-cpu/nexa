-- What each skill run's inference cost, in the providers' own unit (tm 255.9 ·
-- ADR docs/adr/pilot-llm-embedding-provider.md §8, §10).
--
-- ON THE EXISTING COUNTER, NOT BESIDE IT. The AI Agent report already counts
-- `skill_runs` rows; a run is the thing that asks the model and embeds the
-- question, so what those calls cost is written on the same row, in the same
-- transaction that writes the run and increments `skills.runs_count`. A second
-- table or a new `usage_records` metric would be a second counter of the same
-- activity, free to drift from the first — and `usage_records` is the invoice's
-- table: the close sweep invoices every period that has a row in it.
--
-- TOKENS, NOT MONEY. Every candidate provider bills in tokens (chat: input and
-- output; embeddings: input), and the price is the owner's contract with the
-- provider, so no price is stored or computed here. Chat and embedding tokens
-- stay in separate columns because they are priced separately.
--
-- ZERO IS TRUE FOR EVERY EXISTING ROW. Before this migration only the
-- in-process stubs could have answered, and they bill nothing (their usage is
-- 0 from this release on). The previous release, still serving during the
-- rollout, writes runs without these columns and gets the same 0 (CONVENTIONS
-- 6.3: a migration must suit the old code and the new).
--
-- Metadata-only on PostgreSQL 11+: a constant default is kept in the catalogue,
-- not written into every row, so each ADD COLUMN is a brief lock and no rewrite.
ALTER TABLE "skill_runs" ADD COLUMN "llm_input_tokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "skill_runs" ADD COLUMN "llm_output_tokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "skill_runs" ADD COLUMN "embedding_tokens" INTEGER NOT NULL DEFAULT 0;
