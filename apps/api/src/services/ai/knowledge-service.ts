/**
 * Knowledge indexing and retrieval (RAG).
 *
 * Chunks are embedded by the configured `EmbeddingProvider` — the lexical stub
 * unless a deployment names a model (tm 255.7) — and stored in pgvector.
 * Retrieval is a nearest-neighbour search restricted to the caller's license —
 * the `<=>` operator is cosine *distance*, so smaller is closer, which is the
 * opposite of the similarity score everything else here talks in.
 *
 * **Two phases, and the network is never inside a transaction.** Embedding is
 * a provider call that may take `EMBEDDING_TIMEOUT_MS`; a tenant transaction
 * may not take more than 10 s, and holding a pooled connection open on a
 * remote service is how one slow provider starves every other request. So the
 * provider is called first — {@link KnowledgeService.prepare} for a source's
 * text, {@link KnowledgeService.embedQuery} for a question — and only what it
 * returned is carried into the transaction that writes
 * ({@link KnowledgeService.index}) or searches ({@link KnowledgeService.search}).
 * The types make the order the only one that compiles: nothing inside a
 * transaction accepts text.
 *
 * **A question is compared only with chunks of its own space.** Every chunk
 * records the space its vector is in (`knowledge_chunks.embedding_space`); a
 * search is filtered to the space its question was embedded in. Two spaces'
 * vectors side by side are neighbours by accident — a lexical hash and a
 * model's coordinates share nothing but a length — so a knowledge base moving
 * from one to the other (`knowledge:reembed`, PLAN §D182) answers only from
 * the sources already moved, and a question the rest could have answered goes
 * to a human rather than to a passage that happened to be near in the wrong
 * space.
 */
import { Prisma } from '@prisma/client';
import { chunk, toVectorLiteral } from '@siyahtus/ai-mock';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import {
  embeddingEstimate,
  MeteredEmbeddings,
  type EmbeddingHold,
  type EmbeddingPayer,
} from './metered-embeddings.js';
import { EmbeddingProviderError } from './provider/embedding-error.js';
import type { EmbeddingProvider, EmbeddingUsage } from './provider/embedding-provider.js';

/**
 * A source's text, chunked and embedded — everything {@link KnowledgeService.index}
 * writes, produced before its transaction opens.
 */
export interface PreparedChunks {
  /** The space every vector below is in. */
  space: string;
  chunks: Array<{ text: string; vector: string; tokenCount: number }>;
  /** What the provider billed for them (tm 257.20) — 0 when nothing was asked. */
  usage: EmbeddingUsage;
}

/**
 * A question, embedded — what {@link KnowledgeService.search} compares chunks
 * with. `vector` is `null` for a question with nothing in it to search for.
 */
export interface QueryEmbedding {
  space: string;
  vector: string | null;
}

/**
 * A question as {@link KnowledgeService.embedQuery} returns it: the embedding,
 * and what the provider billed for it (tm 255.9) — the skill engine records
 * that on the run the question was asked in.
 */
export interface EmbeddedQuery extends QueryEmbedding {
  usage: EmbeddingUsage;
}

/**
 * For a request an admin is waiting on: `knowledge.prepare(text, tenant).catch(refuseUnembeddable)`.
 * An embedding failure becomes the 503 the contract documents
 * (`EmbeddingUnavailable`) — indexing fails and says so, having written
 * nothing — and anything else propagates as it is. That includes the daily AI
 * cap's refusal (tm 257.20): an `AiDailyCapError` is never an
 * `EmbeddingProviderError`, so it stays its own 429 rather than becoming a 503
 * that tells the admin to try again in a moment, when nothing will fit before
 * UTC midnight.
 */
export function refuseUnembeddable(error: unknown): never {
  if (!(error instanceof EmbeddingProviderError)) throw error;
  throw new ApiError(
    'service_unavailable',
    `This text could not be indexed: the embedding provider did not answer (${error.kind}). Nothing was saved — try again in a moment.`,
    { details: { kind: error.kind } },
  );
}

export interface RetrievedChunk {
  id: string;
  sourceId: string;
  sourceName: string;
  text: string;
  /** Cosine similarity in [0, 1]. Higher is closer. */
  score: number;
}

/**
 * Below this a "match" is noise. Answering a customer from an unrelated article
 * is worse than admitting there is no answer, so the engine treats a miss as a
 * reason to hand over rather than something to paper over.
 *
 * The default of the `RETRIEVAL_THRESHOLD` setting (tm 256.6), which is what
 * the server passes as {@link KnowledgeServiceOptions.retrievalThreshold}.
 */
