/**
 * A procedure's example sentences, embedded — what the understanding call's
 * catalogue is narrowed by (tm 297.3 · SiyahTuş analysis AI-05 §2 ·
 * `ai_procedure_examples`, 20261018180000). Which procedures the turn then
 * offers is `conversation/prefilter.ts`'s; this file writes the rows and
 * finds, for a message, how near each procedure's nearest example lies.
 *
 * **Written after a save, never inside it.** Embedding is a provider call and
 * the network is never inside a tenant transaction (`knowledge-service.ts`):
 * the save transaction clears a skill's rows ({@link ProcedureExamples.clear}),
 * then {@link embedProcedureExamples} and {@link ProcedureExamples.write} run
 * after it commits. A provider that fails leaves the skill with no rows, and a
 * procedure with no rows in the turn's space is one the narrowing cannot judge
 * — it always stays in the catalogue. So every failure here widens the
 * catalogue back towards whole; none drops a procedure.
 *
 * **A message is compared only with examples of its own space**, as a question
 * is with chunks (PLAN §D182).
 *
 * **Exact below a ceiling, the hnsw index above it** — the knowledge search's
 * shape, smaller. An agent past 15 procedures holds a few hundred examples, at
 * most 30 each (`PROCEDURE_EXAMPLES_MAX`): read exactly, that is a few
 * milliseconds. Above {@link EXAMPLES_EXACT_SEARCH_CEILING} in scope the index
 * walks the nearest {@link EXAMPLE_CANDIDATES} sentences under the knowledge
 * search's pinned settings, and when that walk finds fewer procedures than it
 * should, the exact search runs after all — a procedure the index missed would
 * be one the player could not reach.
 */
import { Prisma } from '@prisma/client';
import { PROCEDURE_EXAMPLES_MAX } from '@siyahtus/types';
import type { FastifyRequest } from 'fastify';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { AiDailyCapError } from './ai-daily-budget.js';
import {
  APPROXIMATE_SEARCH,
  type KnowledgeService,
  type QueryEmbedding,
} from './knowledge-service.js';
import type { EmbeddingPayer } from './metered-embeddings.js';
import { EmbeddingProviderError } from './provider/embedding-error.js';
import type { EmbeddingUsage } from './provider/embedding-provider.js';

/** How many procedures the narrowing keeps by nearness (AI-05 §2). */
export const PREFILTER_KEEP = 10;

/** Example rows in scope past which the hnsw index answers instead of an exact read. */
export const EXAMPLES_EXACT_SEARCH_CEILING = 5_000;

/**
 * Sentences read from the index walk: enough that {@link PREFILTER_KEEP}
 * procedures are among them even if each of the nearest has every one of its
 * examples nearer than the next procedure's best.
 */
export const EXAMPLE_CANDIDATES = PREFILTER_KEEP * PROCEDURE_EXAMPLES_MAX;

/** A skill's examples, embedded — what {@link ProcedureExamples.write} stores. */
export interface PreparedExamples {
  space: string;
  sentences: Array<{ text: string; vector: string }>;
  usage: EmbeddingUsage;
}

/** One procedure and how near its nearest example lies to the message. */
export interface RankedSkill {
  skillId: string;
  /** Cosine similarity of the nearest example; NaN when the message embeds to nothing. */
  similarity: number;
}

export type ExampleSearchStrategy = 'exact' | 'approximate' | 'approximate-then-exact';

export interface ExampleRanking {
  strategy: ExampleSearchStrategy;
  /** Example rows in scope, counted no further than one past the ceiling. */
  examplesInScope: number;
  /** Nearest first; only procedures that have examples in the message's space. */
  ranked: RankedSkill[];
}

/**
 * Embed a procedure's examples — the provider call, outside any transaction.
 * Rejects as `KnowledgeService.embedSentences` does.
 */
export function embedProcedureExamples(
  knowledge: KnowledgeService,
  examples: readonly string[],
  payer: EmbeddingPayer,
): Promise<PreparedExamples> {
  return knowledge.embedSentences(examples, payer);
}

