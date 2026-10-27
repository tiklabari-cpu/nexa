/**
 * `knowledge-refresh:run` — the manual trigger for the freshness sweep
 * (FR-MOD-06.3.3, tm 198.4) and, after it, the KB article sync (tm 309.2 ·
 * `kb-article-knowledge.ts`) and the structured table rows' (tm 310.2 ·
 * `knowledge-tables/row-knowledge.ts`), the three parts of the
 * `knowledge_refresh` job.
 *
 * Mirrors `sla-run.ts`: there is no external scheduler in this environment (a
 * project boundary), so this script is how an operator (or CI) drives the
 * sweep by hand. The in-process scheduler (`services/scheduler/jobs.ts`) calls
 * the same `KnowledgeRefreshSweeper.run()` on its own interval. It connects as
 * the runtime (RLS-bound) role, so every read and every write is scoped to its
 * own workspace exactly as a request would be. A refresh is counted against
 * its workspace's daily AI allowance in the same Postgres counters the API
 * spends from (tm 257.20).
 *
 * No dry-run: a refused crawl already leaves the source untouched — that is
 * the sweep's own safety property (`knowledge-refresh-sweep.ts`), not
 * something a preview would add.
 *
 *   pnpm --filter @siyahtus/api knowledge-refresh:run
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../../config/env.js';
import { resolveEmbeddingInferenceProvider } from './inference.js';
import { KbArticleKnowledgeSweeper } from './kb-article-knowledge.js';
import { KnowledgeRefreshSweeper } from './knowledge-refresh-sweep.js';
import { KnowledgeService } from './knowledge-service.js';
import { createMeteredEmbeddings } from './metered-embeddings.js';
import { KnowledgeTableRowKnowledgeSweeper } from '../knowledge-tables/row-knowledge.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  // The configured provider, exactly as the server builds it: a refresh
  // embedded with anything else would land in a space questions never search.
  // Metered like the server's, against the same daily AI caps (tm 257.20).
  const knowledge = new KnowledgeService({
    embeddings: createMeteredEmbeddings(db, env),
    retrievalThreshold: env.RETRIEVAL_THRESHOLD,
  });
  try {
    const embeddingInference = resolveEmbeddingInferenceProvider(env);
    const report = await new KnowledgeRefreshSweeper(db, { embeddingInference }).run();
    // The published KB articles whose knowledge source is behind (tm 309.2),
    // as the scheduled job runs them after the refresh.
    const articles = await new KbArticleKnowledgeSweeper(db, {
      knowledge,
      embeddingInference,
    }).run();
    // Then the structured table rows whose source is behind (tm 310.2), as the job does.
    const rows = await new KnowledgeTableRowKnowledgeSweeper(db, {
      knowledge,
      embeddingInference,
    }).run();
    process.stdout.write(
      `${JSON.stringify({ ...report, kbArticles: articles, tableRows: rows }, null, 2)}\n`,
    );
    process.stderr.write(
      `knowledge-refresh: queued ${report.totals.queued} crawl(s), refused ${report.totals.failed} ` +
        `of ${report.totals.checked} due source(s) across ${report.totals.tenants} tenant(s); ` +
        `KB articles synced ${articles.totals.synced}, deferred ${articles.totals.deferred} ` +
        `of ${articles.totals.checked}; table rows synced ${rows.totals.synced}, ` +
        `deferred ${rows.totals.deferred} of ${rows.totals.checked}\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `knowledge-refresh: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
