/**
 * A model call counted against the daily AI caps (tm 257.8 · ADR
 * `docs/adr/pilot-public-readiness.md` K-e(3)).
 *
 * `complete(tenant, request)` is `LlmProvider.complete` with the workspace it
 * is for: reserve the call's estimate on today's counters
 * (`ai-daily-budget.ts`), ask the provider, settle with what the call cost.
 * The workspace is a parameter rather than something read from ambient state —
 * whoever calls a model already holds the tenant, and an attribution nobody
 * passed is one nobody can check.
 *
 * **Only a provider that bills is counted.** `mock` — every test suite, dev
 * and e2e — calls straight through: no reservation, no row, no query. So does
 * an instance built with no budget, which is what a unit test that reaches no
 * database gets ({@link MeteredLlm.wrap}); the server always builds one.
 *
 * **The estimate** is the prompt's length in characters plus the reply's
 * token ceiling: `LLM_MAX_PROMPT_CHARS` already treats a character as a
 * conservative upper bound on a token, and the reply cannot exceed
 * `maxOutputTokens`. The reservation is therefore above what the call can
 * cost in the ordinary case, and the settle hands the difference back.
 *
 * **What a call cost**, kept by the settle:
 *
 * | the call                                        | counted                    |
 * | ----------------------------------------------- | -------------------------- |
 * | answered                                        | the provider's usage       |
 * | failed with usage on the error (`no_answer`)    | that usage — it was billed |
 * | `timeout`, `network`, `bad_response`            | the estimate               |
 * | any other provider failure                      | 0                          |
 * | not an `LlmProviderError` (a defect)            | the estimate               |
 *
 * The middle rows are the ones nobody can know: a request abandoned at the
 * deadline, a connection that dropped after the bytes went out, or a 200 the
 * adapter could not read may all have been processed and billed, so they keep
 * what was reserved for them — a cap errs toward counting. A failure the
 * provider answered with an error status (`rate_limited`, `auth`,
 * `bad_request`…) or one refused in this process (`circuit_open`,
 * `prompt_too_long`) cost nothing.
 */
import type { TenantContext } from '../../lib/tenant.js';
import type { AiDailyBudget } from './ai-daily-budget.js';
import { LlmProviderError, type LlmFailureKind } from './provider/llm-error.js';
import {
  promptLength,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmProvider,
  type LlmProviderId,
} from './provider/llm-provider.js';

/** Failures that may have been billed although nothing says how much. */
const BILLING_UNKNOWN: ReadonlySet<LlmFailureKind> = new Set<LlmFailureKind>([
  'timeout',
  'network',
  'bad_response',
]);

/** What a call reserves before the provider is asked. */
export function llmEstimate(request: LlmCompletionRequest): number {
  return promptLength(request) + request.maxOutputTokens;
}

/** What a failed call is counted as — the table in the file header. */
export function billedOnFailure(error: unknown, estimate: number): number {
  if (!(error instanceof LlmProviderError)) return estimate;
  if (error.usage) return error.usage.inputTokens + error.usage.outputTokens;
  return BILLING_UNKNOWN.has(error.kind) ? estimate : 0;
}

export class MeteredLlm {
  readonly #llm: LlmProvider;
  readonly #budget: AiDailyBudget | null;

  /**
   * `budget` null counts nothing — a unit test's engine. The server passes its
   * one budget to every instance it builds.
   */
  constructor(llm: LlmProvider, budget: AiDailyBudget | null) {
    this.#llm = llm;
    this.#budget = budget;
  }

  /** `llm` as it is, when it is already metered; otherwise counted by nothing. */
  static wrap(llm: LlmProvider | MeteredLlm): MeteredLlm {
    return llm instanceof MeteredLlm ? llm : new MeteredLlm(llm, null);
  }

  /** Which implementation answers — the value `LLM_PROVIDER` names. */
  get id(): LlmProviderId {
    return this.#llm.id;
  }

  /** Whether calls through this instance are counted. */
  get metered(): boolean {
    return this.#budget !== null && this.#llm.id !== 'mock';
  }

  async complete(tenant: TenantContext, request: LlmCompletionRequest): Promise<LlmCompletion> {
    const budget = this.#budget;
    if (!budget || this.#llm.id === 'mock') return this.#llm.complete(request);

    const estimate = llmEstimate(request);
    // Throws `AiDailyCapError` with nothing reserved; the provider is not reached.
    const reservation = await budget.reserve(tenant, 'llm', estimate);
    let used = estimate;
    try {
      const completion = await this.#llm.complete(request);
      used = completion.usage.inputTokens + completion.usage.outputTokens;
      return completion;
    } catch (error) {
      used = billedOnFailure(error, estimate);
      throw error;
    } finally {
      await budget.settle(reservation, used);
    }
  }

  /**
   * This instance as a plain `LlmProvider` bound to one workspace — for the
   * Copilot writers (`copilot-summary.ts`, `copilot-enhance.ts`), which take a
   * provider and branch on its `id`.
   */
  forTenant(tenant: TenantContext): LlmProvider {
    return {
      id: this.#llm.id,
      complete: (request) => this.complete(tenant, request),
    };
  }
}
