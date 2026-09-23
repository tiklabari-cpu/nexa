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
import { MockLlmProvider } from './mock-llm-provider.js';

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
 * (ADR §8). Money is deliberately absent: the price is the owner's contract,
 * and tm 255.9 attaches these numbers to the existing AI counters.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompletion {
  text: string;
  usage: LlmUsage;
}

export interface LlmProvider {
  /** Which implementation answers — the value `LLM_PROVIDER` names. */
  readonly id: LlmProviderId;
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
 * Build the provider `LLM_PROVIDER` names.
 *
 * `openai` throws, twice over and on purpose. Without its three keys it throws
 * the way `createMailer('smtp')` does — a deployment that asked for a model and
 * quietly got the stub would answer customers with stitched passages while
 * everyone believed a model was writing. With them it still throws, because the
 * adapter is tm 255.6's work and does not exist yet; falling back to the stub
 * would be the same lie told one task earlier.
 */
export function createLlmProvider(id: LlmProviderId, options: LlmProviderOptions): LlmProvider {
  switch (id) {
    case 'mock':
      return new MockLlmProvider();
    case 'openai':
      if (!options.openai) {
        throw new Error('LLM_PROVIDER=openai needs LLM_API_BASE_URL, LLM_MODEL and LLM_API_KEY.');
      }
      throw new Error(
        'LLM_PROVIDER=openai has no adapter in this build yet (tm 255.6); use LLM_PROVIDER=mock.',
      );
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