/**
 * After a procedure skill's save commits (tm 297.3 · AI-05 §2): its example
 * sentences embedded — outside any transaction — and stored for the
 * catalogue narrowing. A provider failure or today's cap leaves the skill
 * without rows, which the narrowing reads as "always offer it"; the save
 * stands and the log says so. Stored only if the skill still holds these
 * examples, so a slower write never replaces a newer save's. The one door for
 * every write of a skill's examples (the editor's save, tm 317.3's "add
 * examples"); `examples` clears the rows inside the write that changes them.
 */
export async function storeProcedureExamples(
  request: FastifyRequest,
  knowledge: KnowledgeService,
  examples: ProcedureExamples,
  skill: { id: string; mode: string; examples: string[] },
): Promise<void> {
  if (skill.mode !== 'procedure' || skill.examples.length === 0) return;
  const tenant = request.tenant();
  let prepared;
  try {
    prepared = await embedProcedureExamples(knowledge, skill.examples, tenant);
  } catch (error) {
    if (!(error instanceof EmbeddingProviderError) && !(error instanceof AiDailyCapError)) {
      throw error;
    }
    request.log.warn(
      {
        skill_id: skill.id,
        kind: error instanceof EmbeddingProviderError ? error.kind : 'ai_cap_reached',
      },
      'procedure examples not embedded; the skill is never narrowed away until its next save',
    );
    return;
  }
  await request.withTenant(async (tx) => {
    const current = await tx.skill.findFirst({
      where: { id: skill.id },
      select: { mode: true, examples: true },
    });
    if (
      current?.mode !== 'procedure' ||
      current.examples.length !== skill.examples.length ||
      current.examples.some((example, index) => example !== skill.examples[index])
    ) {
      return;
    }
    await examples.write(tx, tenant, skill.id, prepared);
  });
}

interface ExampleRow {
  skill_id: string;
  distance: number;
}

/** The approximate walk's settings live inside this savepoint (`knowledge-service.ts`). */
const APPROXIMATE_SAVEPOINT = 'procedure_examples_approximate_search';

export class ProcedureExamples {
  readonly #exactSearchCeiling: number;

  constructor(options: { exactSearchCeiling?: number } = {}) {
    const ceiling = options.exactSearchCeiling ?? EXAMPLES_EXACT_SEARCH_CEILING;
    if (!Number.isSafeInteger(ceiling) || ceiling < 0) {
      throw new RangeError(`exactSearchCeiling must be a non-negative integer, got ${ceiling}`);
    }
    this.#exactSearchCeiling = ceiling;
  }

  /** Remove a skill's rows, inside the caller's transaction — the save's. */
  async clear(tx: TenantClient, skillId: string): Promise<void> {
    await tx.aiProcedureExample.deleteMany({ where: { skillId } });
  }

  /**
   * Replace a skill's rows with prepared ones, inside the caller's
   * transaction. Every row names the space its vector is in. Returns how
   * many were written.
   */
  async write(
    tx: TenantClient,
    tenant: TenantContext,
    skillId: string,
    prepared: PreparedExamples,
  ): Promise<number> {
    await this.clear(tx, skillId);
    for (const sentence of prepared.sentences) {
      // Raw SQL because Prisma has no vector type; the parameters are bound.
      await tx.$executeRaw`
        INSERT INTO ai_procedure_examples (id, license_id, skill_id, text, embedding, embedding_space)
        VALUES (gen_random_uuid(), ${tenant.licenseId}, ${skillId}::uuid, ${sentence.text},
                ${sentence.vector}::vector, ${prepared.space})
      `;
    }
    return prepared.sentences.length;
  }

  /**
   * The procedures among `skillIds` that have examples in the message's
   * space, each with its nearest example's similarity, nearest first. The
   * exact search ranks every one of them; the approximate one those it walks
   * past, which is at least {@link PREFILTER_KEEP} or it falls back.
   */
  async rank(
    tx: TenantClient,
    tenant: TenantContext,
    query: QueryEmbedding,
    skillIds: readonly string[],
  ): Promise<ExampleRanking> {
    if (query.vector === null || skillIds.length === 0) {
      return { strategy: 'exact', examplesInScope: 0, ranked: [] };
    }
    const vector = query.vector;
    const scope = Prisma.sql`e.license_id = ${tenant.licenseId}
        AND e.embedding_space = ${query.space}
        AND e.skill_id = ANY(${[...skillIds]}::uuid[])`;

    const examplesInScope = await this.#countInScope(tx, scope);
    if (examplesInScope <= this.#exactSearchCeiling) {
      return {
        strategy: 'exact',
        examplesInScope,
        ranked: await this.#rankExactly(tx, scope, vector),
      };
    }
    const ranked = await this.#rankApproximately(tx, scope, vector);
    const ranking = { examplesInScope, ranked };
    if (ranked.length >= Math.min(PREFILTER_KEEP, skillIds.length)) {
      return { strategy: 'approximate', ...ranking };
    }
    return {
      strategy: 'approximate-then-exact',
      examplesInScope,
      ranked: await this.#rankExactly(tx, scope, vector),
    };
  }

