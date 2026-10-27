/**
 * The root panel's AI settings, the part both processes share (tm 389.17):
 * the sealed keys, the database-then-environment resolution, and the rules a
 * write is held to — production's branch included, which no integration
 * server reaches (FR-ADMIN-17/19; FR-ADMIN codes are not Ek A IDs, so no tag).
 */
import { describe, expect, it } from 'vitest';
import { CredentialDecryptError } from '../../lib/credential-cipher.js';
import {
  NO_STORED_AI_SETTINGS,
  aiSettingsProblems,
  aiSettingsRootKey,
  openAiApiKey,
  parseStoredAiSettings,
  resolveAiConfig,
  sealAiApiKey,
  type AiEnv,
  type StoredAiEmbedding,
  type StoredAiLlm,
} from './ai-settings.js';

const ROOT = 'a-root-key-for-tests-0123456789abcdef-xyz';
const KEY = 'sk-test-only-not-a-credential-Ab12Cd34';

const ENV: AiEnv = {
  LLM_PROVIDER: 'mock',
  LLM_PROVIDER_REGION: undefined,
  LLM_API_KEY: undefined,
  LLM_MODEL: undefined,
  LLM_TIMEOUT_MS: 20_000,
  LLM_MAX_OUTPUT_TOKENS: 400,
  EMBEDDING_PROVIDER: 'mock',
  EMBEDDING_PROVIDER_REGION: undefined,
  EMBEDDING_API_KEY: undefined,
  EMBEDDING_MODEL: undefined,
  EMBEDDING_TIMEOUT_MS: 10_000,
  SIYAHTUS_REGION: 'eu',
  AI_DAILY_LLM_TOKENS_PER_WORKSPACE: 200_000,
  AI_DAILY_LLM_TOKENS_GLOBAL: 2_000_000,
  AI_DAILY_EMBEDDING_TOKENS_PER_WORKSPACE: 2_000_000,
  AI_DAILY_EMBEDDING_TOKENS_GLOBAL: 20_000_000,
  AI_PRICE_LLM_INPUT_USD_PER_MTOK: undefined,
  AI_PRICE_LLM_OUTPUT_USD_PER_MTOK: undefined,
  AI_PRICE_EMBEDDING_USD_PER_MTOK: undefined,
  llm: { openai: null },
  embedding: { openai: null },
};

function llmRow(overrides: Partial<StoredAiLlm> = {}): StoredAiLlm {
  return {
    provider: 'openai',
    base_url: 'https://eu.api.openai.com/v1',
    model: 'gpt-test',
    model_fast: null,
    region: 'eu',
    timeout_ms: null,
    max_output_tokens: null,
    api_key_ciphertext: sealAiApiKey(KEY, ROOT, 'ai.llm'),
    api_key_last4: KEY.slice(-4),
    ...overrides,
  };
}

function embeddingRow(overrides: Partial<StoredAiEmbedding> = {}): StoredAiEmbedding {
  return {
    provider: 'openai',
    base_url: 'https://eu.api.openai.com/v1',
    model: 'text-embedding-3-small',
    region: 'eu',
    dimensions: 1536,
    api_key_ciphertext: null,
    api_key_last4: null,
    ...overrides,
  };
}

describe('the sealed API keys', () => {
  it('open with the same root and row, and with nothing else', () => {
    const sealed = sealAiApiKey(KEY, ROOT, 'ai.llm');
    expect(sealed).not.toContain(KEY);
    expect(sealed).not.toContain(KEY.slice(-8));
    expect(openAiApiKey(sealed, ROOT, 'ai.llm')).toBe(KEY);
    expect(() => openAiApiKey(sealed, `${ROOT}-other`, 'ai.llm')).toThrow(CredentialDecryptError);
    // Copied into the other row, it does not open: the row is the AAD.
    expect(() => openAiApiKey(sealed, ROOT, 'ai.embedding')).toThrow(CredentialDecryptError);
  });

  it('takes the root from PLATFORM_SETTINGS_KEY, the placeholder outside production, nothing in production', () => {
    expect(aiSettingsRootKey({ PLATFORM_SETTINGS_KEY: ` ${ROOT} `, isProduction: true })).toBe(
      ROOT,
    );
    expect(aiSettingsRootKey({ PLATFORM_SETTINGS_KEY: undefined, isProduction: false })).toMatch(
      /^dev-only-/,
    );
    expect(aiSettingsRootKey({ PLATFORM_SETTINGS_KEY: undefined, isProduction: true })).toBeNull();
  });
});

