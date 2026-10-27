/**
 * The root panel's AI settings, as the platform API reads and writes them
 * (tm 389.17 · FR-ADMIN-17/19 · design.md §B2, §D AI settings, §F).
 *
 * Four `platform_settings` rows (`ai.llm`, `ai.embedding`, `ai.caps`,
 * `ai.prices`; their shapes and the tenant side are `services/ai/ai-settings.ts`).
 * A write replaces the parts it names, in one transaction under one advisory
 * lock, bumps each row's `version`, stamps the operator and hands the caller
 * the dotted names of the fields that moved — which is all the audit entry
 * carries: never a value of a key, and never a key.
 *
 * **The keys.** An `api_key` in a write is sealed here (AES-256-GCM under the
 * `aiApiKey` sub-key of `PLATFORM_SETTINGS_KEY`) before it is stored; the
 * plain text goes no further than this function. Absent, the stored key stays;
 * `null`, it is removed. What any reader gets back is `api_key_last4`.
 *
 * **`ai.caps` is shared** with the plans' defaults (`plans`, tm 389.12): this
 * writes `deployment` and keeps whatever else the row holds.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  OPS_AI_REEMBED_KEY,
  OPS_AI_REEMBED_LOCK_KEY,
  PLATFORM_AI_SETTINGS_CHANGED,
  PLATFORM_OPS_CHANNEL,
  type AiSettingsSource,
  type Region,
} from '@siyahtus/types';
import { LEXICAL_EMBEDDING_SPACE } from '@siyahtus/ai-mock';
import { ApiError } from '../../lib/api-error.js';
import type { AiDailyCaps } from '../ai/ai-daily-budget.js';
import {
  AI_CAPS_SETTING_KEY,
  AI_EMBEDDING_SETTING_KEY,
  AI_LLM_SETTING_KEY,
  AI_PRICES_SETTING_KEY,
  AI_SETTING_KEYS,
  aiSettingsProblems,
  apiKeyLast4,
  parseDeploymentCaps,
  parseStoredEmbedding,
  parseStoredLlm,
  sealAiApiKey,
  type AiEnv,
  type AiRuleEnv,
  type AiSettingKey,
  type StoredAiEmbedding,
  type StoredAiLlm,
  type StoredAiPrices,
  type StoredAiSettings,
} from '../ai/ai-settings.js';
import { EMBEDDING_DIMENSIONS, embeddingSpace } from '../ai/provider/embedding-provider.js';
import type { EmbeddingProviderId } from '../ai/provider/embedding-provider.js';
import type { LlmProviderId } from '../ai/provider/llm-provider.js';

/** `ai.llm` as the contract shows it — the key reduced to its last four characters. */
export interface PlatformAiLlmView {
  provider: LlmProviderId;
  base_url: string | null;
  model: string | null;
  model_fast: string | null;
  region: Region | null;
  timeout_ms: number | null;
  max_output_tokens: number | null;
  api_key_last4: string | null;
}

export interface PlatformAiEmbeddingView {
  provider: EmbeddingProviderId;
  base_url: string | null;
  model: string | null;
  region: Region | null;
  dimensions: typeof EMBEDDING_DIMENSIONS;
  api_key_last4: string | null;
}

export const AI_REEMBED_STATES = ['idle', 'running', 'finished', 'failed'] as const;
export type AiReembedState = (typeof AI_REEMBED_STATES)[number];

export interface PlatformAiReembedStatus {
  state: AiReembedState;
  started_at: string | null;
  finished_at: string | null;
  target: string | null;
  sources: number;
  chunks: number;
  failed: number;
  refused: number;
  capped: boolean;
}

export interface PlatformAiSettingsView {
  llm: PlatformAiLlmView | null;
  embedding: PlatformAiEmbeddingView | null;
  caps: AiDailyCaps | null;
  prices: StoredAiPrices | null;
  source: { llm: AiSettingsSource; embedding: AiSettingsSource };
  reembed: PlatformAiReembedStatus;
  updated_at: string | null;
  warning?: 'reembed_required';
}

/** `PUT /settings/ai`'s `llm`. */
export interface AiLlmInput {
  provider: LlmProviderId;
  base_url?: string | null | undefined;
  model?: string | null | undefined;
  model_fast?: string | null | undefined;
  region?: Region | null | undefined;
  timeout_ms?: number | null | undefined;
  max_output_tokens?: number | null | undefined;
  api_key?: string | null | undefined;
}

export interface AiEmbeddingInput {
  provider: EmbeddingProviderId;
  base_url?: string | null | undefined;
  model?: string | null | undefined;
  region?: Region | null | undefined;
  api_key?: string | null | undefined;
}

