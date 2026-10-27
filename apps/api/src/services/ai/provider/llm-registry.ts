/**
 * The tenant API's AI providers, rebuilt without a restart (tm 389.17 ·
 * FR-ADMIN-18 · design.md §F).
 *
 * Until this, `buildServer` built one model provider per surface and one
 * embedding provider from `env.llm` / `env.embedding` at boot, and the
 * adapters keep their settings in readonly fields — a new key meant a new
 * process. The registry holds the instances now; everything else holds a
 * **facade** ({@link AiProviderRegistry.llm}, {@link AiProviderRegistry.embeddings})
 * whose every call asks the registry for the instance of the moment. So
 * `MeteredLlm`, Copilot's instance, the knowledge service and the sweeps keep
 * the one object they were given at boot, and a `reload()` changes what
 * answers behind it.
 *
 * **Where the settings come from** (`ai-settings.ts`): the root panel's rows
 * through `platform_ai_settings()`, else the environment, part by part. A
 * reload happens when the panel announces `ai.settings_changed`
 * ({@link listenForAiSettingsChanges}) and, as a safety net for a missed
 * announcement, every {@link AI_SETTINGS_REFRESH_MS}. A read that fails keeps
 * what is running and logs a warning — never a reason not to serve.
 *
 * **What a change resets.** A part whose resolved settings changed gets new
 * instances — with new circuit breakers, so a breaker opened by a bad key does
 * not hold back the good one. A call already under way finishes on the
 * instance it started on: the facade resolved it before the swap and the old
 * object lives as long as that call holds it. A part that did not change keeps
 * its instances, breakers and all.
 *
 * **Limits.** When the panel sets `timeout_ms` / `max_output_tokens`, a
 * request that asked for the environment's value (`LLM_TIMEOUT_MS`,
 * `LLM_MAX_OUTPUT_TOKENS` — what every caller passes as "the configured
 * ceiling") gets the panel's instead, and a request that asked for less than
 * the environment's ceiling is held under the panel's too. `LLM_MAX_PROMPT_CHARS`
 * is not a provider setting and is not touched.
 *
 * Nothing here logs a key: the fingerprint that decides "changed" is a hash.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  PLATFORM_AI_SETTINGS_CHANGED,
  PLATFORM_OPS_CHANNEL,
  parsePlatformOpsMessage,
} from '@siyahtus/types';
import {
  NO_STORED_AI_SETTINGS,
  parseStoredAiSettings,
  resolveAiConfig,
  type AiEnv,
  type ResolvedAiConfig,
  type ResolvedEmbeddingConfig,
  type ResolvedLlmConfig,
  type StoredAiSettings,
} from '../ai-settings.js';
import type { InferenceProvider } from '../inference.js';
import { createEmbeddingProvider } from './create-embedding-provider.js';
import type { EmbeddingProvider, EmbeddingProviderId } from './embedding-provider.js';
import {
  createLlmProvider,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmProvider,
  type LlmProviderId,
} from './llm-provider.js';
import type { LlmLogger } from './openai-llm-provider.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The tenant API's AI providers and the settings they were built from (tm 389.17). */
    aiProviders: AiProviderRegistry;
  }
}

/** How often the registry re-reads the settings when no announcement came (60 s). */
export const AI_SETTINGS_REFRESH_MS = 60_000;

/**
 * The model's two instances: the visitors' (the AI Agent, guidance, the test
 * bench, the sweeps) and Copilot's — separate circuit breakers (tm 257.5), so
 * failed summaries do not hand every visitor to a human.
 */
export const LLM_SURFACES = ['visitor', 'copilot'] as const;
export type LlmSurface = (typeof LLM_SURFACES)[number];

export interface AiRegistryLogger extends LlmLogger {
  child(bindings: Record<string, unknown>): AiRegistryLogger;
}

export interface AiProviderRegistryOptions {
  env: AiEnv;
  /** The root key the stored API keys open with (`aiSettingsRootKey`); null — they do not. */
  rootKey: string | null;
  /** The stored rows; a rejection keeps what is running. */
  read: () => Promise<StoredAiSettings>;
  logger: AiRegistryLogger;
  llmFetch?: typeof fetch;
  embeddingFetch?: typeof fetch;
  /** Instances a test hands in; they answer whatever the settings say. */
  pinned?: { visitor?: LlmProvider; copilot?: LlmProvider; embeddings?: EmbeddingProvider };
}

/** Reads `platform_ai_settings()` over the runtime role, outside any tenant transaction. */
export async function readAiSettingsForTenant(db: PrismaClient): Promise<StoredAiSettings> {
  const rows = await db.$queryRaw<
    Array<{ llm: unknown; embedding: unknown; caps: unknown; prices: unknown }>
  >`SELECT llm, embedding, caps, prices FROM platform_ai_settings()`;
  const row = rows[0];
  return row ? parseStoredAiSettings(row) : NO_STORED_AI_SETTINGS;
}

