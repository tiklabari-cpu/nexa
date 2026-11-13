/**
 * `LLM_PROVIDER=openai` — the chat adapter (tm 255.6 · ADR
 * docs/adr/pilot-llm-embedding-provider.md §3.1 and §10).
 *
 * One request shape: `POST {LLM_API_BASE_URL}/chat/completions` carrying
 * `model`, `messages` and `max_completion_tokens` — no streaming, no tools
 * (ADR §5, §6). The answer is `choices[0].message.content`, the bill is
 * `usage`. The network is a constructor argument (`fetchImpl`, as in
 * `s3-store.ts`), so every test of this file runs without a provider and
 * without a key.
 *
 * Since tm 480 the request loop described below lives in
 * `chat-completions-transport.ts`, shared with the DeepSeek and Kimi adapters;
 * this file is the OpenAI dialect on top of it (body, error table, the
 * `json_schema` → prompt fallback). The behaviour did not change.
 *
 * ## Tier and structured output (tm 283.1 · ADR §6a)
 *
 * - `model` is `LLM_MODEL` for `tier: 'default'` and `LLM_MODEL_FAST` for
 *   `tier: 'fast'`, or `LLM_MODEL` again when that is unset (§6a.5).
 * - A request with a `responseFormat` adds
 *   `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }`.
 *   A model without structured outputs answers that with a 400 whose `param`
 *   is `response_format`. The adapter then remembers the model for the life
 *   of the process and sends the same call on the plain-JSON path — no
 *   `response_format`, the schema written into the system prompt (§6a.4.1) —
 *   as its next attempt, at once. It does not validate the reply: that is
 *   `completeStructured`'s gate (`structured-output.ts`), which every
 *   provider's reply passes.
 *
 * ## When it fails
 *
 * Every failure leaves as an `LlmProviderError` (`llm-error.ts`) and the skill
 * engine turns every one of them into a conversation a human answers. What
 * differs is what happens before the error gets there:
 *
 * - **One deadline for the whole call.** `LLM_TIMEOUT_MS` covers every attempt
 *   and every wait between them. The call runs inside the request that stored
 *   the customer's message (`routes/customer.ts`), so the deadline is how long
 *   a customer's send can be held; a per-attempt timeout would multiply it by
 *   the attempt count. One `AbortController` spans the call and aborting it
 *   cancels whatever is in flight — the fetch, or the body read after it — so
 *   an abandoned request does not keep running behind the error.
 * - **Retried** (transient): network errors, 429 rate limits and 5xx, up to
 *   {@link LLM_MAX_ATTEMPTS} attempts, backing off with jitter (OpenAI's own
 *   advice) and never sooner than the provider's `Retry-After`. Only while the
 *   deadline still leaves {@link LLM_MIN_ATTEMPT_MS} for the next attempt: a
 *   wait that would outlast the deadline is not started, because failing later
 *   is the same result, later.
 * - **Never retried** (permanent): 400, 401, 403, 404 and every other 4xx; a
 *   429 whose code says the account is out of credit or over a spend limit —
 *   OpenAI's guide: retrying "won't restore API access"; a response that is not
 *   a completion; and a completion with no answer in it, which includes one
 *   cut off at `max_completion_tokens` — half a sentence is not a reply to send
 *   a customer.
 * - **The circuit breaker** (`circuit-breaker.ts`) stands in front of all of
 *   it, so an outage costs the first few customers a deadline each rather than
 *   every customer.
 *
 * ## The log
 *
 * Events carry the model id, the attempt, the failure kind, the HTTP status,
 * the provider's error code and its request id. Never the key, the prompt, the
 * reply or the provider's error message (`llm-error.ts` says why the last).
 * {@link LLM_SECRET_LOG_PATHS} covers the other way the key could reach a line
 * — somebody logging the configuration.
 */
import { LLM_SECRET_LOG_PATHS } from '../../../lib/log-redact.js';
import {
  ChatCompletionsTransport,
  jsonSchemaInstruction,
  readChatCompletion,
  readPromptCompletionUsage,
  type ChatCompletionsOptions,
  type CompletionReading,
} from './chat-completions-transport.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmTier,
  OpenAiSettings,
} from './llm-provider.js';
import { classifyHttpFailure, openAiEndpointUrl } from './openai-http.js';

// Moved to `openai-http.ts` when the embedding adapter needed them too
// (tm 255.7); still exported from here, where 255.6 published them.
export { classifyHttpFailure, OPENAI_QUOTA_CODES, retryAfterMs } from './openai-http.js';

