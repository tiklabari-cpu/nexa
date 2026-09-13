/**
 * Knowledge retrieval above the exact-search ceiling (tm 254 · PLAN §D173).
 *
 * Below `EXACT_SEARCH_CEILING` chunks in scope a question is searched exactly —
 * `knowledge-retrieval-recall.test.ts` holds that. Above it the HNSW index
 * answers, and an approximate index has three ways to fail that all look like
 * success from the outside, each measured while this was built:
 *
 * 1. **It is not actually used.** The planner cannot see that every vector is
 *    a 6 KB TOAST read, so a full scan looks almost as cheap as the index: left
 *    unpinned, the approximate statement scanned every chunk in scope for 40
 *    questions out of 40 — the answers exactly right and the latency the
 *    ceiling exists to avoid. A test comparing answers alone stays green.
 * 2. **It is used with the wrong settings.** pgvector's defaults found the
 *    stub embedding's best passage for 56–70 % of questions in a 70,000-chunk
 *    table. Recall is a property of `hnsw.ef_search` and the iterative scan,
 *    not of the SQL text.
 * 3. **It leaves the settings behind.** They are transaction-scoped, and the
 *    skill engine calls retrieval in the middle of a transaction that goes on
 *    to plan statements of its own.
 *
 * So the approximate statement is intercepted on its way to the database and
 * examined in place — the settings it runs under and the plan it gets, in its
 * own tenant transaction — rather than re-issued from a copy that could drift.
 *
 * The knowledge base is what the product stores — the two scopes that are
 * searched are written by `KnowledgeService.index` itself: a help centre on
 * eighty topics, a few paragraphs repeated word for word across articles the
 * way boilerplate is, and a second tenant writing about the searched agent's
 * topics in the same words, so the index walks through rows the tenant filter
 * throws away — the shape of a shared table. The ceiling is lowered for the
 * test (the real one is 20,000) so 2,000 chunks sit above it.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { chunk, embed, toVectorLiteral } from '@nexa/ai-mock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, type TenantClient, type TenantContext } from '../../src/lib/tenant.js';
import {
  APPROXIMATE_SEARCH,
  KnowledgeService,
  type KnowledgeSearch,
  type RetrievedChunk,
} from '../../src/services/ai/knowledge-service.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** The test's ceiling. `Big` sits above it, `Small` below. */
const CEILING = 1_000;
const PARAGRAPHS_PER_SOURCE = 50;

/**
 * Who writes about what. `Mirror` — the other tenant — covers `Big`'s forty
 * topics twice over, in the same words, so most of what sits near a question
 * about `Big` is a row the tenant filter discards. The two scopes that are
 * searched are written by `KnowledgeService.index`; the rest, only ever walked
 * past, by the same INSERT in one statement per source.
 */
const LAYOUT = [
  { tenant: 'a', agent: 'Big', sources: 40, topic: (s: number) => s, writer: 'service' },
  { tenant: 'a', agent: 'Small', sources: 10, topic: (s: number) => 40 + s, writer: 'service' },
  { tenant: 'a', agent: 'Other', sources: 30, topic: (s: number) => 50 + s, writer: 'batch' },
  { tenant: 'b', agent: 'Mirror', sources: 160, topic: (s: number) => s % 40, writer: 'batch' },
] as const;
const TOTAL_SOURCES = LAYOUT.reduce((sum, part) => sum + part.sources, 0);

/** A source's paragraphs come from one window of topics; `Mirror` reuses `Big`'s windows. */
const TOPIC_WINDOWS = 40;
const TOPICS_PER_WINDOW = 2;

const QUESTIONS = 60;
const LIMIT = 3;

/**
 * The documented floor (PLAN §D173): the shipped settings, measured on the stub
 * embedding in a 70,000-chunk table shared by two tenants — recall@3 ≥ 0.978,
 * top-1 ≥ 0.985, and no answerable question left unanswered once the exact
 * fallback runs.
 *
 * What it can and cannot catch at this size, measured: the shipped settings
 * score 1.0 here, and pgvector's default `ef_search` of 40 still scores 0.99 —
 * a graph of 12,000 chunks is small enough that almost any walk finds its way. So
 * this floor catches the approximate branch breaking (another index, another
 * scope, rows lost between the walk and the re-sort), not its tuning drifting;
 * the tuning's evidence is the 70,000-chunk bench, and its values are pinned in
 * `knowledge-service.test.ts` so changing one means measuring again.
 */
const FLOOR = { recallAt3: 0.978, top1: 0.985 } as const;

