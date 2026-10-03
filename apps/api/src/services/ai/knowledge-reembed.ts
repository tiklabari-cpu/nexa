/**
 * Moving a stored knowledge base into the configured embedding space (tm 255.7 ·
 * PLAN §D182 · ADR docs/adr/pilot-llm-embedding-provider.md §4.3).
 *
 * Every chunk records the space its vector is in, and a question only searches
 * its own space (`knowledge-service.ts`). So when `EMBEDDING_PROVIDER` changes —
 * the stub's lexical space to a model's, or back — the chunks already stored
 * stop being searchable until they are embedded again. This is the procedure
 * that does it, and it is shaped by four promises:
 *
 * 1. **Atomic per source.** A source's pending chunks are embedded in one
 *    provider call (outside any transaction), then written in one transaction:
 *    every chunk moves to the new space or none does. A source is never half
 *    in one space and half in the other, so a question is never answered from
 *    half a source.
 * 2. **Resumable from the database, not from a checkpoint.** What is left is
 *    whatever is still outside the target space. An interrupted run — killed,
 *    out of quota, `--limit` reached — is resumed by running it again, and it
 *    starts where the data says, with nothing to lose or corrupt in between.
 * 3. **Retrieval keeps working.** Nothing is deleted or rebuilt; each source
 *    flips in one short transaction of `UPDATE`s. A search during the run sees
 *    every source either before or after it moved, and finds what is in its
 *    own space. The cost is coverage, not correctness: until a source moves,
 *    a question in the new space cannot find it, and goes to a human instead.
 * 4. **Reversible.** It moves chunks into whatever space the configured provider
 *    writes; run it with `EMBEDDING_PROVIDER=mock` and the knowledge base goes
 *    back to the lexical space — deterministically the same vectors it had.
 *
 * The text is never re-chunked: the chunk rows are what is indexed, and
 * re-embedding means new vectors for the same passages, not new passages (a
 * source's stored `content` is not always what its chunks hold — the seed's
 * are not). A source edited while it is being re-embedded wins: its new chunks
 * have new ids, the write sees that the rows it embedded are gone, and leaves
 * the edit's chunks alone — the next run picks them up if they need it.
 *
 * Residency is asked per workspace before anything is embedded, because no
 * request carries this work (NFR-C4): a covered workspace whose content the
 * provider would take out of its region is left untouched and reported.
 *
 * **Counted on the deployment's daily AI cap alone (tm 257.20).** This is an
 * operator's migration, not something any workspace asked for, so it spends no
 * workspace's allowance — a re-embed on the morning a provider is switched
 * would otherwise switch every workspace's AI off for the day. It does spend
 * the deployment's key, so each source reserves on the deployment's row
 * (`MeteredEmbeddings.embedForDeployment`). When that is full the run stops
 * asking the provider: every source not yet moved is reported `failed` with
 * `kind: 'ai_daily_cap'`, left exactly where it was, and the next run —
 * after 00:00 UTC — picks it up (promise 2).
 */
import type { PrismaClient } from '@prisma/client';
import { toVectorLiteral } from '@siyahtus/ai-mock';
import { type TenantClient, type TenantContext, withTenant } from '../../lib/tenant.js';
import { inferenceAllowed, readInferenceResidency, type InferenceProvider } from './inference.js';
import { AiDailyCapError } from './ai-daily-budget.js';
import { MeteredEmbeddings } from './metered-embeddings.js';
import { EmbeddingProviderError, type EmbeddingFailureKind } from './provider/embedding-error.js';
import type { EmbeddingProvider } from './provider/embedding-provider.js';

export interface KnowledgeReembedderOptions {
  /**
   * The provider to embed with — its `space` is where the chunks go. The CLI
   * passes it metered with the daily AI budget (tm 257.20); a bare provider is
   * counted by nothing.
   */
  embeddings: EmbeddingProvider | MeteredEmbeddings;
  /** Where that provider runs (`resolveEmbeddingInferenceProvider`). */
  embeddingInference: InferenceProvider;
}

/** How one source came out of a run. */
export type ReembedOutcome = 'reembedded' | 'changed' | 'failed';

export interface ReembedSourceEvent {
  licenseId: string;
  sourceId: string;
  outcome: ReembedOutcome;
  /** Chunks moved into the target space — 0 unless `reembedded`. */
  chunks: number;
  /**
   * Why the source was not moved, when the outcome is `failed`: the provider's
   * failure, or `ai_daily_cap` when the deployment's daily AI cap stopped the
   * run before it (tm 257.20).
   */
  kind?: EmbeddingFailureKind | 'ai_daily_cap';
}

export interface ReembedRunOptions {
  /** Stop after this many sources — how an operator runs a slice, and how a test interrupts a run. */
  limit?: number;
  /** Called after each source has been handled; the run waits for it. */
  onSource?: (event: ReembedSourceEvent) => Promise<void> | void;
}

export interface TenantReembedResult {
  licenseId: string;
  organizationId: string;
  /** Sources found with at least one chunk outside the target space. */
  pending: number;
  reembedded: number;
  chunks: number;
  changed: number;
  failed: number;
  /** True when residency refused the whole workspace; none of its chunks was touched. */
  refused: boolean;
}

