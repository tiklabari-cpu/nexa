/**
 * Embeddings counted against the daily AI caps (tm 257.20 · ADR
 * `docs/adr/pilot-public-readiness.md` K-e(3)) — `metered-llm.ts`' pattern on
 * the embedding meter.
 *
 * Every text the product turns into a vector goes through here: a knowledge
 * source indexed from the panel, a bulk import, a Copilot source, the
 * freshness sweep, a visitor's question, a Copilot draft's question and
 * `knowledge:reembed`. Each reserves its estimate on today's counters
 * (`ai-daily-budget.ts`), asks the provider and settles what the provider
 * said it cost. Who pays is said by the caller, never read from ambient state:
 *
 * | who pays                              | counted on                          |
 * | ------------------------------------- | ----------------------------------- |
 * | a workspace (`TenantContext`)         | its row and the deployment's        |
 * | an {@link EmbeddingHold}              | the same, reserved once for many    |
 * | the operator (`embedForDeployment`)   | the deployment's row alone          |
 *
 * The hold is the bulk import's: the whole file's estimate is reserved before
 * the first row is embedded, so a file the day cannot afford is refused whole
 * instead of row by row, and settled once when the import ends. The
 * deployment-only path is `knowledge:reembed`'s — an operator moving every
 * workspace into a new space is not something any workspace asked for.
 *
 * **Only a provider that bills is counted.** `mock` — every suite, dev and e2e
 * — calls straight through, as does an instance built with no budget
 * ({@link MeteredEmbeddings.wrap}), which is what a unit test or a measurement
 * over a throwaway fixture gets. The server, the scheduler and both CLIs
 * always build one with a budget.
 *
 * **The estimate** is the texts' UTF-8 length in bytes. That is the OpenAI
 * adapter's own upper bound on tokens (`openai-embedding-provider.ts`: a
 * byte-level BPE token is at least one byte), so a reservation is never below
 * what a call can cost, and the settle hands the difference back.
 *
 * **What a failed call cost**, kept by the settle:
 *
 * | the call                                  | counted                         |
 * | ----------------------------------------- | ------------------------------- |
 * | `timeout`, `network`, `bad_response`      | the estimate                    |
 * | any other provider failure                | the batches answered before it  |
 * | not an `EmbeddingProviderError` (defect)  | the estimate                    |
 *
 * A call may be several requests (the adapter batches at 512 inputs or
 * 300,000 bytes); the ones that answered before a refusal were billed, and the
 * adapter carries their usage on the error. A request abandoned or unreadable
 * may have been billed too, and nobody can say how much — the cap errs toward
 * counting, as the LLM meter's does.
 */
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import type { TenantContext } from '../../lib/tenant.js';
import { AiDailyBudget, aiDailyCaps, type AiReservation } from './ai-daily-budget.js';
import { createEmbeddingProvider } from './provider/create-embedding-provider.js';
import { EmbeddingProviderError, type EmbeddingFailureKind } from './provider/embedding-error.js';
import type {
  EmbeddingProvider,
  EmbeddingProviderId,
  EmbeddingProviderRuntime,
  Embeddings,
} from './provider/embedding-provider.js';
import { defaultEmbeddingLogger } from './provider/openai-embedding-provider.js';

/** Failures that may have been billed although nothing says how much. */
const BILLING_UNKNOWN: ReadonlySet<EmbeddingFailureKind> = new Set<EmbeddingFailureKind>([
  'timeout',
  'network',
  'bad_response',
]);

/** What embedding `texts` reserves: their UTF-8 length in bytes. */
export function embeddingEstimate(texts: readonly string[]): number {
  let bytes = 0;
  for (const text of texts) bytes += Buffer.byteLength(text, 'utf8');
  return bytes;
}

/** What a failed embedding call is counted as — the table in the file header. */
export function embeddingBilledOnFailure(error: unknown, estimate: number): number {
  if (!(error instanceof EmbeddingProviderError)) return estimate;
  if (BILLING_UNKNOWN.has(error.kind)) return estimate;
  return error.usage?.inputTokens ?? 0;
}

