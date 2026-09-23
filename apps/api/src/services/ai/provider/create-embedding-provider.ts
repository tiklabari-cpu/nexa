/**
 * Build the embedding provider `EMBEDDING_PROVIDER` names (tm 255.7) — on
 * `createLlmProvider`'s terms: a closed switch, read once at boot.
 *
 * `openai` without its three keys throws, the way `createMailer('smtp')` and
 * `createLlmProvider('openai')` do. A deployment that asked for a model and
 * quietly got the lexical stub would index and search in the wrong space while
 * everyone believed a model was doing it. With the keys it builds the adapter,
 * which throws in turn on a base URL or key it could not send a request with.
 */
import {
  unhandledEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderId,
  type EmbeddingProviderOptions,
  type EmbeddingProviderRuntime,
} from './embedding-provider.js';
import { MockEmbeddingProvider } from './mock-embedding-provider.js';
import { OpenAiEmbeddingProvider } from './openai-embedding-provider.js';

export function createEmbeddingProvider(
  id: EmbeddingProviderId,
  options: EmbeddingProviderOptions,
  runtime: EmbeddingProviderRuntime = {},
): EmbeddingProvider {
  switch (id) {
    case 'mock':
      return new MockEmbeddingProvider();
    case 'openai':
      if (!options.openai) {
        throw new Error(
          'EMBEDDING_PROVIDER=openai needs EMBEDDING_API_BASE_URL, EMBEDDING_MODEL and EMBEDDING_API_KEY.',
        );
      }
      return new OpenAiEmbeddingProvider(options.openai, runtime);
    default:
      return unhandledEmbeddingProvider(id);
  }
}
