/**
 * The clusters' arithmetic (tm 317.2 · AI-22 §4): assignment at τ with a
 * running mean, the nightly merge at τ_merge, and the fixture that holds τ in
 * a model's space — 30 wordings of one question in one cluster, its neighbour
 * and an unrelated question apart.
 */
import { describe, expect, it } from 'vitest';
import { embed } from '@siyahtus/ai-mock';
import {
  UNRESOLVED_CLUSTER_SIMILARITY,
  UNRESOLVED_MERGE_SIMILARITY,
  unresolvedSpaceKind,
} from '@siyahtus/types';
import {
  BONUS,
  PAPARA_DEPOSIT,
  PAPARA_WITHDRAWAL,
  fixtureSpace,
} from '../../../../test/helpers/unresolved-vectors.js';
import {
  assignToClusters,
  blend,
  cosine,
  parseVector,
  planMerges,
  type ClusterableItem,
  type MergeCandidate,
} from './assign.js';

const T0 = Date.parse('2026-10-22T08:00:00Z');

function items(texts: readonly string[], vectorFor: (text: string) => number[], from = 0) {
  return texts.map((text, index): ClusterableItem => ({
    id: `item-${String(from + index).padStart(3, '0')}`,
    createdAt: new Date(T0 + (from + index) * 60_000),
    vector: vectorFor(text),
  }));
}

function counter(prefix = 'c'): () => string {
  let next = 0;
  return () => `${prefix}${++next}`;
}

/** Which cluster each text went to. */
function groups(result: ReturnType<typeof assignToClusters>, all: ClusterableItem[]) {
  const at = new Map(result.assignments.map((a) => [a.itemId, a.clusterId]));
  return all.map((item) => at.get(item.id));
}

describe('cosine, blend, parseVector', () => {
  it('measures the angle, not the length; a zero vector is 0', () => {
    expect(cosine([1, 0], [5, 0])).toBe(1);
    expect(cosine([1, 0], [0, 3])).toBe(0);
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(() => cosine([1], [1, 2])).toThrow(/length/);
  });

  it('weighs a mean by how many vectors each side is of', () => {
    expect(blend([0, 0], 3, [4, 8], 1)).toEqual([1, 2]);
    expect(blend([2, 2], 0, [0, 0], 0)).toEqual([2, 2]);
  });

  it('reads pgvector’s text form, and nothing else', () => {
    expect(parseVector('[0.5,-1,2]')).toEqual([0.5, -1, 2]);
    expect(() => parseVector('{"a":1}')).toThrow(/not a vector/);
  });
});

describe('the thresholds, by kind of space', () => {
  it('reads the stub’s space as lexical and any provider’s as a model’s', () => {
    expect(unresolvedSpaceKind('mock:lexical-v1')).toBe('lexical');
    expect(unresolvedSpaceKind('openai:text-embedding-3-small')).toBe('model');
  });

  it('starts a model’s τ at the analysis’s 0.8 and merges only above it', () => {
    expect(UNRESOLVED_CLUSTER_SIMILARITY.model).toBe(0.8);
    for (const kind of ['model', 'lexical'] as const) {
      expect(UNRESOLVED_MERGE_SIMILARITY[kind]).toBeGreaterThan(
        UNRESOLVED_CLUSTER_SIMILARITY[kind],
      );
    }
  });
});

