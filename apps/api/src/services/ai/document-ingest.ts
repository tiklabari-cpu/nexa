/**
 * The `document` knowledge job (tm 313.3 · SiyahTuş analysis AI-18): reads a
 * PDF or Word source's original and writes what it says as chunks, the third
 * half of the document source after its upload (tm 313.1) and its isolated
 * reader (tm 313.2, `document-parse/`).
 *
 *   1. **The original** is read back from the object store — the bytes the
 *      upload stored and the source's sha256 names, not anything the request
 *      said — and handed to {@link parseDocumentInWorker}, which reads it in a
 *      process of its own. This class never opens a document.
 *   2. **A refusal** (`encrypted`, `no_text_layer`, `too_many_pages`,
 *      `parse_timeout`, …) ends the job `failed` with the code as its `error`
 *      and the source `failed` with the same code in `last_refresh_error` — the
 *      panel has a sentence for each. Nothing is written to the knowledge base;
 *      a source that already had chunks (a re-read) keeps them and says
 *      `partial`.
 *   3. **A read document** is cut into ~600-character chunks that never cross a
 *      heading ({@link chunkDocument}), each with the pages it came from and the
 *      heading it sits under, and embedded in batches against one hold of the
 *      workspace's daily AI allowance taken for the whole document first: one
 *      the day cannot take parks the job `waiting_budget` until UTC midnight
 *      with nothing embedded, and the source stays `processing`.
 *   4. **One short transaction** ends the job (fenced by the claim — a runner
 *      that lost the job, or a source deleted meanwhile, writes nothing),
 *      replaces the source's chunks, and records its `page_count`.
 *   5. **Infrastructure is not the document's fault.** The store or the
 *      embedding provider not answering, or no worker process starting, hands
 *      the job back `queued` a minute later per attempt; the last attempt fails
 *      it (`storage_unavailable`, `embedding_unavailable`, `worker_unavailable`)
 *      and the source says `parse_failed`.
 *
 * Embedding a document the workspace's residency rule would send out of its
 * region is refused like a crawl is (NFR-C4): `residency_refused`.
 */
import type { PrismaClient } from '@prisma/client';
import type { KnowledgeDocumentMimeType } from '@siyahtus/types';
import { type TenantClient, withTenant } from '../../lib/tenant.js';
import { StorageUnavailableError, type ObjectStore } from '../storage/object-store.js';
import { AiDailyCapError, nextUtcMidnight } from './ai-daily-budget.js';
import {
  endJobClaim,
  jobFence,
  KNOWLEDGE_JOB_MAX_ATTEMPTS,
  type KnowledgeJobClaim,
} from './crawler/jobs.js';
import { chunkDocument } from './document-parse/chunk.js';
import {
  parseDocumentInWorker,
  type DocumentParseOutcome,
  type DocumentWorkerOptions,
} from './document-parse/worker.js';
import { inferenceAllowed, readInferenceResidency, type InferenceProvider } from './inference.js';
import type { KnowledgeService } from './knowledge-service.js';
import { EmbeddingProviderError } from './provider/embedding-error.js';

/** `last_refresh_error` for a document the residency rule refused to embed. */
export const DOCUMENT_REFUSED_RESIDENCY =
  'Not read: this workspace is covered by a signed HIPAA agreement and the embedding provider runs outside its region.';

/** How long an infrastructure failure waits before the job is tried again, per attempt already made. */
export const DOCUMENT_RETRY_DELAY_MS = 60_000;

