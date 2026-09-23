/**
 * `EMBEDDING_PROVIDER=mock` — the in-process, deterministic stand-in (CLAUDE.md:
 * an external service is mocked).
 *
 * Exactly the vectors the product has always written: `embed()` from
 * `@nexa/ai-mock`, the hashed bag of words, one text at a time — only now
 * behind the same asynchronous, batched `embed(texts)` a real model answers
 * through. So every test suite, the seed and any deployment without a model
 * keep the knowledge base they had, in the space they had it in
 * ({@link LEXICAL_EMBEDDING_SPACE}), and a stored chunk written before this seam
 * existed is still a chunk this provider's questions can find.
 *
 * It is the one place in `src/` allowed to call that function for retrieval —
 * `embedding-seam-audit.test.ts` holds the line — because a second caller would
 * be a second way for vectors to reach the index without a space to go with
 * them.
 *
 * Its usage is zero, for `MockLlmProvider`'s reason (tm 255.9): the hashing
 * runs in this process and no provider bills a token of it, so a count
 * recorded from here would be spend that never happened.
 */
import { embed, LEXICAL_EMBEDDING_SPACE } from '@nexa/ai-mock';
import type { EmbeddingProvider, Embeddings } from './embedding-provider.js';

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'mock' as const;
  readonly space = LEXICAL_EMBEDDING_SPACE;

  async embed(texts: readonly string[]): Promise<Embeddings> {
    return {
      vectors: texts.map((text) => embed(text)),
      usage: { inputTokens: 0 },
    };
  }
}
