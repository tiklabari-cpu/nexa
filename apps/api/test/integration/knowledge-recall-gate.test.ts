/**
 * The retrieval recall gate (tm 255.8 · PLAN §D183).
 *
 * tm 252 measured once, by hand, that search finds the right passage; this
 * makes that a regression gate. A golden set of questions, each naming the
 * passage that answers it (`test/fixtures/knowledge-recall-golden.json`), is
 * asked of a knowledge base built from the seed's own passages plus the
 * articles that compete with them, and the gate is two numbers
 * (`RECALL_GATE`, whose comments carry the measurement): recall@k at the k
 * the product asks for, and how many unanswerable questions still get a
 * passage — the thing `RETRIEVAL_THRESHOLD` exists to prevent.
 *
 * It runs on the fake embedding provider, so it is deterministic and needs no
 * key: the fake is the stub's geometry in a space of its own, which puts the
 * questions on the path a real model's take — a non-lexical space, searched
 * only within itself (tm 255.7). The same set, the same harness and the same
 * verdict run against a real provider by hand:
 * `pnpm --filter @nexa/api measure:knowledge-recall`, which refuses to run
 * without a key rather than reporting green.
 *
 * A gate is only worth something if it can fail, so the second half degrades
 * retrieval on purpose — the limit, the threshold both ways, and a model that
 * changed without the knowledge base being re-embedded — and requires each to
 * be red.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { chunk } from '@nexa/ai-mock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '../../src/lib/tenant.js';
import { KnowledgeService, RETRIEVAL_THRESHOLD } from '../../src/services/ai/knowledge-service.js';
import {
  FAKE_EMBEDDING_SPACE,
  FakeEmbeddingProvider,
  fakeEmbedding,
} from '../helpers/fake-embedding-provider.js';
import { ownerClient, seedFixtures } from '../helpers/fixtures.js';
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
  type GoldenAgent,
  type GoldenSet,
} from '../helpers/knowledge-recall.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(HERE, '../../prisma/seed.ts');
const MEASURE_SCRIPT = resolve(HERE, '../../scripts/measure-knowledge-recall.ts');

/** How far a score must sit from the threshold and from its neighbour (tm 252's margin). */
const ROUNDING_CLEARANCE = 0.005;