/** mulberry32 — the corpus must be the same on every run. */
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

/** A help centre's worth of words, and the paragraphs and questions made of them. */
function helpCentre(seed: number) {
  const next = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  /** Head-heavy, the way word frequencies are. */
  const skewed = <T>(list: readonly T[]): T => list[Math.floor(list.length * next() ** 2.2)]!;

  const consonants = [
    'b',
    'd',
    'f',
    'g',
    'k',
    'l',
    'm',
    'n',
    'p',
    'r',
    't',
    'v',
    'z',
    'br',
    'st',
    'tr',
  ];
  const vowels = ['a', 'e', 'i', 'o', 'u', 'ai', 'ou'];
  const seen = new Set<string>();
  const word = (): string => {
    for (;;) {
      let candidate = '';
      for (let syllable = 0, n = 2 + Math.floor(next() * 2); syllable < n; syllable++) {
        candidate += pick(consonants) + pick(vowels);
      }
      if (!seen.has(candidate)) {
        seen.add(candidate);
        return candidate;
      }
    }
  };

  const common = Array.from({ length: 600 }, word);
  // Twenty words a topic, so a topic's paragraphs resemble each other the way
  // one product's help articles do and ranking them takes more than a keyword.
  const topics = Array.from({ length: TOPIC_WINDOWS * TOPICS_PER_WINDOW }, () =>
    Array.from({ length: 20 }, word),
  );
  const filler = ['the', 'to', 'and', 'of', 'a', 'in', 'is', 'for', 'on', 'with', 'you', 'your'];

  const paragraph = (topic: readonly string[]): string =>
    Array.from({ length: 30 + Math.floor(next() * 40) }, () => {
      const roll = next();
      if (roll < 0.45) return skewed(topic);
      if (roll < 0.8) return skewed(common);
      return pick(filler);
    }).join(' ') + '.';

  const boilerplate = Array.from({ length: 12 }, () => paragraph(topics[0]!));

  return {
    /** One source: fifty paragraphs, so `chunk()` keeps fifty chunks. */
    article(window: number): string[] {
      const first = (window % TOPIC_WINDOWS) * TOPICS_PER_WINDOW;
      return Array.from({ length: PARAGRAPHS_PER_SOURCE }, () =>
        next() < 0.02
          ? pick(boilerplate)
          : paragraph(topics[first + Math.floor(next() * TOPICS_PER_WINDOW)]!),
      );
    },
    /** A visitor asking about one paragraph, in a few of its own words. */
    question(text: string): string {
      const words = [...new Set(text.replace('.', '').split(' '))].filter(
        (w) => !filler.includes(w),
      );
      const asked = new Set<string>();
      const wanted = Math.min(4 + Math.floor(next() * 4), words.length);
      while (asked.size < wanted) asked.add(pick(words));
      return `how do I ${[...asked].join(' ')} ${skewed(common)}?`;
    },
  };
}

interface Plan {
  'Node Type': string;
  'Parent Relationship'?: string;
  'Index Name'?: string;
  Output?: string[];
  'Sort Key'?: string[];
  'Order By'?: string | string[];
  Filter?: string;
  Plans?: Plan[];
}
type PlanNode = Plan;
const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];

/** What a plan evaluates for every row it reads — InitPlans run once, so they are left out. */
function rowExpressions(node: Plan): string[] {
  if (node['Parent Relationship'] === 'InitPlan') return [];
  return [
    ...(node.Output ?? []),
    ...(node['Sort Key'] ?? []),
    ...([] as string[]).concat(node['Order By'] ?? []),
    ...(node.Filter ? [node.Filter] : []),
    ...(node.Plans ?? []).flatMap(rowExpressions),
  ];
}

interface Observed {
  settings: Record<string, string>;
  plan: Plan;
}

/**
 * A client whose transactions report the approximate statement as it passes:
 * the settings in force and the plan it gets, read on the same transaction
 * right before the statement itself runs.
 */