/** A present key changes; `null` removes the stored value. */
export interface AiSettingsUpdate {
  llm?: AiLlmInput | null | undefined;
  embedding?: AiEmbeddingInput | null | undefined;
  caps?: AiDailyCaps | null | undefined;
  prices?: StoredAiPrices | null | undefined;
}

export interface AiSettingsChange {
  settings: PlatformAiSettingsView;
  /** Dotted field names — `llm.model`, `embedding.api_key`, `caps`… */
  changed: string[];
  /** The `platform_settings` keys that were written. */
  keys: AiSettingKey[];
}

type Row = { key: string; value: Prisma.JsonValue; updatedAt: Date };

const IDLE: PlatformAiReembedStatus = {
  state: 'idle',
  started_at: null,
  finished_at: null,
  target: null,
  sources: 0,
  chunks: 0,
  failed: 0,
  refused: 0,
  capped: false,
};

function llmView(row: StoredAiLlm | null): PlatformAiLlmView | null {
  if (!row) return null;
  return {
    provider: row.provider,
    base_url: row.base_url,
    model: row.model,
    model_fast: row.model_fast,
    region: row.region,
    timeout_ms: row.timeout_ms,
    max_output_tokens: row.max_output_tokens,
    api_key_last4: row.api_key_last4,
  };
}

function embeddingView(row: StoredAiEmbedding | null): PlatformAiEmbeddingView | null {
  if (!row) return null;
  return {
    provider: row.provider,
    base_url: row.base_url,
    model: row.model,
    region: row.region,
    dimensions: row.dimensions,
    api_key_last4: row.api_key_last4,
  };
}

function storedPrices(value: Prisma.JsonValue | undefined): StoredAiPrices | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const price = (field: string): number | null => {
    const figure = row[field];
    return typeof figure === 'number' && Number.isFinite(figure) && figure >= 0 ? figure : null;
  };
  return {
    llm_input_usd_per_mtok: price('llm_input_usd_per_mtok'),
    llm_output_usd_per_mtok: price('llm_output_usd_per_mtok'),
    embedding_usd_per_mtok: price('embedding_usd_per_mtok'),
  };
}

/** The four rows as stored, and the raw `ai.caps` value (its `plans` half is kept on write). */
interface AiRows {
  stored: StoredAiSettings;
  prices: StoredAiPrices | null;
  capsValue: Record<string, unknown> | null;
  updatedAt: Date | null;
}

function fromRows(rows: readonly Row[]): AiRows {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const capsRaw = byKey.get(AI_CAPS_SETTING_KEY)?.value;
  const capsValue =
    typeof capsRaw === 'object' && capsRaw !== null && !Array.isArray(capsRaw)
      ? (capsRaw as Record<string, unknown>)
      : null;
  const prices = storedPrices(byKey.get(AI_PRICES_SETTING_KEY)?.value);
  const newest = rows.reduce<Date | null>(
    (latest, row) => (latest && latest > row.updatedAt ? latest : row.updatedAt),
    null,
  );
  return {
    stored: {
      llm: parseStoredLlm(byKey.get(AI_LLM_SETTING_KEY)?.value),
      embedding: parseStoredEmbedding(byKey.get(AI_EMBEDDING_SETTING_KEY)?.value),
      caps: parseDeploymentCaps(capsValue),
      prices: null,
    },
    prices,
    capsValue,
    updatedAt: newest,
  };
}

