/**
 * Deterministic topic clustering for the Chat topics report (FR-MOD-07.6).
 *
 * A pure function, next door to the embeddings it borrows: no DB, no Fastify, no
 * env. It takes the conversations in a reporting window — each already reduced to
 * a bit of text (an AI summary, or a customer message) — and groups them into
 * topics, on the fly, every request. Nothing here is persisted; there is no Topic
 * table and PRD §8.4 never asks for one. Swapping in a real LLM clusterer means
 * replacing this one module and nothing else.
 *
 * It leans on `embedding.ts` as a pure consumer — `embed`, `similarity` and
 * `tokenize` are used exactly as RAG uses them and are not touched here, so the
 * knowledge/RAG suite that shares them cannot break from this file.
 *
 * Three properties the report actually depends on, and why each is load-bearing:
 *
 *   1. Determinism. The same conversations, in any order, yield the same topics,
 *      labels and ordering — otherwise the report would reshuffle on every
 *      refresh and its tests would be flakes. Input is sorted by id before any
 *      clustering, so caller order never leaks in.
 *
 *   2. An honest floor. Clustering a handful of chats invents patterns that are
 *      not there; below `TOPIC_MIN_CONVERSATIONS` clusterable conversations the
 *      answer is `{ sufficient: false, topics: [] }` — the "not enough
 *      conversations yet" state the contract (07.6-a) renders, never one
 *      fabricated topic.
 *
 *   3. No PII in a label. Labels come from customer conversation text, so a bare
 *      run of digits — an order or card number — must never become a topic name.
 *      Pure-number tokens are dropped from every label.
 *
 * The route that computes each topic's `share`, `previous_volume` and `trend`
 * against the previous window lives in 07.6-c; those fields need the tenant query
 * and the earlier window, which a pure function does not have. This module
 * produces the half a pure function honestly can — `id`, `label`, `keywords`,
 * `volume` and the member `docIds` the route needs to derive the rest.
 */
import { embed, similarity, tokenize } from './embedding.js';

/** A conversation reduced to clusterable text. `id` is the chat id. */
export interface TopicDoc {
  id: string;
  text: string;
}

/**
 * One clustered topic. The fields a pure function can produce, aligned with the
 * `ReportsTopics.topics[]` contract; the route grafts `share`/`previous_volume`/
 * `trend` on top from the previous window (07.6-c).
 */
export interface TopicCluster {
  /** Stable within one result — a slug of the keywords, deduped. */
  id: string;
  /** Human-readable name derived from the cluster's distinguishing terms. */
  label: string;
  /** The terms the label was derived from (up to three), most distinctive first. */
  keywords: string[];
  /** Conversations in this topic. */
  volume: number;
  /** Member chat ids, ascending — the seam the route uses for share and trend. */
  docIds: string[];
}

export interface TopicClusterResult {
  /** False when fewer than `minConversations` clusterable docs were seen. */
  sufficient: boolean;
  /** Clusterable conversations seen (those carrying at least one token). */
  analyzed: number;
  /** Topics, most voluminous first. Empty while `sufficient` is false. */
  topics: TopicCluster[];
}

export interface ClusterTopicsOptions {
  /** Cosine floor for two conversations to share a topic. */
  similarityThreshold?: number;
  /** Fewest members a cluster needs to count as a topic. */
  minClusterSize?: number;
  /** Fewest clusterable conversations before any topic is reported. */
  minConversations?: number;
}

/**
 * Cosine floor for "same topic".
 *
 * Calibrated against the lexical embedding this module consumes: within a topic
 * (conversations sharing the topic's vocabulary) cosine sits around 0.38–0.62,
 * while unrelated topics that merely share a stray word ("order", "my") stay at
 * or below ~0.20. 0.3 falls in the empty band between the two, so a real overlap
 * clears it and incidental word-sharing does not. This is the same reasoning as
 * intent matching's `INTENT_THRESHOLD` and RAG's retrieval floor: below the line
 * is noise, and a wrong merge (two unrelated concerns filed as one topic) is the
 * mistake that makes the report untrustworthy.
 */
export const TOPIC_SIMILARITY_THRESHOLD = 0.3;

/**
 * A single stray conversation is not a topic. Requiring at least this many
 * members keeps one-off chats out of the report as their own headline — they
 * still count toward `analyzed`, they just do not get a row.
 */
export const TOPIC_MIN_CLUSTER_SIZE = 2;

/**
 * The "not enough conversations yet" floor. Mirrors the report route's own gate
 * so the two agree, and matches the contract's `min_conversations`: below it the
 * result is honestly empty rather than a pattern read into too little data.
 */
export const TOPIC_MIN_CONVERSATIONS = 20;

/** A token that is only digits — an order or card number, never a topic name. */
const PURE_NUMBER = /^\p{N}+$/u;

interface PreparedDoc {
  id: string;
  tokens: string[];
  vector: number[];
}

interface WorkingCluster {
  docIds: string[];
  /** Running vector sum; the centroid is its normalisation. */
  sum: number[];
  centroid: number[];
}

/**
 * Group conversations into topics.
 *
 * Greedy leader clustering: docs are taken in id order, each is compared to the
 * centroid of every open cluster, and it joins the nearest whose similarity
 * clears the threshold — or opens a new cluster when none does. A cluster's
 * centroid is the normalised mean of its members, updated as each one joins.
 * Ties (equal similarity to two clusters) go to the earlier cluster, which is
 * well-defined because clusters are created in id order.
 */
