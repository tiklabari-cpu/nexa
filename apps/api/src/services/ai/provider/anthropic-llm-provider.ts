/**
 * `LLM_PROVIDER=anthropic` — the Claude chat adapter (tm 479 · K51 · ADR
 * docs/adr/pilot-llm-embedding-provider.md §13).
 *
 * The ADR's §3.2 ruled Anthropic's OpenAI-compatible layer out for production
 * (its own documentation says so), and §0 made the rule general: a new vendor
 * is a new enum value with its own adapter. This is that adapter, on the
 * official SDK (`@anthropic-ai/sdk`) and its native Messages API — one
 * non-streaming, tool-less `messages.create` per attempt (ADR §5, §6).
 *
 * ## What it sends
 *
 * - `model` — `LLM_MODEL`, or `LLM_MODEL_FAST` for `tier: 'fast'` (§6a.5).
 * - `max_tokens` — the request's `maxOutputTokens`. A current Claude model
 *   thinks before it writes and cannot be told not to; its thinking counts
 *   against this ceiling, so a reply cut off before any text says which
 *   setting to change ({@link LLM_ANTHROPIC_EMPTY_LENGTH_HINT}).
 * - `system` as its own field, `messages` as the conversation. The last turn
 *   must be the customer's: an assistant turn at the end would be a prefill,
 *   which current models answer with a 400 — so the adapter refuses such a
 *   prompt itself (`bad_request` / `prompt_invalid`, no request). Assistant
 *   turns before the first customer turn (a greeting the bot sent first) move
 *   into the system prompt, because a conversation sent to the API opens with
 *   the user.
 * - `output_config.effort` — `LLM_EFFORT` (low by default: support replies,
 *   not research), and `output_config.format` for a structured request: the
 *   caller's strict schema in the shape the API accepts ({@link anthropicOutputSchema}).
 *   The reply is validated by `completeStructured` like every provider's.
 * - `inference_geo: 'us'` when the region is `us` (NFR-C4). The API pins
 *   inference to the US or leaves it global; there is no EU pin, so production
 *   refuses `LLM_PROVIDER_REGION=eu` for this provider at boot
 *   (`provider-hosts.ts`). Elsewhere `eu` runs unpinned and says so once.
 *   A reply whose `usage.inference_geo` is not the one asked for is logged.
 * - `cache_control: { type: 'ephemeral' }` at the top level: the system
 *   prompt and history are re-sent every turn, and a cached prefix bills at a
 *   tenth.
 * - Never `temperature`, `top_p` or `top_k`: the API version this SDK speaks
 *   (2026-10-21) answers any of them with a 400.
 * - With `LLM_ANTHROPIC_FALLBACK` on (the default), the request goes through
 *   `client.beta.messages.create` with `fallbacks: 'default'` under the
 *   {@link ANTHROPIC_FALLBACK_BETA} header: a request a model's safety
 *   classifier declines is re-run server-side on the model Anthropic
 *   recommends for that refusal category. The model that answered is logged.
 *
 * ## What it reads
 *
 * - The text: every `text` block after the last `fallback` block (text before
 *   a switch is the declined model's, discarded). Thinking blocks are never
 *   read.
 * - `stop_reason`: only `end_turn` is an answer. `refusal` is `no_answer` /
 *   `refusal` (the category, when given, as its code), `max_tokens` is
 *   `no_answer` / `length` — the same reasons the OpenAI adapter gives, so
 *   `completeStructured` and every caller treat them alike.
 * - The bill: input = `input_tokens + cache_creation_input_tokens +
 *   cache_read_input_tokens`, output = `output_tokens` (thinking included —
 *   it is billed as output). When a fallback ran, `usage.iterations` lists
 *   every attempt and the sum of them is counted: the top-level `usage`
 *   covers only the attempt that answered, and a count that misses an
 *   attempt is spend nobody sees.
 *
 * ## When it fails
 *
 * The OpenAI adapter's policy, unchanged (`openai-llm-provider.ts`): one
 * deadline for the whole call, the SDK's own retries off (`maxRetries: 0`)
 * so this file decides, transient failures retried with equal jitter and never
 * sooner than `retry-after`, the circuit breaker in front. The SDK's typed
 * errors say which failure it was — no message is matched:
 *
 * | SDK error                                  | kind              | retried |
 * | ------------------------------------------ | ----------------- | ------- |
 * | `APIUserAbortError`, `APIConnectionTimeoutError` | `timeout`   | (deadline) |
 * | `APIConnectionError`                       | `network`         | yes     |
 * | `RateLimitError` (429)                     | `rate_limited`    | yes     |
 * | `OverloadedError` (529), `InternalServerError` (5xx), 408 | `unavailable` | yes |
 * | 402 / `billing_error`                      | `quota_exhausted` | no      |
 * | `AuthenticationError` (401)                | `auth`            | no      |
 * | `PermissionDeniedError` (403)              | `forbidden`       | no      |
 * | `NotFoundError` (404)                      | `not_found`       | no      |
 * | any other 4xx                              | `bad_request`     | no      |
 * | a redirect, an oversized body              | `bad_response`    | no      |
 *
 * ## What never leaves
 *
 * The SDK's own logging is off (`logLevel: 'off'`) and its OpenTelemetry spans
 * are pinned to `metadata_only` without trace propagation: an environment
 * variable cannot turn either into a channel for the key, the prompt or the
 * reply. Redirects are refused, not followed, and a body over
 * `LLM_MAX_RESPONSE_BYTES` is not read past the cap. Log lines carry what the
 * OpenAI adapter's carry — model, attempt, kind, status, the error's type and
 * the request id — never the key, the prompt, the reply or a provider message.
 */
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import type { Region } from '@siyahtus/types';
import { CircuitBreaker, type CircuitPermit } from './circuit-breaker.js';
import type { JsonSchema, JsonSchemaType } from './json-schema.js';
import { LLM_ANTHROPIC_EMPTY_LENGTH_HINT, LlmProviderError } from './llm-error.js';
import type {
  AnthropicSettings,
  LlmCompletion,
  LlmCompletionRequest,
  LlmMessage,
  LlmProvider,
  LlmTier,
  LlmUsage,
} from './llm-provider.js';
import {
  HEADER_SAFE,
  isCount,
  isRecord,
  networkCode,
  readCapped,
  ResponseTooLarge,
  retryAfterMs,
  SAFE_CODE,
  SAFE_REQUEST_ID,
  safeToken,
} from './openai-http.js';
import {
  defaultLlmLogger,
  LLM_CIRCUIT_FAILURE_THRESHOLD,
  LLM_CIRCUIT_OPEN_MS,
  LLM_MAX_ATTEMPTS,
  LLM_MAX_RESPONSE_BYTES,
  LLM_MIN_ATTEMPT_MS,
  llmFailureFields,
  llmRetryBackoffMs,
  type LlmLogger,
} from './openai-llm-provider.js';

