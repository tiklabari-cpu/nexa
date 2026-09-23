/**
 * The seam between the product and whatever turns its text into vectors
 * (tm 255.7 · ADR docs/adr/pilot-llm-embedding-provider.md §4, §9.2, §10).
 *
 * Before this, `embed()` from `@nexa/ai-mock` was called straight from the
 * knowledge service, synchronously, inside the transaction that wrote the
 * chunks. A real model is a network call, so three things change together:
 * the call is asynchronous, it happens *before* any transaction opens (a
 * provider may take `EMBEDDING_TIMEOUT_MS`, the tenant transaction may not
 * take more than 10 s), and it is made for a whole list of texts at once —
 * one request per source rather than one per chunk, which in a pilot is the
 * difference between a knowledge base that indexes in a second and one that
 * pays for hundreds of round trips.
 *
 * Configured apart from the chat provider (ADR §4.2): its own enum, key, base
 * URL, model and region. The two can change independently, and a deployment
 * may run a real model for one and the stub for the other.
 *
 * This file is the contract only. The factory lives in
 * `create-embedding-provider.ts`, because the adapters read
 * {@link EMBEDDING_DIMENSIONS} from here and the factory reads the adapters.
 */
import type { EmbeddingLogger } from './openai-embedding-provider.js';

/**
 * Closed, like `LLM_PROVIDERS`: a new vendor is a new value *and* its own
 * adapter, and `createEmbeddingProvider`'s switch refuses to compile until the
 * value has a branch.
 */
export const EMBEDDING_PROVIDERS = ['mock', 'openai'] as const;
export type EmbeddingProviderId = (typeof EMBEDDING_PROVIDERS)[number];

/**
 * The only vector length the store holds — `knowledge_chunks.embedding` is
 * `vector(1536)`, and the HNSW index is built over it. Not a setting:
 * `EMBEDDING_DIMENSIONS` in the environment is an assertion that must equal
 * this, and a provider that returns any other length fails the call rather
 * than having its vectors cut or padded to fit (ADR §9.2). A model with a
 * different dimension is a migration and a full re-embed (ADR §4.3), not a
 * configuration change.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/** What an embedding call cost — input tokens, the unit embeddings are billed in (ADR §8). */
export interface EmbeddingUsage {
  inputTokens: number;
}

export interface Embeddings {
  /** One vector per input, in input order, each {@link EMBEDDING_DIMENSIONS} long. */
  vectors: number[][];
  usage: EmbeddingUsage;
}

export interface EmbeddingProvider {
  /** Which implementation answers — the value `EMBEDDING_PROVIDER` names. */
  readonly id: EmbeddingProviderId;
  /**
   * The vector space this provider's vectors live in: `<provider>:<model>`.
   * Stored beside every vector (`knowledge_chunks.embedding_space`); vectors of
   * two different spaces are never compared (PLAN §D182). Two deployments of one
   * model — OpenAI's US and EU hosts — are one space.
   */
  readonly space: string;
  /**
   * Embed every text. As few requests as the provider's limits allow — one for
   * any realistic source — and never one per text. Rejects with an
   * `EmbeddingProviderError` (`embedding-error.ts`) when the provider could not
   * answer; any other rejection is a defect.
   */
  embed(texts: readonly string[]): Promise<Embeddings>;
}

/**
 * The OpenAI settings `EMBEDDING_PROVIDER=openai` reads (ADR §9.2), gathered by
 * `parseEnv` into `env.embedding`. `null` unless the provider is `openai` *and*
 * its three keys are present — `env.llm`'s rule.
 */
export interface OpenAiEmbeddingSettings {
  baseUrl: string;
  model: string;
  /** A secret. Never logged, never echoed into an error message. */
  apiKey: string;
  /** `EMBEDDING_TIMEOUT_MS`: how long one request, retries included, may take. */
  timeoutMs: number;
}

export interface EmbeddingProviderOptions {
  openai: OpenAiEmbeddingSettings | null;
}

/**
 * What the environment does not carry: where a provider logs, and how it
 * reaches the network. `buildServer` passes its logger; a test passes a
 * `fetch` recorder.
 */
export interface EmbeddingProviderRuntime {
  logger?: EmbeddingLogger;
  fetchImpl?: typeof fetch;
}

/** The space a provider's model writes into — see {@link EmbeddingProvider.space}. */
export function embeddingSpace(provider: EmbeddingProviderId, model: string): string {
  return `${provider}:${model}`;
}

/**
 * The compile-time half of "closed": with every value handled, `id` is `never`
 * in a `default` branch and this call type-checks; a value added to
 * {@link EMBEDDING_PROVIDERS} without a `case` stops the build.
 */
export function unhandledEmbeddingProvider(id: never): never {
  throw new Error(`Unknown EMBEDDING_PROVIDER: ${String(id)}`);
}