export function clusterTopics(
  docs: TopicDoc[],
  options: ClusterTopicsOptions = {},
): TopicClusterResult {
  const threshold = options.similarityThreshold ?? TOPIC_SIMILARITY_THRESHOLD;
  const minClusterSize = options.minClusterSize ?? TOPIC_MIN_CLUSTER_SIZE;
  const minConversations = options.minConversations ?? TOPIC_MIN_CONVERSATIONS;

  // Sort by id first, so the result never depends on the order the caller passed
  // the conversations in. Codepoint order, not locale — a locale-aware compare
  // would make the output depend on the machine's locale.
  const sorted = [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Keep only clusterable docs: an empty, whitespace-only or punctuation-only
  // text tokenises to nothing and embeds to a zero vector — it carries no topic,
  // so it is dropped here rather than allowed to sit at cosine 0 against
  // everything. This set also defines `analyzed`.
  const prepared: PreparedDoc[] = [];
  for (const doc of sorted) {
    const tokens = tokenize(doc.text);
    if (tokens.length === 0) continue;
    prepared.push({ id: doc.id, tokens, vector: embed(doc.text) });
  }

  const analyzed = prepared.length;

  // The honest floor: too few conversations to say anything, so say nothing.
  if (analyzed < minConversations) {
    return { sufficient: false, analyzed, topics: [] };
  }

  const clusters: WorkingCluster[] = [];
  for (const doc of prepared) {
    let target: WorkingCluster | null = null;
    let bestSim = -Infinity;
    for (const cluster of clusters) {
      const sim = similarity(doc.vector, cluster.centroid);
      // Strict `>` so an exact tie keeps the earlier (first-created) cluster.
      if (sim > bestSim) {
        bestSim = sim;
        target = cluster;
      }
    }

    if (target && bestSim >= threshold) {
      target.docIds.push(doc.id);
      addInto(target.sum, doc.vector);
      target.centroid = normalise(target.sum);
    } else {
      clusters.push({ docIds: [doc.id], sum: [...doc.vector], centroid: doc.vector });
    }
  }

  // Document frequency across the whole clusterable corpus, for the light tf-idf
  // that picks each cluster's distinguishing terms. Counted once per doc.
  const corpusDf = new Map<string, number>();
  for (const doc of prepared) {
    for (const token of new Set(doc.tokens)) {
      corpusDf.set(token, (corpusDf.get(token) ?? 0) + 1);
    }
  }

  const tokensById = new Map(prepared.map((doc) => [doc.id, doc.tokens]));

  const topics: TopicCluster[] = [];
  for (const cluster of clusters) {
    if (cluster.docIds.length < minClusterSize) continue;
    const keywords = deriveKeywords(cluster.docIds, tokensById, corpusDf, analyzed);
    // A cluster whose only terms were numbers has no honest name — dropping it
    // keeps a bare order/card number from ever surfacing as a topic.
    if (keywords.length === 0) continue;
    topics.push({
      id: '',
      label: keywords.join(' '),
      keywords,
      volume: cluster.docIds.length,
      docIds: cluster.docIds,
    });
  }

  // Most voluminous first; ties broken by label so the order is total and stable.
  topics.sort((a, b) => b.volume - a.volume || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  // Assign ids after ordering: a keyword slug, deduped in the now-fixed order so
  // two same-named topics still get distinct, stable ids within this response.
  const usedIds = new Set<string>();
  for (const topic of topics) {
    let id = topic.keywords.join('-');
    let suffix = 2;
    while (usedIds.has(id)) id = `${topic.keywords.join('-')}-${suffix++}`;
    usedIds.add(id);
    topic.id = id;
  }

  return { sufficient: true, analyzed, topics };
}

/**
 * The cluster's distinguishing terms: frequent inside it, rare across the corpus.
 *
 * A term common to every conversation ("order", when every chat mentions an
 * order) says nothing about what sets this topic apart, so it is weighted down by
 * inverse document frequency. Pure-number tokens are excluded outright — a label
 * is shown to a human and must never leak an order or card number. Ties are
 * broken alphabetically so the same corpus always names a topic the same way.
 */
function deriveKeywords(
  docIds: string[],
  tokensById: Map<string, string[]>,
  corpusDf: Map<string, number>,
  corpusSize: number,
): string[] {
  const termFreq = new Map<string, number>();
  for (const id of docIds) {
    for (const token of tokensById.get(id) ?? []) {
      if (PURE_NUMBER.test(token)) continue;
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }
  }

  const scored: Array<{ token: string; score: number }> = [];
  for (const [token, tf] of termFreq) {
    const df = corpusDf.get(token) ?? 1;
    // Natural-log idf: a term in every doc (df === corpusSize) scores 0 and drops
    // out; a term confined to this cluster scores highest.
    const idf = Math.log(corpusSize / df);
    scored.push({ token, score: tf * idf });
  }

  scored.sort((a, b) => b.score - a.score || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));

  // Keep only terms that actually distinguish (positive score); if every term is
  // ubiquitous (all idf 0), fall back to the alphabetically-first terms so a
  // real cluster is still named rather than left blank.
  const distinctive = scored.filter((entry) => entry.score > 0);
  const chosen = (distinctive.length > 0 ? distinctive : scored).slice(0, 3);
  return chosen.map((entry) => entry.token);
}

/** Add `v` into `sum` in place. */
function addInto(sum: number[], v: number[]): void {
  for (let i = 0; i < sum.length; i++) sum[i] = (sum[i] ?? 0) + (v[i] ?? 0);
}

/**
 * L2-normalise, rounded to six places to match `embedding.ts` — same rounding on
 * both sides keeps a centroid comparable to the doc vectors without float drift.
 */
function normalise(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}