export const RETRIEVAL_THRESHOLD = 0.25;

/**
 * How many passages an answer is drafted from: the copilot searches this many,
 * the skill engine this many or its persona's passage budget, whichever is
 * more. It is the k of the recall gate's recall@k (tm 255.8), so a change here
 * moves the gate with it — a passage ranked just past it is one no answer is
 * written from.
 */
export const ANSWER_RETRIEVAL_LIMIT = 2;

/**
 * The most chunks one question is searched against exactly.
 *
 * Exact search reads every vector in scope, and every vector is a 6 KB TOAST
 * read, so it costs time in proportion to the scope: p50 ~100 ms at 20,000
 * chunks and ~220 ms at 50,000 on a warm connection (PLAN §D173,
 * `measure:knowledge-retrieval`). A customer's message is answered inside their
 * own POST, whose NFR-P2 budget is p99 < 300 ms for the whole write — 87.9 ms of
 * it spent before retrieval existed (§D127). Past this many chunks the question
 * goes to the approximate index instead.
 */
export const EXACT_SEARCH_CEILING = 20_000;

/**
 * How the approximate search reads `idx_chunks_embedding_hnsw`. Each value was
 * chosen against exact search on real OpenAI embeddings and on the stub's, in a
 * 70,000-chunk table shared by two tenants (PLAN §D173); neither of the two
 * pgvector settings here is at its default, because both defaults measurably
 * lost answers.
 */
export const APPROXIMATE_SEARCH = {
  /**
   * Candidates kept per step through the graph. The default of 40 found the
   * stub's best passage for 56–70 % of questions; hashed bags of words sit in
   * near-orthogonal clusters that a narrow walk rarely finds its way between.
   */
  efSearch: 1000,
  /**
   * The index walks the whole table, every tenant's chunks, and the tenant and
   * agent filters drop what is not in scope. Without an iterative scan the walk
   * ends after `efSearch` candidates however few survived — every question came
   * back empty on a scope holding 1.4 % of the table. `strict_order` keeps the
   * walk going but drops a closer chunk found after a further one was returned;
   * `relaxed_order` returns it, and the rows are re-sorted here.
   */
  iterativeScan: 'relaxed_order',
  /** Rows read from the walk before the exact re-sort picks the `limit` best. */
  candidates: 20,
} as const;

/** How a search found its chunks. */
export type RetrievalStrategy = 'exact' | 'approximate' | 'approximate-then-exact';

export interface KnowledgeSearch {
  strategy: RetrievalStrategy;
  /** Ready chunks the question was scoped to, counted no further than one past the ceiling. */
  chunksInScope: number;
  chunks: RetrievedChunk[];
}

interface ChunkRow {
  id: string;
  source_id: string;
  source_name: string;
  chunk_text: string;
  distance: number;
}

/**
 * The approximate search's planner and index settings live inside this
 * savepoint, and rolling back to it is what takes them away again: `ROLLBACK TO
 * SAVEPOINT` cancels every `SET LOCAL` made after the savepoint, and the SELECT
 * in between wrote nothing to lose.
 */
const APPROXIMATE_SAVEPOINT = 'knowledge_approximate_search';

export interface KnowledgeServiceOptions {
  /**
   * Who embeds — the server's one provider, so every caller shares its circuit
   * breaker. Metered (tm 257.20) wherever the work is real: the server, the
   * scheduler and the CLIs pass a `MeteredEmbeddings` with the daily AI
   * budget. A bare provider is counted by nothing — a unit test's, or a
   * measurement over a throwaway fixture.
   */
  embeddings: EmbeddingProvider | MeteredEmbeddings;
  /**
   * Overrides {@link EXACT_SEARCH_CEILING}; tests lower it so a knowledge base
   * of a few thousand chunks crosses it.
   */
  exactSearchCeiling?: number;
  /**
   * Overrides {@link RETRIEVAL_THRESHOLD}. The server sets it from the
   * `RETRIEVAL_THRESHOLD` setting (tm 256.6), so a value measured in the real
   * embedding space needs a restart rather than a rebuild. The recall gate
   * raises and lowers it to prove it goes red when the threshold moves, and
   * `measure:knowledge-recall` sets it to -1 to read every score a question
   * has (tm 255.8 · PLAN §D183).
   */
  retrievalThreshold?: number;
}