/** The base URL when `LLM_API_BASE_URL` is unset — the only host production accepts. */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** The beta header the `fallbacks: 'default'` form needs (the array form takes it too). */
export const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * What `inference_geo` is sent for each region. `us` pins inference to the
 * US; the API has no EU pin, so `eu` sends nothing (global) — refused in
 * production by `llmEndpointProblem`, tolerated elsewhere with a warning.
 */
export const ANTHROPIC_INFERENCE_GEO: Readonly<Record<Region, 'us' | null>> = {
  us: 'us',
  eu: null,
};

/** Ceiling on an error body; the SDK reads only `error.type` from it. */
const PROBLEM_MAX_BYTES = 65_536;

export interface AnthropicLlmProviderOptions {
  /** How requests leave the process. Injected by every test; the global `fetch` otherwise. */
  fetchImpl?: typeof fetch;
  logger?: LlmLogger;
  /** Attempts per call; `LLM_MAX_ATTEMPTS` by default. */
  maxAttempts?: number;
  circuit?: { failureThreshold?: number; openMs?: number };
  /** Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** The jitter's source, in [0, 1). */
  random?: () => number;
  now?: () => number;
}

/**
 * `LLM_API_BASE_URL` as the SDK's `baseURL`, or an error for the operator.
 * The SDK appends `/v1/messages` itself, so the setting is the host root —
 * a value ending in `/v1` (OpenAI's convention, copied over) would send every
 * request to `/v1/v1/messages` and is refused here, with what to write
 * instead. The other checks are `openAiEndpointUrl`'s, for its reasons; no
 * message repeats the URL.
 */
