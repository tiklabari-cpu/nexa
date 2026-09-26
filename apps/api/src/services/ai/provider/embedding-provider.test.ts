/**
 * The embedding seam (tm 255.7): the closed provider enum and its factory, the
 * stub's promise that nothing already stored moves, and the two constants the
 * store and the stub have to agree on.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMBEDDING_DIMENSIONS as LEXICAL_DIMENSIONS,
  LEXICAL_EMBEDDING_SPACE,
  embed,
} from '@siyahtus/ai-mock';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createEmbeddingProvider } from './create-embedding-provider.js';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDERS,
  embeddingSpace,
  unhandledEmbeddingProvider,
  type EmbeddingProviderId,
} from './embedding-provider.js';
import { MockEmbeddingProvider } from './mock-embedding-provider.js';
import { OpenAiEmbeddingProvider } from './openai-embedding-provider.js';
import { OPENAI_REGIONAL_HOSTS, embeddingEndpointProblem } from './provider-hosts.js';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const SETTINGS = {
  baseUrl: 'https://eu.api.openai.com/v1',
  model: 'text-embedding-3-small',
  apiKey: 'sk-test-only',
  timeoutMs: 10_000,
};

describe('createEmbeddingProvider', () => {
  it("builds the in-process stub for 'mock'", () => {
    const provider = createEmbeddingProvider('mock', { openai: null });
    expect(provider).toBeInstanceOf(MockEmbeddingProvider);
    expect(provider.id).toBe('mock');
    expect(provider.space).toBe(LEXICAL_EMBEDDING_SPACE);
  });

  it("refuses 'openai' without its keys rather than falling back to the stub", () => {
    expect(() => createEmbeddingProvider('openai', { openai: null })).toThrow(
      'EMBEDDING_PROVIDER=openai needs EMBEDDING_API_BASE_URL, EMBEDDING_MODEL and EMBEDDING_API_KEY.',
    );
  });

  it("builds the adapter for 'openai', in the model's own space", () => {
    const provider = createEmbeddingProvider(
      'openai',
      { openai: SETTINGS },
      { fetchImpl: (async () => new Response(null, { status: 500 })) as typeof fetch },
    );
    expect(provider).toBeInstanceOf(OpenAiEmbeddingProvider);
    expect(provider.id).toBe('openai');
    expect(provider.space).toBe('openai:text-embedding-3-small');
  });

  it("refuses an 'openai' base URL it could not send to, without echoing the key", () => {
    const apiKey = 'sk-test-never-printed-0123456789';
    let message = '';
    try {
      createEmbeddingProvider('openai', {
        openai: { ...SETTINGS, baseUrl: `https://user:${apiKey}@eu.api.openai.com/v1`, apiKey },
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/EMBEDDING_API_BASE_URL must not carry credentials/);
    expect(message).not.toContain(apiKey);
  });

  it('refuses a key an HTTP header could not carry', () => {
    expect(() =>
      createEmbeddingProvider('openai', { openai: { ...SETTINGS, apiKey: 'sk-test\n' } }),
    ).toThrow('EMBEDDING_API_KEY contains whitespace or characters an HTTP header cannot carry.');
  });

  it('is closed to exactly mock and openai', () => {
    expect(EMBEDDING_PROVIDERS).toEqual(['mock', 'openai']);
    expectTypeOf<EmbeddingProviderId>().toEqualTypeOf<'mock' | 'openai'>();
    expectTypeOf<'voyage'>().not.toMatchTypeOf<EmbeddingProviderId>();
  });

  it('turns a missing switch branch into a compile error', () => {
    // `createEmbeddingProvider` and `embeddingEndpointProblem` both hand the id
    // their cases did not take to this `never` parameter, so a vendor added to
    // the list without an adapter stops the build at both.
    expectTypeOf(unhandledEmbeddingProvider).parameter(0).toEqualTypeOf<never>();
    expectTypeOf<Exclude<EmbeddingProviderId, 'mock' | 'openai'>>().toEqualTypeOf<never>();
    expect(() => unhandledEmbeddingProvider('voyage' as never)).toThrow(
      'Unknown EMBEDDING_PROVIDER: voyage',
    );
  });

  it('names a space by provider and model — one model is one space on every host', () => {
    expect(embeddingSpace('openai', 'text-embedding-3-small')).toBe(
      'openai:text-embedding-3-small',
    );
    const us = createEmbeddingProvider('openai', {
      openai: { ...SETTINGS, baseUrl: 'https://us.api.openai.com/v1' },
    });
    const eu = createEmbeddingProvider('openai', { openai: SETTINGS });
    expect(us.space).toBe(eu.space);
  });
});

describe("the 'mock' provider keeps every stored vector where it was (FR-MOD-06.3.2)", () => {
  it('returns exactly the lexical vectors, in input order, for any batch', async () => {
    const texts = [
      'Refunds are issued within 14 days.',
      'Standard delivery takes three to five working days.',
      'Gift cards never expire.',
    ];
    const { vectors, usage } = await new MockEmbeddingProvider().embed(texts);

    expect(vectors).toEqual(texts.map((text) => embed(text)));
    // The hashing runs in-process and bills nobody, so it reports no tokens —
    // an estimate would be counted as spend on the run (tm 255.9).
    expect(usage).toEqual({ inputTokens: 0 });
  });

  it('answers an empty batch with nothing', async () => {
    expect(await new MockEmbeddingProvider().embed([])).toEqual({
      vectors: [],
      usage: { inputTokens: 0 },
    });
  });
});

/**
 * Two constants two packages and a migration must agree on. Each drift would be
 * silent until it hurt: a stub wider than the column fails every seeded insert;
 * a default that no longer names the stub's space would file every vector the
 * previous release writes during a rollout under a space nobody searches.
 */