/** The logger a job's lines go to (the runner's `KnowledgeJobLogger`). */
interface Logger {
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

export interface DocumentIngestOptions {
  db: PrismaClient;
  /** Where the originals are (`STORAGE_PROVIDER`). */
  store: ObjectStore;
  /** Embeds the chunks, metered against the workspace's daily AI allowance. */
  knowledge: Pick<KnowledgeService, 'holdFor' | 'prepareDocument' | 'index'>;
  /** Where the embedding provider runs, as the NFR-C4 gate reads it. */
  embeddingInference: () => InferenceProvider;
  /** The reader; a test passes a canned one, the server the isolated worker. */
  parse?: (
    bytes: Buffer,
    mime: KnowledgeDocumentMimeType,
    options: DocumentWorkerOptions,
  ) => Promise<DocumentParseOutcome>;
  maxAttempts?: number;
  now?: () => Date;
}

/** The failures that are the infrastructure's, with the code the last attempt ends the job with. */
type Infrastructure = 'storage_unavailable' | 'embedding_unavailable' | 'worker_unavailable';

/**
 * What a document source says once its job has ended without chunks to show:
 * `partial` when an earlier read's chunks still answer, `failed` when none do;
 * `error` (a `KNOWLEDGE_DOCUMENT_ERRORS` code or the residency sentence) in
 * `last_refresh_error`. The document counterpart of `settleCrawledSource`,
 * whose page counts and crawl dates are a website's.
 */
export async function settleFailedDocument(
  tx: TenantClient,
  sourceId: string,
  error: string,
  now: Date,
): Promise<void> {
  const answering = await tx.knowledgeChunk.count({ where: { sourceId } });
  await tx.knowledgeSource.updateMany({
    where: { id: sourceId },
    data: {
      status: answering > 0 ? 'partial' : 'failed',
      lastRefreshError: error,
      updatedAt: now,
    },
  });
}

export class DocumentIngest {
  readonly #db: PrismaClient;
  readonly #store: ObjectStore;
  readonly #knowledge: DocumentIngestOptions['knowledge'];
  readonly #embeddingInference: () => InferenceProvider;
  readonly #parse: NonNullable<DocumentIngestOptions['parse']>;
  readonly #maxAttempts: number;
  readonly #now: () => Date;

  constructor(options: DocumentIngestOptions) {
    this.#db = options.db;
    this.#store = options.store;
    this.#knowledge = options.knowledge;
    this.#embeddingInference = options.embeddingInference;
    this.#parse = options.parse ?? parseDocumentInWorker;
    this.#maxAttempts = options.maxAttempts ?? KNOWLEDGE_JOB_MAX_ATTEMPTS;
    this.#now = options.now ?? (() => new Date());
  }