/** The embedding space a configuration writes, as the tenant API would name it. */
export function embeddingSpaceOf(config: {
  provider: EmbeddingProviderId;
  model: string | null;
}): string {
  return config.provider === 'mock'
    ? LEXICAL_EMBEDDING_SPACE
    : embeddingSpace(config.provider, config.model ?? '');
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Tell every tenant process to rebuild its providers. After the commit. */
export async function announceAiSettingsChanged(
  redis: Pick<Redis, 'publish'>,
  keys: readonly string[],
): Promise<void> {
  await redis.publish(
    PLATFORM_OPS_CHANNEL,
    JSON.stringify({ type: PLATFORM_AI_SETTINGS_CHANGED, keys }),
  );
}

export interface PlatformAiSettingsStoreOptions {
  /** `PLATFORM_SETTINGS_KEY` (`platform-env.ts`'s resolved root). */
  rootKey: string;
  /** The platform process's environment: the save-time rules, and the fallback a view compares against. */
  env: AiEnv & AiRuleEnv;
}

export class PlatformAiSettingsStore {
  readonly #db: PrismaClient;
  readonly #redis: Redis;
  readonly #options: PlatformAiSettingsStoreOptions;

  constructor(db: PrismaClient, redis: Redis, options: PlatformAiSettingsStoreOptions) {
    this.#db = db;
    this.#redis = redis;
    this.#options = options;
  }

  async #rows(client: Pick<PrismaClient, 'platformSetting'> = this.#db): Promise<AiRows> {
    const rows = await client.platformSetting.findMany({
      where: { key: { in: [...AI_SETTING_KEYS] } },
      select: { key: true, value: true, updatedAt: true },
    });
    return fromRows(rows);
  }

  /** The stored settings — keys still sealed. For the connection test and re-embedding. */
  async stored(): Promise<StoredAiSettings> {
    const rows = await this.#rows();
    return { ...rows.stored, prices: null };
  }

  async read(
    client: Pick<PrismaClient, 'platformSetting'> = this.#db,
  ): Promise<PlatformAiSettingsView> {
    return this.#view(await this.#rows(client));
  }

  async #view(rows: AiRows): Promise<PlatformAiSettingsView> {
    return {
      llm: llmView(rows.stored.llm),
      embedding: embeddingView(rows.stored.embedding),
      caps: rows.stored.caps,
      prices: rows.prices,
      source: {
        llm: rows.stored.llm ? 'db' : 'env',
        embedding: rows.stored.embedding ? 'db' : 'env',
      },
      reembed: await this.reembedStatus(),
      updated_at: rows.updatedAt ? rows.updatedAt.toISOString() : null,
    };
  }

  /** The last re-embedding's progress; a run whose lock has lapsed is `failed`. */
  async reembedStatus(): Promise<PlatformAiReembedStatus> {
    const [hash, lock] = await Promise.all([
      this.#redis.hgetall(OPS_AI_REEMBED_KEY).catch(() => ({}) as Record<string, string>),
      this.#redis.exists(OPS_AI_REEMBED_LOCK_KEY).catch(() => 0),
    ]);
    const state = AI_REEMBED_STATES.find((candidate) => candidate === hash['state']);
    if (!state) return IDLE;
    const count = (field: string): number => {
      const value = Number(hash[field] ?? 0);
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    };
    return {
      state: state === 'running' && lock === 0 ? 'failed' : state,
      started_at: hash['started_at'] || null,
      finished_at: hash['finished_at'] || null,
      target: hash['target'] || null,
      sources: count('sources'),
      chunks: count('chunks'),
      failed: count('failed'),
      refused: count('refused'),
      capped: hash['capped'] === '1',
    };
  }

  /**
   * Apply `update` in one transaction. Throws `400 validation` naming every
   * rule a part breaks (`aiSettingsProblems`) before anything is written; a
   * write equal to what is stored changes nothing and records nothing.
   */
  async update(
    update: AiSettingsUpdate,
    adminId: string,
    record: (tx: Prisma.TransactionClient, change: AiSettingsChange) => Promise<void>,
  ): Promise<AiSettingsChange> {
    return this.#db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform_settings.ai'))`;
      const before = await this.#rows(tx);
      const changed: string[] = [];
      const keys: AiSettingKey[] = [];

      let nextLlm = before.stored.llm;
      if (update.llm !== undefined) nextLlm = this.#nextLlm(before.stored.llm, update.llm);
      let nextEmbedding = before.stored.embedding;
      if (update.embedding !== undefined) {
        nextEmbedding = this.#nextEmbedding(before.stored.embedding, update.embedding);
      }

      const problems = aiSettingsProblems(
        {
          llm: update.llm !== undefined ? nextLlm : null,
          embedding: update.embedding !== undefined ? nextEmbedding : null,
        },
        this.#options.env,
      );
      if (problems.length > 0) {
        throw ApiError.validation(problems.join(' '), { problems });
      }

      if (update.llm !== undefined) {
        const fields = diff('llm', before.stored.llm, nextLlm, update.llm?.api_key);
        if (fields.length > 0) {
          changed.push(...fields);
          keys.push(AI_LLM_SETTING_KEY);
          await write(tx, AI_LLM_SETTING_KEY, nextLlm, adminId);
        }
      }
      if (update.embedding !== undefined) {
        const fields = diff(
          'embedding',
          before.stored.embedding,
          nextEmbedding,
          update.embedding?.api_key,
        );
        if (fields.length > 0) {
          changed.push(...fields);
          keys.push(AI_EMBEDDING_SETTING_KEY);
          await write(tx, AI_EMBEDDING_SETTING_KEY, nextEmbedding, adminId);
        }
      }
      if (update.caps !== undefined && !same(before.stored.caps, update.caps)) {
        changed.push('caps');
        keys.push(AI_CAPS_SETTING_KEY);
        const rest = { ...(before.capsValue ?? {}) };
        delete rest['deployment'];
        const value = update.caps === null ? rest : { ...rest, deployment: update.caps };
        await write(tx, AI_CAPS_SETTING_KEY, Object.keys(value).length > 0 ? value : null, adminId);
      }
      if (update.prices !== undefined && !same(before.prices, update.prices)) {
        changed.push('prices');
        keys.push(AI_PRICES_SETTING_KEY);
        await write(tx, AI_PRICES_SETTING_KEY, update.prices, adminId);
      }

      const after = keys.length > 0 ? await this.#rows(tx) : before;
      const settings = await this.#view(after);
      if (this.#space(before.stored) !== this.#space(after.stored)) {
        settings.warning = 'reembed_required';
      }
      const change = { settings, changed, keys };
      if (keys.length > 0) await record(tx, change);
      return change;
    });
  }

  /** The space the stored embedding settings (else the environment's) write — no key needed. */
  #space(stored: StoredAiSettings): string {
    const env = this.#options.env;
    return embeddingSpaceOf(
      stored.embedding ?? {
        provider: env.EMBEDDING_PROVIDER,
        model: env.embedding.openai?.model ?? env.EMBEDDING_MODEL ?? null,
      },
    );
  }

  #nextLlm(current: StoredAiLlm | null, input: AiLlmInput | null): StoredAiLlm | null {
    if (input === null) return null;
    return {
      provider: input.provider,
      base_url: emptyToNull(input.base_url),
      model: emptyToNull(input.model),
      model_fast: emptyToNull(input.model_fast),
      region: input.region ?? null,
      timeout_ms: input.timeout_ms ?? null,
      max_output_tokens: input.max_output_tokens ?? null,
      ...this.#key(current, input.api_key, AI_LLM_SETTING_KEY),
    };
  }

  #nextEmbedding(
    current: StoredAiEmbedding | null,
    input: AiEmbeddingInput | null,
  ): StoredAiEmbedding | null {
    if (input === null) return null;
    return {
      provider: input.provider,
      base_url: emptyToNull(input.base_url),
      model: emptyToNull(input.model),
      region: input.region ?? null,
      dimensions: EMBEDDING_DIMENSIONS,
      ...this.#key(current, input.api_key, AI_EMBEDDING_SETTING_KEY),
    };
  }

  /** The sealed key after a write: kept when absent, removed on `null`, sealed when given. */
  #key(
    current: { api_key_ciphertext: string | null; api_key_last4: string | null } | null,
    given: string | null | undefined,
    key: typeof AI_LLM_SETTING_KEY | typeof AI_EMBEDDING_SETTING_KEY,
  ): { api_key_ciphertext: string | null; api_key_last4: string | null } {
    if (given === undefined) {
      return {
        api_key_ciphertext: current?.api_key_ciphertext ?? null,
        api_key_last4: current?.api_key_last4 ?? null,
      };
    }
    const plain = given?.trim() ?? '';
    if (plain === '') return { api_key_ciphertext: null, api_key_last4: null };
    return {
      api_key_ciphertext: sealAiApiKey(plain, this.#options.rootKey, key),
      api_key_last4: apiKeyLast4(plain),
    };
  }
}