describe('assignToClusters (AI-22 §4)', () => {
  it('puts 30 wordings of one question in one cluster in a model’s space, its neighbour and an unrelated question apart (AI-22 acceptance)', () => {
    const space = fixtureSpace();
    const all = [
      ...items(PAPARA_DEPOSIT, space.vectorFor),
      ...items(PAPARA_WITHDRAWAL, space.vectorFor, 100),
      ...items(BONUS, space.vectorFor, 200),
    ];
    const result = assignToClusters(all, [], UNRESOLVED_CLUSTER_SIMILARITY.model, counter());
    const at = groups(result, all);

    const deposit = new Set(at.slice(0, PAPARA_DEPOSIT.length));
    expect(deposit.size).toBe(1);
    const withdrawal = new Set(at.slice(PAPARA_DEPOSIT.length, -BONUS.length));
    const bonus = new Set(at.slice(-BONUS.length));
    expect(withdrawal.size).toBe(1);
    expect(bonus.size).toBe(1);
    expect(new Set([...deposit, ...withdrawal, ...bonus]).size).toBe(3);
    expect(result.opened).toHaveLength(3);
  });

  it('holds the fixture’s geometry: one question ≈ 0.85 apart, its neighbour well under τ', () => {
    const space = fixtureSpace();
    const a = space.vectorFor(PAPARA_DEPOSIT[0]);
    const b = space.vectorFor(PAPARA_DEPOSIT[1]);
    const n = space.vectorFor(PAPARA_WITHDRAWAL[0]);
    expect(cosine(a, b)).toBeGreaterThan(0.8);
    expect(cosine(a, b)).toBeLessThan(0.9);
    expect(cosine(a, n)).toBeLessThan(0.65);
  });

  it('joins an existing centre and moves it by a running mean', () => {
    const result = assignToClusters(
      [{ id: 'i1', createdAt: new Date(T0), vector: [0, 1] }],
      [{ id: 'old', centroid: [1, 0.2], weight: 3 }],
      0.1,
      counter(),
    );
    expect(result.assignments).toEqual([
      { itemId: 'i1', clusterId: 'old', similarity: cosine([0, 1], [1, 0.2]) },
    ]);
    expect(result.centres[0]).toEqual({ id: 'old', centroid: [0.75, 0.4], weight: 4 });
    expect(result.opened).toEqual([]);
  });

  it('opens a cluster below τ, and the next item meets it', () => {
    const result = assignToClusters(
      [
        { id: 'a', createdAt: new Date(T0), vector: [1, 0] },
        { id: 'b', createdAt: new Date(T0 + 1), vector: [0, 1] },
        { id: 'c', createdAt: new Date(T0 + 2), vector: [0.1, 1] },
      ],
      [],
      0.8,
      counter(),
    );
    expect(result.assignments.map((a) => a.clusterId)).toEqual(['c1', 'c2', 'c2']);
    expect(result.opened).toEqual(['c1', 'c2']);
  });

  it('gives the same clusters whatever order the items come in', () => {
    const space = fixtureSpace();
    const all = [
      ...items(PAPARA_DEPOSIT.slice(0, 10), space.vectorFor),
      ...items(PAPARA_WITHDRAWAL, space.vectorFor, 50),
    ];
    const forward = assignToClusters(all, [], 0.8, counter());
    const backward = assignToClusters([...all].reverse(), [], 0.8, counter());
    expect(backward.assignments).toEqual(forward.assignments);
  });

  it('groups the lexical stub’s wordings that share their words at the stub’s τ', () => {
    const texts = [
      'Papara ile yatırdım gözükmüyor',
      'Papara ile yatırdım hesapta gözükmüyor',
      'papara yatırdım gözükmüyor hala',
      'Bonus çevrim şartı nedir',
    ];
    const all = items(texts, embed);
    const at = groups(
      assignToClusters(all, [], UNRESOLVED_CLUSTER_SIMILARITY.lexical, counter()),
      all,
    );
    expect(new Set(at.slice(0, 3)).size).toBe(1);
    expect(at[3]).not.toBe(at[0]);
  });
});

describe('planMerges (AI-22 §4, the nightly pass)', () => {
  const candidate = (
    id: string,
    centroid: number[],
    weight: number,
    over: Partial<MergeCandidate> = {},
  ): MergeCandidate => ({
    id,
    centroid,
    weight,
    status: 'open',
    firstSeen: new Date(T0),
    ...over,
  });

  it('folds the smaller of two near centres into the bigger', () => {
    const plans = planMerges(
      [candidate('small', [1, 0.05], 2), candidate('big', [1, 0], 6), candidate('far', [0, 1], 9)],
      0.95,
    );
    expect(plans).toEqual([
      { survivorId: 'big', absorbedIds: ['small'], centroid: [1, 0.0125], weight: 8 },
    ]);
  });

  it('never merges an ignored or fixed cluster with an open one', () => {
    expect(
      planMerges(
        [
          candidate('open', [1, 0], 5),
          candidate('ignored', [1, 0], 3, { status: 'ignored' }),
          candidate('fixed', [1, 0], 2, { status: 'resolved' }),
        ],
        0.9,
      ),
    ).toEqual([]);
  });

  it('keeps the older of two equal ones, and merges a chain into one survivor', () => {
    const plans = planMerges(
      [
        candidate('young', [1, 0], 3, { firstSeen: new Date(T0 + 1) }),
        candidate('old', [1, 0], 3),
        candidate('third', [1, 0.01], 1),
      ],
      0.99,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ survivorId: 'old', absorbedIds: ['young', 'third'] });
  });

  it('splits nothing that the fixture puts apart', () => {
    const space = fixtureSpace();
    const deposit = space.vectorFor(PAPARA_DEPOSIT[0]);
    const withdrawal = space.vectorFor(PAPARA_WITHDRAWAL[0]);
    expect(
      planMerges(
        [candidate('d', deposit, 30), candidate('w', withdrawal, 5)],
        UNRESOLVED_MERGE_SIMILARITY.model,
      ),
    ).toEqual([]);
  });
});
