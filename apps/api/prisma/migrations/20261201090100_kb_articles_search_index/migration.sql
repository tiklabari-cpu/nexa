-- Alone in this file on purpose (CONVENTIONS 6.3): `CREATE INDEX CONCURRENTLY`
-- cannot run inside the implicit transaction Postgres opens for a multi-statement
-- migration, so it gets a file of its own.
--
-- Serves the widget's Help search (WG-12 · tm 348): `kb_search_published`
-- matches `kb_article_search_document(title, body) @@ query`, the expression this
-- index stores (20261201090000 explains why it is reached only from inside that
-- SECURITY DEFINER function). Prisma cannot express an expression index;
-- `scripts/check-drift.ts` allows it by name if Prisma ever reports it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "kb_articles_search_idx" ON "kb_articles" USING gin (kb_article_search_document("title", "body"));