function observingClient(base: PrismaClient, sink: (observed: Observed) => void): PrismaClient {
  const wrap = (tx: TenantClient): TenantClient =>
    new Proxy(tx, {
      get(target, property, receiver): unknown {
        if (property !== '$queryRaw') return Reflect.get(target, property, receiver);
        return async (first: unknown, ...values: unknown[]): Promise<unknown> => {
          const statement = Array.isArray(first)
            ? Prisma.sql(first as unknown as TemplateStringsArray, ...values)
            : (first as Prisma.Sql);
          if (/AS distance/.test(statement.sql) && !/\+ 0 AS distance/.test(statement.sql)) {
            const [settings] = await target.$queryRaw<Array<Record<string, string>>>`
              SELECT current_setting('enable_sort') AS enable_sort,
                     current_setting('jit') AS jit,
                     current_setting('hnsw.ef_search') AS ef_search,
                     current_setting('hnsw.iterative_scan') AS iterative_scan`;
            const rows = await target.$queryRaw<Array<Record<string, unknown>>>(
              Prisma.sql`EXPLAIN (FORMAT JSON) ${statement}`,
            );
            const raw = Object.values(rows[0] ?? {})[0];
            const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<{
              Plan: Plan;
            }>;
            sink({ settings: settings!, plan: parsed[0]!.Plan });
          }
          return target.$queryRaw(statement);
        };
      },
    }) as TenantClient;

  return new Proxy(base, {
    get(target, property, receiver): unknown {
      if (property !== '$transaction') return Reflect.get(target, property, receiver);
      return (fn: unknown, options?: unknown) =>
        typeof fn === 'function'
          ? target.$transaction(
              async (tx) => (fn as (tx: TenantClient) => Promise<unknown>)(wrap(tx)),
              options as Parameters<PrismaClient['$transaction']>[1],
            )
          : (target.$transaction as (...args: unknown[]) => Promise<unknown>)(fn, options);
    },
  });
}

