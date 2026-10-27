/**
 * The two actions on the root panel's AI page (tm 389.17 · FR-ADMIN-19):
 * "Test the connection" and "Re-embed".
 *
 * Both build the provider the tenant API would build — the stored settings,
 * else this process's environment (the platform API runs the tenant image
 * with the same environment, design.md §A) — and both count what they spend
 * on the **deployment's** daily AI allowance, never a workspace's: no
 * workspace asked for them (tm 257.20's rule for `knowledge:reembed`).
 *
 * **The connection test** sends one tiny completion (or one embedding) and
 * reports whether it came back, how long it took and, when it did not, the
 * failure's kind — never the provider's message, which may quote the key.
 * `mock` is built and succeeds without a request — it runs in-process.
 *
 * **Re-embedding** is `knowledge:reembed`'s body (`KnowledgeReembedder`) run in
 * this process, in the background. One at a time across every platform
 * process: a Redis lock (`SET NX PX`, refreshed while the run lives) — a
 * second start is `409 platform_operation_running`; a process that dies
 * mid-run lets the lock lapse and the panel reads `failed`. Progress is a
 * Redis hash the page polls (`OPS_AI_REEMBED_KEY`).
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { OPS_AI_REEMBED_KEY, OPS_AI_REEMBED_LOCK_KEY } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { AiDailyBudget, AiDailyCapError, type AiBudgetLogger } from '../ai/ai-daily-budget.js';
import {
  resolveAiConfig,
  type AiEnv,
  type ResolvedAiConfig,
  type StoredAiSettings,
} from '../ai/ai-settings.js';
import { KnowledgeReembedder } from '../ai/knowledge-reembed.js';
import { MeteredEmbeddings } from '../ai/metered-embeddings.js';
import { billedOnFailure, llmEstimateUsage } from '../ai/metered-llm.js';
import { createEmbeddingProvider } from '../ai/provider/create-embedding-provider.js';
import { EmbeddingProviderError } from '../ai/provider/embedding-error.js';
import { LlmProviderError } from '../ai/provider/llm-error.js';
import { createLlmProvider, type LlmCompletionRequest } from '../ai/provider/llm-provider.js';
import type { LlmLogger } from '../ai/provider/openai-llm-provider.js';
import { embeddingSpaceOf, type PlatformAiReembedStatus } from './ai-settings.js';

export const AI_TEST_TARGETS = ['llm', 'embedding'] as const;
export type AiTestTarget = (typeof AI_TEST_TARGETS)[number];

/** Connection tests one operator may run a minute. */
export const AI_TEST_PER_MINUTE = 3;

/** The test completion: a handful of tokens either way. */
const TEST_REQUEST: Omit<LlmCompletionRequest, 'timeoutMs'> = {
  system: 'You are a connection check. Reply with the single word OK.',
  messages: [{ role: 'user', content: 'Connection check.' }],
  maxOutputTokens: 5,
};

/** How long the re-embedding lock lives without a refresh. */
const REEMBED_LOCK_MS = 120_000;
const REEMBED_REFRESH_MS = 30_000;
/** How long a finished run's record stays for the page (7 days). */
const REEMBED_RECORD_TTL_S = 7 * 24 * 3600;

export interface AiConnectionTestResult {
  target: AiTestTarget;
  provider: 'mock' | 'openai';
  source: 'db' | 'env';
  model: string | null;
  ok: boolean;
  latency_ms: number;
  error: string | null;
}