// The retry loop, its constants and its logger moved to
// `chat-completions-transport.ts` when DeepSeek and Kimi needed the same
// transport (tm 480); still exported from here, where 255.6 published them.
export {
  defaultLlmLogger,
  jsonSchemaInstruction,
  LLM_CIRCUIT_FAILURE_THRESHOLD,
  LLM_CIRCUIT_OPEN_MS,
  LLM_MAX_ATTEMPTS,
  LLM_MAX_RESPONSE_BYTES,
  LLM_MIN_ATTEMPT_MS,
  LLM_RETRY_BACKOFF_BASE_MS,
  LLM_RETRY_BACKOFF_CAP_MS,
  llmFailureFields,
  llmRetryBackoffMs,
  type LlmLogger,
} from './chat-completions-transport.js';

/**
 * Where the key would sit if anyone logged the configuration or a request.
 * Kept with every other provider credential in `lib/log-redact.ts` (tm 255.9),
 * which the server's `redact.paths` spreads; used by `defaultLlmLogger`.
 */
export { LLM_SECRET_LOG_PATHS };

export type OpenAiLlmProviderOptions = ChatCompletionsOptions;

/**
 * The chat endpoint under `LLM_API_BASE_URL`, or an error for the operator —
 * `openAiEndpointUrl` says what is checked and why.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  return openAiEndpointUrl(baseUrl, {
    key: 'LLM_API_BASE_URL',
    apiKeyName: 'LLM_API_KEY',
    path: 'chat/completions',
  });
}

/**
 * How a structured request is sent: with `response_format` (`json_schema`),
 * or on the plain-JSON path with the schema in the prompt (`prompt`).
 */
export type StructuredMode = 'json_schema' | 'prompt';

/** The request body for one mode. Serialised once per mode: every attempt in it sends the same bytes. */
export function chatCompletionBody(
  request: LlmCompletionRequest,
  model: string,
  mode: StructuredMode | null,
): string {
  const format = request.responseFormat;
  const system =
    format && mode === 'prompt'
      ? `${request.system}\n\n${jsonSchemaInstruction(format.schema)}`
      : request.system;
  return JSON.stringify({
    model,
    messages: [{ role: 'system', content: system }, ...request.messages],
    max_completion_tokens: request.maxOutputTokens,
    ...(format && mode === 'json_schema'
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: format.name, schema: format.schema, strict: true },
          },
        }
      : {}),
  });
}

/** OpenAI's completion: `prompt_tokens` / `completion_tokens`, `refusal`, `stop`. */
const OPENAI_READING: CompletionReading = { usage: readPromptCompletionUsage };

export class OpenAiLlmProvider implements LlmProvider {
  readonly id = 'openai' as const;
  /**
   * Models that refused `response_format: json_schema` (ADR §6a.4.1). Per
   * instance, which is per process: a model gains the feature on the provider's
   * side, and a restart is when this process would find out.
   */
  readonly #noJsonSchema = new Set<string>();
  readonly #transport: ChatCompletionsTransport<StructuredMode>;

  constructor(settings: OpenAiSettings, options: OpenAiLlmProviderOptions = {}) {
    // Configuration errors fail at boot, where an operator reads them, rather
    // than as a failed call on the first customer message.
    const endpoint = chatCompletionsUrl(settings.baseUrl);
    this.#transport = new ChatCompletionsTransport<StructuredMode>(
      {
        provider: this.id,
        endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        fastModel: settings.fastModel ?? null,
      },
      {
        structuredMode: (model) => (this.#noJsonSchema.has(model) ? 'prompt' : 'json_schema'),
        body: chatCompletionBody,
        classify: classifyHttpFailure,
        read: (text, meta) => readChatCompletion(text, meta, OPENAI_READING),
        // A model without structured outputs answers `json_schema` with a 400
        // whose `param` is `response_format`; the same call goes on with the
        // schema in the prompt, at once.
        fallback: (model, mode, failure, problem) => {
          if (
            mode !== 'json_schema' ||
            failure.kind !== 'bad_request' ||
            problem?.param !== 'response_format'
          ) {
            return null;
          }
          this.#noJsonSchema.add(model);
          return {
            mode: 'prompt',
            event: 'llm.json_schema_unsupported',
            message:
              'the model refused response_format json_schema; its schema goes in the prompt from now on',
          };
        },
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

  /** Whether `model` has been seen refusing `json_schema` — for tests and an operator's question. */
  structuredOutputsRefusedBy(model: string): boolean {
    return this.#noJsonSchema.has(model);
  }
}
