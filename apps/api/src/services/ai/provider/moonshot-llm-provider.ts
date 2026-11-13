/**
 * `LLM_PROVIDER=moonshot` — the Kimi chat adapter (tm 480 · K51 · ADR
 * docs/adr/pilot-llm-embedding-provider.md §14). Moonshot AI is the company,
 * Kimi the models; the enum names the company, the root panel says
 * "Kimi (Moonshot)".
 *
 * Kimi answers the OpenAI request shape, and ADR §0/§3 still makes it its own
 * enum value and its own adapter: what differs is below, and the part that is
 * the same is `chat-completions-transport.ts`, shared with the OpenAI and
 * DeepSeek adapters. Facts are from Kimi's international platform
 * documentation (platform.kimi.ai, formerly platform.moonshot.ai; read
 * 2026-11-13; sources in the ADR).
 *
 * ## What it sends
 *
 * `POST https://api.moonshot.ai/v1/chat/completions` with:
 *
 * - `model` — `LLM_MODEL`, or `LLM_MODEL_FAST` for `tier: 'fast'` (§6a.5).
 * - `messages` — the system prompt as the first message, then the turns.
 * - `max_completion_tokens` — the ceiling's current name (`max_tokens` is
 *   marked deprecated in the API reference).
 * - `reasoning_effort: 'low'` — Kimi's current (K3) models always reason
 *   before they answer, `max` by default, and the reasoning counts against the
 *   ceiling; `low` is the least the API offers. A reply cut off before any text
 *   carries {@link LLM_MOONSHOT_EMPTY_LENGTH_HINT}.
 * - Structured output: `response_format: { type: 'json_schema', json_schema:
 *   { name, schema, strict: true } }`, which Kimi documents, with the schema in
 *   the system prompt as well — its JSON-mode guide asks for the fields to be
 *   described there. A model that answers a `json_schema` request with
 *   `invalid_request_error` is remembered for the life of the process and the
 *   same call goes on at once as `{ type: 'json_object' }` (the shape every
 *   Kimi model documents). Either way `completeStructured` validates the reply.
 * - Never `temperature`, `top_p` or the penalties: the K3 models fix them and
 *   answer any other value with an error. No tools, no `stream`.
 *
 * ## What it reads
 *
 * - `choices[0].message.content` only; `reasoning_content` is never read, and
 *   an empty `content` is `no_answer` / `empty`.
 * - `finish_reason`: `stop` is an answer; `length` and the rest `no_answer`.
 *   (Kimi's content filter is not a finish reason but a 400.)
 * - The bill: `prompt_tokens` — documented as always the whole input, cached
 *   and cache-written tokens included (a body that says less than those two is
 *   billed on them) — and `completion_tokens`, reasoning included.
 *
 * ## Its error table (`error.type`)
 *
 * | status | type                           | kind              | retried |
 * | ------ | ------------------------------ | ----------------- | ------- |
 * | 400    | `invalid_request_error`, `content_filter` | `bad_request` | no |
 * | 401    | `invalid_authentication_error`, `incorrect_api_key_error` | `auth` | no |
 * | 403    | `permission_denied_error`      | `forbidden`       | no      |
 * | 404    | `resource_not_found_error`     | `not_found`       | no      |
 * | 429    | `exceeded_current_quota_error` | `quota_exhausted` | no      |
 * | 429    | `engine_overloaded_error`      | `unavailable`     | yes     |
 * | 429    | `rate_limit_reached_error`     | `rate_limited`    | yes     |
 * | 5xx    | `server_error`, `server_unavailable`, 504 | `unavailable` | yes |
 *
 * ## Where it runs
 *
 * Moonshot AI Pte. Ltd. stores what it collects on servers in Singapore — not
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
import { LLM_MOONSHOT_EMPTY_LENGTH_HINT } from './llm-error.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmTier,
  LlmUsage,
  MoonshotSettings,
} from './llm-provider.js';
import {
  isCount,
  isRecord,
  openAiEndpointUrl,
  problemSays,
  statusFailureKind,
  type HttpFailureKind,
} from './openai-http.js';

/** The base URL when `LLM_API_BASE_URL` is unset — the only host production accepts. */
export const MOONSHOT_DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1';

/** The least reasoning Kimi's K3 models can be asked for. */
export const MOONSHOT_REASONING_EFFORT = 'low';

/** `json_schema` first; `json_object` for a model that refused it. */
export type MoonshotStructuredMode = 'json_schema' | 'json_object';

/** The chat endpoint under `LLM_API_BASE_URL` (`…/v1/chat/completions`). */
export function moonshotChatCompletionsUrl(baseUrl: string): string {
  return openAiEndpointUrl(baseUrl, {
    key: 'LLM_API_BASE_URL',
    apiKeyName: 'LLM_API_KEY',
    path: 'chat/completions',
  });
}

