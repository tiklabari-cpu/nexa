/**
 * Measures what answering one question from the knowledge base costs, as the
 * knowledge base grows (tm 254 · PLAN §D173).
 *
 *     pnpm --filter @nexa/api measure:knowledge-retrieval [questions]
 *
 * The AI agent answers a customer inside the customer's own POST, so retrieval
 * spends NFR-P2's write budget (p99 < 300 ms for the whole request). This is the
 * ladder that set `EXACT_SEARCH_CEILING`: one table shared by two tenants, the
 * first tenant's knowledge split across agents of 1,000 · 5,000 · 20,000 ·
 * 50,000 chunks, the second holding 20,000 more, and every question asked of one
 * agent — the scope the skill engine searches.
 *
 * Five ways of searching, each on a warm connection:
 *
 *  - **before** — the statement tm 252 shipped: exact, with the question's
 *    vector as a bare `$1::vector`. Prisma binds that literal as `text`, and once
 *    Postgres has cached the statement's generic plan the cast is evaluated for
 *    every row the search reads.
 *  - **exact** — `KnowledgeService` with the ceiling out of reach: the same
 *    exact search with the vector parsed once, as an InitPlan.
 *  - **approximate** — `KnowledgeService` with a ceiling of zero: every question
 *    goes to the HNSW index, under the settings the service pins.
 *  - **shipped** — `KnowledgeService` as it ships: exact up to the ceiling,
 *    approximate above it.
 *  - **unanswerable** — the shipped service asked questions exact search finds
 *    nothing for. Above the ceiling each pays for the approximate search and
 *    then the exact fallback.
 *
 * "Warm" is the point, not a detail: the first five executions of a prepared
 * statement get custom plans, and a connection pool keeps its connections for
 * hours. Each strategy gets its own single-connection client, ten untimed
 * questions, then the timed ones.
 *
 * Everything runs as `nexa_app` inside `withTenant` — row level security on, the
 * role and transaction the product uses. The vectors are the stub's, and the
 * rows are the ones `KnowledgeService.index` writes, one INSERT per source; the
 * HNSW index is built after the load from the statement in its own migration,
 * so the index measured is the index shipped.
 *
 * Nothing here touches the development database: a scratch `nexa_test_` one is
 * created, migrated, measured and dropped — the prefix the test harness sweeps.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { embed, toVectorLiteral } from '@nexa/ai-mock';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { withTenant, type TenantClient, type TenantContext } from '../src/lib/tenant.js';
import { KnowledgeService } from '../src/services/ai/knowledge-service.js';
import {
  adminUrl,
  assertDroppableDatabaseName,
  isolatedDatabaseName,
  withDatabaseName,
} from './test-datastores.js';

loadEnvFile();

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

const INDEX_MIGRATION = resolve(
  apiRoot,
  'prisma/migrations/20260913120100_knowledge_chunks_hnsw_index/migration.sql',
);

const CHUNKS_PER_SOURCE = 50;
const WARM_UP = 10;

/** The first tenant's agents, smallest first, then the second tenant's bulk. */
const RUNGS = [1_000, 5_000, 20_000, 50_000] as const;
const NOISE = 20_000;

type Strategy = 'before' | 'exact' | 'approximate' | 'shipped' | 'unanswerable';

/** mulberry32 — the same knowledge base on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Help-centre paragraphs: topic words, common words and filler, per source. */
function helpCentre(seed: number) {
  const next = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const skewed = <T>(list: readonly T[]): T => list[Math.floor(list.length * next() ** 2.2)]!;
  const syllables = [
    'ba',
    'de',
    'fi',
    'go',
    'ku',
    'la',
    'me',
    'ni',
    'po',
    'ru',
    'sa',
    'te',
    'vi',
    'zo',
  ];
  const word = (): string =>
    Array.from({ length: 2 + Math.floor(next() * 3) }, () => pick(syllables)).join('');
  const common = Array.from({ length: 1_500 }, word);
  const topics = Array.from({ length: 700 }, () => Array.from({ length: 45 }, word));
  const filler = ['the', 'to', 'and', 'of', 'a', 'in', 'is', 'for', 'on', 'with', 'you', 'your'];

  return {
    paragraph(source: number): string {
      const topic = topics[source % topics.length]!;
      return (
        Array.from({ length: 30 + Math.floor(next() * 40) }, () => {
          const roll = next();
          if (roll < 0.45) return skewed(topic);
          if (roll < 0.8) return skewed(common);
          return pick(filler);
        }).join(' ') + '.'
      );
    },
    question(paragraph: string): string {
      const words = paragraph
        .replace('.', '')
        .split(' ')
        .filter((w) => !filler.includes(w));
      return `how do I ${Array.from({ length: 5 }, () => pick(words)).join(' ')}?`;
    },
  };
}