export function anthropicBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('LLM_API_BASE_URL is not a URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('LLM_API_BASE_URL must be an http(s) URL.');
  }
  if (url.username || url.password) {
    throw new Error(
      'LLM_API_BASE_URL must not carry credentials; the key belongs in LLM_API_KEY, which is kept out of logs.',
    );
  }
  if (url.search || url.hash) {
    throw new Error('LLM_API_BASE_URL must not have a query string or fragment.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/v1$/i.test(path)) {
    throw new Error(
      `LLM_API_BASE_URL for anthropic is the host root (${ANTHROPIC_DEFAULT_BASE_URL}): the SDK adds /v1/messages itself.`,
    );
  }
  return `${url.origin}${path}`;
}

function typesOf(node: JsonSchema): JsonSchemaType[] {
  if (node.type === undefined) return [];
  return Array.isArray(node.type) ? node.type : [node.type];
}

/**
 * A type union (`['string', 'null']`) as `anyOf` branches, each with only the
 * keywords that belong to its type — the strict subset allows unions, the
 * Messages API's schema reads `type` as one name. `enum` keeps its union as
 * it is: the values already say which types are allowed.
 */
function splitUnions(node: JsonSchema): Record<string, unknown> {
  if (node.anyOf) {
    return {
      ...(node.description !== undefined ? { description: node.description } : {}),
      anyOf: node.anyOf.map(splitUnions),
    };
  }
  const types = typesOf(node);
  if (node.enum || types.length <= 1) return single(node, types[0]);
  return {
    ...(node.description !== undefined ? { description: node.description } : {}),
    anyOf: types.map((type) => single({ ...node, description: undefined }, type)),
  };
}

function single(node: JsonSchema, type: JsonSchemaType | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (node.enum) out['enum'] = [...node.enum];
  else if (type) out['type'] = type;
  if (node.description !== undefined) out['description'] = node.description;
  const is = (candidate: JsonSchemaType) =>
    type === candidate || (node.enum !== undefined && typesOf(node).includes(candidate));
  if (is('object')) {
    out['properties'] = Object.fromEntries(
      Object.entries(node.properties ?? {}).map(([key, child]) => [key, splitUnions(child)]),
    );
    out['required'] = [...(node.required ?? [])];
    out['additionalProperties'] = false;
  }
  if (is('array') && node.items) {
    out['items'] = splitUnions(node.items);
    if (node.minItems !== undefined) out['minItems'] = node.minItems;
    if (node.maxItems !== undefined) out['maxItems'] = node.maxItems;
  }
  if (is('number') || is('integer')) {
    if (node.minimum !== undefined) out['minimum'] = node.minimum;
    if (node.maximum !== undefined) out['maximum'] = node.maximum;
  }
  return out;
}

/**
 * The caller's strict schema (`json-schema.ts`) as `output_config.format.schema`.
 * Unions become `anyOf`, then the SDK's own `transformJSONSchema` moves what
 * the API does not constrain on (`minimum`, `maximum`, `maxItems`, a
 * `minItems` above 1) into the node's description, as the SDK's `parse()`
 * helpers do. Nothing is lost: `completeStructured` checks the reply against
 * the original schema, every keyword included.
 */
export function anthropicOutputSchema(schema: JsonSchema): Record<string, unknown> {
  return transformJSONSchema(splitUnions(schema));
}

/**
 * The conversation in the shape the Messages API takes, or `null` when it
 * cannot be sent: no turns, or the last one is not the customer's (a prefill,
 * which current models refuse). Leading assistant turns move into `system`.
 */