  async #countInScope(tx: TenantClient, scope: Prisma.Sql): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ examples: number }>>`
      SELECT count(*)::int AS examples
      FROM (
        SELECT 1 FROM ai_procedure_examples e
        WHERE ${scope}
        LIMIT ${this.#exactSearchCeiling + 1}
      ) in_scope
    `;
    return rows[0]?.examples ?? 0;
  }

  /**
   * Every procedure in scope by its nearest example — exact whatever the plan:
   * the `+ 0` keeps the index out, and the vector is a scalar subquery so a
   * generic plan parses it once (`KnowledgeService.#searchExactly`).
   */
  async #rankExactly(tx: TenantClient, scope: Prisma.Sql, vector: string): Promise<RankedSkill[]> {
    const rows = await tx.$queryRaw<ExampleRow[]>`
      SELECT e.skill_id::text AS skill_id,
             min((e.embedding <=> (SELECT ${vector}::vector)) + 0) AS distance
      FROM ai_procedure_examples e
      WHERE ${scope}
      GROUP BY e.skill_id
    `;
    return byNearest(rows);
  }

  /**
   * The nearest sentences the hnsw index walks to, as procedures. The plan is
   * pinned on the index and the walk widened, inside a savepoint whose
   * rollback takes every setting away again — `KnowledgeService.#searchApproximately`
   * explains each of the four.
   */
  async #rankApproximately(
    tx: TenantClient,
    scope: Prisma.Sql,
    vector: string,
  ): Promise<RankedSkill[]> {
    await tx.$executeRawUnsafe(`SAVEPOINT ${APPROXIMATE_SAVEPOINT}`);
    let rows: ExampleRow[];
    try {
      await tx.$executeRaw`
        SELECT set_config('enable_sort', 'off', true),
               set_config('jit', 'off', true),
               set_config('hnsw.ef_search', ${String(APPROXIMATE_SEARCH.efSearch)}, true),
               set_config('hnsw.iterative_scan', ${APPROXIMATE_SEARCH.iterativeScan}, true)
      `;
      rows = await tx.$queryRaw<ExampleRow[]>`
        SELECT e.skill_id::text AS skill_id,
               e.embedding <=> (SELECT ${vector}::vector) AS distance
        FROM ai_procedure_examples e
        WHERE ${scope}
        ORDER BY distance
        LIMIT ${EXAMPLE_CANDIDATES}
      `;
    } finally {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${APPROXIMATE_SAVEPOINT}`);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${APPROXIMATE_SAVEPOINT}`);
    }
    // Each procedure by its nearest sentence the walk returned.
    const nearest = new Map<string, number>();
    for (const row of rows) {
      const distance = Number(row.distance);
      const seen = nearest.get(row.skill_id);
      if (seen === undefined || distance < seen || Number.isNaN(seen)) {
        nearest.set(row.skill_id, distance);
      }
    }
    return byNearest([...nearest].map(([skill_id, distance]) => ({ skill_id, distance })));
  }
}

/** Similarity, nearest first; NaN (a message with no words) last, then by id for a stable order. */
function byNearest(rows: readonly ExampleRow[]): RankedSkill[] {
  return rows
    .map((row) => ({ skillId: row.skill_id, similarity: 1 - Number(row.distance) }))
    .sort((a, b) => {
      const left = Number.isNaN(a.similarity) ? -Infinity : a.similarity;
      const right = Number.isNaN(b.similarity) ? -Infinity : b.similarity;
      return right - left || a.skillId.localeCompare(b.skillId);
    });
}