/** A hash of what a part is built from — equal hashes, same instances. */
function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** The request with the panel's limits in place of the environment's (file header). */
export function applyLlmLimits(
  request: LlmCompletionRequest,
  config: Pick<ResolvedLlmConfig, 'source' | 'timeoutMs' | 'maxOutputTokens'>,
  env: Pick<AiEnv, 'LLM_TIMEOUT_MS' | 'LLM_MAX_OUTPUT_TOKENS'>,
): LlmCompletionRequest {
  if (config.source !== 'db') return request;
  const limit = (asked: number, envValue: number, panel: number): number =>
    asked === envValue ? panel : Math.min(asked, panel);
  const timeoutMs = limit(request.timeoutMs, env.LLM_TIMEOUT_MS, config.timeoutMs);
  const maxOutputTokens = limit(
    request.maxOutputTokens,
    env.LLM_MAX_OUTPUT_TOKENS,
    config.maxOutputTokens,
  );
  return timeoutMs === request.timeoutMs && maxOutputTokens === request.maxOutputTokens
    ? request
    : { ...request, timeoutMs, maxOutputTokens };
}

export class AiProviderRegistry {
  readonly #options: AiProviderRegistryOptions;
  #config: ResolvedAiConfig;
  #llmPrint = '';
  #embeddingPrint = '';
  #llm: Record<LlmSurface, LlmProvider>;
  #embeddings: EmbeddingProvider;
  #reloading: Promise<boolean> | null = null;
  #again = false;
  #timer: NodeJS.Timeout | null = null;
  readonly #facades: Record<LlmSurface, LlmProvider>;
  readonly #embeddingFacade: EmbeddingProvider;

