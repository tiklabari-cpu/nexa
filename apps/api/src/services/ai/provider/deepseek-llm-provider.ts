/**
 * `LLM_PROVIDER=deepseek` — the DeepSeek chat adapter (tm 480 · K51 · ADR
 * docs/adr/pilot-llm-embedding-provider.md §14).
 *
 * DeepSeek answers the OpenAI request shape, and ADR §0/§3 still makes it its
 * own enum value and its own adapter: what differs is below, and the part that
 * is the same is `chat-completions-transport.ts` — the retry loop, the
 * deadline, the circuit breaker and the reading of a body, shared with the
 * OpenAI and Kimi adapters. Facts are from DeepSeek's API documentation
 * (api-docs.deepseek.com, read 2026-11-13; sources in the ADR).
 *
 * ## What it sends
 *
 * `POST https://api.deepseek.com/chat/completions` — the base URL has no
 * `/v1` — with:
 *
 * - `model` — `LLM_MODEL`, or `LLM_MODEL_FAST` for `tier: 'fast'` (§6a.5).
 * - `messages` — the system prompt as the first message, then the turns.
 * - `max_tokens` — DeepSeek's name for the output ceiling (not
 *   `max_completion_tokens`).
 * - `thinking: { type: 'disabled' }` — DeepSeek's current models think before
 *   they answer **by default** (effort `high`), and the thinking is billed as
 *   output and spends the ceiling. A support reply under
 *   `LLM_MAX_OUTPUT_TOKENS` (400) and `LLM_TIMEOUT_MS` (20 s) cannot afford
 *   it, so the documented switch turns it off on every request.
 * - Structured output: `response_format: { type: 'json_object' }` — the only
 *   structured mode DeepSeek documents; there is no `json_schema`. JSON mode
 *   guarantees an object, not the caller's object, so the schema goes into the
 *   system prompt ({@link jsonObjectInstruction}, which also says "json" as the
 *   guide requires) and `completeStructured` validates the reply and retries a
 *   bad one once. DeepSeek warns that JSON mode can answer with whitespace
 *   only: that is `no_answer` / `empty`, which gets that one retry.
 * - Never `temperature`, `top_p`, tools or `stream`.
 *
 * ## What it reads
 *
 * - `choices[0].message.content` only. A reasoning reply's `reasoning_content`
 *   is never read; an empty `content` is `no_answer` / `empty`.
 * - `finish_reason`: `stop` is an answer; `insufficient_system_resource`
 *   ("interrupted due to insufficient resource of the inference system") is
 *   DeepSeek failing, so `unavailable` — retried, counted against the
 *   provider; `length`, `content_filter` and the rest are `no_answer`.
 * - The bill: `prompt_tokens` (documented as cache hits + misses, so cached
 *   input is already in it; a body that says less than the two together is
 *   billed on the two) and `completion_tokens`.
 * - The body may start with blank lines — DeepSeek keeps a non-streaming
 *   connection alive with them while it waits; `JSON.parse` skips them.
 *
 * ## Its error table
 *
 * | status | DeepSeek's name        | kind              | retried |
 * | ------ | ---------------------- | ----------------- | ------- |
 * | 400    | Invalid Format         | `bad_request`     | no      |
 * | 401    | Authentication Fails   | `auth`            | no      |
 * | 402    | Insufficient Balance   | `quota_exhausted` | no      |
 * | 422    | Invalid Parameters     | `bad_request`     | no      |
 * | 429    | Rate Limit Reached     | `rate_limited`    | yes     |
 * | 500    | Server Error           | `unavailable`     | yes     |
 * | 503    | Server Overloaded      | `unavailable`     | yes     |
 *
 * ## Where it runs
 *
 * DeepSeek processes and stores data in the People's Republic of China — not
 * in any region this build serves. `provider-hosts.ts` fixes its processing
 * location as outside them, so the NFR-C4 gate refuses a BAA-covered
 * workspace and no `LLM_PROVIDER_REGION` can be declared for it.
 */
import {
  ChatCompletionsTransport,
  jsonObjectInstruction,
  readChatCompletion,
  readPromptCompletionUsage,
  type ChatCompletionsOptions,
  type CompletionReading,
} from './chat-completions-transport.js';
import type {
  DeepSeekSettings,
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmTier,
  LlmUsage,
} from './llm-provider.js';
import {
  isCount,
  isRecord,
  openAiEndpointUrl,
  statusFailureKind,
  type HttpFailureKind,
} from './openai-http.js';