describe('the store, the stub and the migration agree', () => {
  it('embeds into the width the column holds', () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
    expect(LEXICAL_DIMENSIONS).toBe(EMBEDDING_DIMENSIONS);
    expect(embed('any text at all')).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("defaults embedding_space to the stub's space, in the migration and in the schema", () => {
    const migration = readFileSync(
      resolve(
        API_ROOT,
        'prisma/migrations/20260923090000_knowledge_chunks_embedding_space/migration.sql',
      ),
      'utf8',
    );
    const schema = readFileSync(resolve(API_ROOT, 'prisma/schema.prisma'), 'utf8');

    expect(migration).toContain(
      `ADD COLUMN "embedding_space" TEXT NOT NULL DEFAULT '${LEXICAL_EMBEDDING_SPACE}'`,
    );
    expect(schema).toContain(`@default("${LEXICAL_EMBEDDING_SPACE}") @map("embedding_space")`);
  });
});

describe('embeddingEndpointProblem (NFR-C4)', () => {
  it('accepts each regional host for its own region only', () => {
    for (const region of ['eu', 'us'] as const) {
      const url = `https://${OPENAI_REGIONAL_HOSTS[region]}/v1`;
      expect(embeddingEndpointProblem('openai', url, region)).toBeNull();
      const other = region === 'eu' ? 'us' : 'eu';
      expect(embeddingEndpointProblem('openai', url, other)).toMatch(
        new RegExp(
          `EMBEDDING_PROVIDER_REGION=${other} but EMBEDDING_API_BASE_URL is the ${region} host`,
        ),
      );
    }
  });

  it('refuses the global host, a foreign host, plain http and a non-URL, naming its own keys', () => {
    expect(embeddingEndpointProblem('openai', 'https://api.openai.com/v1', 'us')).toBe(
      'EMBEDDING_API_BASE_URL points at api.openai.com, which does not say where it processes requests; use the regional host for EMBEDDING_PROVIDER_REGION=us (us.api.openai.com).',
    );
    expect(embeddingEndpointProblem('openai', 'https://proxy.example.test/v1', 'us')).toMatch(
      /^EMBEDDING_API_BASE_URL host proxy\.example\.test is not an OpenAI regional host/,
    );
    expect(embeddingEndpointProblem('openai', 'http://us.api.openai.com/v1', 'us')).toBe(
      'EMBEDDING_API_BASE_URL must use https in production: the request carries the API key and the text it embeds.',
    );
    expect(embeddingEndpointProblem('openai', 'not a url', 'us')).toBe(
      'EMBEDDING_API_BASE_URL is not a URL.',
    );
  });
});
