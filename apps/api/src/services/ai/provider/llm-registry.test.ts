/**
 * The hot-swap registry (tm 389.17 · FR-ADMIN-18): facades that follow
 * `reload()`, instances that change only when their settings do, a failed read
 * that keeps what runs, and the panel's limits in place of the environment's.
 * The end-to-end half — a platform write reaching a running tenant server
 * through Redis within seconds — is `platform-ai-settings.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { fakeOpenAiFetch, openAiCompletion } from '../../../../test/helpers/fake-openai.js';
import {
  NO_STORED_AI_SETTINGS,
  sealAiApiKey,
  type AiEnv,
  type StoredAiSettings,
} from '../ai-settings.js';
import { AiProviderRegistry, applyLlmLimits, type AiRegistryLogger } from './llm-registry.js';

const ROOT = 'a-root-key-for-tests-0123456789abcdef-xyz';
const KEY_ONE = 'sk-test-only-first-key-Qw12';
const KEY_TWO = 'sk-test-only-second-key-Zx98';

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

const REQUEST = {
  system: 'Answer.',
  messages: [{ role: 'user' as const, content: 'Hello' }],
  maxOutputTokens: 400,
  timeoutMs: 20_000,
};

function quietLogger(lines: string[] = []): AiRegistryLogger {
  const logger: AiRegistryLogger = {
    debug: (details, message) => lines.push(`${message} ${JSON.stringify(details)}`),
    info: (details, message) => lines.push(`${message} ${JSON.stringify(details)}`),
    warn: (details, message) => lines.push(`${message} ${JSON.stringify(details)}`),
    error: (details, message) => lines.push(`${message} ${JSON.stringify(details)}`),
    child: () => logger,
  };
  return logger;
}

function openAiStored(key: string, overrides: Record<string, unknown> = {}): StoredAiSettings {
  return {
    ...NO_STORED_AI_SETTINGS,
    llm: {
      provider: 'openai',
      base_url: 'https://llm.fake.test/v1',
      model: 'gpt-test',
      model_fast: null,
      region: 'us',
      timeout_ms: null,
      max_output_tokens: null,
      api_key_ciphertext: sealAiApiKey(key, ROOT, 'ai.llm'),
      api_key_last4: key.slice(-4),
      ...overrides,
    },
  };
}

const authorization = (init: RequestInit): string =>
  new Headers(init.headers as ConstructorParameters<typeof Headers>[0]).get('authorization') ?? '';

describe('AiProviderRegistry', () => {
  it('starts on the environment, then answers with the stored model after reload, through the same facade', async () => {
    let stored: StoredAiSettings = NO_STORED_AI_SETTINGS;
    const net = fakeOpenAiFetch(openAiCompletion('From the model.'));
    const registry = await AiProviderRegistry.create({
      env: ENV,
      rootKey: ROOT,
      read: async () => stored,
      logger: quietLogger(),
      llmFetch: net.impl,
    });
    const visitor = registry.llm('visitor');
    expect(visitor.id).toBe('mock');
    expect(net.calls).toHaveLength(0);

    stored = openAiStored(KEY_ONE);
    expect(await registry.reload()).toBe(true);
    expect(visitor.id).toBe('openai');
    expect(registry.inference().llm).toEqual({ id: 'openai', region: 'us' });
    expect((await visitor.complete(REQUEST)).text).toBe('From the model.');
    expect(authorization(net.calls[0]!.init)).toBe(`Bearer ${KEY_ONE}`);

    stored = openAiStored(KEY_TWO);
    await registry.reload();
    await visitor.complete(REQUEST);
    expect(authorization(net.calls[1]!.init)).toBe(`Bearer ${KEY_TWO}`);
  });

  it('keeps its instances — breakers and all — when nothing changed, and gives Copilot its own', async () => {
    const stored = openAiStored(KEY_ONE);
    const registry = await AiProviderRegistry.create({
      env: ENV,
      rootKey: ROOT,
      read: async () => stored,
      logger: quietLogger(),
    });
    const before = registry.current('visitor');
    expect(registry.current('copilot')).not.toBe(before);
    expect(await registry.reload()).toBe(false);
    expect(registry.current('visitor')).toBe(before);
  });

  it('keeps what runs when the settings cannot be read, and says so without the key', async () => {
    let fail = false;
    const lines: string[] = [];
    const registry = await AiProviderRegistry.create({
      env: ENV,
      rootKey: ROOT,
      read: async () => {
        if (fail) throw new Error('platform_ai_settings() is missing');
        return openAiStored(KEY_ONE);
      },
      logger: quietLogger(lines),
    });
    const before = registry.current('visitor');
    fail = true;
    expect(await registry.reload()).toBe(false);
    expect(registry.current('visitor')).toBe(before);
    expect(lines.join('\n')).toMatch(/AI settings not re-read/);
    expect(lines.join('\n')).not.toContain(KEY_ONE.slice(-8));
  });

  it('boots on the environment when the first read fails', async () => {
    const registry = await AiProviderRegistry.create({
      env: ENV,
      rootKey: ROOT,
      read: async () => {
        throw new Error('down');
      },
      logger: quietLogger(),
    });
    expect(registry.config().llm.source).toBe('env');
  });

  it('answers a pinned instance whatever the settings say, as a test injects one', async () => {
    const pinned = {
      id: 'mock' as const,
      complete: async () => ({ text: 'pinned', usage: { inputTokens: 0, outputTokens: 0 } }),
    };
    const registry = await AiProviderRegistry.create({
      env: ENV,
      rootKey: ROOT,
      read: async () => openAiStored(KEY_ONE),
      logger: quietLogger(),
      pinned: { visitor: pinned },
    });
    expect((await registry.llm('visitor').complete(REQUEST)).text).toBe('pinned');
    expect(registry.inference().llm.id).toBe('openai');
  });
});

describe('applyLlmLimits', () => {
  const env = { LLM_TIMEOUT_MS: 20_000, LLM_MAX_OUTPUT_TOKENS: 400 };
  const panel = { source: 'db' as const, timeoutMs: 8_000, maxOutputTokens: 900 };

  it('replaces the environment’s ceiling with the panel’s, and holds a smaller ask under it', () => {
    expect(applyLlmLimits(REQUEST, panel, env)).toMatchObject({
      timeoutMs: 8_000,
      maxOutputTokens: 900,
    });
    expect(applyLlmLimits({ ...REQUEST, maxOutputTokens: 60 }, panel, env).maxOutputTokens).toBe(
      60,
    );
    expect(
      applyLlmLimits({ ...REQUEST, maxOutputTokens: 60 }, { ...panel, maxOutputTokens: 40 }, env)
        .maxOutputTokens,
    ).toBe(40);
  });

  it('leaves a request alone while the environment decides', () => {
    expect(applyLlmLimits(REQUEST, { ...panel, source: 'env' }, env)).toBe(REQUEST);
  });
});
