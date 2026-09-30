/**
 * The retrieval recall gate against a REAL embedding provider, by hand
 * (tm 255.8 · PLAN §D183).
 *
 *     pnpm --filter @siyahtus/api measure:knowledge-recall          # the configured model
 *     pnpm --filter @siyahtus/api measure:knowledge-recall --stub   # the lexical stub, for comparison
 *
 * CI runs the same golden set on the fake provider
 * (`test/integration/knowledge-recall-gate.test.ts`); nothing on the CI path
 * calls a provider. This is how the set reaches a model: it needs
 * `EMBEDDING_PROVIDER=openai` with `EMBEDDING_API_BASE_URL`, `EMBEDDING_MODEL`
 * and `EMBEDDING_API_KEY` in the environment or the root `.env`, and without
 * them it refuses — exit 2, "SKIPPED … nothing was measured" — rather than
 * measuring the stub and calling that green.
 *
 * What it sends: the golden set's own passages and questions, about 60 short
 * texts in 15 + 41 requests — synthetic help-centre text, no customer's data.
 * The key is read from the configuration and never printed.
 *
 * What it does: a scratch `siyahtus_test_` database (created, migrated, dropped —
 * the prefix the test harness sweeps), the golden knowledge base written by
 * `KnowledgeService` with the configured provider, every question asked the
 * way the skill engine asks it, and the gate's verdict (`RECALL_GATE`). Then
 * the same questions at a threshold of -1 and a limit past every chunk, so
 * the full ranking is read once and the threshold can be moved along it: the
 * sweep says what recall@k and the false answers would be at each value — the
 * measurement `RETRIEVAL_THRESHOLD` has to be re-decided from in a new space.
 * The threshold under test is the configured one (the `RETRIEVAL_THRESHOLD`
 * setting, tm 256.6; the stub is measured at the default), and the summary
 * says how to move it: one line in `.env` and a restart of the api — no
 * rebuild.
 *
 * The report goes to stdout as JSON, a summary to stderr. Exit 0 when the
 * gate holds, 1 when it does not, 2 when nothing was measured.
 */
import { loadEnvFile } from '../src/config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../src/config/env.js';
import { KnowledgeService, RETRIEVAL_THRESHOLD } from '../src/services/ai/knowledge-service.js';
import { createEmbeddingProvider } from '../src/services/ai/provider/create-embedding-provider.js';
import type { EmbeddingProvider } from '../src/services/ai/provider/embedding-provider.js';
import { MockEmbeddingProvider } from '../src/services/ai/provider/mock-embedding-provider.js';
import { ownerClient, seedFixtures } from '../test/helpers/fixtures.js';
import {
  RECALL_GATE,
  askGoldenSet,
  calibrate,
  embedGoldenQuestions,
  formatReport,
  gateFailures,
  loadGoldenSet,
  scoreRecall,
  seedGoldenKnowledgeBase,
} from '../test/helpers/knowledge-recall.js';
import { provisionIsolatedDatastores } from './test-datastores.js';

/** Exit code for "nothing was measured" — distinct from a red gate, never 0. */
const SKIPPED = 2;

/** Where the sweep reads recall@k and false answers; the current threshold is added. */
const SWEEP = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8];

/** Past every chunk the golden set stores, so a search returns its whole ranking. */
const FULL_RANKING = 1_000;

function parseArgs(argv: string[]): { stub: boolean } {
  let stub = false;
  for (const arg of argv) {
    if (arg === '--stub') stub = true;
    else throw new Error(`Unknown argument: ${arg} (the only option is --stub)`);
  }
  return { stub };
}

/** The setting the threshold is read from — what the summary tells the operator to change. */
const THRESHOLD_SETTING = 'RETRIEVAL_THRESHOLD';

interface Subject {
  provider: EmbeddingProvider;
  /** The threshold the api would search at with this configuration. */
  threshold: number;
}

/** The provider to measure and its configured threshold, or why there is none. */
function chooseProvider(stub: boolean): Subject | string {
  if (stub) return { provider: new MockEmbeddingProvider(), threshold: RETRIEVAL_THRESHOLD };
  const env = parseEnv();
  if (env.EMBEDDING_PROVIDER === 'mock') {
    return 'EMBEDDING_PROVIDER is mock — set EMBEDDING_PROVIDER=openai to measure a real model (or pass --stub to measure the stub on purpose)';
  }
  if (!env.embedding.openai) {
    return `EMBEDDING_PROVIDER=${env.EMBEDDING_PROVIDER} needs EMBEDDING_API_BASE_URL, EMBEDDING_MODEL and EMBEDDING_API_KEY`;
  }
  return {
    provider: createEmbeddingProvider(env.EMBEDDING_PROVIDER, env.embedding),
    threshold: env.RETRIEVAL_THRESHOLD,
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const subject = chooseProvider(args.stub);
  if (typeof subject === 'string') {
    process.stderr.write(
      `measure:knowledge-recall SKIPPED — ${subject}. Nothing was measured; this is not a pass.\n`,
    );
    return SKIPPED;
  }
  const { provider, threshold } = subject;

  const set = loadGoldenSet();
  const datastores = await provisionIsolatedDatastores();
  Object.assign(process.env, datastores.env);
  const owner = ownerClient();
  const app = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
  try {
    const knowledge = new KnowledgeService({ embeddings: provider, retrievalThreshold: threshold });
    const fx = await seedFixtures(owner);
    const tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    const agents = await seedGoldenKnowledgeBase(owner, knowledge, tenant, set);
    const embedded = await embedGoldenQuestions(knowledge, set);

    const report = scoreRecall(
      set,
      await askGoldenSet({ app, knowledge, tenant, agents, set, embedded }),
    );
    const failures = gateFailures(report);

    // The same vectors, read in full: no second provider call.
    const everything = new KnowledgeService({ embeddings: provider, retrievalThreshold: -1 });
    const rankings = await askGoldenSet({
      app,
      knowledge: everything,
      tenant,
      agents,
      set,
      embedded,
      limit: FULL_RANKING,
    });
    const thresholds = [...new Set([...SWEEP, threshold])].sort((a, b) => a - b);
    const calibration = calibrate(set, rankings, thresholds);

    process.stdout.write(
      `${JSON.stringify(
        {
          provider: provider.id,
          space: provider.space,
          threshold,
          thresholdSetting: THRESHOLD_SETTING,
          gate: RECALL_GATE,
          verdict: failures.length === 0 ? 'pass' : 'fail',
          failures,
          report,
          calibration,
        },
        null,
        2,
      )}\n`,
    );
    const sweep = calibration.sweep
      .map(
        (row) =>
          `  ${row.threshold.toFixed(2)}${row.threshold === threshold ? '*' : ' '}  recall@${RECALL_GATE.k} ${row.found}/${report.answerable}  false answers ${row.falseAnswers}/${report.unanswerable}`,
      )
      .join('\n');
    process.stderr.write(
      `measure:knowledge-recall — ${provider.space}\n${formatReport(report)}\n` +
        `threshold sweep (* = ${THRESHOLD_SETTING}, now ${threshold}):\n${sweep}\n` +
        `verdict: ${failures.length === 0 ? 'PASS' : `FAIL — ${failures.join('; ')}`}\n` +
        `to search at another value: ${THRESHOLD_SETTING}=<value> in .env, then restart the api — no rebuild\n`,
    );
    return failures.length === 0 ? 0 : 1;
  } finally {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
    await datastores.release();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // The provider's own errors carry a kind and a status, never the key.
    process.stderr.write(
      `measure:knowledge-recall failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