describe('resolveAiConfig — the database first, then the environment', () => {
  it('runs on the environment when nothing is stored', () => {
    const config = resolveAiConfig(NO_STORED_AI_SETTINGS, ENV, ROOT);
    expect(config.llm).toMatchObject({ source: 'env', provider: 'mock', region: 'eu' });
    expect(config.embedding).toMatchObject({ source: 'env', provider: 'mock' });
    expect(config.caps.llm).toEqual({ workspace: 200_000, global: 2_000_000 });
    expect(config.capsSource).toBe('env');
    expect(config.warnings).toEqual([]);
  });

  it('builds the stored model with its opened key, region and limits', () => {
    const config = resolveAiConfig(
      { ...NO_STORED_AI_SETTINGS, llm: llmRow({ timeout_ms: 9_000, max_output_tokens: 900 }) },
      ENV,
      ROOT,
    );
    expect(config.llm).toMatchObject({
      source: 'db',
      provider: 'openai',
      region: 'eu',
      timeoutMs: 9_000,
      maxOutputTokens: 900,
    });
    expect(config.llm.options.openai).toEqual({
      baseUrl: 'https://eu.api.openai.com/v1',
      model: 'gpt-test',
      fastModel: null,
      apiKey: KEY,
    });
  });

  it('uses the environment’s key for a stored row without one, and falls back whole without either', () => {
    const keyless = { ...NO_STORED_AI_SETTINGS, llm: llmRow({ api_key_ciphertext: null }) };
    const withEnvKey = resolveAiConfig(keyless, { ...ENV, LLM_API_KEY: 'sk-env-only-key' }, ROOT);
    expect(withEnvKey.llm.source).toBe('db');
    expect(withEnvKey.llm.options.openai?.apiKey).toBe('sk-env-only-key');

    const none = resolveAiConfig(keyless, ENV, ROOT);
    expect(none.llm).toMatchObject({ source: 'env', provider: 'mock' });
    expect(none.warnings).toEqual([expect.stringMatching(/ai\.llm has no API key/)]);
  });

  it('falls back to the environment, with a warning that names no key, when the stored key does not open', () => {
    const stored = { ...NO_STORED_AI_SETTINGS, llm: llmRow() };
    for (const root of [null, `${ROOT}-rotated`]) {
      const config = resolveAiConfig(stored, ENV, root);
      expect(config.llm.source).toBe('env');
      expect(config.warnings).toHaveLength(1);
      expect(config.warnings.join(' ')).not.toContain(KEY.slice(-4));
    }
  });

  it('keeps the plans’ half of ai.caps out of the deployment caps, and needs both meters', () => {
    const stored = parseStoredAiSettings({
      caps: {
        plans: { growth: { llm: 5 } },
        deployment: {
          llm: { workspace: 10, global: 100 },
          embedding: { workspace: 20, global: 200 },
        },
      },
      prices: {
        llm_input_usd_per_mtok: 0.4,
        llm_output_usd_per_mtok: 1.6,
        embedding_usd_per_mtok: null,
      },
    });
    const config = resolveAiConfig(stored, ENV, ROOT);
    expect(config.caps).toEqual({
      llm: { workspace: 10, global: 100 },
      embedding: { workspace: 20, global: 200 },
    });
    expect(config.capsSource).toBe('db');
    expect(config.prices).toEqual({ llm: { input: 0.4, output: 1.6 }, embedding: null });
    expect(
      parseStoredAiSettings({ caps: { deployment: { llm: { workspace: 1, global: 2 } } } }).caps,
    ).toBeNull();
  });
});

describe('aiSettingsProblems — what a write is refused for', () => {
  const dev = { isProduction: false, PILOT_MODE: false, SIYAHTUS_REGION: 'eu' } as const;
  const production = { ...dev, isProduction: true } as const;
  const pilot = { ...production, PILOT_MODE: true } as const;

  it('needs base URL, model and region for a remote provider, everywhere', () => {
    expect(
      aiSettingsProblems({ llm: llmRow({ base_url: null, region: null }), embedding: null }, dev),
    ).toEqual(['llm: base_url, region required for provider openai.']);
  });

  it('lets a development box point anywhere, but not at something that is not a URL', () => {
    expect(
      aiSettingsProblems(
        { llm: llmRow({ base_url: 'http://127.0.0.1:9/v1' }), embedding: null },
        dev,
      ),
    ).toEqual([]);
    expect(
      aiSettingsProblems({ llm: llmRow({ base_url: 'not a url' }), embedding: null }, dev),
    ).toEqual(['llm.base_url is not a URL.']);
  });

  it('refuses api.openai.com and a host of another region in production (NODE_ENV=production branch)', () => {
    const global = aiSettingsProblems(
      { llm: llmRow({ base_url: 'https://api.openai.com/v1' }), embedding: null },
      production,
    );
    expect(global).toEqual([
      expect.stringMatching(/^llm: .*api\.openai\.com.*eu\.api\.openai\.com/),
    ]);
    const crossed = aiSettingsProblems(
      { llm: null, embedding: embeddingRow({ base_url: 'https://us.api.openai.com/v1' }) },
      production,
    );
    expect(crossed).toEqual([expect.stringMatching(/^embedding: .*the us host/)]);
    expect(aiSettingsProblems({ llm: llmRow(), embedding: embeddingRow() }, production)).toEqual(
      [],
    );
  });

  it('refuses the stub and another region under PILOT_MODE in production, and allows the stub elsewhere', () => {
    const stub = llmRow({ provider: 'mock', base_url: null, model: null, region: null });
    expect(aiSettingsProblems({ llm: stub, embedding: null }, pilot)).toEqual([
      expect.stringMatching(/^llm\.provider must be a real provider .*PILOT_MODE=true/),
    ]);
    expect(aiSettingsProblems({ llm: stub, embedding: null }, production)).toEqual([]);
    const us = llmRow({ base_url: 'https://us.api.openai.com/v1', region: 'us' });
    expect(aiSettingsProblems({ llm: us, embedding: null }, pilot)).toEqual([
      expect.stringMatching(/^llm\.region must equal SIYAHTUS_REGION \(eu\)/),
    ]);
  });
});
