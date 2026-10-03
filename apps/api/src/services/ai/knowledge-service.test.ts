import { Prisma } from '@prisma/client';
import { chunk, toVectorLiteral } from '@siyahtus/ai-mock';
import { describe, expect, it } from 'vitest';
import {
  FAKE_EMBEDDING_SPACE,
  FakeEmbeddingProvider,
  fakeEmbedding,
} from '../../../test/helpers/fake-embedding-provider.js';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import {
  APPROXIMATE_SEARCH,
  EXACT_SEARCH_CEILING,
  KnowledgeService,
  RETRIEVAL_THRESHOLD,
  refuseUnembeddable,
  type KnowledgeServiceOptions,
  type QueryEmbedding,
} from './knowledge-service.js';
import { EmbeddingProviderError } from './provider/embedding-error.js';
import { MockEmbeddingProvider } from './provider/mock-embedding-provider.js';

const embeddings = new MockEmbeddingProvider();

/** A service over the lexical stub, as every search test here has always used. */
const service = (options: Omit<KnowledgeServiceOptions, 'embeddings'> = {}): KnowledgeService =>
  new KnowledgeService({ embeddings, ...options });

/** A question embedded the way the engine embeds one, before any transaction. */
const question = (text: string): Promise<QueryEmbedding> => service().embedQuery(text);

/**
 * The order of statements `KnowledgeService.search` sends, pinned without a
 * database (tm 254).
 *
 * What the integration suite cannot force is here: an approximate search that
 * finds nothing above the threshold while exact search would, and an
 * approximate statement that fails halfway. Both are rare on a real index —
 * which is exactly why the paths that handle them must not be left to chance.
 * The recall, the plan and the settings a real database sees are measured in
 * `test/integration/knowledge-retrieval-scale.test.ts`.
 */

const TENANT: TenantContext = { licenseId: 7n, organizationId: 'org-7' };

interface Row {
  id: string;
  source_id: string;
  source_name: string;
  chunk_text: string;
  distance: number;
}

const row = (id: string, distance: number): Row => ({
  id,
  source_id: `source-${id}`,
  source_name: `Source ${id}`,
  chunk_text: `Text of ${id}`,
  distance,
});

type Kind = 'count' | 'exact' | 'approximate' | 'settings' | 'savepoint' | 'rollback' | 'release';

/**
 * A transaction that records what it is asked, classified by statement, and
 * answers from the script it was given.
 */
function scriptedTx(script: { chunksInScope: number; exact?: Row[]; approximate?: Row[] | Error }) {
  const log: Array<{ kind: Kind; values: unknown[] }> = [];

  const classify = (sql: string): Kind => {
    if (/count\(\*\)/.test(sql)) return 'count';
    if (/set_config/.test(sql)) return 'settings';
    if (/\+ 0 AS distance/.test(sql)) return 'exact';
    if (/AS distance/.test(sql)) return 'approximate';
    throw new Error(`unexpected statement: ${sql}`);
  };

  const raw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = Prisma.sql(strings, ...values);
    const kind = classify(statement.sql);
    log.push({ kind, values: statement.values });
    if (kind === 'count') return [{ chunks: script.chunksInScope }];
    if (kind === 'exact') return script.exact ?? [];
    if (kind === 'approximate') {
      if (script.approximate instanceof Error) throw script.approximate;
      return script.approximate ?? [];
    }
    return 1;
  };

  const tx = {
    $queryRaw: raw,
    $executeRaw: raw,
    $executeRawUnsafe: async (sql: string) => {
      if (sql.startsWith('SAVEPOINT')) log.push({ kind: 'savepoint', values: [] });
      else if (sql.startsWith('ROLLBACK TO SAVEPOINT')) log.push({ kind: 'rollback', values: [] });
      else if (sql.startsWith('RELEASE SAVEPOINT')) log.push({ kind: 'release', values: [] });
      else throw new Error(`unexpected statement: ${sql}`);
      return 0;
    },
  } as unknown as TenantClient;

  return { tx, log, kinds: () => log.map((entry) => entry.kind) };
}

const CEILING = 100;

