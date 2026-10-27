/**
 * The root panel's AI settings (tm 389.17 · FR-ADMIN-17/19 · design.md §B2,
 * §F) — the part both processes share.
 *
 * Four `platform_settings` rows: `ai.llm` and `ai.embedding` (provider, host,
 * model, region, limits, and the API key sealed with AES-256-GCM under a
 * sub-key of `PLATFORM_SETTINGS_KEY`), `ai.caps` (the deployment's daily caps
 * under `deployment`, beside the plans' defaults under `plans` that tm 389.12
 * writes) and `ai.prices`. The platform API writes them; the tenant API reads
 * them through `platform_ai_settings()` and builds its providers from them
 * (`provider/llm-registry.ts`).
 *
 * **The database first, then the environment.** A row decides that part; no
 * row and the `LLM_*` / `EMBEDDING_*` / `AI_DAILY_*` / `AI_PRICE_*` settings
 * decide, exactly as before the panel existed. A row that cannot be used — a
 * sealed key that does not open (no `PLATFORM_SETTINGS_KEY`, another key, an
 * edited row), a remote provider with no key anywhere — is not a reason to
 * stop serving (the owner's rule of 2026-10-10): that part runs on the
 * environment and {@link resolveAiConfig} says why in `warnings`.
 *
 * **A stored row without a key** uses the environment's key
 * (`LLM_API_KEY` / `EMBEDDING_API_KEY`) — removing the key in the panel
 * removes the panel's copy, never the environment's.
 *
 * **Nothing here returns a key in the clear** except {@link openAiApiKey},
 * which only the provider's construction calls.
 */
import { REGIONS, type Region } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { DEV_PLATFORM_SETTINGS_KEY } from '../../config/platform-env.js';
import { decryptCredential, encryptCredential } from '../../lib/credential-cipher.js';
import { derivePlatformKey } from '../../lib/platform-keys.js';
import { aiDailyCaps, type AiDailyCaps } from './ai-daily-budget.js';
import { aiPrices, type AiPrices } from './ai-usage-report.js';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDERS,
  type EmbeddingProviderId,
  type EmbeddingProviderOptions,
} from './provider/embedding-provider.js';
import {
  LLM_PROVIDERS,
  type LlmProviderId,
  type LlmProviderOptions,
} from './provider/llm-provider.js';
import { embeddingEndpointProblem, llmEndpointProblem } from './provider/provider-hosts.js';

/** The `platform_settings` keys this module reads and writes. */
export const AI_LLM_SETTING_KEY = 'ai.llm';
export const AI_EMBEDDING_SETTING_KEY = 'ai.embedding';
export const AI_CAPS_SETTING_KEY = 'ai.caps';
export const AI_PRICES_SETTING_KEY = 'ai.prices';
export const AI_SETTING_KEYS = [
  AI_LLM_SETTING_KEY,
  AI_EMBEDDING_SETTING_KEY,
  AI_CAPS_SETTING_KEY,
  AI_PRICES_SETTING_KEY,
] as const;
export type AiSettingKey = (typeof AI_SETTING_KEYS)[number];

/** The bounds the environment holds `LLM_TIMEOUT_MS` and `LLM_MAX_OUTPUT_TOKENS` to. */
export const AI_TIMEOUT_MS_MIN = 1_000;
export const AI_TIMEOUT_MS_MAX = 120_000;
export const AI_MAX_OUTPUT_TOKENS_MAX = 16_384;

/** `ai.llm` as stored. */
export interface StoredAiLlm {
  provider: LlmProviderId;
  base_url: string | null;
  model: string | null;
  model_fast: string | null;
  region: Region | null;
  timeout_ms: number | null;
  max_output_tokens: number | null;
  api_key_ciphertext: string | null;
  api_key_last4: string | null;
}

/** `ai.embedding` as stored. */
export interface StoredAiEmbedding {
  provider: EmbeddingProviderId;
  base_url: string | null;
  model: string | null;
  region: Region | null;
  dimensions: typeof EMBEDDING_DIMENSIONS;
  api_key_ciphertext: string | null;
  api_key_last4: string | null;
}

/** The four rows, read; a part nobody set (or of an unreadable shape) is `null`. */
export interface StoredAiSettings {
  llm: StoredAiLlm | null;
  embedding: StoredAiEmbedding | null;
  /** `ai.caps.deployment` — the plans' half of the row is 389.12's. */
  caps: AiDailyCaps | null;
  prices: AiPrices | null;
}