export class KnowledgeService {
  readonly #embeddings: MeteredEmbeddings;
  readonly #exactSearchCeiling: number;
  readonly #threshold: number;

  constructor(options: KnowledgeServiceOptions) {
    const ceiling = options.exactSearchCeiling ?? EXACT_SEARCH_CEILING;
    if (!Number.isSafeInteger(ceiling) || ceiling < 0) {
      throw new RangeError(`exactSearchCeiling must be a non-negative integer, got ${ceiling}`);
    }
    const threshold = options.retrievalThreshold ?? RETRIEVAL_THRESHOLD;
    // A cosine similarity is in [-1, 1]; anything else would be a typo that
    // silently answers everything or nothing.
    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
      throw new RangeError(`retrievalThreshold must be a number in [-1, 1], got ${threshold}`);
    }
    this.#embeddings = MeteredEmbeddings.wrap(options.embeddings);
    this.#exactSearchCeiling = ceiling;
    this.#threshold = threshold;
  }

  /** The space this service embeds into — and therefore the one its questions search. */
  get space(): string {
    return this.#embeddings.space;
  }

  /** The similarity below which a chunk is not an answer — {@link RETRIEVAL_THRESHOLD} unless overridden. */
  get threshold(): number {
    return this.#threshold;
  }

  /**
   * What {@link prepare} would reserve for `content` against the daily AI cap
   * (tm 257.20): the UTF-8 bytes of its chunks, which overlap by a sentence
   * where a paragraph is cut. The bulk import adds these up before its first row.
   */
  estimate(content: string): number {
    return embeddingEstimate(chunk(content));
  }

  /**
   * Reserve `estimate` of `tenant`'s embedding allowance for several
   * {@link prepare} calls at once — the bulk import's file (tm 257.20). Throws
   * `AiDailyCapError` when it does not fit; settle the hold when done.
   */
  hold(tenant: TenantContext, estimate: number): Promise<EmbeddingHold> {
    return this.#embeddings.hold(tenant, estimate);
  }

  /**
   * Chunk a source's text and embed every chunk — in one call, so one request
   * for any realistic source. The provider call; never inside a transaction.
   *
   * Counted against `payer`'s daily AI allowance (tm 257.20) and refused with
   * `AiDailyCapError` when it does not fit — before the provider is asked.
   * Rejects with the provider's `EmbeddingProviderError` when it could not
   * embed, before anything has been written: indexing fails whole and says so.
   * Text that chunks to nothing asks the provider for nothing.
   */
  async prepare(content: string, payer?: EmbeddingPayer): Promise<PreparedChunks> {
    const pieces = chunk(content);
    if (pieces.length === 0) return { space: this.space, chunks: [], usage: { inputTokens: 0 } };
    const { vectors, usage } = await this.#embeddings.embed(pieces, payer);
    return {
      space: this.space,
      chunks: pieces.map((text, position) => ({
        text,
        vector: toVectorLiteral(vectors[position]!),
        tokenCount: text.split(/\s+/).length,
      })),
      usage,
    };
  }

  /**
   * Replace a source's chunks with prepared ones, inside the caller's
   * transaction.
   *
   * Replaces every chunk rather than diffing: sources are edited rarely and
   * wholesale, and a partial update leaves orphaned chunks that keep answering
   * from text the admin already deleted. Every row names the space its vector
   * is in — never left to the column's default, which describes the stub.
   */
  async index(
    tx: TenantClient,
    tenant: TenantContext,
    sourceId: string,
    prepared: PreparedChunks,
  ): Promise<number> {
    await tx.knowledgeChunk.deleteMany({ where: { sourceId } });

    for (const [position, piece] of prepared.chunks.entries()) {
      // Raw SQL because Prisma has no vector type; the parameters are still
      // bound, not interpolated.
      await tx.$executeRaw`
        INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding,
                                      embedding_space, token_count, position)
        VALUES (gen_random_uuid(), ${sourceId}::uuid, ${tenant.licenseId}, ${piece.text},
                ${piece.vector}::vector, ${prepared.space}, ${piece.tokenCount}, ${position})
      `;
    }

    await tx.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: prepared.chunks.length > 0 ? 'ready' : 'empty', updatedAt: new Date() },
    });

    return prepared.chunks.length;
  }

  /**
   * Embed a question — the provider call; never inside a transaction.
   *
   * A question with nothing but whitespace in it has nothing to search for:
   * the provider is not asked, and {@link search} answers it with no chunks —
   * what the stub's zero vector always amounted to. Rejects with the
   * provider's `EmbeddingProviderError` when it could not embed, and with
   * `AiDailyCapError` when `payer`'s daily AI allowance cannot take it
   * (tm 257.20).
   */
  async embedQuery(query: string, payer?: EmbeddingPayer): Promise<EmbeddedQuery> {
    if (query.trim() === '') return { space: this.space, vector: null, usage: { inputTokens: 0 } };
    const { vectors, usage } = await this.#embeddings.embed([query], payer);
    return { space: this.space, vector: toVectorLiteral(vectors[0]!), usage };
  }

  /** Nearest chunks to a question, best first. How they are found: {@link search}. */
  async retrieve(
    tx: TenantClient,
    tenant: TenantContext,
    query: QueryEmbedding,
    options: { aiAgentId?: string; limit?: number } = {},
  ): Promise<RetrievedChunk[]> {
    return (await this.search(tx, tenant, query, options)).chunks;
  }

  /**
   * Nearest chunks to a question, best first, and which search found them.
   *
   * Exact search up to {@link EXACT_SEARCH_CEILING} chunks in scope: every
   * vector read, nothing missed, the cost linear in the scope. Beyond it the
   * approximate index answers, and its misses are what the rest of this method
   * is shaped around — they are silent by nature, because "nothing above the
   * threshold" is also what an unanswerable question returns (GL-16's customer
   * was queued for a human while the answer sat in the knowledge base at 0.58).
   * So when the approximate search finds nothing above the threshold, the
   * question is searched again exactly. A question the knowledge base can
   * answer is therefore never handed over for the index's sake; what the index
   * can still cost is rank — a lower passage in place of the best one, measured
   * in PLAN §D173 for both kinds of embedding.
   *
   * The scope is counted first, and only up to one past the ceiling, so the
   * count stops reading as soon as the answer is "above".
   *
   * The scope is the question's own embedding space — see the file header. A
   * chunk in any other space is not in scope: not counted, not ranked, never
   * returned, however close its vector happens to be.
   */
  async search(
    tx: TenantClient,
    tenant: TenantContext,
    query: QueryEmbedding,
    options: { aiAgentId?: string; limit?: number } = {},
  ): Promise<KnowledgeSearch> {
    if (query.vector === null) return { strategy: 'exact', chunksInScope: 0, chunks: [] };
    const vector = query.vector;
    const limit = options.limit ?? 3;
    const scope = Prisma.sql`c.license_id = ${tenant.licenseId}
        AND c.embedding_space = ${query.space}
        AND s.status = 'ready'
        ${options.aiAgentId ? Prisma.sql`AND s.ai_agent_id = ${options.aiAgentId}::uuid` : Prisma.empty}`;

    const chunksInScope = await this.#countInScope(tx, scope);
    if (chunksInScope <= this.#exactSearchCeiling) {
      return {
        strategy: 'exact',
        chunksInScope,
        chunks: await this.#searchExactly(tx, scope, vector, limit),
      };
    }

    const approximate = await this.#searchApproximately(tx, scope, vector, limit);
    if (approximate.length > 0) {
      return { strategy: 'approximate', chunksInScope, chunks: approximate };
    }
    return {
      strategy: 'approximate-then-exact',
      chunksInScope,
      chunks: await this.#searchExactly(tx, scope, vector, limit),
    };
  }

  async #countInScope(tx: TenantClient, scope: Prisma.Sql): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ chunks: number }>>`
      SELECT count(*)::int AS chunks
      FROM (
        SELECT 1
        FROM knowledge_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id
        WHERE ${scope}
        LIMIT ${this.#exactSearchCeiling + 1}
      ) in_scope
    `;
    return rows[0]?.chunks ?? 0;
  }

  /**
   * Every chunk in scope, ranked — by exact search, whatever plan Postgres picks.
   *
   * An index can only serve an ORDER BY that is a bare distance operator, so the
   * `+ 0` keeps every plan exact (tm 252: on the IVFFlat index this replaced,
   * 17–22 of 24 questions per fresh database were answered wrongly or not at
   * all). It sits in the select list, not in the ORDER BY, so the distance — and
   * the TOAST read of each vector — happens once per row. And it stays
   * ascending: a chunk with no searchable word embeds to zero, its cosine
   * distance is NaN, and Postgres sorts NaN above every number, so a descending
   * similarity would hand those rows the LIMIT ahead of a real match.
   *
   * The question's vector is a scalar subquery, not a bare parameter, and that
   * is worth 5–15× on a warm connection. Prisma prepares each statement and
   * binds the literal as `text`; after five executions Postgres may switch the
   * statement to a generic plan, and in a generic plan `$1::vector` is not
   * folded into a constant — it is re-parsed for every row the search reads.
   * Measured on one connection, 20,000 chunks in scope: 81–83 ms for the first
   * five calls, 457–472 ms from the sixth on; with a full-precision 1536-d
   * literal, the size a real provider returns, 127–133 ms became ~2 s. As an
   * InitPlan the literal is parsed once per execution on every plan, generic or
   * not (PLAN §D173).
   */
  async #searchExactly(
    tx: TenantClient,
    scope: Prisma.Sql,
    vector: string,
    limit: number,
  ): Promise<RetrievedChunk[]> {
    const rows = await tx.$queryRaw<ChunkRow[]>`
      SELECT c.id, c.source_id, s.name AS source_name, c.chunk_text,
             (c.embedding <=> (SELECT ${vector}::vector)) + 0 AS distance
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      WHERE ${scope}
      ORDER BY distance
      LIMIT ${limit}
    `;
    return toRetrievedChunks(rows, limit, this.#threshold);
  }

  /**
   * The nearest chunks the HNSW index finds, re-ranked by their exact distance.
   *
   * The plan is pinned on the index. Left alone, the planner costs each
   * distance as one cheap operator call — it cannot see that behind every
   * vector is a 6 KB TOAST read — so a full scan looks nearly as cheap as the
   * index, and it mostly wins: unpinned, this statement read the whole scope
   * for 40 questions out of 40 at 4,000 and at 20,000 chunks, and at 50,000 an
   * EXPLAIN chose the index while the prepared statement actually executed
   * still scanned (p50 209 ms; 40 ms pinned). Pricing out the explicit sort
   * leaves the index as the only ordered plan; JIT goes with it, because that
   * price lifts every plan past `jit_above_cost` and compiling each query costs
   * ~100 ms without changing its answer. The pin is only consistent because
   * this one statement always runs under it: Postgres caches a statement's
   * generic plan without remembering the settings it was planned under (tm 252).
   *
   * All four settings are made inside a savepoint and removed by rolling back to
   * it, on success and on error alike, so nothing leaks into the rest of the
   * caller's transaction — which may go on to plan statements of its own.
   */
  async #searchApproximately(
    tx: TenantClient,
    scope: Prisma.Sql,
    vector: string,
    limit: number,
  ): Promise<RetrievedChunk[]> {
    await tx.$executeRawUnsafe(`SAVEPOINT ${APPROXIMATE_SAVEPOINT}`);
    let rows: ChunkRow[];
    try {
      await tx.$executeRaw`
        SELECT set_config('enable_sort', 'off', true),
               set_config('jit', 'off', true),
               set_config('hnsw.ef_search', ${String(APPROXIMATE_SEARCH.efSearch)}, true),
               set_config('hnsw.iterative_scan', ${APPROXIMATE_SEARCH.iterativeScan}, true)
      `;
      rows = await tx.$queryRaw<ChunkRow[]>`
        SELECT c.id, c.source_id, s.name AS source_name, c.chunk_text,
               c.embedding <=> (SELECT ${vector}::vector) AS distance
        FROM knowledge_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id
        WHERE ${scope}
        ORDER BY distance
        LIMIT ${Math.max(limit, APPROXIMATE_SEARCH.candidates)}
      `;
    } finally {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${APPROXIMATE_SAVEPOINT}`);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${APPROXIMATE_SAVEPOINT}`);
    }
    // `relaxed_order` returns rows only roughly by distance.
    return toRetrievedChunks([...rows].sort(byDistance), limit, this.#threshold);
  }
}

/** Ascending, NaN last — the order exact search's ORDER BY gives. */
function byDistance(left: ChunkRow, right: ChunkRow): number {
  const a = Number(left.distance);
  const b = Number(right.distance);
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
  if (Number.isNaN(b)) return -1;
  return a - b;
}

function toRetrievedChunks(rows: ChunkRow[], limit: number, threshold: number): RetrievedChunk[] {
  return (
    rows
      .slice(0, limit)
      // `<=>` is distance; the rest of the system reasons in similarity.
      .map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        sourceName: row.source_name,
        text: row.chunk_text,
        score: Number((1 - Number(row.distance)).toFixed(4)),
      }))
      .filter((row) => row.score >= threshold)
  );
}