export function anthropicConversation(
  system: string,
  messages: readonly LlmMessage[],
): { system: string; messages: LlmMessage[] } | null {
  const turns = messages.map((message) => ({ ...message }));
  if (turns.at(-1)?.role !== 'user') return null;
  const opening: string[] = [];
  while (turns[0]?.role === 'assistant') opening.push(turns.shift()!.content);
  return {
    system:
      opening.length > 0
        ? `${system}\n\nBefore the customer's first message, the conversation opened with this message from you:\n${opening.join('\n')}`
        : system,
    messages: turns,
  };
}

/**
 * The request body for one call. Built once per call: every attempt sends the
 * same bytes. Exported for the tests, which pin what is — and is not — sent.
 */
export function anthropicRequestBody(
  request: LlmCompletionRequest,
  model: string,
  settings: Pick<AnthropicSettings, 'effort' | 'region' | 'fallback'>,
): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming | null {
  const conversation = anthropicConversation(request.system, request.messages);
  if (!conversation) return null;
  const geo = ANTHROPIC_INFERENCE_GEO[settings.region];
  const format = request.responseFormat;
  return {
    model,
    max_tokens: request.maxOutputTokens,
    system: conversation.system,
    messages: conversation.messages,
    output_config: {
      effort: settings.effort,
      ...(format
        ? { format: { type: 'json_schema', schema: anthropicOutputSchema(format.schema) } }
        : {}),
    },
    cache_control: { type: 'ephemeral' },
    ...(geo ? { inference_geo: geo } : {}),
    ...(settings.fallback ? { betas: [ANTHROPIC_FALLBACK_BETA], fallbacks: 'default' } : {}),
  };
}

/**
 * `fetch` with two guards the SDK does not have: a redirect is returned, not
 * followed (the next hop would receive the conversation, and nobody
 * configured it), and the body is read here under a cap — a success body up
 * to `LLM_MAX_RESPONSE_BYTES`, an error body up to 64 KiB — so whatever the
 * far end sends, the SDK parses at most that.
 */
export function guardedFetch(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await fetchImpl(input, { ...init, redirect: 'manual' });
    const limit = response.ok ? LLM_MAX_RESPONSE_BYTES : PROBLEM_MAX_BYTES;
    const text = await readCapped(response, limit);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    const empty = response.status === 204 || response.status === 304;
    return new Response(empty ? null : text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }) as typeof fetch;
}