function migrate(databaseUrl: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: '1' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
}

/** The statement tm 252 shipped, verbatim but for the columns nobody reads here. */
function beforeTm254(tx: TenantClient, tenant: TenantContext, question: string, agentId: string) {
  const vector = toVectorLiteral(embed(question));
  return tx.$queryRaw`
    SELECT c.id, c.source_id, s.name AS source_name, c.chunk_text,
           (c.embedding <=> ${vector}::vector) + 0 AS distance
    FROM knowledge_chunks c
    JOIN knowledge_sources s ON s.id = c.source_id
    WHERE c.license_id = ${tenant.licenseId}
      AND s.status = 'ready'
      AND s.ai_agent_id = ${agentId}::uuid
    ORDER BY distance
    LIMIT ${3}
  `;
}

async function main(): Promise<number> {
  const questionsPerRung = Number(process.argv[2] ?? '60');
  if (!Number.isInteger(questionsPerRung) || questionsPerRung < 10) {
    console.error('usage: measure-knowledge-retrieval.ts [questions >= 10]');
    return 2;
  }
  const ownerUrl = process.env['DATABASE_URL'];
  const appUrl = process.env['DATABASE_APP_URL'];
  if (!ownerUrl || !appUrl) {
    throw new Error('DATABASE_URL and DATABASE_APP_URL must be set (see .env / .env.example)');
  }

  const databaseName = isolatedDatabaseName();
  assertDroppableDatabaseName(databaseName);
  const admin = new PrismaClient({ datasourceUrl: adminUrl(ownerUrl) });
  const scratchOwnerUrl = withDatabaseName(ownerUrl, databaseName);
  const scratchAppUrl = withDatabaseName(appUrl, databaseName);
  console.log(`scratch database: ${databaseName} · ${questionsPerRung} questions per rung`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  const owner = new PrismaClient({ datasourceUrl: scratchOwnerUrl });

  try {
    const migrated = await migrate(scratchOwnerUrl);
    if (migrated !== 0) throw new Error(`migrate deploy failed with exit ${migrated}`);

    const corpus = helpCentre(254);
    const tenants: TenantContext[] = [];
    for (const name of ['Measured A', 'Measured B']) {
      const organization = await owner.organization.create({
        data: { name },
        select: { id: true },
      });
      const license = await owner.license.create({
        data: { organizationId: organization.id },
        select: { id: true },
      });
      tenants.push({ licenseId: license.id, organizationId: organization.id });
    }
    const [tenantA, tenantB] = tenants as [TenantContext, TenantContext];

    // Loaded without the vector index, then indexed once: building the graph
    // row by row costs minutes and measures nothing this script is about.
    await owner.$executeRawUnsafe('DROP INDEX IF EXISTS idx_chunks_embedding_hnsw');
    const loadStarted = Date.now();
    const agents = new Map<number, { id: string; questions: string[] }>();
    let sourceNumber = 0;
    for (const [tenant, chunks, rung] of [
      ...RUNGS.map((size) => [tenantA, size, size] as const),
      [tenantB, NOISE, 0] as const,
    ]) {
      const agent = await owner.aiAgent.create({
        data: { licenseId: tenant.licenseId, name: `Agent ${chunks}` },
        select: { id: true },
      });
      const questions: string[] = [];
      const questionsPerSource = Math.ceil(
        (questionsPerRung + WARM_UP) / (chunks / CHUNKS_PER_SOURCE),
      );
      for (let written = 0; written < chunks; written += CHUNKS_PER_SOURCE) {
        const source = await owner.knowledgeSource.create({
          data: {
            aiAgentId: agent.id,
            licenseId: tenant.licenseId,
            type: 'article',
            name: `Source ${sourceNumber}`,
          },
          select: { id: true },
        });
        const paragraphs = Array.from({ length: CHUNKS_PER_SOURCE }, () =>
          corpus.paragraph(sourceNumber),
        );
        sourceNumber += 1;
        await owner.$executeRaw`
          INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
          VALUES ${Prisma.join(
            paragraphs.map(
              (text, position) =>
                Prisma.sql`(gen_random_uuid(), ${source.id}::uuid, ${tenant.licenseId}, ${text},
                            ${toVectorLiteral(embed(text))}::vector, ${text.split(/\s+/).length}, ${position})`,
            ),
          )}`;
        for (let asked = 0; rung > 0 && asked < questionsPerSource; asked += 1) {
          if (questions.length >= questionsPerRung + WARM_UP) break;
          questions.push(corpus.question(paragraphs[(asked * 17) % CHUNKS_PER_SOURCE]!));
        }
      }
      if (rung > 0) agents.set(rung, { id: agent.id, questions });
    }
    const indexStarted = Date.now();
    // The migration's own statement, without CONCURRENTLY: nothing else is
    // writing to a scratch database, and a plain build can run in a transaction
    // that holds its memory setting on one connection.
    const statement = readFileSync(INDEX_MIGRATION, 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n')
      .replace('CREATE INDEX CONCURRENTLY', 'CREATE INDEX')
      .trim();
    await owner.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL maintenance_work_mem = '1GB'`);
        // Docker's default 64 MB /dev/shm cannot hold a parallel build's graph.
        await tx.$executeRawUnsafe('SET LOCAL max_parallel_maintenance_workers = 0');
        await tx.$executeRawUnsafe(statement);
      },
      { timeout: 3_600_000 },
    );
    await owner.$executeRawUnsafe('VACUUM ANALYZE knowledge_chunks');
    await owner.$executeRawUnsafe('VACUUM ANALYZE knowledge_sources');
    const total = RUNGS.reduce<number>((sum, size) => sum + size, NOISE);
    console.log(
      `loaded ${total} chunks in ${((indexStarted - loadStarted) / 1000).toFixed(0)} s · ` +
        `index built in ${((Date.now() - indexStarted) / 1000).toFixed(0)} s`,
    );

    const services: Record<Exclude<Strategy, 'before'>, KnowledgeService> = {
      exact: new KnowledgeService({ exactSearchCeiling: 1_000_000 }),
      approximate: new KnowledgeService({ exactSearchCeiling: 0 }),
      shipped: new KnowledgeService(),
      unanswerable: new KnowledgeService(),
    };
    const strategies: Strategy[] = ['before', 'exact', 'approximate', 'shipped', 'unanswerable'];
    // Questions exact search finds nothing for. Above the ceiling each one pays
    // for the approximate search and then the exact one — the price of never
    // handing an answerable question over. Checked rather than assumed: the
    // stub hashes words into shared buckets, and invented words still collide
    // with the heaviest ones in some paragraph (measured: "xylophone quartz
    // kazoo" cleared the threshold against 50,000 chunks).
    async function unanswerableFor(agentId: string): Promise<string[]> {
      const found: string[] = [];
      const url = new URL(scratchAppUrl);
      url.searchParams.set('connection_limit', '1');
      const probe = new PrismaClient({ datasourceUrl: url.toString() });
      for (
        let n = 0;
        found.length < questionsPerRung + WARM_UP && n < 50 * questionsPerRung;
        n += 1
      ) {
        const question = `qx${n} vz${n * 7} jq${n * 13}`;
        const { chunks } = await withTenant(probe, tenantA, (tx) =>
          services.exact.search(tx, tenantA, question, { aiAgentId: agentId }),
        );
        if (chunks.length === 0) found.push(question);
      }
      await probe.$disconnect();
      return found;
    }

    console.log(
      '\nchunks in scope · strategy    ·    p50 ·    p95 ·    p99 ·    max (ms) · searched as',
    );
    for (const rung of RUNGS) {
      const { id: agentId, questions } = agents.get(rung)!;
      const noAnswer = await unanswerableFor(agentId);
      for (const strategy of strategies) {
        const url = new URL(scratchAppUrl);
        url.searchParams.set('connection_limit', '1');
        const app = new PrismaClient({ datasourceUrl: url.toString() });
        const timings: number[] = [];
        const seen = new Set<string>();
        for (const [index, question] of questions.entries()) {
          const started = process.hrtime.bigint();
          if (strategy === 'before') {
            await withTenant(app, tenantA, (tx) => beforeTm254(tx, tenantA, question, agentId));
            seen.add('exact');
          } else {
            const asked = strategy === 'unanswerable' ? (noAnswer[index] ?? question) : question;
            const result = await withTenant(app, tenantA, (tx) =>
              services[strategy].search(tx, tenantA, asked, { aiAgentId: agentId }),
            );
            seen.add(result.strategy);
          }
          const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
          if (index >= WARM_UP) timings.push(elapsed);
        }
        await app.$disconnect();
        const sorted = [...timings].sort((a, b) => a - b);
        console.log(
          `${String(rung).padStart(15)} · ${strategy.padEnd(11)} · ` +
            [50, 95, 99].map((p) => percentile(sorted, p).toFixed(1).padStart(6)).join(' · ') +
            ` · ${Math.max(...sorted)
              .toFixed(1)
              .padStart(6)}      · ${[...seen].join(', ')}`,
        );
      }
    }
    return 0;
  } finally {
    await owner.$disconnect().catch(() => undefined);
    await admin
      .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      .catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