const COMPARED_FIELDS = [
  'provider',
  'base_url',
  'model',
  'model_fast',
  'region',
  'timeout_ms',
  'max_output_tokens',
  'dimensions',
] as const;

/** The dotted fields that differ; a key counts as changed when one was given or one was removed. */
function diff(
  part: 'llm' | 'embedding',
  before: StoredAiLlm | StoredAiEmbedding | null,
  after: StoredAiLlm | StoredAiEmbedding | null,
  givenKey: string | null | undefined,
): string[] {
  if (before === null && after === null) return [];
  if (before === null || after === null) {
    const present = (after ?? before)!;
    const fields = COMPARED_FIELDS.filter(
      (field) =>
        field in present && (present as unknown as Record<string, unknown>)[field] !== null,
    ).map((field) => `${part}.${field}`);
    if (present.api_key_ciphertext !== null) fields.push(`${part}.api_key`);
    return fields.length > 0 ? fields : [part];
  }
  const a = before as unknown as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  const fields = COMPARED_FIELDS.filter((field) => field in b && a[field] !== b[field]).map(
    (field) => `${part}.${field}`,
  );
  const keyMoved =
    (givenKey !== undefined && givenKey !== null && givenKey.trim() !== '') ||
    before.api_key_ciphertext !== after.api_key_ciphertext;
  if (keyMoved) fields.push(`${part}.api_key`);
  return fields;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, canonical(record[key])]),
  );
}

async function write(
  tx: Prisma.TransactionClient,
  key: AiSettingKey,
  value: unknown,
  adminId: string,
): Promise<void> {
  if (value === null) {
    await tx.platformSetting.deleteMany({ where: { key } });
    return;
  }
  const json = value as Prisma.InputJsonValue;
  await tx.platformSetting.upsert({
    where: { key },
    create: { key, value: json, updatedBy: adminId },
    update: { value: json, updatedBy: adminId, version: { increment: 1 } },
  });
}