  private constructor(options: AiProviderRegistryOptions, config: ResolvedAiConfig) {
    this.#options = options;
    this.#config = config;
    this.#llm = this.#buildLlm(config.llm);
    this.#embeddings = this.#buildEmbeddings(config.embedding);
    this.#llmPrint = fingerprint(config.llm);
    this.#embeddingPrint = fingerprint(config.embedding);

    // Arrow functions: each call reads the registry's fields as they are then.
    const current = (surface: LlmSurface): LlmProvider => this.current(surface);
    const limited = (request: LlmCompletionRequest): LlmCompletionRequest =>
      applyLlmLimits(request, this.#config.llm, this.#options.env);
    const embeddings = (): EmbeddingProvider => this.#embeddings;
    const facade = (surface: LlmSurface): LlmProvider => ({
      get id(): LlmProviderId {
        return current(surface).id;
      },
      complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
        const provider = current(surface);
        return provider.complete(limited(request));
      },
    });
    this.#facades = { visitor: facade('visitor'), copilot: facade('copilot') };
    this.#embeddingFacade = {
      get id(): EmbeddingProviderId {
        return embeddings().id;
      },
      get space(): string {
        return embeddings().space;
      },
      embed(texts) {
        return embeddings().embed(texts);
      },
    };
  }

  /**
   * Read the settings once and build. A failed read starts on the
   * environment; a stored part that cannot be built starts on the
   * environment's; the environment's own failure throws, as the boot always did.
   */
  static async create(options: AiProviderRegistryOptions): Promise<AiProviderRegistry> {
    let stored = NO_STORED_AI_SETTINGS;
    try {
      stored = await options.read();
    } catch (error) {
      options.logger.warn(
        { err: error, event: 'ai.settings_unread' },
        'AI settings not read; running on the environment',
      );
    }
    let config = resolveAiConfig(stored, options.env, options.rootKey);
    let registry: AiProviderRegistry;
    try {
      registry = new AiProviderRegistry(options, config);
    } catch (error) {
      if (config.llm.source === 'env' && config.embedding.source === 'env') throw error;
      options.logger.warn(
        { err: error, event: 'ai.settings_unusable' },
        'stored AI settings could not be built; running on the environment',
      );
      config = resolveAiConfig(NO_STORED_AI_SETTINGS, options.env, options.rootKey);
      registry = new AiProviderRegistry(options, config);
    }
    registry.#report(config, true);
    return registry;
  }

  /** The settings in force. */
  config(): ResolvedAiConfig {
    return this.#config;
  }

  /** The instance answering `surface` now — a test's pinned one if it handed one in. */
  current(surface: LlmSurface = 'visitor'): LlmProvider {
    return this.#options.pinned?.[surface] ?? this.#llm[surface];
  }

  /** A provider that always calls {@link current}; hand this out, not the instance. */
  llm(surface: LlmSurface): LlmProvider {
    return this.#facades[surface];
  }

  /** The embedding provider's facade, on {@link llm}'s terms. */
  embeddings(): EmbeddingProvider {
    return this.#embeddingFacade;
  }

  /**
   * Where each provider runs — what the NFR-C4 gate reads, per request. The
   * configured provider, as `resolveInferenceProvider` always reported it,
   * whatever instance a test pinned.
   */
  inference(): { llm: InferenceProvider; embedding: InferenceProvider } {
    return {
      llm: { id: this.#config.llm.provider, region: this.#config.llm.region },
      embedding: { id: this.#config.embedding.provider, region: this.#config.embedding.region },
    };
  }

  /**
   * Re-read the settings and rebuild whatever changed. Resolves `true` when
   * an instance was replaced. Never rejects: a failure keeps what runs.
   * Calls that overlap run once more after the current one, not in parallel.
   */
  reload(): Promise<boolean> {
    if (this.#reloading) {
      this.#again = true;
      return this.#reloading;
    }
    this.#reloading = (async () => {
      let changed = false;
      do {
        this.#again = false;
        changed = (await this.#reloadOnce()) || changed;
      } while (this.#again);
      return changed;
    })().finally(() => {
      this.#reloading = null;
    });
    return this.#reloading;
  }

  /** The safety-net timer; {@link stop} clears it. */
  start(intervalMs = AI_SETTINGS_REFRESH_MS): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.reload(), intervalMs);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#reloading?.catch(() => false);
  }

  async #reloadOnce(): Promise<boolean> {
    let stored: StoredAiSettings;
    try {
      stored = await this.#options.read();
    } catch (error) {
      this.#options.logger.warn(
        { err: error, event: 'ai.settings_unread' },
        'AI settings not re-read; the providers in use stay',
      );
      return false;
    }
    const config = resolveAiConfig(stored, this.#options.env, this.#options.rootKey);
    const llmPrint = fingerprint(config.llm);
    const embeddingPrint = fingerprint(config.embedding);
    let llm = this.#llm;
    let embeddings = this.#embeddings;
    try {
      if (llmPrint !== this.#llmPrint) llm = this.#buildLlm(config.llm);
      if (embeddingPrint !== this.#embeddingPrint)
        embeddings = this.#buildEmbeddings(config.embedding);
    } catch (error) {
      this.#options.logger.warn(
        { err: error, event: 'ai.settings_unusable' },
        'new AI settings could not be built; the providers in use stay',
      );
      return false;
    }
    const changed = llm !== this.#llm || embeddings !== this.#embeddings;
    this.#llm = llm;
    this.#embeddings = embeddings;
    this.#llmPrint = llmPrint;
    this.#embeddingPrint = embeddingPrint;
    const before = this.#config;
    this.#config = config;
    if (changed || fingerprint(before.caps) !== fingerprint(config.caps))
      this.#report(config, false);
    return changed;
  }

  #buildLlm(config: ResolvedLlmConfig): Record<LlmSurface, LlmProvider> {
    const build = (surface: LlmSurface): LlmProvider =>
      createLlmProvider(config.provider, config.options, {
        logger:
          surface === 'visitor'
            ? this.#options.logger.child({ component: 'llm' })
            : this.#options.logger.child({ component: 'llm', surface }),
        ...(this.#options.llmFetch ? { fetchImpl: this.#options.llmFetch } : {}),
      });
    return { visitor: build('visitor'), copilot: build('copilot') };
  }

  #buildEmbeddings(config: ResolvedEmbeddingConfig): EmbeddingProvider {
    if (this.#options.pinned?.embeddings) return this.#options.pinned.embeddings;
    return createEmbeddingProvider(config.provider, config.options, {
      logger: this.#options.logger.child({ component: 'embedding' }),
      ...(this.#options.embeddingFetch ? { fetchImpl: this.#options.embeddingFetch } : {}),
    });
  }

  #report(config: ResolvedAiConfig, boot: boolean): void {
    for (const warning of config.warnings) {
      this.#options.logger.warn({ event: 'ai.settings_fallback' }, warning);
    }
    this.#options.logger.info(
      {
        event: boot ? 'ai.settings_loaded' : 'ai.settings_applied',
        llm_source: config.llm.source,
        llm_provider: config.llm.provider,
        embedding_source: config.embedding.source,
        embedding_provider: config.embedding.provider,
        caps_source: config.capsSource,
      },
      boot ? 'AI providers built' : 'AI providers rebuilt from new settings',
    );
  }
}

/**
 * Reload on `ai.settings_changed` (tm 389.17), on the subscriber connection
 * the deployment settings already use. A message that does not parse reloads
 * too — re-reading costs one query, missing a change costs a minute.
 */
export async function listenForAiSettingsChanges(
  subscriber: Redis,
  onChange: () => void,
): Promise<void> {
  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== PLATFORM_OPS_CHANNEL) return;
    const parsed = parsePlatformOpsMessage(message);
    if (parsed === null || parsed.type === PLATFORM_AI_SETTINGS_CHANGED) onChange();
  });
  await subscriber.subscribe(PLATFORM_OPS_CHANNEL);
}
