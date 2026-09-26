/**
 * `knowledge-refresh:run` — the manual trigger for the freshness sweep
 * (FR-MOD-06.3.3, tm 198.4).
 *
 * Mirrors `sla-run.ts`: there is no external scheduler in this environment (a
 * project boundary), so this script is how an operator (or CI) drives the
 * sweep by hand. The in-process scheduler (`services/scheduler/jobs.ts`) calls
 * the same `KnowledgeRefreshSweeper.run()` on its own interval. It connects as
 * the runtime (RLS-bound) role, so every read and every write is scoped to its
 * own workspace exactly as a request would be.
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
import { KnowledgeRefreshSweeper } from './knowledge-refresh-sweep.js';
import { KnowledgeService } from './knowledge-service.js';
import { createEmbeddingProvider } from './provider/create-embedding-provider.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  // The configured provider, exactly as the server builds it: a refresh
  // embedded with anything else would land in a space questions never search.
  const knowledge = new KnowledgeService({
    embeddings: createEmbeddingProvider(env.EMBEDDING_PROVIDER, env.embedding),
  });
  try {
    const report = await new KnowledgeRefreshSweeper(db, {
      knowledge,
      embeddingInference: resolveEmbeddingInferenceProvider(env),
    }).run();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(
      `knowledge-refresh: refreshed ${report.totals.refreshed}, failed ${report.totals.failed} ` +
        `of ${report.totals.checked} due source(s) across ${report.totals.tenants} tenant(s)\n`,
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