export const NO_STORED_AI_SETTINGS: StoredAiSettings = {
  llm: null,
  embedding: null,
  caps: null,
  prices: null,
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function region(value: unknown): Region | null {
  return REGIONS.find((candidate) => candidate === value) ?? null;
}

function bounded(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function price(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** `ai.llm`, or null when it is not one. */
export function parseStoredLlm(value: unknown): StoredAiLlm | null {
  const row = record(value);
  const provider = LLM_PROVIDERS.find((candidate) => candidate === row?.['provider']);
  if (!row || !provider) return null;
  return {
    provider,
    base_url: text(row['base_url']),
    model: text(row['model']),
    model_fast: text(row['model_fast']),
    region: region(row['region']),
    timeout_ms: bounded(row['timeout_ms'], AI_TIMEOUT_MS_MIN, AI_TIMEOUT_MS_MAX),
    max_output_tokens: bounded(row['max_output_tokens'], 1, AI_MAX_OUTPUT_TOKENS_MAX),
    api_key_ciphertext: text(row['api_key_ciphertext']),
    api_key_last4: text(row['api_key_last4']),
  };
}

/** `ai.embedding`, or null when it is not one. */
export function parseStoredEmbedding(value: unknown): StoredAiEmbedding | null {
  const row = record(value);
  const provider = EMBEDDING_PROVIDERS.find((candidate) => candidate === row?.['provider']);
  if (!row || !provider) return null;
  return {
    provider,
    base_url: text(row['base_url']),
    model: text(row['model']),
    region: region(row['region']),
    dimensions: EMBEDDING_DIMENSIONS,
    api_key_ciphertext: text(row['api_key_ciphertext']),
    api_key_last4: text(row['api_key_last4']),
  };
}

/** The largest daily cap accepted — far past any real day, inside a BIGINT (389.12's bound). */
export const AI_DAILY_CAP_MAX = 10_000_000_000;

function capPair(value: unknown): { workspace: number; global: number } | null {
  const pair = record(value);
  if (!pair) return null;
  const workspace = bounded(pair['workspace'], 1, AI_DAILY_CAP_MAX);
  const global = bounded(pair['global'], 1, AI_DAILY_CAP_MAX);
  return workspace !== null && global !== null ? { workspace, global } : null;
}

/** `ai.caps.deployment`, or null — both meters or neither. */
export function parseDeploymentCaps(value: unknown): AiDailyCaps | null {
  const deployment = record(record(value)?.['deployment']);
  if (!deployment) return null;
  const llm = capPair(deployment['llm']);
  const embedding = capPair(deployment['embedding']);
  return llm && embedding ? { llm, embedding } : null;
}

/** `ai.prices` as the contract names its fields. */
export interface StoredAiPrices {
  llm_input_usd_per_mtok: number | null;
  llm_output_usd_per_mtok: number | null;
  embedding_usd_per_mtok: number | null;
}

/** `ai.prices`, or null. The model's price needs both halves, like `AI_PRICE_*`. */
export function parseStoredPrices(value: unknown): AiPrices | null {
  const row = record(value);
  if (!row) return null;
  const input = price(row['llm_input_usd_per_mtok']);
  const output = price(row['llm_output_usd_per_mtok']);
  return {
    llm: input !== null && output !== null ? { input, output } : null,
    embedding: price(row['embedding_usd_per_mtok']),
  };
}

/** The four rows' values (as `platform_ai_settings()` returns them) as {@link StoredAiSettings}. */
export function parseStoredAiSettings(values: {
  llm?: unknown;
  embedding?: unknown;
  caps?: unknown;
  prices?: unknown;
}): StoredAiSettings {
  return {
    llm: parseStoredLlm(values.llm),
    embedding: parseStoredEmbedding(values.embedding),
    caps: parseDeploymentCaps(values.caps),
    prices: parseStoredPrices(values.prices),
  };
}

// --- The sealed keys ------------------------------------------------------

/**
 * The additional data a key is sealed with: the row it belongs to, so a
 * ciphertext copied from `ai.embedding` into `ai.llm` does not open.
 */
function aiKeyAad(key: typeof AI_LLM_SETTING_KEY | typeof AI_EMBEDDING_SETTING_KEY): string {
  return `platform_settings:${key}:api_key`;
}

export function sealAiApiKey(
  plain: string,
  root: string,
  key: typeof AI_LLM_SETTING_KEY | typeof AI_EMBEDDING_SETTING_KEY,
): string {
  return encryptCredential(plain, derivePlatformKey(root, 'aiApiKey'), aiKeyAad(key));
}

/** Throws `CredentialDecryptError` for anything that does not open. */
export function openAiApiKey(
  sealed: string,
  root: string,
  key: typeof AI_LLM_SETTING_KEY | typeof AI_EMBEDDING_SETTING_KEY,
): string {
  return decryptCredential(sealed, derivePlatformKey(root, 'aiApiKey'), aiKeyAad(key));
}

/** The last four characters a panel shows of a key — never more. */
export function apiKeyLast4(plain: string): string {
  return plain.slice(-4);
}

/**
 * The root key the tenant API opens the panel's keys with: `PLATFORM_SETTINGS_KEY`,
 * or outside production the development placeholder the platform process
 * itself falls back to (`platform-env.ts`). `null` in production without one —
 * the stored keys are then unusable and the environment's apply.
 */
export function aiSettingsRootKey(
  env: Pick<Env, 'PLATFORM_SETTINGS_KEY' | 'isProduction'>,
): string | null {
  const root = env.PLATFORM_SETTINGS_KEY?.trim();
  if (root) return root;
  return env.isProduction ? null : DEV_PLATFORM_SETTINGS_KEY;
}

// --- What a process builds its providers from -----------------------------

export type AiEnv = Pick<
  Env,
  | 'LLM_PROVIDER'
  | 'LLM_PROVIDER_REGION'
  | 'LLM_API_KEY'
  | 'LLM_MODEL'
  | 'LLM_TIMEOUT_MS'
  | 'LLM_MAX_OUTPUT_TOKENS'
  | 'EMBEDDING_PROVIDER'
  | 'EMBEDDING_PROVIDER_REGION'
  | 'EMBEDDING_API_KEY'
  | 'EMBEDDING_MODEL'
  | 'EMBEDDING_TIMEOUT_MS'
  | 'SIYAHTUS_REGION'
  | 'AI_DAILY_LLM_TOKENS_PER_WORKSPACE'
  | 'AI_DAILY_LLM_TOKENS_GLOBAL'
  | 'AI_DAILY_EMBEDDING_TOKENS_PER_WORKSPACE'
  | 'AI_DAILY_EMBEDDING_TOKENS_GLOBAL'
  | 'AI_PRICE_LLM_INPUT_USD_PER_MTOK'
  | 'AI_PRICE_LLM_OUTPUT_USD_PER_MTOK'
  | 'AI_PRICE_EMBEDDING_USD_PER_MTOK'
  | 'llm'
  | 'embedding'
>;

export interface ResolvedLlmConfig {
  source: 'db' | 'env';
  provider: LlmProviderId;
  options: LlmProviderOptions;
  /** Where the inference runs — what the NFR-C4 gate compares a workspace with. */
  region: Region;
  model: string | null;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface ResolvedEmbeddingConfig {
  source: 'db' | 'env';
  provider: EmbeddingProviderId;
  options: EmbeddingProviderOptions;
  region: Region;
  model: string | null;
}

export interface ResolvedAiConfig {
  llm: ResolvedLlmConfig;
  embedding: ResolvedEmbeddingConfig;
  caps: AiDailyCaps;
  capsSource: 'db' | 'env';
  prices: AiPrices;
  /** Why a stored part was not used — operator-facing, never a key. */
  warnings: string[];
}

function envLlm(env: AiEnv): ResolvedLlmConfig {
  return {
    source: 'env',
    provider: env.LLM_PROVIDER,
    options: env.llm,
    region: env.LLM_PROVIDER_REGION ?? env.SIYAHTUS_REGION,
    model: env.llm.openai?.model ?? env.LLM_MODEL ?? null,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
  };
}

function envEmbedding(env: AiEnv): ResolvedEmbeddingConfig {
  return {
    source: 'env',
    provider: env.EMBEDDING_PROVIDER,
    options: env.embedding,
    region: env.EMBEDDING_PROVIDER_REGION ?? env.SIYAHTUS_REGION,
    model: env.embedding.openai?.model ?? env.EMBEDDING_MODEL ?? null,
  };
}

/** The stored key opened, else the environment's, else `null` with the reason. */
function keyFor(
  sealed: string | null,
  fallback: string | undefined,
  root: string | null,
  key: typeof AI_LLM_SETTING_KEY | typeof AI_EMBEDDING_SETTING_KEY,
): { key: string } | { problem: string } {
  if (sealed === null) {
    return fallback
      ? { key: fallback }
      : { problem: `${key} has no API key, and the environment none either` };
  }
  if (root === null) {
    return { problem: `${key}'s API key cannot be opened: PLATFORM_SETTINGS_KEY is unset` };
  }
  try {
    return { key: openAiApiKey(sealed, root, key) };
  } catch {
    return {
      problem: `${key}'s API key does not open with this PLATFORM_SETTINGS_KEY (another key, or an edited row)`,
    };
  }
}

/**
 * What this process builds its providers, caps and prices from: each stored
 * part that can be used, the environment for the rest. Pure — no I/O.
 */
export function resolveAiConfig(
  stored: StoredAiSettings,
  env: AiEnv,
  root: string | null,
): ResolvedAiConfig {
  const warnings: string[] = [];

  let llm = envLlm(env);
  if (stored.llm) {
    const row = stored.llm;
    const base = {
      source: 'db' as const,
      provider: row.provider,
      region: row.region ?? env.SIYAHTUS_REGION,
      model: row.model,
      timeoutMs: row.timeout_ms ?? env.LLM_TIMEOUT_MS,
      maxOutputTokens: row.max_output_tokens ?? env.LLM_MAX_OUTPUT_TOKENS,
    };
    if (row.provider === 'mock') {
      llm = { ...base, options: { openai: null } };
    } else if (!row.base_url || !row.model) {
      warnings.push(`${AI_LLM_SETTING_KEY} names ${row.provider} without a base URL and model`);
    } else {
      const opened = keyFor(row.api_key_ciphertext, env.LLM_API_KEY, root, AI_LLM_SETTING_KEY);
      if ('problem' in opened) warnings.push(opened.problem);
      else {
        llm = {
          ...base,
          options: {
            openai: {
              baseUrl: row.base_url,
              model: row.model,
              fastModel: row.model_fast,
              apiKey: opened.key,
            },
          },
        };
      }
    }
  }

  let embedding = envEmbedding(env);
  if (stored.embedding) {
    const row = stored.embedding;
    const base = {
      source: 'db' as const,
      provider: row.provider,
      region: row.region ?? env.SIYAHTUS_REGION,
      model: row.model,
    };
    if (row.provider === 'mock') {
      embedding = { ...base, options: { openai: null } };
    } else if (!row.base_url || !row.model) {
      warnings.push(
        `${AI_EMBEDDING_SETTING_KEY} names ${row.provider} without a base URL and model`,
      );
    } else {
      const opened = keyFor(
        row.api_key_ciphertext,
        env.EMBEDDING_API_KEY,
        root,
        AI_EMBEDDING_SETTING_KEY,
      );
      if ('problem' in opened) warnings.push(opened.problem);
      else {
        embedding = {
          ...base,
          options: {
            openai: {
              baseUrl: row.base_url,
              model: row.model,
              apiKey: opened.key,
              timeoutMs: env.EMBEDDING_TIMEOUT_MS,
            },
          },
        };
      }
    }
  }

  return {
    llm,
    embedding,
    caps: stored.caps ?? aiDailyCaps(env),
    capsSource: stored.caps ? 'db' : 'env',
    prices: stored.prices ?? aiPrices(env),
    warnings,
  };
}

// --- What the platform API refuses to store (FR-ADMIN-19) -----------------

/** The environment facts the save-time rules read — the platform process's own. */
export type AiRuleEnv = Pick<Env, 'isProduction' | 'PILOT_MODE' | 'SIYAHTUS_REGION'>;

/**
 * Why `llm` / `embedding` may not be stored, as operator-facing sentences —
 * empty when they may. The rules `env.ts` holds the `LLM_*` / `EMBEDDING_*`
 * settings to at boot, applied at the moment of saving instead, so a value the
 * tenant API would refuse in its environment cannot arrive through the panel:
 *
 * - a remote provider names a base URL, a model and a region;
 * - in production the base URL is https and the OpenAI regional host of that
 *   region — never `api.openai.com` (`provider-hosts.ts`);
 * - in production under `PILOT_MODE=true`, never `mock`, and the region is
 *   `SIYAHTUS_REGION`.
 *
 * Outside production the host is not checked, so a test or a dev box can
 * point at a local fake. The embedding width is fixed by the schema type.
 */
export function aiSettingsProblems(
  next: { llm: StoredAiLlm | null; embedding: StoredAiEmbedding | null },
  env: AiRuleEnv,
): string[] {
  const problems: string[] = [];
  const pilot = env.isProduction && env.PILOT_MODE;
  const parts = [
    { name: 'llm', row: next.llm, check: llmEndpointProblem },
    { name: 'embedding', row: next.embedding, check: embeddingEndpointProblem },
  ] as const;
  for (const { name, row, check } of parts) {
    if (!row) continue;
    if (row.provider === 'mock') {
      if (pilot) {
        problems.push(
          `${name}.provider must be a real provider in production when PILOT_MODE=true: the stub answers real visitors.`,
        );
      }
      continue;
    }
    const missing = (['base_url', 'model', 'region'] as const).filter((field) => !row[field]);
    if (missing.length > 0) {
      problems.push(`${name}: ${missing.join(', ')} required for provider ${row.provider}.`);
      continue;
    }
    if (env.isProduction) {
      const problem = check(row.provider, row.base_url!, row.region!);
      if (problem) problems.push(`${name}: ${problem}`);
    } else if (!isUrl(row.base_url!)) {
      problems.push(`${name}.base_url is not a URL.`);
    }
    if (pilot && row.region !== env.SIYAHTUS_REGION) {
      problems.push(
        `${name}.region must equal SIYAHTUS_REGION (${env.SIYAHTUS_REGION}) in production when PILOT_MODE=true: every workspace is filed there.`,
      );
    }
  }
  return problems;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