export interface ReembedReport {
  target: string;
  startedAt: string;
  finishedAt: string;
  /** False when `limit` stopped the run with sources still pending. */
  finished: boolean;
  /**
   * True when the deployment's daily AI cap refused a source (tm 257.20): from
   * then on the provider was not asked, and every source still pending is in
   * `failed` for the next run.
   */
  capped: boolean;
  tenants: TenantReembedResult[];
  totals: {
    tenants: number;
    pending: number;
    reembedded: number;
    chunks: number;
    changed: number;
    failed: number;
    refused: number;
  };
}

/** The mixed state, measured — `knowledge:reembed --status`. */
export interface EmbeddingSpaceStatus {
  target: string;
  tenants: Array<{
    licenseId: string;
    organizationId: string;
    spaces: Array<{ space: string; sources: number; chunks: number }>;
    /** Sources whose chunks are in more than one space — the state atomicity rules out. */
    mixedSources: number;
  }>;
  totals: {
    /** Per space, across every workspace. */
    spaces: Array<{ space: string; sources: number; chunks: number }>;
    /** Chunks a question in the target space cannot find until they are re-embedded. */
    pendingChunks: number;
    pendingSources: number;
    mixedSources: number;
  };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

interface ChunkRow {
  id: string;
  chunk_text: string;
}

export class KnowledgeReembedder {
  readonly #db: PrismaClient;
  readonly #embeddings: MeteredEmbeddings;
  readonly #inference: InferenceProvider;

  constructor(db: PrismaClient, options: KnowledgeReembedderOptions) {
    this.#db = db;
    this.#embeddings = MeteredEmbeddings.wrap(options.embeddings);
    this.#inference = options.embeddingInference;
  }

  /** The space this run moves chunks into. */
  get target(): string {
    return this.#embeddings.space;
  }

  async status(): Promise<EmbeddingSpaceStatus> {
    const target = this.target;
    const tenants: EmbeddingSpaceStatus['tenants'] = [];
    let pendingSources = 0;
    for (const tenant of await this.#listTenants()) {
      const context = contextOf(tenant);
      const measured = await withTenant(this.#db, context, async (tx) => {
        // Per source first: how many spaces its chunks are in, and whether any
        // of them is still outside the target.
        const sources = await tx.$queryRaw<Array<{ spaces: number; pending: boolean }>>`
          SELECT count(DISTINCT embedding_space)::int AS spaces,
                 bool_or(embedding_space <> ${target}) AS pending
          FROM knowledge_chunks
          WHERE license_id = ${context.licenseId}
          GROUP BY source_id`;
        const spaces = await tx.$queryRaw<
          Array<{ space: string; sources: number; chunks: number }>
        >`
          SELECT embedding_space AS space,
                 count(DISTINCT source_id)::int AS sources,
                 count(*)::int AS chunks
          FROM knowledge_chunks
          WHERE license_id = ${context.licenseId}
          GROUP BY embedding_space
          ORDER BY embedding_space`;
        return { sources, spaces };
      });
      if (measured.spaces.length === 0) continue;
      pendingSources += measured.sources.filter((source) => source.pending).length;
      tenants.push({
        licenseId: context.licenseId.toString(),
        organizationId: context.organizationId,
        spaces: measured.spaces,
        mixedSources: measured.sources.filter((source) => source.spaces > 1).length,
      });
    }

    const bySpace = new Map<string, { sources: number; chunks: number }>();
    for (const tenant of tenants) {
      for (const row of tenant.spaces) {
        const sum = bySpace.get(row.space) ?? { sources: 0, chunks: 0 };
        bySpace.set(row.space, {
          sources: sum.sources + row.sources,
          chunks: sum.chunks + row.chunks,
        });
      }
    }
    const spaces = [...bySpace.entries()]
      .map(([space, counts]) => ({ space, ...counts }))
      .sort((a, b) => (a.space < b.space ? -1 : a.space > b.space ? 1 : 0));
    return {
      target,
      tenants,
      totals: {
        spaces,
        pendingChunks: spaces
          .filter((row) => row.space !== target)
          .reduce((sum, row) => sum + row.chunks, 0),
        pendingSources,
        mixedSources: tenants.reduce((sum, tenant) => sum + tenant.mixedSources, 0),
      },
    };
  }

