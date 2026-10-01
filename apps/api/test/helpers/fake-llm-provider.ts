/**
 * A recording `LlmProvider` for tests (tm 255.5).
 *
 * `buildServer({ llm })` takes it the way it takes a mailer: the server under
 * test sends its AI calls here, nothing touches a network, and the test reads
 * back how many calls were made and with which prompt. Deterministic — the reply
 * is a fixed string unless the test supplies one — so an assertion on the text a
 * customer received is an assertion that the text came from *this* provider and
 * not from the in-process stub.
 *
 * `id` is `openai` by default because a fake stands in for a remote model: that
 * is the configuration the residency gate and the usage counter exist for.
 */
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmProviderId,
  LlmUsage,
} from '../../src/services/ai/provider/llm-provider.js';

export const FAKE_LLM_REPLY = 'Written by the fake model.';

export interface FakeLlmProviderOptions {
  id?: LlmProviderId;
  /** The reply, or how to derive it from the request. */
  reply?: string | ((request: LlmCompletionRequest) => string);
  usage?: LlmUsage;
  /** Throw this instead of answering — a provider failure. */
  fail?: Error;
  /**
   * Awaited before answering, with the request and its 0-based position — a
   * model that is still thinking, for as long as the test holds it (tm 256.10).
   */
  hold?: (request: LlmCompletionRequest, call: number) => Promise<void>;
}

export class FakeLlmProvider implements LlmProvider {
  readonly id: LlmProviderId;
  /** Every request, in order. `calls.length` is the call count. */
  readonly calls: LlmCompletionRequest[] = [];
  /** Calls started and not yet answered, and the most there ever were at once. */
  inFlight = 0;
  maxInFlight = 0;
  readonly #options: FakeLlmProviderOptions;

  constructor(options: FakeLlmProviderOptions = {}) {
    this.id = options.id ?? 'openai';
    this.#options = options;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const call = this.calls.push(request) - 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.#options.hold) await this.#options.hold(request, call);
      if (this.#options.fail) throw this.#options.fail;
      const reply = this.#options.reply ?? FAKE_LLM_REPLY;
      return {
        text: typeof reply === 'function' ? reply(request) : reply,
        usage: this.#options.usage ?? { inputTokens: 100, outputTokens: 10 },
      };
    } finally {
      this.inFlight -= 1;
    }
  }

  reset(): void {
    this.calls.length = 0;
    this.inFlight = 0;
    this.maxInFlight = 0;
  }
}
