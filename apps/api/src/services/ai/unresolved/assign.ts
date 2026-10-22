/**
 * The arithmetic of the unresolved questions' clusters (tm 317.2 · SiyahTuş
 * analysis AI-22 §4) — pure, so the fixtures can hold it without a database:
 *
 *   - **assignment** (the 15-minute job): each new item, oldest first, goes
 *     to the nearest centre of its agent and space when the cosine reaches τ
 *     (`UNRESOLVED_CLUSTER_SIMILARITY`), and the centre moves by a running
 *     mean; otherwise it opens a cluster of its own. The candidates are a
 *     workspace's few hundred centres at most, so the search is exact — no
 *     index (AI-22 §9);
 *   - **merging** (the nightly job): centres closer than τ_merge
 *     (`UNRESOLVED_MERGE_SIMILARITY`) are one question the greedy pass split
 *     by the order its items came in. The biggest absorbs the others; only
 *     clusters in the same state merge — the workspace's "ignore" or "fixed"
 *     is never undone by a machine.
 *
 * Deterministic: the same items and centres, in any order, give the same
 * clusters (items by `createdAt`, then id; centres by weight, then age, then id).
 */
import type { UnresolvedClusterStatus } from '@siyahtus/types';

/** A cluster's centre, as assignment and merging see it. */
export interface ClusterCentre {
  readonly id: string;
  /** The mean of the vectors that joined it — not normalised; cosine does not care. */
  centroid: number[];
  /** How many vectors the mean is of (`item_count`). */
  weight: number;
}

export interface ClusterableItem {
  readonly id: string;
  readonly createdAt: Date;
  readonly vector: number[];
}

export interface ItemAssignment {
  readonly itemId: string;
  readonly clusterId: string;
  readonly similarity: number;
}

export interface AssignResult {
  readonly assignments: ItemAssignment[];
  /** Every centre, the new ones included, as the items left them. */
  readonly centres: ClusterCentre[];
  /** The ids of the clusters this pass opened, in the order it opened them. */
  readonly opened: string[];
}

/** Cosine similarity; 0 when either vector is all zeros. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new TypeError(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / Math.sqrt(aa * bb);
}

/** The weighted mean of two centres. */
export function blend(
  a: readonly number[],
  aWeight: number,
  b: readonly number[],
  bWeight: number,
): number[] {
  const total = aWeight + bWeight;
  if (total <= 0) return [...a];
  return a.map((value, i) => (value * aWeight + b[i]! * bWeight) / total);
}

/** pgvector's text form (`[0.1,0.2,…]`) as numbers. */
export function parseVector(text: string): number[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'number')) {
    throw new TypeError('not a vector');
  }
  return parsed as number[];
}

function byAge(a: ClusterableItem, b: ClusterableItem): number {
  const time = a.createdAt.getTime() - b.createdAt.getTime();
  if (time !== 0) return time;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Put `items` into `centres` (one agent, one space). A centre is never
 * mutated in place: the result carries the moved copies. `newId` names a
 * cluster this pass opens.
 */
export function assignToClusters(
  items: readonly ClusterableItem[],
  centres: readonly ClusterCentre[],
  threshold: number,
  newId: () => string,
): AssignResult {
  const working: ClusterCentre[] = centres.map((centre) => ({
    id: centre.id,
    centroid: [...centre.centroid],
    weight: centre.weight,
  }));
  const assignments: ItemAssignment[] = [];
  const opened: string[] = [];
  for (const item of [...items].sort(byAge)) {
    let best: ClusterCentre | null = null;
    let bestSimilarity = -Infinity;
    for (const centre of working) {
      const similarity = cosine(item.vector, centre.centroid);
      // Strict `>`: a tie keeps the earlier centre, so the order is the rule.
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        best = centre;
      }
    }
    if (best && bestSimilarity >= threshold) {
      const weight = Math.max(best.weight, 0);
      best.centroid = blend(best.centroid, weight, item.vector, 1);
      best.weight = weight + 1;
      assignments.push({ itemId: item.id, clusterId: best.id, similarity: bestSimilarity });
    } else {
      const id = newId();
      working.push({ id, centroid: [...item.vector], weight: 1 });
      opened.push(id);
      assignments.push({ itemId: item.id, clusterId: id, similarity: 1 });
    }
  }
  return { assignments, centres: working, opened };
}

/** A cluster as the nightly merge sees it. */
export interface MergeCandidate extends ClusterCentre {
  readonly status: UnresolvedClusterStatus;
  readonly firstSeen: Date;
}

export interface PlannedMerge {
  readonly survivorId: string;
  readonly absorbedIds: string[];
  /** The survivor's centre once the others are in it. */
  readonly centroid: number[];
  readonly weight: number;
}

/**
 * Which clusters fold into which (one agent, one space): the biggest first
 * (then the oldest, then the id) takes every later cluster in its own state
 * whose centre is within `threshold` of its centre — which moves as each one
 * joins. A cluster absorbed is never a survivor.
 */
export function planMerges(
  candidates: readonly MergeCandidate[],
  threshold: number,
): PlannedMerge[] {
  const ordered = [...candidates].sort(
    (a, b) =>
      b.weight - a.weight ||
      a.firstSeen.getTime() - b.firstSeen.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const absorbed = new Set<string>();
  const plans: PlannedMerge[] = [];
  for (const [index, survivor] of ordered.entries()) {
    if (absorbed.has(survivor.id)) continue;
    let centroid = [...survivor.centroid];
    let weight = Math.max(survivor.weight, 1);
    const taken: string[] = [];
    for (const other of ordered.slice(index + 1)) {
      if (absorbed.has(other.id) || other.status !== survivor.status) continue;
      if (cosine(centroid, other.centroid) < threshold) continue;
      const otherWeight = Math.max(other.weight, 1);
      centroid = blend(centroid, weight, other.centroid, otherWeight);
      weight += otherWeight;
      taken.push(other.id);
      absorbed.add(other.id);
    }
    if (taken.length > 0) {
      plans.push({ survivorId: survivor.id, absorbedIds: taken, centroid, weight });
    }
  }
  return plans;
}
