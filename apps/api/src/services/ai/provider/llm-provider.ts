/**
 * The seam between the product and whatever writes its AI text (tm 255.5).
 *
 * Before this, nothing wrote: the skill engine stitched retrieved passages into
 * an answer itself (`shapeAnswer`), and every AI surface imported its
 * deterministic stand-in straight from `@nexa/ai-mock`. A real model has to
 * arrive through one door that can be configured, injected and counted — this
 * file is that door, on the terms `createMailer` and `createObjectStore` set:
 * a closed provider enum, a factory that reads the environment once at boot,
 * and an instance `buildServer` accepts so a test can hand in its own.
 *
 * **Narrow on purpose.** One non-streaming, tool-less call. ADR
 * `docs/adr/pilot-llm-embedding-provider.md` §5 and §6 answered both questions
 * "no" for the pilot: the answer travels to the widget as one event, so there
 * is nothing to stream into, and the skill's steps are written by an admin, so
 * there is nothing for a model to call. `stream`, `tools` and `response_format`
 * are absent from this interface rather than optional in it — an option nobody
 * implements is a promise the adapter would silently break.
 *
 * **Where it may run is not decided here.** The NFR-C4 residency gate
 * (`services/ai/inference.ts`, enforced by `plugins/ai-residency.ts`) runs
 * before any caller reaches a provider. A provider does not re-check it: it has
 * no workspace to check it against, and a second copy of the rule is a copy
 * that can disagree.
 */
import { LlmProviderError } from './llm-error.js';
import { MockLlmProvider } from './mock-llm-provider.js';
import { OpenAiLlmProvider, type LlmLogger } from './openai-llm-provider.js';

/**
 * Closed, like `MAIL_PROVIDERS`: a new vendor is a new value *and* its own
 * adapter (ADR §3 — "OpenAI-compatible" layers were checked one by one and none
 * is a drop-in), and `createLlmProvider`'s switch refuses to compile until the
 * value has a branch.
 */
export const LLM_PROVIDERS = ['mock', 'openai'] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];

/** A turn of the conversation handed to the model. The system prompt is separate. */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionRequest {
  /** Instructions and grounding — everything that is not the conversation. */
  system: string;
  messages: LlmMessage[];
  /** Ceiling on the reply, in the provider's tokens (`LLM_MAX_OUTPUT_TOKENS`). */
  maxOutputTokens: number;
  /** How long the call may take before it is abandoned (`LLM_TIMEOUT_MS`). */
  timeoutMs: number;
}

/**
 * What the call cost, in tokens — the unit every candidate provider bills in
 * (ADR §8). Money is deliberately absent: the price is the owner's contract.
 * The skill engine records these on the run that made the call
 * (`skill_runs.llm_input_tokens` / `llm_output_tokens`, tm 255.9), where the AI
 * Agent report sums them beside the run count it already reported.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompletion {
  text: string;
  usage: LlmUsage;
}

/** The part of a request that is prompt — what `LLM_MAX_PROMPT_CHARS` measures. */
export type LlmPrompt = Pick<LlmCompletionRequest, 'system' | 'messages'>;

/**
 * A prompt's length in characters: the system prompt and every message, the
 * text a provider bills as input. Counted in UTF-16 code units, which is what
 * `String.length` gives and never fewer than the characters a person sees.
 */
export function promptLength(prompt: LlmPrompt): number {
  return prompt.messages.reduce(
    (sum, message) => sum + message.content.length,
    prompt.system.length,
  );
}

/**
 * The per-call prompt ceiling (tm 255.9 · ADR §9.1 `LLM_MAX_PROMPT_CHARS`):
 * throws `prompt_too_long` for a prompt over `maxChars`, before any provider
 * sees it. Called by the caller that builds the prompt, immediately before
 * `complete()`, so a refused prompt costs no request, no tokens and no circuit
 * breaker count — it fails the way any other call does and a human answers.
 */
export function refuseOverlongPrompt(prompt: LlmPrompt, maxChars: number): void {
  const length = promptLength(prompt);
  if (length > maxChars) {
    throw new LlmProviderError('prompt_too_long', { reason: `${length}/${maxChars}` });
  }
}

export interface LlmProvider {
  /** Which implementation answers — the value `LLM_PROVIDER` names. */
  readonly id: LlmProviderId;
  /**
   * Write the reply. When the model could not answer — timeout, provider
   * error, an open circuit, a reply with nothing in it — this rejects with an
   * `LlmProviderError` (`llm-error.ts`), and the skill engine hands the
   * conversation to a human. Any other rejection is a defect and propagates.
   */
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
}

/**
 * The OpenAI settings `LLM_PROVIDER=openai` reads (ADR §9.1), gathered by
 * `parseEnv` into `env.llm`. `null` unless the provider is `openai` *and* all
 * three are present — half a configuration must not look like a configured
 * endpoint downstream, which is `env.mail`'s rule for SMTP.
 */
export interface OpenAiSettings {
  baseUrl: string;
  model: string;
  /** A secret. Never logged, never echoed into an error message. */
  apiKey: string;
}

export interface LlmProviderOptions {
  openai: OpenAiSettings | null;
}

/**
 * What the environment does not carry: where a provider logs, and how it
 * reaches the network. `buildServer` passes its own logger — its stream, level
 * and redaction paths — and a test passes a `fetch` recorder (tm 255.6).
 */
export interface LlmProviderRuntime {
  logger?: LlmLogger;
  fetchImpl?: typeof fetch;
}

/**
 * Build the provider `LLM_PROVIDER` names.
 *
 * `openai` without its three keys throws the way `createMailer('smtp')` does
 * — a deployment that asked for a model and quietly got the stub would answer
 * customers with stitched passages while everyone believed a model was
 * writing. With them it builds the chat adapter (tm 255.6), which throws in
 * turn on a base URL or key it could not send a request with.
 */
export function createLlmProvider(
  id: LlmProviderId,
  options: LlmProviderOptions,
  runtime: LlmProviderRuntime = {},
): LlmProvider {
  switch (id) {
    case 'mock':
      return new MockLlmProvider();
    case 'openai':
      if (!options.openai) {
        throw new Error('LLM_PROVIDER=openai needs LLM_API_BASE_URL, LLM_MODEL and LLM_API_KEY.');
      }
      return new OpenAiLlmProvider(options.openai, runtime);
    default:
      return unhandledLlmProvider(id);
  }
}

/**
 * The compile-time half of "closed". With every value handled, `id` has type
 * `never` in the `default` branch and this call type-checks; add a value to
 * `LLM_PROVIDERS` without a `case` and it stops compiling, which is the point.
 * The throw is for a value that bypassed the type system (an unchecked cast).
 */
export function unhandledLlmProvider(id: never): never {
  throw new Error(`Unknown LLM_PROVIDER: ${String(id)}`);
}