export interface AiOperationsOptions {
  /** The runtime (RLS-bound) role's client: the daily budget and the re-embedding read through it. */
  runtimeDb: () => PrismaClient;
  redis: Redis;
  env: AiEnv;
  rootKey: string;
  logger: LlmLogger & AiBudgetLogger;
  /** How the `openai` adapters reach the network — a test's recorder. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function failureKind(error: unknown): string {
  if (error instanceof AiDailyCapError) return 'ai_daily_cap';
  if (error instanceof LlmProviderError) return error.kind;
  if (error instanceof EmbeddingProviderError) return error.kind;
  return 'provider_error';
}

export class PlatformAiOperations {
  readonly #options: AiOperationsOptions;
  readonly #now: () => number;
  #running: Promise<void> | null = null;

  constructor(options: AiOperationsOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  #resolve(stored: StoredAiSettings): ResolvedAiConfig {
    return resolveAiConfig(stored, this.#options.env, this.#options.rootKey);
  }

  #budget(config: ResolvedAiConfig): AiDailyBudget {
    return new AiDailyBudget(this.#options.runtimeDb(), config.caps, {
      logger: this.#options.logger,
    });
  }

  /** 429 past {@link AI_TEST_PER_MINUTE} tests in a minute for this operator. */
  async limit(adminId: string): Promise<void> {
    const key = `rl:platform:ai-test:${adminId}`;
    const count = await this.#options.redis.incr(key);
    if (count === 1) await this.#options.redis.pexpire(key, 60_000);
    if (count > AI_TEST_PER_MINUTE) {
      const ttl = await this.#options.redis.pttl(key);
      throw ApiError.tooManyRequests(ttl > 0 ? ttl / 1000 : 60, 'Three connection tests a minute.');
    }
  }