describe('knowledge retrieval recall gate — golden set on the fake provider (FR-MOD-06.3.2)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let tenant: TenantContext;
  let agents: Record<GoldenAgent, string>;
  const set: GoldenSet = loadGoldenSet();
  const knowledge = new KnowledgeService({ embeddings: new FakeEmbeddingProvider() });

  /** The whole gate, with whatever service and limit a test degrades. */
  async function runGate(service: KnowledgeService, limit: number = RECALL_GATE.k) {
    const embedded = await embedGoldenQuestions(service, set);
    const answers = await askGoldenSet({
      app,
      knowledge: service,
      tenant,
      agents,
      set,
      embedded,
      limit,
    });
    const report = scoreRecall(set, answers);
    return { report, failures: gateFailures(report) };
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    const fx = await seedFixtures(owner);
    tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    agents = await seedGoldenKnowledgeBase(owner, knowledge, tenant, set);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  it('holds at least 20 answerable pairs, each answered by a passage of the seed knowledge base', () => {
    expect(set.questions.length).toBeGreaterThanOrEqual(20);
    const seed = readFileSync(SEED_PATH, 'utf8');
    for (const q of set.questions) {
      const source = set.sources.find((s) => s.id === q.expected.source)!;
      expect(source.origin, q.id).toBe('seed');
    }
    for (const source of set.sources.filter((s) => s.origin === 'seed')) {
      // The seed's chunks, verbatim: a reworded seed would leave the gate
      // guarding passages nobody stores.
      for (const passage of source.passages) expect(seed, passage).toContain(`'${passage}'`);
    }
    // Unanswerable questions exist, or the threshold's half of the gate is empty.
    expect(set.unanswerable.length).toBeGreaterThanOrEqual(5);
  });

  it('stores every passage as one chunk, in the fake space', async () => {
    for (const source of set.sources) {
      expect(chunk(source.passages.join('\n\n')), source.id).toEqual(source.passages);
    }
    const stored = await owner.knowledgeChunk.groupBy({
      by: ['embeddingSpace'],
      where: { licenseId: tenant.licenseId },
      _count: { _all: true },
    });
    expect(stored).toEqual([
      {
        embeddingSpace: FAKE_EMBEDDING_SPACE,
        _count: { _all: set.sources.reduce((sum, s) => sum + s.passages.length, 0) },
      },
    ]);
  });

  it(`finds the answer at k = ${RECALL_GATE.k} for at least ${RECALL_GATE.recallFloor} of the questions and hands over the unanswerable ones`, async () => {
    const started = performance.now();
    const { report, failures } = await runGate(knowledge);
    const seconds = ((performance.now() - started) / 1000).toFixed(2);
    // The run's own record: the list of questions below the line, and how long it took.
    console.info(`[recall gate] ${seconds} s\n${formatReport(report)}`);
    expect(failures, formatReport(report)).toEqual([]);
    // The measurement RECALL_GATE's comments describe — a change here is a
    // change to retrieval, and the floor's rationale has to be re-read.
    expect({ found: report.found, answerable: report.answerable }).toEqual({
      found: 23,
      answerable: 31,
    });
    expect(report.misses.filter((m) => m.wording !== 'paraphrase').map((m) => m.id)).toEqual([
      'large-refund-approval',
    ]);
    expect(report.falseAnswers.map((q) => q.id)).toEqual(['sunday-hours']);
  });

  it('goes red when retrieval returns one passage instead of the product’s two', async () => {
    const { report, failures } = await runGate(knowledge, 1);
    expect(report.found).toBeLessThan(23);
    expect(failures).toEqual([expect.stringMatching(/^recall@2 .* is below the floor/)]);
  });

  it('goes red when the threshold is raised past real answers', async () => {
    const strict = new KnowledgeService({
      embeddings: new FakeEmbeddingProvider(),
      retrievalThreshold: RETRIEVAL_THRESHOLD + 0.2,
    });
    const { failures } = await runGate(strict);
    expect(failures).toEqual([expect.stringMatching(/^recall@2 .* is below the floor/)]);
  });

  it('goes red when the threshold is lowered until unrelated passages answer', async () => {
    const lax = new KnowledgeService({
      embeddings: new FakeEmbeddingProvider(),
      retrievalThreshold: RETRIEVAL_THRESHOLD - 0.1,
    });
    const { report, failures } = await runGate(lax);
    // Recall cannot drop when the threshold does — the red is the false answers.
    expect(report.found).toBeGreaterThanOrEqual(23);
    expect(failures).toEqual([expect.stringMatching(/unanswerable questions got a passage/)]);
  });

  it('goes red when the model changes and the knowledge base is not re-embedded', async () => {
    // Same space name, different coordinates: what a provider swapping models
    // under an unchanged EMBEDDING_MODEL would look like to the search.
    const swapped = new KnowledgeService({
      embeddings: new FakeEmbeddingProvider({
        vector: (text) => {
          const v = fakeEmbedding(text);
          return v.map((_, i) => v[(i + 101) % v.length]!);
        },
      }),
    });
    const { report, failures } = await runGate(swapped);
    expect(report.found).toBeLessThan(5);
    expect(failures[0]).toMatch(/^recall@2 .* is below the floor/);
  });

  it('decides no verdict by rounding: every score clear of the threshold and of its neighbour', async () => {
    // The full ranking, as `measure:knowledge-recall` reads it. `vector` is
    // float4, so a score within rounding of the threshold, or a tie across the
    // k boundary, would make the gate a coin toss between databases.
    const everything = new KnowledgeService({
      embeddings: new FakeEmbeddingProvider(),
      retrievalThreshold: -1,
    });
    const embedded = await embedGoldenQuestions(everything, set);
    const rankings = await askGoldenSet({
      app,
      knowledge: everything,
      tenant,
      agents,
      set,
      embedded,
      limit: 1_000,
    });
    const calibration = calibrate(set, rankings, [RETRIEVAL_THRESHOLD]);
    const scores = [
      ...calibration.expected.map((e) => e.score),
      ...calibration.unanswerableBest.map((u) => u.score),
    ].filter((score): score is number => score !== null);
    for (const score of scores) {
      expect(Math.abs(score - RETRIEVAL_THRESHOLD)).toBeGreaterThan(ROUNDING_CLEARANCE);
    }
    for (const [id, ranking] of rankings) {
      const [kth, next] = [ranking[RECALL_GATE.k - 1], ranking[RECALL_GATE.k]];
      // A tie below the threshold decides nothing: neither side is returned.
      if (kth && next && next.score > RETRIEVAL_THRESHOLD - ROUNDING_CLEARANCE) {
        expect(kth.score - next.score, id).toBeGreaterThan(ROUNDING_CLEARANCE);
      }
    }
    // The sweep reads the same ranking the gate does: at the product's
    // threshold it lands exactly on the gate's own numbers.
    expect(calibration.sweep).toEqual([
      { threshold: RETRIEVAL_THRESHOLD, found: 23, recall: 0.7419, falseAnswers: 1 },
    ]);
  });

  it('refuses to measure a real provider without a key, and says so instead of passing', () => {
    // The CI path never has a key; `mock` makes sure a developer's .env with
    // one cannot turn this test into a real provider call.
    const run = spawnSync(process.execPath, ['--import', 'tsx', MEASURE_SCRIPT], {
      env: { ...process.env, EMBEDDING_PROVIDER: 'mock' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(2);
    expect(run.stderr).toMatch(
      /^measure:knowledge-recall SKIPPED — .*Nothing was measured; this is not a pass\./m,
    );
    expect(run.stdout).toBe('');
  });
});