type AttemptResult =
  | { ok: true; completion: LlmCompletion; served: string | null; geo: string | null }
  | { ok: false; error: LlmProviderError; retryAfterMs: number | null };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class AnthropicLlmProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #fastModel: string;
  readonly #settings: Pick<AnthropicSettings, 'effort' | 'region' | 'fallback'>;
  readonly #log: LlmLogger;
  readonly #maxAttempts: number;
  readonly #openMs: number;
  readonly #breaker: CircuitBreaker;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;
  readonly #now: () => number;

  constructor(settings: AnthropicSettings, options: AnthropicLlmProviderOptions = {}) {
    // Configuration errors fail at boot, where an operator reads them.
    const baseURL = anthropicBaseUrl(settings.baseUrl);
    if (!HEADER_SAFE.test(settings.apiKey)) {
      throw new Error('LLM_API_KEY contains whitespace or characters an HTTP header cannot carry.');
    }
    this.#model = settings.model;
    this.#fastModel = settings.fastModel || settings.model;
    this.#settings = {
      effort: settings.effort,
      region: settings.region,
      fallback: settings.fallback,
    };
    this.#client = new Anthropic({
      apiKey: settings.apiKey,
      // Explicit, so the SDK's own resolution (ANTHROPIC_AUTH_TOKEN, a profile
      // on disk, ANTHROPIC_BASE_URL) can never pick another credential or host.
      authToken: null,
      baseURL,
      maxRetries: 0,
      fetch: guardedFetch(options.fetchImpl ?? fetch),
      logLevel: 'off',
      openTelemetry: { propagation: false, traces: { contentMode: 'metadata_only' } },
    });
    this.#log = options.logger ?? defaultLlmLogger();
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? LLM_MAX_ATTEMPTS);
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
    this.#now = options.now ?? Date.now;
    this.#openMs = options.circuit?.openMs ?? LLM_CIRCUIT_OPEN_MS;
    this.#breaker = new CircuitBreaker({
      failureThreshold: options.circuit?.failureThreshold ?? LLM_CIRCUIT_FAILURE_THRESHOLD,
      openMs: this.#openMs,
      now: this.#now,
    });
    if (ANTHROPIC_INFERENCE_GEO[settings.region] === null) {
      this.#log.warn(
        {
          ...this.#where(this.#model),
          event: 'llm.inference_geo_unpinned',
          region: settings.region,
        },
        'Anthropic cannot pin inference to this region; requests run unpinned (production refuses this configuration)',
      );
    }
  }

  /** Where the circuit stands — for tests and for anyone deciding what to show an operator. */
  get circuitState(): 'closed' | 'open' | 'half_open' {
    return this.#breaker.state;
  }

  /** The model a tier is answered by (ADR §6a.5). */
  modelFor(tier: LlmTier = 'default'): string {
    return tier === 'fast' ? this.#fastModel : this.#model;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const permit = this.#breaker.acquire();
    if (!permit) {
      this.#log.debug(
        { ...this.#where(this.modelFor(request.tier), request), event: 'llm.short_circuited' },
        'llm circuit open, provider not called',
      );
      throw new LlmProviderError('circuit_open');
    }

    let outcome: 'healthy' | 'faulty' = 'healthy';
    try {
      return await this.#call(request);
    } catch (error) {
      if (error instanceof LlmProviderError && error.providerFault) outcome = 'faulty';
      throw error;
    } finally {
      this.#settle(permit, outcome);
    }
  }

  async #call(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const model = this.modelFor(request.tier);
    const where = this.#where(model, request);
    const body = anthropicRequestBody(request, model, this.#settings);
    if (!body) {
      const error = new LlmProviderError('bad_request', { reason: 'prompt_invalid' });
      this.#log.warn(
        { ...where, event: 'llm.failed', ...llmFailureFields(error) },
        'llm prompt does not end with a customer turn; not sent',
      );
      throw error;
    }

    const started = this.#now();
    const deadline = started + request.timeoutMs;
    const controller = new AbortController();
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, request.timeoutMs);

    try {
      for (let attempt = 1; ; attempt += 1) {
        this.#log.debug({ ...where, event: 'llm.attempt', attempt }, 'llm request');
        const result = await this.#attempt(body, controller.signal, deadline, () => expired);

        if (result.ok) {
          const { usage } = result.completion;
          const fellBack = result.served !== null && result.served !== model;
          if (fellBack) {
            this.#log.info(
              { ...where, event: 'llm.fallback_served', servedModel: result.served },
              'the model declined; a fallback model answered',
            );
          }
          const geo = ANTHROPIC_INFERENCE_GEO[this.#settings.region];
          if (geo !== null && result.geo !== geo) {
            this.#log.warn(
              {
                ...where,
                event: 'llm.inference_geo_mismatch',
                expected: geo,
                reported: safeToken(result.geo, SAFE_CODE),
              },
              'the reply does not say it was inferred in the pinned geography',
            );
          }
          this.#log.info(
            {
              ...where,
              event: 'llm.completed',
              attempts: attempt,
              durationMs: this.#now() - started,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              ...(fellBack ? { servedModel: result.served } : {}),
            },
            'llm answered',
          );
          return result.completion;
        }

        const failure = result.error;
        failure.attempts = attempt;
        const fields = { ...where, attempt, ...llmFailureFields(failure) };
        const delayMs = this.#retryDelay(failure, attempt, result.retryAfterMs, deadline);
        if (delayMs !== null) {
          this.#log.warn(
            { ...fields, event: 'llm.retry', delayMs },
            'llm attempt failed, retrying',
          );
          await this.#sleep(delayMs);
          continue;
        }

        const level = failure.providerFault ? 'error' : 'warn';
        this.#log[level](
          { ...fields, event: 'llm.failed', durationMs: this.#now() - started },
          'llm call failed',
        );
        throw failure;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** How long to wait before the next attempt, or `null` when this failure ends the call. */
  #retryDelay(
    failure: LlmProviderError,
    attempt: number,
    retryAfter: number | null,
    deadline: number,
  ): number | null {
    if (!failure.transient || attempt >= this.#maxAttempts) return null;
    const delay = Math.max(llmRetryBackoffMs(attempt, this.#random), retryAfter ?? 0);
    return this.#now() + delay + LLM_MIN_ATTEMPT_MS <= deadline ? delay : null;
  }

  async #attempt(
    body: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
    signal: AbortSignal,
    deadline: number,
    expired: () => boolean,
  ): Promise<AttemptResult> {
    const options = {
      signal,
      timeout: Math.max(1, deadline - this.#now()),
      maxRetries: 0,
    };
    let message: unknown;
    try {
      // Two endpoints, one body: `betas`/`fallbacks` are only in it when the
      // fallback is on, and only the beta method sends them.
      message = this.#settings.fallback
        ? await this.#client.beta.messages.create(body, options)
        : await this.#client.messages.create(
            body as Anthropic.Messages.MessageCreateParamsNonStreaming,
            options,
          );
    } catch (error) {
      return this.#failure(error, expired);
    }
    return readMessage(message);
  }

  /** An SDK error as the failure it is (the table in the file header). */
  #failure(error: unknown, expired: () => boolean): AttemptResult {
    const failed = (kind: LlmProviderError['kind'], details = {}) => ({
      ok: false as const,
      error: new LlmProviderError(kind, details),
      retryAfterMs: null,
    });
    if (error instanceof APIUserAbortError || error instanceof APIConnectionTimeoutError) {
      return failed('timeout');
    }
    if (error instanceof APIConnectionError) {
      if (expired()) return failed('timeout');
      if (error.cause instanceof ResponseTooLarge) {
        return failed('bad_response', { reason: 'too_large' });
      }
      return failed('network', { code: networkCode(error.cause ?? error) });
    }
    if (!(error instanceof APIError)) throw error;

    const status = typeof error.status === 'number' ? error.status : null;
    const code = safeToken(error.type, SAFE_CODE);
    const requestId = safeToken(error.requestID, SAFE_REQUEST_ID);
    const meta = { status, code, requestId };
    const retry = retryAfterMs(error.headers?.get('retry-after') ?? null, this.#now());
    const kind: LlmProviderError['kind'] =
      status === 402 || code === 'billing_error'
        ? 'quota_exhausted'
        : error instanceof RateLimitError
          ? 'rate_limited'
          : error instanceof AuthenticationError
            ? 'auth'
            : error instanceof PermissionDeniedError
              ? 'forbidden'
              : error instanceof NotFoundError
                ? 'not_found'
                : status !== null && (status >= 500 || status === 408)
                  ? 'unavailable'
                  : status !== null && status >= 400
                    ? 'bad_request'
                    : 'bad_response';
    return {
      ok: false,
      error: new LlmProviderError(kind, {
        ...meta,
        ...(kind === 'bad_response'
          ? { reason: status !== null && status >= 300 && status < 400 ? 'redirect' : 'status' }
          : {}),
      }),
      retryAfterMs: retry,
    };
  }

  #settle(permit: CircuitPermit, outcome: 'healthy' | 'faulty'): void {
    const transition = this.#breaker.release(permit, outcome);
    if (transition === 'opened') {
      this.#log.error(
        {
          ...this.#where(this.#model),
          event: 'llm.circuit_opened',
          probe: permit.probe,
          consecutiveFailures: this.#breaker.consecutiveFailures,
          openMs: this.#openMs,
        },
        'llm circuit opened: calls fail fast and go to a human until the window ends',
      );
    } else if (transition === 'closed') {
      this.#log.info(
        { ...this.#where(this.#model), event: 'llm.circuit_closed' },
        'llm circuit closed: the probe was answered',
      );
    }
  }

  /** What every line about a call carries — the OpenAI adapter's fields. */
  #where(model: string, request?: LlmCompletionRequest): Record<string, unknown> {
    return {
      provider: this.id,
      model,
      ...(request?.tier === 'fast' ? { tier: 'fast' } : {}),
      ...(request?.responseFormat ? { format: request.responseFormat.name } : {}),
    };
  }
}