  async testConnection(
    stored: StoredAiSettings,
    target: AiTestTarget,
  ): Promise<AiConnectionTestResult> {
    const config = this.#resolve(stored);
    const runtime = {
      logger: this.#options.logger,
      ...(this.#options.fetchImpl ? { fetchImpl: this.#options.fetchImpl } : {}),
    };
    const part = target === 'llm' ? config.llm : config.embedding;
    // A stored part the tenant API cannot use — its key does not open, a
    // remote provider with no key anywhere — runs on the environment there.
    // Testing the environment instead would report the stub's success for a
    // setting that is broken; say it is misconfigured, and send nothing.
    const row = stored[target];
    if (row && part.source === 'env') {
      return {
        target,
        provider: row.provider,
        source: 'db',
        model: row.model,
        ok: false,
        latency_ms: 0,
        error: 'misconfigured',
      };
    }
    const base = {
      target,
      provider: part.provider,
      source: part.source,
      model: part.model,
    } as const;
    const started = this.#now();
    const elapsed = (): number => Math.max(0, Math.round(this.#now() - started));
    try {
      if (target === 'llm') {
        const provider = createLlmProvider(config.llm.provider, config.llm.options, runtime);
        const request: LlmCompletionRequest = { ...TEST_REQUEST, timeoutMs: config.llm.timeoutMs };
        // The stub runs in this process and answers only the product's own
        // prompts: building it is the whole test.
        if (provider.id !== 'mock') {
          const budget = this.#budget(config);
          const estimate = llmEstimateUsage(request);
          const reservation = await budget.reserveDeployment(
            'llm',
            estimate.inputTokens + estimate.outputTokens,
          );
          let used = estimate;
          try {
            used = (await provider.complete(request)).usage;
          } catch (error) {
            used = billedOnFailure(error, estimate);
            throw error;
          } finally {
            await budget.settle(reservation, used);
          }
        }
      } else {
        const provider = createEmbeddingProvider(
          config.embedding.provider,
          config.embedding.options,
          runtime,
        );
        const metered = new MeteredEmbeddings(
          provider,
          provider.id === 'mock' ? null : this.#budget(config),
        );
        await metered.embedForDeployment(['Connection check.']);
      }
      return { ...base, ok: true, latency_ms: elapsed(), error: null };
    } catch (error) {
      // An adapter that refuses its own settings throws a plain Error at
      // construction — a configuration problem, not a provider's answer.
      const kind =
        error instanceof LlmProviderError ||
        error instanceof EmbeddingProviderError ||
        error instanceof AiDailyCapError
          ? failureKind(error)
          : 'misconfigured';
      return { ...base, ok: false, latency_ms: elapsed(), error: kind };
    }
  }

  /**
   * Start re-embedding in the background, or throw `409
   * platform_operation_running` when a run holds the lock. Resolves once the
   * run has started, with its first record.
   */
  async startReembed(stored: StoredAiSettings): Promise<PlatformAiReembedStatus> {
    const { redis } = this.#options;
    const token = randomUUID();
    const taken = await redis.set(OPS_AI_REEMBED_LOCK_KEY, token, 'PX', REEMBED_LOCK_MS, 'NX');
    if (taken !== 'OK') {
      throw new ApiError('platform_operation_running', 'A re-embedding is already running.');
    }
    const config = this.#resolve(stored);
    const provider = createEmbeddingProvider(config.embedding.provider, config.embedding.options, {
      logger: this.#options.logger,
      ...(this.#options.fetchImpl ? { fetchImpl: this.#options.fetchImpl } : {}),
    });
    const aiDailyBudget = this.#budget(config);
    const status: PlatformAiReembedStatus = {
      state: 'running',
      started_at: new Date(this.#now()).toISOString(),
      finished_at: null,
      target: embeddingSpaceOf(config.embedding),
      sources: 0,
      chunks: 0,
      failed: 0,
      refused: 0,
      capped: false,
    };
    await redis
      .multi()
      .del(OPS_AI_REEMBED_KEY)
      .hset(OPS_AI_REEMBED_KEY, recordOf(status))
      .expire(OPS_AI_REEMBED_KEY, REEMBED_RECORD_TTL_S)
      .exec();

    const refresh = setInterval(() => {
      void redis.pexpire(OPS_AI_REEMBED_LOCK_KEY, REEMBED_LOCK_MS).catch(() => undefined);
    }, REEMBED_REFRESH_MS);
    refresh.unref();

    // On the deployment's row alone: `KnowledgeReembedder` embeds as the operator.
    const reembedder = new KnowledgeReembedder(this.#options.runtimeDb(), {
      embeddings: new MeteredEmbeddings(provider, aiDailyBudget),
      embeddingInference: { id: config.embedding.provider, region: config.embedding.region },
    });
    this.#running = (async () => {
      try {
        const report = await reembedder.run({
          onSource: async (event) => {
            const field =
              event.outcome === 'reembedded'
                ? 'sources'
                : event.outcome === 'failed'
                  ? 'failed'
                  : null;
            const pipeline = redis.multi();
            if (field) pipeline.hincrby(OPS_AI_REEMBED_KEY, field, 1);
            if (event.chunks > 0) pipeline.hincrby(OPS_AI_REEMBED_KEY, 'chunks', event.chunks);
            await pipeline.exec();
          },
        });
        await redis.hset(OPS_AI_REEMBED_KEY, {
          state: 'finished',
          finished_at: new Date(this.#now()).toISOString(),
          sources: String(report.totals.reembedded),
          chunks: String(report.totals.chunks),
          failed: String(report.totals.failed),
          refused: String(report.totals.refused),
          capped: report.capped ? '1' : '0',
        });
      } catch (error) {
        this.#options.logger.error(
          { err: error, event: 'ai.reembed_failed' },
          'knowledge re-embedding failed',
        );
        await redis
          .hset(OPS_AI_REEMBED_KEY, {
            state: 'failed',
            finished_at: new Date(this.#now()).toISOString(),
          })
          .catch(() => undefined);
      } finally {
        clearInterval(refresh);
        // Released only if still ours: a lock that lapsed may be another run's.
        const holder = await redis.get(OPS_AI_REEMBED_LOCK_KEY).catch(() => null);
        if (holder === token) await redis.del(OPS_AI_REEMBED_LOCK_KEY).catch(() => undefined);
      }
    })().finally(() => {
      this.#running = null;
    });
    return status;
  }

  /** Resolves once no re-embedding started here is running — the close hook and tests. */
  async idle(): Promise<void> {
    await this.#running;
  }
}

function recordOf(status: PlatformAiReembedStatus): Record<string, string> {
  return {
    state: status.state,
    started_at: status.started_at ?? '',
    finished_at: status.finished_at ?? '',
    target: status.target ?? '',
    sources: String(status.sources),
    chunks: String(status.chunks),
    failed: String(status.failed),
    refused: String(status.refused),
    capped: status.capped ? '1' : '0',
  };
}