describe('KnowledgeService.search — which search runs, and in what order', () => {
  it('searches exactly at the ceiling, without touching a setting', async () => {
    const { tx, kinds } = scriptedTx({ chunksInScope: CEILING, exact: [row('a', 0.2)] });
    const result = await service({ exactSearchCeiling: CEILING }).search(
      tx,
      TENANT,
      await question('where is my parcel'),
    );

    expect(kinds()).toEqual(['count', 'exact']);
    expect(result.strategy).toBe('exact');
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(['a']);
  });

  it('counts no further than one past the ceiling', async () => {
    const { tx, log } = scriptedTx({ chunksInScope: 3 });
    await service({ exactSearchCeiling: CEILING }).search(tx, TENANT, await question('refund'));

    const count = log.find((entry) => entry.kind === 'count')!;
    expect(count.values.at(-1)).toBe(CEILING + 1);
  });

  it('goes approximate above the ceiling, inside a savepoint it rolls back to', async () => {
    const { tx, log, kinds } = scriptedTx({
      chunksInScope: CEILING + 1,
      // Roughly ordered, the way relaxed_order returns rows.
      approximate: [row('second', 0.3), row('first', 0.1), row('third', 0.4), row('fourth', 0.5)],
    });
    const result = await service({ exactSearchCeiling: CEILING }).search(
      tx,
      TENANT,
      await question('refund'),
      { limit: 3 },
    );

    expect(kinds()).toEqual([
      'count',
      'savepoint',
      'settings',
      'approximate',
      'rollback',
      'release',
    ]);
    expect(result.strategy).toBe('approximate');
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(['first', 'second', 'third']);
    // The settings the search was measured with, and the pin that makes the
    // index its plan.
    expect(log.find((entry) => entry.kind === 'settings')!.values).toEqual([
      String(APPROXIMATE_SEARCH.efSearch),
      APPROXIMATE_SEARCH.iterativeScan,
    ]);
  });

  it('reads at least the measured number of candidates, and more when asked for more', async () => {
    const knowledge = service({ exactSearchCeiling: CEILING });
    const refund = await question('refund');
    const few = scriptedTx({ chunksInScope: CEILING + 1, approximate: [row('a', 0.1)] });
    await knowledge.search(few.tx, TENANT, refund, { limit: 2 });
    const many = scriptedTx({ chunksInScope: CEILING + 1, approximate: [row('a', 0.1)] });
    await knowledge.search(many.tx, TENANT, refund, { limit: APPROXIMATE_SEARCH.candidates + 5 });

    const limitOf = (log: typeof few.log) =>
      log.find((entry) => entry.kind === 'approximate')!.values.at(-1);
    expect(limitOf(few.log)).toBe(APPROXIMATE_SEARCH.candidates);
    expect(limitOf(many.log)).toBe(APPROXIMATE_SEARCH.candidates + 5);
  });

  it('searches exactly when the approximate search finds nothing above the threshold', async () => {
    const belowThreshold = 1 - RETRIEVAL_THRESHOLD + 0.1;
    const { tx, kinds } = scriptedTx({
      chunksInScope: CEILING + 1,
      approximate: [row('noise', belowThreshold)],
      exact: [row('answer', 0.3)],
    });
    const result = await service({ exactSearchCeiling: CEILING }).search(
      tx,
      TENANT,
      await question('refund'),
    );

    // After the savepoint is gone — exact search must not run under the pin.
    expect(kinds()).toEqual([
      'count',
      'savepoint',
      'settings',
      'approximate',
      'rollback',
      'release',
      'exact',
    ]);
    expect(result.strategy).toBe('approximate-then-exact');
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(['answer']);
  });

  it('rolls back to the savepoint when the approximate statement fails', async () => {
    const { tx, kinds } = scriptedTx({
      chunksInScope: CEILING + 1,
      approximate: new Error('canceling statement due to statement timeout'),
    });

    const refund = await question('refund');
    await expect(
      service({ exactSearchCeiling: CEILING }).search(tx, TENANT, refund),
    ).rejects.toThrow('statement timeout');
    expect(kinds()).toEqual([
      'count',
      'savepoint',
      'settings',
      'approximate',
      'rollback',
      'release',
    ]);
  });

  it('keeps retrieve() the chunks of search()', async () => {
    const { tx } = scriptedTx({ chunksInScope: 1, exact: [row('a', 0.2), row('b', 0.9)] });
    const chunks = await service().retrieve(tx, TENANT, await question('refund'));

    // `b` sits below the threshold, exactly as before tm 254.
    expect(chunks.map((chunk) => chunk.id)).toEqual(['a']);
    expect(chunks[0]!.score).toBeCloseTo(0.8, 4);
  });

  /**
   * A tripwire, deliberately. These are measurements, not preferences: each was
   * chosen against exact search at 70,000 chunks on two kinds of embedding
   * (PLAN §D173), and the integration suite's knowledge base is too small to
   * notice most of them drifting — at 12,000 chunks even pgvector's default
   * `ef_search` finds 99 % of what exact search finds. Change one, run the bench
   * again, then change this test.
   */
  it('keeps the ceiling and the approximate search settings that were measured', () => {
    expect(EXACT_SEARCH_CEILING).toBe(20_000);
    expect(APPROXIMATE_SEARCH).toEqual({
      efSearch: 1000,
      iterativeScan: 'relaxed_order',
      candidates: 20,
    });
  });

  it('refuses a ceiling that is not a count', () => {
    expect(() => service({ exactSearchCeiling: -1 })).toThrow(RangeError);
    expect(() => service({ exactSearchCeiling: 1.5 })).toThrow(RangeError);
    expect(() => service({ exactSearchCeiling: Infinity })).toThrow(RangeError);
  });

  it('cuts at an overridden threshold, on the exact and the approximate path alike (tm 255.8)', async () => {
    const rows = [row('a', 0.2), row('b', 0.5), row('c', 0.9)];
    // Similarities 0.8 · 0.5 · 0.1: the default keeps two, 0.6 keeps one, -1 all three.
    for (const [threshold, kept] of [
      [undefined, ['a', 'b']],
      [0.6, ['a']],
      [-1, ['a', 'b', 'c']],
    ] as const) {
      const knowledge = service({
        exactSearchCeiling: CEILING,
        ...(threshold === undefined ? {} : { retrievalThreshold: threshold }),
      });
      expect(knowledge.threshold).toBe(threshold ?? RETRIEVAL_THRESHOLD);
      const exact = scriptedTx({ chunksInScope: CEILING, exact: rows });
      const approximate = scriptedTx({ chunksInScope: CEILING + 1, approximate: rows });
      for (const { tx } of [exact, approximate]) {
        const { chunks } = await knowledge.search(tx, TENANT, await question('refund'), {
          limit: 3,
        });
        expect(chunks.map((chunk) => chunk.id)).toEqual(kept);
      }
    }
  });

  it('refuses a threshold that is not a similarity', () => {
    expect(() => service({ retrievalThreshold: 1.5 })).toThrow(RangeError);
    expect(() => service({ retrievalThreshold: -2 })).toThrow(RangeError);
    expect(() => service({ retrievalThreshold: Number.NaN })).toThrow(RangeError);
  });
});

