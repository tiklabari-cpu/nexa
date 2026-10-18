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
 *
 * **The understanding call (tm 297.1) is answered apart.** Every procedure
 * turn starts with it, and a fake that wrote its fixed prose there would end
 * every such turn in "the model could not read the message". By default it is
 * answered as `LLM_PROVIDER=mock` answers it (`mockUnderstanding`), costs
 * nothing, and is recorded in `understandCalls` — not in `calls`, and not
 * held or failed by `hold` / `fail` — so a test about the written part
 * counts the written part. A test about the understanding itself passes
 * `understand`.
 *
 * **A knowledge answer is an object (tm 298).** Its reply is the fake's reply,
 * as before; the fake writes it as the `knowledge_answer` object — grounded
 * in full, citing the first passage it was given — unless the reply already is
 * such an object, which is how a test sends a partial answer, a citation of
 * nothing, or an invented figure. Counted in `calls` like any other.
 */
import { mockUnderstanding } from '../../src/services/ai/conversation/understand-mock.js';
import {
  readUnderstandGrounding,
  UNDERSTAND_RESPONSE_NAME,
} from '../../src/services/ai/conversation/understand.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmProviderId,
  LlmUsage,
} from '../../src/services/ai/provider/llm-provider.js';
import { asKnowledgeAnswer } from './knowledge-answer.js';

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
  /**
   * How the understanding call is answered: the mock's reading (default), the
   * reply this function writes, or this error thrown.
   */
  understand?: ((request: LlmCompletionRequest) => string) | Error;
  /** What an understanding reply costs; nothing by default. */
  understandUsage?: LlmUsage;
}

export class FakeLlmProvider implements LlmProvider {
  readonly id: LlmProviderId;
  /** Every request, in order. `calls.length` is the call count. */
  readonly calls: LlmCompletionRequest[] = [];
  /** The understanding calls, in order (see the file header). */
  readonly understandCalls: LlmCompletionRequest[] = [];
  /** Calls started and not yet answered, and the most there ever were at once. */
  inFlight = 0;
  maxInFlight = 0;
  readonly #options: FakeLlmProviderOptions;

  constructor(options: FakeLlmProviderOptions = {}) {
    this.id = options.id ?? 'openai';
    this.#options = options;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    if (request.responseFormat?.name === UNDERSTAND_RESPONSE_NAME) return this.#understand(request);
    const call = this.calls.push(request) - 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.#options.hold) await this.#options.hold(request, call);
      if (this.#options.fail) throw this.#options.fail;
      const reply = this.#options.reply ?? FAKE_LLM_REPLY;
      const text = typeof reply === 'function' ? reply(request) : reply;
      return {
        text: asKnowledgeAnswer(text, request),
        usage: this.#options.usage ?? { inputTokens: 100, outputTokens: 10 },
      };
    } finally {
      this.inFlight -= 1;
    }
  }

  #understand(request: LlmCompletionRequest): LlmCompletion {
    this.understandCalls.push(request);
    const answer = this.#options.understand;
    if (answer instanceof Error) throw answer;
    const usage = this.#options.understandUsage ?? { inputTokens: 0, outputTokens: 0 };
    if (answer) return { text: answer(request), usage };
    const grounding = readUnderstandGrounding(request.system);
    if (!grounding) throw new Error('An understanding request without its context line.');
    return { text: JSON.stringify(mockUnderstanding(grounding)), usage };
  }

  reset(): void {
    this.calls.length = 0;
    this.understandCalls.length = 0;
    this.inFlight = 0;
    this.maxInFlight = 0;
  }
}