  /** Plays one claim of one `document` job. */
  async run(
    claim: KnowledgeJobClaim,
    run: { stopping: { value: boolean }; signal: AbortSignal; log: Logger },
  ): Promise<void> {
    const { context } = claim;
    const { log } = run;
    if (run.stopping.value) {
      await this.#end(claim, { status: 'queued' });
      return;
    }

    const read = await withTenant(
      this.#db,
      context,
      async (tx) => {
        const job = await tx.knowledgeJob.findFirst({
          where: jobFence(claim),
          select: { id: true },
        });
        if (!job) return null;
        const source = await tx.knowledgeSource.findFirst({
          where: { id: claim.sourceId, retiredAt: null },
          select: { fileKey: true, fileMime: true },
        });
        return { source, residency: await readInferenceResidency(tx, context) };
      },
      { readOnly: true },
    );
    // The claim was lost (cancelled, taken over, the source deleted): not this runner's job any more.
    if (!read) return;

    const key = read.source?.fileKey ?? null;
    const mime = (read.source?.fileMime ?? null) as KnowledgeDocumentMimeType | null;
    if (key === null || mime === null) {
      await this.#fail(claim, 'not_document', 'parse_failed');
      return;
    }
    const allowed =
      read.residency !== null &&
      inferenceAllowed({
        provider: this.#embeddingInference(),
        workspaceRegion: read.residency.region,
        hipaaScope: read.residency.hipaaScope,
      });
    if (!allowed) {
      await this.#fail(claim, 'residency_refused', DOCUMENT_REFUSED_RESIDENCY);
      return;
    }

    // 1. The original.
    let bytes: Buffer;
    try {
      const stored = await this.#store.get(key);
      if (!stored) {
        // The object is gone (a half-finished delete, or a store restored from
        // before it): nothing to read now or later.
        log.warn({ file_key_present: true }, 'document job: the original is not in the store');
        await this.#fail(claim, 'original_missing', 'parse_failed');
        return;
      }
      bytes = stored.bytes;
    } catch (error) {
      if (!(error instanceof StorageUnavailableError)) throw error;
      log.warn({ err: error }, 'document job: the object store did not answer');
      await this.#retryOrFail(claim, 'storage_unavailable');
      return;
    }

    // 2. The isolated reader.
    let outcome: DocumentParseOutcome;
    try {
      outcome = await this.#parse(bytes, mime, { logger: log });
    } catch (error) {
      log.error({ err: error }, 'document job: no worker could be started');
      await this.#retryOrFail(claim, 'worker_unavailable');
      return;
    }
    if (!outcome.ok) {
      log.info({ error: outcome.error, detail: outcome.detail }, 'document job: not read');
      await this.#fail(claim, outcome.error, outcome.error);
      return;
    }
    const { document } = outcome;
    log.info(
      {
        pages: document.pageCount,
        characters: document.characterCount,
        blocks: document.blocks.length,
        elapsed_ms: outcome.run.elapsedMs,
      },
      'document job: read',
    );

    // 3. Chunks, then embeddings under one hold of the day's allowance.
    const pieces = chunkDocument(document.blocks);
    if (pieces.length === 0) {
      await this.#fail(claim, 'no_text_layer', 'no_text_layer');
      return;
    }
    let prepared;
    try {
      const hold = await this.#knowledge.holdFor(
        context,
        pieces.map((piece) => piece.text),
      );
      try {
        prepared = await this.#knowledge.prepareDocument(pieces, hold);
      } finally {
        await hold.settle();
      }
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        log.info({}, 'document job: parked until the day’s AI allowance renews');
        await this.#end(claim, {
          status: 'waiting_budget',
          availableAt: nextUtcMidnight(this.#now()),
        });
        return;
      }
      if (error instanceof EmbeddingProviderError) {
        log.warn({ kind: error.kind }, 'document job: the embedding provider did not answer');
        await this.#retryOrFail(claim, 'embedding_unavailable');
        return;
      }
      throw error;
    }

    // 4. Written together: the job's end, the chunks, the page count.
    const now = this.#now();
    await withTenant(
      this.#db,
      context,
      async (tx) => {
        if (!(await endJobClaim(tx, claim, { status: 'done' }))) return;
        await tx.knowledgeJob.updateMany({
          where: { id: claim.id },
          data: {
            pagesDiscovered: document.pageCount,
            pagesDone: document.pageCount,
            pagesOk: document.pageCount,
          },
        });
        await this.#knowledge.index(tx, context, claim.sourceId, prepared);
        await tx.knowledgeSource.updateMany({
          where: { id: claim.sourceId },
          data: { pageCount: document.pageCount, lastRefreshError: null, updatedAt: now },
        });
      },
      { timeoutMs: 120_000 },
    );
    log.info(
      { chunks: prepared.chunks.length, pages: document.pageCount },
      'document job finished',
    );
  }

  /** End the claim, fenced, without touching the source. */
  async #end(claim: KnowledgeJobClaim, end: Parameters<typeof endJobClaim>[2]): Promise<void> {
    await withTenant(this.#db, claim.context, async (tx) => {
      await endJobClaim(tx, claim, end);
    });
  }

  /**
   * The job failed for good: its `error` (`code`) and the source's
   * `last_refresh_error` (`message` — the same code, or a sentence) say why.
   */
  async #fail(claim: KnowledgeJobClaim, code: string, message: string): Promise<void> {
    await withTenant(this.#db, claim.context, async (tx) => {
      if (!(await endJobClaim(tx, claim, { status: 'failed', error: code }))) return;
      await settleFailedDocument(tx, claim.sourceId, message, this.#now());
    });
  }

  /** An infrastructure failure: tried again a while later, or — the last attempt — failed. */
  async #retryOrFail(claim: KnowledgeJobClaim, why: Infrastructure): Promise<void> {
    if (claim.attempts >= this.#maxAttempts) {
      await this.#fail(claim, why, 'parse_failed');
      return;
    }
    await this.#end(claim, {
      status: 'queued',
      availableAt: new Date(this.#now().getTime() + DOCUMENT_RETRY_DELAY_MS * claim.attempts),
    });
  }
}