describe('knowledge retrieval above the exact-search ceiling', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  let tenant: TenantContext;
  const agents = new Map<string, string>();
  const questions: string[] = [];
  /** Every source of the agent the questions are asked of. */
  const bigSources = new Set<string>();

  /** The service under test, with the lowered ceiling. */
  const scaled = new KnowledgeService({ exactSearchCeiling: CEILING });
  /** Exact search whatever the scope — the reference every answer is held to. */
  const exact = new KnowledgeService({ exactSearchCeiling: 1_000_000 });

  function search(
    service: KnowledgeService,
    agent: string,
    question: string,
  ): Promise<KnowledgeSearch> {
    return withTenant(app, tenant, (tx) =>
      service.search(tx, tenant, question, { aiAgentId: agents.get(agent)!, limit: LIMIT }),
    );
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    fx = await seedFixtures(owner);
    tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };

    const corpus = helpCentre(254);
    const indexer = new KnowledgeService();
    for (const { tenant: key, agent, sources, topic, writer } of LAYOUT) {
      const context = { licenseId: fx[key].licenseId, organizationId: fx[key].organizationId };
      const created = await owner.aiAgent.create({
        data: { licenseId: context.licenseId, kind: 'ai_agent', name: agent },
        select: { id: true },
      });
      agents.set(agent, created.id);
      for (let s = 0; s < sources; s++) {
        const paragraphs = corpus.article(topic(s));
        const content = paragraphs.join('\n\n');
        const source = await owner.knowledgeSource.create({
          data: {
            aiAgentId: created.id,
            licenseId: context.licenseId,
            type: 'article',
            name: `${agent} ${s}`,
            content,
          },
          select: { id: true },
        });
        if (agent === 'Big') bigSources.add(source.id);
        if (writer === 'service') {
          await indexer.index(owner as TenantClient, context, source.id, content);
        } else {
          // The rows `index()` writes — a paragraph under 600 characters is one
          // chunk — without one round trip per chunk.
          if (chunk(content).length !== paragraphs.length) {
            throw new Error(`${agent} ${s}: chunk() would not keep its paragraphs apart`);
          }
          await owner.$executeRaw`
            INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
            VALUES ${Prisma.join(
              paragraphs.map(
                (text, position) =>
                  Prisma.sql`(gen_random_uuid(), ${source.id}::uuid, ${context.licenseId}, ${text},
                              ${toVectorLiteral(embed(text))}::vector, ${text.split(/\s+/).length}, ${position})`,
              ),
            )}`;
        }
        if (agent === 'Big' && questions.length < QUESTIONS && s % 2 === 0) {
          questions.push(corpus.question(paragraphs[(s * 7) % PARAGRAPHS_PER_SOURCE]!));
          questions.push(corpus.question(paragraphs[(s * 13 + 5) % PARAGRAPHS_PER_SOURCE]!));
          questions.push(corpus.question(paragraphs[(s * 29 + 11) % PARAGRAPHS_PER_SOURCE]!));
        }
      }
    }
    await owner.$executeRawUnsafe('ANALYZE knowledge_chunks');
    await owner.$executeRawUnsafe('ANALYZE knowledge_sources');
  }, 300_000);

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  it('holds one scope above the ceiling and one below it', async () => {
    const count = (agent: string) =>
      owner.knowledgeChunk.count({ where: { source: { aiAgentId: agents.get(agent)! } } });
    expect(await count('Big')).toBe(40 * PARAGRAPHS_PER_SOURCE);
    expect(await count('Small')).toBe(10 * PARAGRAPHS_PER_SOURCE);
    expect(await owner.knowledgeChunk.count()).toBe(TOTAL_SOURCES * PARAGRAPHS_PER_SOURCE);
    expect(questions).toHaveLength(QUESTIONS);

    expect((await search(scaled, 'Big', questions[0]!)).strategy).not.toBe('exact');
    const small = await search(scaled, 'Small', questions[0]!);
    expect(small.strategy).toBe('exact');
    expect(small.chunksInScope).toBe(10 * PARAGRAPHS_PER_SOURCE);
  });

  it('answers above the ceiling from the HNSW index, under the settings it was measured with', async () => {
    const observed: Observed[] = [];
    const client = observingClient(app, (entry) => observed.push(entry));
    const result = await withTenant(client, tenant, (tx) =>
      scaled.search(tx, tenant, questions[1]!, { aiAgentId: agents.get('Big')!, limit: LIMIT }),
    );

    expect(result.strategy).not.toBe('exact');
    expect(observed).toHaveLength(1);
    expect(observed[0]!.settings).toEqual({
      enable_sort: 'off',
      jit: 'off',
      ef_search: String(APPROXIMATE_SEARCH.efSearch),
      iterative_scan: APPROXIMATE_SEARCH.iterativeScan,
    });
    const scans = nodes(observed[0]!.plan).filter((node) => node['Index Name']);
    expect(scans.map((node) => node['Index Name'])).toContain('idx_chunks_embedding_hnsw');
    expect(nodes(observed[0]!.plan).map((node) => node['Node Type'])).not.toContain('Sort');
  });

  it("leaves the caller's own settings as it found them", async () => {
    const read = (tx: TenantClient) => tx.$queryRaw<Array<Record<string, string>>>`
      SELECT current_setting('enable_sort') AS enable_sort,
             current_setting('jit') AS jit,
             current_setting('hnsw.ef_search') AS ef_search,
             current_setting('hnsw.iterative_scan') AS iterative_scan`;

    const [before, after, plan] = await withTenant(app, tenant, async (tx) => {
      // Values of the caller's own, none of them the search's, set the way a
      // caller would set them.
      await tx.$executeRawUnsafe('SET LOCAL hnsw.ef_search = 77');
      await tx.$executeRawUnsafe('SET LOCAL hnsw.iterative_scan = strict_order');
      await tx.$executeRawUnsafe('SET LOCAL jit = on');
      const settingsBefore = await read(tx);
      const result = await scaled.search(tx, tenant, questions[2]!, {
        aiAgentId: agents.get('Big')!,
        limit: LIMIT,
      });
      expect(result.strategy).not.toBe('exact');
      const settingsAfter = await read(tx);
      // And the next statement the caller plans gets its sort back.
      const next = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        'EXPLAIN SELECT id FROM knowledge_sources ORDER BY name LIMIT 5',
      );
      return [
        settingsBefore[0],
        settingsAfter[0],
        next.map((line) => line['QUERY PLAN']).join('\n'),
      ];
    });

    expect(before).toEqual({
      enable_sort: 'on',
      jit: 'on',
      ef_search: '77',
      iterative_scan: 'strict_order',
    });
    expect(after).toEqual(before);
    expect(plan).toMatch(/Sort/);
  });

  it('finds what exact search finds, within the documented floor (FR-MOD-06.3.3)', async () => {
    let wanted = 0;
    let found = 0;
    let sameBest = 0;
    let answerable = 0;
    const unanswered: string[] = [];
    const outOfScope: RetrievedChunk[] = [];
    const strategies = new Set<string>();

    for (const question of questions) {
      const reference = (await search(exact, 'Big', question)).chunks;
      const approximate = await search(scaled, 'Big', question);
      strategies.add(approximate.strategy);
      outOfScope.push(...approximate.chunks.filter((chunk) => !bigSources.has(chunk.sourceId)));
      if (reference.length === 0) continue;
      answerable++;
      if (approximate.chunks.length === 0) unanswered.push(question);
      // By score, so two chunks tied at the same similarity are not a miss —
      // which is also why scope is checked by source above, not here.
      const worstWanted = reference.at(-1)!.score;
      wanted += reference.length;
      found += Math.min(
        approximate.chunks.filter((chunk) => chunk.score >= worstWanted - 1e-4).length,
        reference.length,
      );
      if (approximate.chunks[0] && approximate.chunks[0].score >= reference[0]!.score - 1e-4)
        sameBest++;
    }

    // The fixture asks real questions: nearly all have an answer above the threshold.
    expect(answerable).toBeGreaterThanOrEqual(QUESTIONS * 0.9);
    expect(strategies.has('exact')).toBe(false);
    expect(outOfScope).toEqual([]);
    // No answerable question is handed to a human for the index's sake.
    expect(unanswered).toEqual([]);
    expect(found / wanted).toBeGreaterThanOrEqual(FLOOR.recallAt3);
    expect(sameBest / answerable).toBeGreaterThanOrEqual(FLOOR.top1);
  });
});