  async run(options: ReembedRunOptions = {}): Promise<ReembedReport> {
    const startedAt = new Date().toISOString();
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    let handled = 0;
    let finished = true;
    // Once the deployment's cap refuses a source nothing more fits today.
    const pass = { capped: false };

    const tenants: TenantReembedResult[] = [];
    for (const tenant of await this.#listTenants()) {
      const context = contextOf(tenant);
      const pending = await withTenant(
        this.#db,
        context,
        (tx) =>
          tx.$queryRaw<Array<{ source_id: string }>>`
          SELECT DISTINCT source_id FROM knowledge_chunks
          WHERE license_id = ${context.licenseId} AND embedding_space <> ${this.target}
          ORDER BY source_id`,
      );
      if (pending.length === 0) continue;

      const result: TenantReembedResult = {
        licenseId: context.licenseId.toString(),
        organizationId: context.organizationId,
        pending: pending.length,
        reembedded: 0,
        chunks: 0,
        changed: 0,
        failed: 0,
        refused: false,
      };
      tenants.push(result);

      if (!(await this.#residencyAllows(context))) {
        result.refused = true;
        continue;
      }

      for (const { source_id: sourceId } of pending) {
        if (handled >= limit) {
          finished = false;
          break;
        }
        handled += 1;
        const event = await this.#reembedSource(context, sourceId, pass);
        if (event.outcome === 'reembedded') {
          result.reembedded += 1;
          result.chunks += event.chunks;
        } else if (event.outcome === 'changed') {
          result.changed += 1;
        } else {
          result.failed += 1;
        }
        await options.onSource?.(event);
      }
      if (!finished) break;
    }

    return {
      target: this.target,
      startedAt,
      finishedAt: new Date().toISOString(),
      finished,
      capped: pass.capped,
      tenants,
      totals: {
        tenants: tenants.length,
        pending: tenants.reduce((sum, t) => sum + t.pending, 0),
        reembedded: tenants.reduce((sum, t) => sum + t.reembedded, 0),
        chunks: tenants.reduce((sum, t) => sum + t.chunks, 0),
        changed: tenants.reduce((sum, t) => sum + t.changed, 0),
        failed: tenants.reduce((sum, t) => sum + t.failed, 0),
        refused: tenants.filter((t) => t.refused).length,
      },
    };
  }

  /**
   * One source: read what is pending, embed it with no transaction open, then
   * move it in one transaction — or not at all, if the source changed meanwhile.
   */
  async #reembedSource(
    context: TenantContext,
    sourceId: string,
    pass: { capped: boolean },
  ): Promise<ReembedSourceEvent> {
    const target = this.target;
    const licenseId = context.licenseId.toString();
    if (pass.capped) {
      return { licenseId, sourceId, outcome: 'failed', chunks: 0, kind: 'ai_daily_cap' };
    }
    const pending = (tx: TenantClient, lock: boolean) =>
      lock
        ? tx.$queryRaw<ChunkRow[]>`
            SELECT id, chunk_text FROM knowledge_chunks
            WHERE source_id = ${sourceId}::uuid AND embedding_space <> ${target}
            ORDER BY position, id
            FOR UPDATE`
        : tx.$queryRaw<ChunkRow[]>`
            SELECT id, chunk_text FROM knowledge_chunks
            WHERE source_id = ${sourceId}::uuid AND embedding_space <> ${target}
            ORDER BY position, id`;

    const read = await withTenant(this.#db, context, (tx) => pending(tx, false));
    if (read.length === 0) return { licenseId, sourceId, outcome: 'changed', chunks: 0 };

    let vectors: number[][];
    try {
      ({ vectors } = await this.#embeddings.embedForDeployment(read.map((row) => row.chunk_text)));
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        // Nothing was asked and nothing written; this and every later source
        // wait for the next run (see the file header).
        pass.capped = true;
        return { licenseId, sourceId, outcome: 'failed', chunks: 0, kind: 'ai_daily_cap' };
      }
      if (!(error instanceof EmbeddingProviderError)) throw error;
      // Nothing was written: the source is still wholly where it was, and the
      // next run tries it again.
      return { licenseId, sourceId, outcome: 'failed', chunks: 0, kind: error.kind };
    }

    const moved = await withTenant(this.#db, context, async (tx) => {
      // Locked, then compared: if an edit or a reindex replaced the source's
      // chunks after they were read, these are not the passages that were
      // embedded, and writing the vectors onto them would be wrong.
      const current = await pending(tx, true);
      const same =
        current.length === read.length &&
        current.every((row, i) => row.id === read[i]!.id && row.chunk_text === read[i]!.chunk_text);
      if (!same) return false;
      for (const [i, row] of read.entries()) {
        await tx.$executeRaw`
          UPDATE knowledge_chunks
          SET embedding = ${toVectorLiteral(vectors[i]!)}::vector, embedding_space = ${target}
          WHERE id = ${row.id}::uuid`;
      }
      return true;
    });

    return moved
      ? { licenseId, sourceId, outcome: 'reembedded', chunks: read.length }
      : { licenseId, sourceId, outcome: 'changed', chunks: 0 };
  }

  async #residencyAllows(context: TenantContext): Promise<boolean> {
    return withTenant(this.#db, context, async (tx) => {
      const residency = await readInferenceResidency(tx, context);
      return (
        residency !== null &&
        inferenceAllowed({
          provider: this.#inference,
          workspaceRegion: residency.region,
          hipaaScope: residency.hipaaScope,
        })
      );
    });
  }

  /** The shared SECURITY DEFINER enumerator the sweeps use — two ids per workspace, nothing else. */
  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }
}

function contextOf(tenant: TenantRow): TenantContext {
  return { licenseId: tenant.license_id, organizationId: tenant.organization_id };
}
