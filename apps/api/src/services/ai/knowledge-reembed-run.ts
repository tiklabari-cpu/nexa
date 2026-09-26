/**
 * `knowledge:reembed` — move the stored knowledge base into the space the
 * configured `EMBEDDING_PROVIDER` writes (tm 255.7 · PLAN §D182).
 *
 * Run it after switching provider — the stub to a model, one model to another,
 * or back to the stub — while the server keeps serving: sources move one at a
 * time, atomically, and a question meanwhile searches whatever has already
 * moved (`knowledge-reembed.ts` has the four promises this rests on).
 *
 *   pnpm --filter @siyahtus/api knowledge:reembed             # every pending source
 *   pnpm --filter @siyahtus/api knowledge:reembed --limit 50  # a slice; run again to go on
 *   pnpm --filter @siyahtus/api knowledge:reembed --status    # measure only, change nothing
 *
 * It connects as the runtime (RLS-bound) role, workspace by workspace, like
 * the sweeps. The report goes to stdout as JSON, a one-line summary to
 * stderr. Exit 1 when a source failed or a workspace was refused — both are
 * left exactly as they were, and running again retries them.
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../../config/env.js';
import { resolveEmbeddingInferenceProvider } from './inference.js';
import { KnowledgeReembedder } from './knowledge-reembed.js';
import { createEmbeddingProvider } from './provider/create-embedding-provider.js';

interface Args {
  status: boolean;
  limit: number | undefined;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { status: false, limit: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--status') args.status = true;
    else if (arg === '--limit') {
      const value = Number(argv[++i]);
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('--limit needs a whole number of sources, at least 1.');
      }
      args.limit = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = parseEnv();
  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  const reembedder = new KnowledgeReembedder(db, {
    embeddings: createEmbeddingProvider(env.EMBEDDING_PROVIDER, env.embedding),
    embeddingInference: resolveEmbeddingInferenceProvider(env),
  });
  try {
    if (args.status) {
      const status = await reembedder.status();
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      process.stderr.write(
        `knowledge:reembed --status: ${status.totals.pendingChunks} chunk(s) in ` +
          `${status.totals.pendingSources} source(s) outside ${status.target}; ` +
          `${status.totals.mixedSources} source(s) in more than one space\n`,
      );
      return;
    }

    const report = await reembedder.run(args.limit === undefined ? {} : { limit: args.limit });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const { totals } = report;
    process.stderr.write(
      `knowledge:reembed: ${totals.reembedded} source(s) (${totals.chunks} chunk(s)) moved to ` +
        `${report.target}; ${totals.changed} changed meanwhile, ${totals.failed} failed, ` +
        `${totals.refused} workspace(s) refused` +
        `${report.finished ? '' : ' — stopped at --limit, run again to continue'}\n`,
    );
    if (totals.failed > 0 || totals.refused > 0) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `knowledge:reembed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