/**
 * One workspace's allowance reserved up front for several embedding calls —
 * the bulk import's file. Calls draw on it; a call it has no room left for
 * reserves the shortfall on its own, and is refused with
 * {@link import('./ai-daily-budget.js').AiDailyCapError} if that does not fit.
 * {@link settle} hands back what the calls did not use. Built by
 * {@link MeteredEmbeddings.hold}; settled exactly once, in a `finally`, or the
 * estimate stays counted for the day.
 */
export class EmbeddingHold {
  readonly tenant: TenantContext;
  readonly #budget: AiDailyBudget | null;
  readonly #reservations: AiReservation[] = [];
  #reserved = 0;
  #committed = 0;
  #inFlight = 0;
  #settled = false;

  /** @internal — {@link MeteredEmbeddings.hold}. */
  constructor(tenant: TenantContext, budget: AiDailyBudget | null, first: AiReservation | null) {
    this.tenant = tenant;
    this.#budget = budget;
    if (first) {
      this.#reservations.push(first);
      this.#reserved = first.estimate;
    }
  }

  /** Tokens reserved: the up-front estimate and any shortfall reserved since. */
  get reserved(): number {
    return this.#reserved;
  }

  /** Tokens the finished calls cost. */
  get used(): number {
    return this.#committed;
  }