/**
 * A 2xx body, already parsed by the SDK, read as an answer. Checked field by
 * field all the same: the SDK types what it expects, not what arrived.
 */
function readMessage(message: unknown): AttemptResult {
  const requestId = isRecord(message) ? safeToken(message['_request_id'], SAFE_REQUEST_ID) : null;
  const meta = { status: 200, requestId };
  const failed = (kind: 'bad_response' | 'no_answer', details: Record<string, unknown>) => ({
    ok: false as const,
    error: new LlmProviderError(kind, { ...meta, ...details }),
    retryAfterMs: null,
  });
  if (!isRecord(message) || !Array.isArray(message['content'])) {
    return failed('bad_response', { reason: 'shape' });
  }
  const usage = readUsage(message['usage']);
  const stop = message['stop_reason'];
  if (!usage || typeof stop !== 'string') return failed('bad_response', { reason: 'shape' });

  const blocks = message['content'] as unknown[];
  const lastSwitch = blocks.findLastIndex(
    (block) => isRecord(block) && block['type'] === 'fallback',
  );
  const text = blocks
    .slice(lastSwitch + 1)
    .filter((block): block is { type: 'text'; text: string } => {
      return isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string';
    })
    .map((block) => block.text)
    .join('')
    .trim();

  const unanswered = (reason: string, extra: Record<string, unknown> = {}) =>
    failed('no_answer', { reason, usage, ...extra });
  if (stop === 'refusal') {
    const details = isRecord(message['stop_details']) ? message['stop_details'] : null;
    return unanswered('refusal', { code: safeToken(details?.['category'], SAFE_CODE) });
  }
  if (stop === 'max_tokens') {
    return unanswered('length', text ? {} : { hint: LLM_ANTHROPIC_EMPTY_LENGTH_HINT });
  }
  if (stop !== 'end_turn') return unanswered(safeToken(stop, SAFE_CODE) ?? 'stop_reason');
  if (!text) return unanswered('empty');

  const usageRecord = message['usage'] as Record<string, unknown>;
  const served = typeof message['model'] === 'string' ? message['model'] : null;
  const geo =
    typeof usageRecord['inference_geo'] === 'string' ? usageRecord['inference_geo'] : null;
  return { ok: true, completion: { text, usage }, served, geo };
}

/** One usage record's tokens: input with both cache counts, output with thinking. */
function tokensOf(value: unknown): LlmUsage | null {
  if (!isRecord(value)) return null;
  const input = value['input_tokens'];
  const output = value['output_tokens'];
  if (!isCount(input) || !isCount(output)) return null;
  const cached = (key: string): number => {
    const count = value[key];
    return isCount(count) ? count : 0;
  };
  return {
    inputTokens: input + cached('cache_creation_input_tokens') + cached('cache_read_input_tokens'),
    outputTokens: output,
  };
}

/**
 * The bill. With `usage.iterations` (a fallback ran, or the API itemised the
 * attempts anyway) the sum of every attempt; otherwise the top level.
 */
function readUsage(value: unknown): LlmUsage | null {
  const top = tokensOf(value);
  if (!top || !isRecord(value) || !Array.isArray(value['iterations'])) return top;
  const attempts = (value['iterations'] as unknown[]).map(tokensOf);
  if (attempts.length === 0 || attempts.some((attempt) => attempt === null)) return top;
  return (attempts as LlmUsage[]).reduce(
    (sum, attempt) => ({
      inputTokens: sum.inputTokens + attempt.inputTokens,
      outputTokens: sum.outputTokens + attempt.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}
