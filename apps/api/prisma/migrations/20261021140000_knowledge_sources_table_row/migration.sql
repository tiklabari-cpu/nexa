-- A structured-table row in the knowledge store (tm 310.2 · SiyahTuş analysis
-- AI-13 "Kodlama mantığı" 3; ADR-14b §2.12).
--
-- Every row of the four tables (20261021120000) is rendered to Turkish text
-- (`@siyahtus/types` `renderRowText`) and kept as one knowledge source, so
-- retrieval finds it like any other passage: `type = 'table_row'`, addressed
-- by `source_table` (`KNOWLEDGE_TABLE_SQL_NAMES`) and `source_row_id`
-- (20261020220000's pair). The row's own write keeps it current and its
-- delete takes it away (`services/knowledge-tables/row-knowledge.ts`); the
-- hourly knowledge sweep finishes what a write could not.
--
-- Widening only (CONVENTIONS §6.3): the release before this one never writes
-- `table_row` nor a `source_table`, so neither constraint refuses anything it
-- does. The second says the two go together — a source that renders a row is
-- a `table_row`, and a `table_row` renders a row.

ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_type_check;
ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_type_check
  CHECK (type IN ('website', 'file', 'article', 'faq', 'table_row'));

ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_table_row_check
  CHECK ((type = 'table_row') = (source_table IS NOT NULL));