describe('knowledge retrieval on a warm connection', () => {
  let owner: PrismaClient;
  let single: PrismaClient;
  let tenant: TenantContext;
  let agentId: string;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    // One connection, so the statements the service prepares are the ones read back.
    const url = new URL(APP_URL);
    url.searchParams.set('connection_limit', '1');
    single = new PrismaClient({ datasourceUrl: url.toString() });
    const fx = await seedFixtures(owner);
    tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    const agent = await owner.aiAgent.create({
      data: { licenseId: tenant.licenseId, kind: 'ai_agent', name: 'Ada' },
      select: { id: true },
    });
    agentId = agent.id;
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId: agentId,
        licenseId: tenant.licenseId,
        type: 'article',
        name: 'Delivery',
        content: '',
      },
      select: { id: true },
    });
    await new KnowledgeService().index(
      owner as TenantClient,
      tenant,
      source.id,
      'Standard delivery takes 3 to 5 working days.\n\nReturns are accepted within 30 days.',
    );
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), single.$disconnect()]);
  });

  /**
   * Prisma prepares each statement and binds the question's vector as `text`.
   * After five executions Postgres may plan the statement once for every set of
   * values, and in that generic plan a bare `$1::vector` is a cast evaluated for
   * every row read — measured at 5× the time for the stub's vectors and 15× for
   * a real provider's at 20,000 chunks in scope (PLAN §D173). The plan below is
   * the generic plan of the very statement the service prepared on this
   * connection, so the test reads what a warm connection actually runs.
   */
  it('parses the question once per search, not once per row, on the plan Postgres caches', async () => {
    const service = new KnowledgeService({ exactSearchCeiling: 0 });
    await withTenant(single, tenant, (tx) =>
      service.search(tx, tenant, 'how long does delivery take', { aiAgentId: agentId, limit: 2 }),
    );
    await withTenant(single, tenant, (tx) =>
      new KnowledgeService().search(tx, tenant, 'how long does delivery take', {
        aiAgentId: agentId,
      }),
    );

    const statements = await withTenant(single, tenant, (tx) =>
      tx.$queryRawUnsafe<Array<{ name: string; statement: string; types: string }>>(
        `SELECT name, statement, parameter_types::text AS types FROM pg_prepared_statements
         WHERE statement LIKE '%FROM knowledge_chunks c%ORDER BY distance%'
           AND statement NOT LIKE '%pg_prepared_statements%'`,
      ),
    );
    // Both statements, and both as Prisma bound them: the vector as text.
    expect(statements.map((s) => s.statement.includes('+ 0 AS distance')).sort()).toEqual([
      false,
      true,
    ]);

    for (const { name, statement, types } of statements) {
      expect(types.startsWith('{text,')).toBe(true);
      const approximate = !statement.includes('+ 0 AS distance');
      const plan = await withTenant(single, tenant, async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_generic_plan');
        // The approximate statement is only ever planned under its pin.
        if (approximate) {
          await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
          await tx.$executeRawUnsafe('SET LOCAL jit = off');
        }
        const nulls = types
          .replace(/[{}]/g, '')
          .split(',')
          .map(() => 'NULL')
          .join(', ');
        const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `EXPLAIN (VERBOSE, FORMAT JSON) EXECUTE "${name}"(${nulls})`,
        );
        const raw = Object.values(rows[0] ?? {})[0];
        return ((typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<{ Plan: PlanNode }>)[0]!
          .Plan;
      });

      // Every expression the plan evaluates per row — the InitPlan itself, which
      // runs once, is the one place the cast belongs.
      const perRow = rowExpressions(plan);
      expect(perRow.some((expression) => expression.includes('(InitPlan 1).col1'))).toBe(true);
      expect(perRow.filter((expression) => /\$1\)?::vector/.test(expression))).toEqual([]);
    }
  });
});
