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
}

export class FakeLlmProvider implements LlmProvider {
  readonly id: LlmProviderId;
  /** Every request, in order. `calls.length` is the call count. */
  readonly calls: LlmCompletionRequest[] = [];
  readonly #options: FakeLlmProviderOptions;

  constructor(options: FakeLlmProviderOptions = {}) {
    this.id = options.id ?? 'openai';
    this.#options = options;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    this.calls.push(request);
    if (this.#options.fail) throw this.#options.fail;
    const reply = this.#options.reply ?? FAKE_LLM_REPLY;
    return {
      text: typeof reply === 'function' ? reply(request) : reply,
      usage: this.#options.usage ?? { inputTokens: 100, outputTokens: 10 },
    };
  }

  reset(): void {
    this.calls.length = 0;
  }
}