/** The base URL when `LLM_API_BASE_URL` is unset — the only host production accepts. */
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';

/** The one structured mode DeepSeek documents. */
export type DeepSeekStructuredMode = 'json_object';

/** The chat endpoint under `LLM_API_BASE_URL` (`…/chat/completions`, no `/v1`). */
export function deepSeekChatCompletionsUrl(baseUrl: string): string {
  return openAiEndpointUrl(baseUrl, {
    key: 'LLM_API_BASE_URL',
    apiKeyName: 'LLM_API_KEY',
    path: 'chat/completions',
  });
}

/** The request body. Serialised once per call: every attempt sends the same bytes. */
export function deepSeekChatBody(
  request: LlmCompletionRequest,
  model: string,
  mode: DeepSeekStructuredMode | null,
): string {
  const format = mode === 'json_object' ? request.responseFormat : undefined;
  const system = format
    ? `${request.system}\n\n${jsonObjectInstruction(format.schema)}`
    : request.system;
  return JSON.stringify({
    model,
    messages: [{ role: 'system', content: system }, ...request.messages],
    max_tokens: request.maxOutputTokens,
    thinking: { type: 'disabled' },
    ...(format ? { response_format: { type: 'json_object' } } : {}),
  });
}

/**
 * DeepSeek's error table (`quick_start/error_codes`). Only 402 is DeepSeek's
 * own: the balance is used up, and no retry tops it up. The rest is what the
 * status says — 422 a request DeepSeek will not take, 429 pace, 500 and 503
 * DeepSeek failing.
 */
export function classifyDeepSeekFailure(status: number): HttpFailureKind {
  if (status === 402) return 'quota_exhausted';
  return statusFailureKind(status);
}

/**
 * `prompt_tokens` and `completion_tokens`. `prompt_tokens` is documented as
 * `prompt_cache_hit_tokens + prompt_cache_miss_tokens`; when a body says less
 * than the two together, the larger count is billed — a cap that under-counts
 * is spend nobody sees.
 */
export function readDeepSeekUsage(value: unknown): LlmUsage | null {
  const usage = readPromptCompletionUsage(value);
  if (!usage || !isRecord(value)) return usage;
  const hit = value['prompt_cache_hit_tokens'];
  const miss = value['prompt_cache_miss_tokens'];
  if (!isCount(hit) || !isCount(miss)) return usage;
  return { ...usage, inputTokens: Math.max(usage.inputTokens, hit + miss) };
}

/** The finish reason that is DeepSeek's inference system running out, not the reply ending. */
export const DEEPSEEK_UNAVAILABLE_FINISHES: ReadonlySet<string> = new Set([
  'insufficient_system_resource',
]);

const DEEPSEEK_READING: CompletionReading = {
  usage: readDeepSeekUsage,
  unavailableFinishes: DEEPSEEK_UNAVAILABLE_FINISHES,
};

export class DeepSeekLlmProvider implements LlmProvider {
  readonly id = 'deepseek' as const;
  readonly #transport: ChatCompletionsTransport<DeepSeekStructuredMode>;

  constructor(settings: DeepSeekSettings, options: ChatCompletionsOptions = {}) {
    // Configuration errors fail at boot, where an operator reads them.
    const endpoint = deepSeekChatCompletionsUrl(settings.baseUrl);
    this.#transport = new ChatCompletionsTransport<DeepSeekStructuredMode>(
      {
        provider: this.id,
        endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        fastModel: settings.fastModel ?? null,
      },
      {
        structuredMode: () => 'json_object',
        body: deepSeekChatBody,
        classify: classifyDeepSeekFailure,
        read: (text, meta) => readChatCompletion(text, meta, DEEPSEEK_READING),
      },
      options,
    );
  }

  /** Where the circuit stands — for tests and for anyone deciding what to show an operator. */
  get circuitState(): 'closed' | 'open' | 'half_open' {
    return this.#transport.circuitState;
  }

  complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    return this.#transport.send(request);
  }

  /** The model a tier is answered by (ADR §6a.5). */
  modelFor(tier: LlmTier = 'default'): string {
    return this.#transport.modelFor(tier);
  }
}