  /** @internal Room for a call of `estimate`, from what is held or reserved for the shortfall. */
  async take(estimate: number): Promise<void> {
    if (this.#settled) throw new Error('This embedding hold has already been settled.');
    if (this.#budget) {
      const room = this.#reserved - this.#committed - this.#inFlight;
      if (estimate > room) {
        // Throws `AiDailyCapError` with nothing added; the call is not made.
        const more = await this.#budget.reserve(this.tenant, 'embedding', estimate - room);
        this.#reservations.push(more);
        this.#reserved += more.estimate;
      }
    }
    this.#inFlight += estimate;
  }

  /** @internal A call drawn by {@link take} has ended, having cost `used`. */
  finish(estimate: number, used: number): void {
    this.#inFlight -= estimate;
    this.#committed += used;
  }

  /**
   * Hand back every reservation and keep what the calls cost — on the first
   * reservation's day (a hold that crosses midnight is counted on the day it
   * was taken). Never throws (`AiDailyBudget.settle`); a second call does
   * nothing.
   */
  async settle(): Promise<void> {
    if (this.#settled) return;
    this.#settled = true;
    if (!this.#budget) return;
    for (const [index, reservation] of this.#reservations.entries()) {
      await this.#budget.settle(reservation, index === 0 ? this.#committed : 0);
    }
  }
}

/** Who an embedding is counted against: a workspace per call, or a hold it reserved for many. */
export type EmbeddingPayer = TenantContext | EmbeddingHold;

export class MeteredEmbeddings {
  readonly #provider: EmbeddingProvider;
  readonly #budget: AiDailyBudget | null;

  /**
   * `budget` null counts nothing — a unit test's service, or a measurement
   * over a throwaway fixture. The server, the scheduler and the CLIs pass one.
   */
  constructor(provider: EmbeddingProvider, budget: AiDailyBudget | null) {
    this.#provider = provider;
    this.#budget = budget;
  }

  /** `embeddings` as it is, when it is already metered; otherwise counted by nothing. */
  static wrap(embeddings: EmbeddingProvider | MeteredEmbeddings): MeteredEmbeddings {
    return embeddings instanceof MeteredEmbeddings
      ? embeddings
      : new MeteredEmbeddings(embeddings, null);
  }

  /** Which implementation answers — the value `EMBEDDING_PROVIDER` names. */
  get id(): EmbeddingProviderId {
    return this.#provider.id;
  }

  /** The vector space the provider writes into. */
  get space(): string {
    return this.#provider.space;
  }

  /** Whether calls through this instance are counted. */
  get metered(): boolean {
    return this.#budget !== null && this.#provider.id !== 'mock';
  }

  /**
   * Embed `texts` for `payer`. Throws `AiDailyCapError` with nothing reserved
   * and the provider not reached when the call does not fit today's caps.
   * `payer` may be left out only where nothing is counted; a counted call
   * without one is a defect, and fails before the provider is asked.
   */
  async embed(texts: readonly string[], payer?: EmbeddingPayer): Promise<Embeddings> {
    const budget = this.#budget;
    if (!budget || !this.metered || texts.length === 0) return this.#provider.embed(texts);
    if (payer === undefined) {
      throw new Error('A counted embedding call needs the workspace it is for.');
    }

    const estimate = embeddingEstimate(texts);
    if (payer instanceof EmbeddingHold) {
      await payer.take(estimate);
      let used = estimate;
      try {
        const embeddings = await this.#provider.embed(texts);
        used = embeddings.usage.inputTokens;
        return embeddings;
      } catch (error) {
        used = embeddingBilledOnFailure(error, estimate);
        throw error;
      } finally {
        payer.finish(estimate, used);
      }
    }
    const reservation = await budget.reserve(payer, 'embedding', estimate);
    return this.#counted(budget, reservation, texts);
  }

  /**
   * Reserve `estimate` for `tenant` now, for calls made with the returned hold
   * as their payer (the bulk import). Throws `AiDailyCapError` when it does
   * not fit; reserves nothing when nothing is counted or the estimate is 0.
   */
  async hold(tenant: TenantContext, estimate: number): Promise<EmbeddingHold> {
    const budget = this.metered ? this.#budget : null;
    const first =
      budget && estimate > 0 ? await budget.reserve(tenant, 'embedding', estimate) : null;
    return new EmbeddingHold(tenant, budget, first);
  }

  /**
   * Embed `texts` as the deployment's operator — counted on the deployment's
   * row alone, never on a workspace's (`knowledge:reembed`; see the file
   * header). Throws `AiDailyCapError` with scope `global` when it does not fit.
   */
  async embedForDeployment(texts: readonly string[]): Promise<Embeddings> {
    const budget = this.#budget;
    if (!budget || !this.metered || texts.length === 0) return this.#provider.embed(texts);
    const reservation = await budget.reserveDeployment('embedding', embeddingEstimate(texts));
    return this.#counted(budget, reservation, texts);
  }

  /** Ask the provider under `reservation`, then settle it with what the call cost. */
  async #counted(
    budget: AiDailyBudget,
    reservation: AiReservation,
    texts: readonly string[],
  ): Promise<Embeddings> {
    const estimate = reservation.estimate;
    let used = estimate;
    try {
      const embeddings = await this.#provider.embed(texts);
      used = embeddings.usage.inputTokens;
      return embeddings;
    } catch (error) {
      used = embeddingBilledOnFailure(error, estimate);
      throw error;
    } finally {
      await budget.settle(reservation, used);
    }
  }
}

/**
 * The configured provider, metered with a daily AI budget over `db` — what a
 * process without a server builds: the scheduler's fallback and the
 * `knowledge-refresh:run` and `knowledge:reembed` CLIs. Same provider, same
 * caps, same Postgres counters as the server (Redis is not involved), so a job
 * run by hand spends from the allowance the API does.
 */
export function createMeteredEmbeddings(
  db: PrismaClient,
  env: Env,
  runtime: EmbeddingProviderRuntime = {},
): MeteredEmbeddings {
  const logger = runtime.logger ?? defaultEmbeddingLogger();
  return new MeteredEmbeddings(
    createEmbeddingProvider(env.EMBEDDING_PROVIDER, env.embedding, { ...runtime, logger }),
    new AiDailyBudget(db, aiDailyCaps(env), { logger }),
  );
}