/** The request body for one mode. Serialised once per mode: every attempt in it sends the same bytes. */
export function moonshotChatBody(
  request: LlmCompletionRequest,
  model: string,
  mode: MoonshotStructuredMode | null,
): string {
  const format = mode ? request.responseFormat : undefined;
  const system = format
    ? `${request.system}\n\n${jsonObjectInstruction(format.schema)}`
    : request.system;
  return JSON.stringify({
    model,
    messages: [{ role: 'system', content: system }, ...request.messages],
    max_completion_tokens: request.maxOutputTokens,
    reasoning_effort: MOONSHOT_REASONING_EFFORT,
    ...(format && mode === 'json_schema'
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: format.name, schema: format.schema, strict: true },
          },
        }
      : {}),
    ...(format && mode === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
  });
}

/** `exceeded_current_quota_error`: the balance or the token quota is used up — no retry restores it. */
export const MOONSHOT_QUOTA_TYPES: ReadonlySet<string> = new Set(['exceeded_current_quota_error']);
/** `engine_overloaded_error`: Kimi's engine is overloaded — its failure, not this caller's pace. */
export const MOONSHOT_OVERLOADED_TYPES: ReadonlySet<string> = new Set(['engine_overloaded_error']);

/** Kimi's error table (`docs/api/errors`): its 429 says three different things by `error.type`. */
export function classifyMoonshotFailure(
  status: number,
  problem: { code: string | null; type: string | null },
): HttpFailureKind {
  if (problemSays(problem, MOONSHOT_QUOTA_TYPES)) return 'quota_exhausted';
  if (status === 429 && problemSays(problem, MOONSHOT_OVERLOADED_TYPES)) return 'unavailable';
  return statusFailureKind(status);
}

/**
 * `prompt_tokens` and `completion_tokens`. Kimi documents `prompt_tokens` as
 * the whole input — cached, cache-written and uncached tokens together — so it
 * is billed as is, unless a body says less than its cached and cache-written
 * counts together; then those are.
 */
export function readMoonshotUsage(value: unknown): LlmUsage | null {
  const usage = readPromptCompletionUsage(value);
  if (!usage || !isRecord(value)) return usage;
  const details = isRecord(value['prompt_tokens_details']) ? value['prompt_tokens_details'] : {};
  const cachedValue = value['cached_tokens'] ?? details['cached_tokens'];
  const cached = isCount(cachedValue) ? cachedValue : 0;
  const written = isCount(details['cache_write_tokens']) ? details['cache_write_tokens'] : 0;
  return { ...usage, inputTokens: Math.max(usage.inputTokens, cached + written) };
}

const MOONSHOT_READING: CompletionReading = {
  usage: readMoonshotUsage,
  emptyLengthHint: LLM_MOONSHOT_EMPTY_LENGTH_HINT,
};

export class MoonshotLlmProvider implements LlmProvider {
  readonly id = 'moonshot' as const;
  /**
   * Models that refused `json_schema`. Per instance, which is per process: a
   * model gains the feature on Kimi's side, and a restart is when this process
   * would find out.
   */
  readonly #noJsonSchema = new Set<string>();
  readonly #transport: ChatCompletionsTransport<MoonshotStructuredMode>;

  constructor(settings: MoonshotSettings, options: ChatCompletionsOptions = {}) {
    // Configuration errors fail at boot, where an operator reads them.
    const endpoint = moonshotChatCompletionsUrl(settings.baseUrl);
    this.#transport = new ChatCompletionsTransport<MoonshotStructuredMode>(
      {
        provider: this.id,
        endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        fastModel: settings.fastModel ?? null,
      },
      {
        structuredMode: (model) => (this.#noJsonSchema.has(model) ? 'json_object' : 'json_schema'),
        body: moonshotChatBody,
        classify: classifyMoonshotFailure,
        read: (text, meta) => readChatCompletion(text, meta, MOONSHOT_READING),
        // A content-filter 400 is about the conversation, not the mode; only a
        // request Kimi calls invalid moves the model to `json_object`.
        fallback: (model, mode, failure, problem) => {
          if (
            mode !== 'json_schema' ||
            failure.kind !== 'bad_request' ||
            !(problem?.type === 'invalid_request_error' || problem?.param === 'response_format')
          ) {
            return null;
          }
          this.#noJsonSchema.add(model);
          return {
            mode: 'json_object',
            event: 'llm.json_schema_unsupported',
            message:
              'the model refused response_format json_schema; it is asked for a json_object from now on',
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