/**
 * The two phases (tm 255.7): the provider is called with a source's whole text
 * or a question before any transaction exists, and what goes into the
 * transaction is only what it returned — tagged with the space it is in.
 */
describe('KnowledgeService — embedding before the transaction (FR-MOD-06.3.2)', () => {
  const SOURCE = [
    'Refunds are issued to the original payment method within five working days.',
    'Standard delivery takes three to five working days across the EU.',
    'Returns are accepted within thirty days if the item is unused.',
  ].join('\n\n');

  it('embeds every chunk of a source in one call, in order, in the provider’s space', async () => {
    const fake = new FakeEmbeddingProvider();
    const prepared = await new KnowledgeService({ embeddings: fake }).prepare(SOURCE);

    const pieces = chunk(SOURCE);
    expect(pieces).toHaveLength(3);
    // One request for N chunks — never one per chunk.
    expect(fake.calls).toEqual([pieces]);
    expect(prepared.space).toBe(FAKE_EMBEDDING_SPACE);
    expect(prepared.chunks.map((piece) => piece.text)).toEqual(pieces);
    expect(prepared.chunks.map((piece) => piece.vector)).toEqual(
      pieces.map((piece) => toVectorLiteral(fakeEmbedding(piece))),
    );
  });

  it('names the prepared space on every row it writes, never leaving it to the default', async () => {
    const fake = new FakeEmbeddingProvider();
    const knowledge = new KnowledgeService({ embeddings: fake });
    const prepared = await knowledge.prepare(SOURCE);

    const inserts: Array<{ sql: string; values: unknown[] }> = [];
    const tx = {
      knowledgeChunk: { deleteMany: async () => ({ count: 0 }) },
      knowledgeSource: { update: async () => ({}) },
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const statement = Prisma.sql(strings, ...values);
        inserts.push({ sql: statement.sql, values: statement.values });
        return 1;
      },
    } as unknown as TenantClient;

    const written = await knowledge.index(tx, TENANT, 'source-1', prepared);

    expect(written).toBe(3);
    expect(inserts).toHaveLength(3);
    for (const insert of inserts) {
      expect(insert.sql).toContain('embedding_space');
      expect(insert.values).toContain(FAKE_EMBEDDING_SPACE);
    }
    // The provider was not called again: the transaction only writes.
    expect(fake.calls).toHaveLength(1);
  });

  it('asks the provider nothing for text that chunks to nothing', async () => {
    const fake = new FakeEmbeddingProvider();
    const prepared = await new KnowledgeService({ embeddings: fake }).prepare('   \n\n  ');

    expect(prepared).toEqual({
      space: FAKE_EMBEDDING_SPACE,
      chunks: [],
      usage: { inputTokens: 0 },
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('returns what the provider billed, and estimates the bytes it will send (tm 257.20)', async () => {
    const fake = new FakeEmbeddingProvider();
    const knowledge = new KnowledgeService({ embeddings: fake });
    const prepared = await knowledge.prepare(SOURCE);

    const pieces = chunk(SOURCE);
    // The fake bills a token per character.
    expect(prepared.usage).toEqual({
      inputTokens: pieces.reduce((sum, piece) => sum + piece.length, 0),
    });
    // The estimate is over the chunks as sent, in UTF-8 bytes — not the source's length.
    expect(knowledge.estimate(SOURCE)).toBe(
      pieces.reduce((sum, piece) => sum + Buffer.byteLength(piece, 'utf8'), 0),
    );
    expect(knowledge.estimate('Teslimat üç–beş iş günü sürer.')).toBe(
      Buffer.byteLength('Teslimat üç–beş iş günü sürer.', 'utf8'),
    );
    expect(knowledge.estimate('   \n\n  ')).toBe(0);
  });

  it('asks the provider nothing for a blank question, and searches nothing', async () => {
    const fake = new FakeEmbeddingProvider();
    const knowledge = new KnowledgeService({ embeddings: fake });
    const blank = await knowledge.embedQuery('  \t ');
    const { tx, kinds } = scriptedTx({ chunksInScope: 5, exact: [row('a', 0.1)] });

    const result = await knowledge.search(tx, TENANT, blank);

    expect(fake.calls).toHaveLength(0);
    expect(kinds()).toEqual([]);
    expect(result).toEqual({ strategy: 'exact', chunksInScope: 0, chunks: [] });
  });

  it('scopes every search statement to the question’s own space', async () => {
    const fake = new FakeEmbeddingProvider();
    const knowledge = new KnowledgeService({ embeddings: fake, exactSearchCeiling: CEILING });
    const asked = await knowledge.embedQuery('how long does delivery take');
    const { tx, log } = scriptedTx({ chunksInScope: 1, exact: [row('a', 0.2)] });

    await knowledge.search(tx, TENANT, asked);

    expect(asked.space).toBe(FAKE_EMBEDDING_SPACE);
    expect(fake.calls).toEqual([['how long does delivery take']]);
    const statements = log.filter((entry) => entry.kind === 'count' || entry.kind === 'exact');
    expect(statements).toHaveLength(2);
    for (const statement of statements) expect(statement.values).toContain(FAKE_EMBEDDING_SPACE);
  });

  it('fails whole when the provider cannot embed a source — before anything could be written', async () => {
    const fake = new FakeEmbeddingProvider({ fail: new EmbeddingProviderError('unavailable') });

    await expect(new KnowledgeService({ embeddings: fake }).prepare(SOURCE)).rejects.toMatchObject({
      name: 'EmbeddingProviderError',
      kind: 'unavailable',
    });
    expect(fake.calls).toHaveLength(1);
  });
});

describe('refuseUnembeddable — indexing fails and says so (FR-MOD-06.3.2)', () => {
  it('turns a provider failure into the documented 503, naming the kind', () => {
    let refusal: unknown;
    try {
      refuseUnembeddable(new EmbeddingProviderError('timeout'));
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ApiError);
    const apiError = refusal as ApiError;
    expect(apiError.status).toBe(503);
    expect(apiError.type).toBe('service_unavailable');
    expect(apiError.details).toEqual({ kind: 'timeout' });
    expect(apiError.message).toContain('Nothing was saved');
  });

  it('lets anything else through untouched — a defect is not an outage', () => {
    const defect = new TypeError('cannot read properties of undefined');
    expect(() => refuseUnembeddable(defect)).toThrow(defect);
  });
});
