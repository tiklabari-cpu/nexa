import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import {
  APPROXIMATE_SEARCH,
  EXACT_SEARCH_CEILING,
  KnowledgeService,
  RETRIEVAL_THRESHOLD,
} from './knowledge-service.js';

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
    const result = await new KnowledgeService({ exactSearchCeiling: CEILING }).search(
      tx,
      TENANT,
      'where is my parcel',
    );

    expect(kinds()).toEqual(['count', 'exact']);
    expect(result.strategy).toBe('exact');
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(['a']);
  });

  it('counts no further than one past the ceiling', async () => {
    const { tx, log } = scriptedTx({ chunksInScope: 3 });
    await new KnowledgeService({ exactSearchCeiling: CEILING }).search(tx, TENANT, 'refund');

    const count = log.find((entry) => entry.kind === 'count')!;
    expect(count.values.at(-1)).toBe(CEILING + 1);
  });

  it('goes approximate above the ceiling, inside a savepoint it rolls back to', async () => {
    const { tx, log, kinds } = scriptedTx({
      chunksInScope: CEILING + 1,
      // Roughly ordered, the way relaxed_order returns rows.
      approximate: [row('second', 0.3), row('first', 0.1), row('third', 0.4), row('fourth', 0.5)],
    });
    const result = await new KnowledgeService({ exactSearchCeiling: CEILING }).search(
      tx,
      TENANT,
      'refund',
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
    const service = new KnowledgeService({ exactSearchCeiling: CEILING });
    const few = scriptedTx({ chunksInScope: CEILING + 1, approximate: [row('a', 0.1)] });
    await service.search(few.tx, TENANT, 'refund', { limit: 2 });
    const many = scriptedTx({ chunksInScope: CEILING + 1, approximate: [row('a', 0.1)] });
    await service.search(many.tx, TENANT, 'refund', { limit: APPROXIMATE_SEARCH.candidates + 5 });

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
    const result = await new KnowledgeService({ exactSearchCeiling: CEILING }).search(
      tx,
      TENANT,
      'refund',
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

    await expect(
      new KnowledgeService({ exactSearchCeiling: CEILING }).search(tx, TENANT, 'refund'),
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
    const chunks = await new KnowledgeService().retrieve(tx, TENANT, 'refund');

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
    expect(() => new KnowledgeService({ exactSearchCeiling: -1 })).toThrow(RangeError);
    expect(() => new KnowledgeService({ exactSearchCeiling: 1.5 })).toThrow(RangeError);
    expect(() => new KnowledgeService({ exactSearchCeiling: Infinity })).toThrow(RangeError);
  });
});
