/**
 * A recording `EmbeddingProvider` for tests (tm 255.7), on `FakeLlmProvider`'s
 * terms: `buildServer({ embeddings })` takes it, nothing touches a network, and
 * the test reads back every call and the texts it carried.
 *
 * **Its own space, with the stub's geometry.** A vector here is the lexical
 * stub's vector with its coordinates rotated by a fixed offset. A rotation is
 * a permutation, and a permutation preserves every dot product, so *within*
 * this space two texts are exactly as close as the stub says they are — a
 * question finds the passage the stub would find, with the same score. *Across*
 * spaces the coordinates no longer line up, so a lexical question against these
 * vectors (or the reverse) lands near nothing — which is what a real model's
 * vectors are to the stub's, and what the space filter exists for. That makes
 * this fake a stand-in for "a real provider" that the existing fixtures,
 * written against the stub, can still be reasoned about with.
 */
import { embed } from '@nexa/ai-mock';
import type {
  EmbeddingProvider,
  EmbeddingProviderId,
  Embeddings,
} from '../../src/services/ai/provider/embedding-provider.js';

export const FAKE_EMBEDDING_SPACE = 'openai:fake-embedding-model';

/** Coordinates each vector is rotated by. Any offset that is not 0 mod 1536 would do. */
const ROTATION = 397;

/** The fake space's vector for `text` — see the file header. */
export function fakeEmbedding(text: string): number[] {
  const lexical = embed(text);
  return lexical.map((_, i) => lexical[(i + ROTATION) % lexical.length]!);
}

export interface FakeEmbeddingProviderOptions {
  id?: EmbeddingProviderId;
  space?: string;
  /** How a text becomes a vector; {@link fakeEmbedding} by default. */
  vector?: (text: string) => number[];
  /** Throw this instead of answering — every call, or from the call `failFrom` on. */
  fail?: Error;
  /** 1-based: the first call that fails. Defaults to the first. */
  failFrom?: number;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  readonly space: string;
  /** The texts of every call, in order. `calls.length` is the call count. */
  readonly calls: string[][] = [];
  #fail: Error | undefined;
  readonly #failFrom: number;
  readonly #vector: (text: string) => number[];

  constructor(options: FakeEmbeddingProviderOptions = {}) {
    this.id = options.id ?? 'openai';
    this.space = options.space ?? FAKE_EMBEDDING_SPACE;
    this.#fail = options.fail;
    this.#failFrom = options.failFrom ?? 1;
    this.#vector = options.vector ?? fakeEmbedding;
  }

  async embed(texts: readonly string[]): Promise<Embeddings> {
    this.calls.push([...texts]);
    if (this.#fail && this.calls.length >= this.#failFrom) throw this.#fail;
    return {
      vectors: texts.map((text) => this.#vector(text)),
      usage: { inputTokens: texts.reduce((sum, text) => sum + text.length, 0) },
    };
  }

  /** Start (or stop, with `undefined`) failing from the next call. */
  failWith(error: Error | undefined): void {
    this.#fail = error;
  }

  /** Every text this provider was asked to embed, across calls. */
  get texts(): string[] {
    return this.calls.flat();
  }

  reset(): void {
    this.calls.length = 0;
  }
}
