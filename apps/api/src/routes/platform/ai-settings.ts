/**
 * `/platform/v1/settings/ai*` — the AI provider settings (tm 389.17 ·
 * FR-ADMIN-17/18/19 · design.md §C settings, §D, §F).
 *
 *   GET  /settings/ai                  ai.read          stored values, keys as `…last4`
 *   PUT  /settings/ai                  ai.manage        recentTotp — model, embedding, caps, prices
 *   POST /settings/ai/test-connection  ai.manage        one tiny request; 3 a minute
 *   POST /settings/ai/reembed          operations.run   `knowledge:reembed` in the background
 *
 * A write records `ai_settings.updated` in its own transaction with the dotted
 * names of the fields that moved (`changed`) — never a value of a key — and
 * announces `ai.settings_changed` after the commit, so every tenant process
 * rebuilds its providers (`llm-registry.ts`); a change to the caps also
 * announces `ai.caps_changed`, which drops every workspace's cached caps. No
 * workspace is named, so there is no tenant entry.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REGIONS } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import type { PlatformEnv } from '../../config/platform-env.js';
import { ApiError } from '../../lib/api-error.js';
import {
  AI_DAILY_CAP_MAX,
  AI_MAX_OUTPUT_TOKENS_MAX,
  AI_TIMEOUT_MS_MAX,
  AI_TIMEOUT_MS_MIN,
} from '../../services/ai/ai-settings.js';
import { publishAiCapsChanged } from '../../services/ai/ai-caps-events.js';
import { EMBEDDING_DIMENSIONS } from '../../services/ai/provider/embedding-provider.js';
import {
  AI_TEST_TARGETS,
  type PlatformAiOperations,
} from '../../services/platform/ai-operations.js';
import {
  announceAiSettingsChanged,
  PlatformAiSettingsStore,
} from '../../services/platform/ai-settings.js';
import { parse } from './auth.js';

const optionalText = (max: number) => z.string().max(max).nullable().optional();
const apiKey = z.string().trim().min(8).max(500).nullable().optional();

const llmInput = z
  .object({
    provider: z.enum(['mock', 'openai']),
    base_url: optionalText(500),
    model: optionalText(200),
    model_fast: optionalText(200),
    region: z.enum(REGIONS).nullable().optional(),
    timeout_ms: z
      .number()
      .int()
      .min(AI_TIMEOUT_MS_MIN)
      .max(AI_TIMEOUT_MS_MAX)
      .nullable()
      .optional(),
    max_output_tokens: z.number().int().min(1).max(AI_MAX_OUTPUT_TOKENS_MAX).nullable().optional(),
    api_key: apiKey,
  })
  .strict();

const embeddingInput = z
  .object({
    provider: z.enum(['mock', 'openai']),
    base_url: optionalText(500),
    model: optionalText(200),
    region: z.enum(REGIONS).nullable().optional(),
    dimensions: z
      .number()
      .int()
      .refine((value) => value === EMBEDDING_DIMENSIONS, {
        message: `must be ${EMBEDDING_DIMENSIONS}: knowledge_chunks.embedding is vector(${EMBEDDING_DIMENSIONS})`,
      })
      .optional(),
    api_key: apiKey,
  })
  .strict();

const cap = z.number().int().min(1).max(AI_DAILY_CAP_MAX);
const capPair = z.object({ workspace: cap, global: cap }).strict();
const caps = z.object({ llm: capPair, embedding: capPair }).strict();

const price = z.number().min(0).max(10_000).nullable();
const prices = z
  .object({
    llm_input_usd_per_mtok: price,
    llm_output_usd_per_mtok: price,
    embedding_usd_per_mtok: price,
  })
  .strict();

// `reason` is the audit plugin's (checked before the handler).
const putBody = z
  .object({
    reason: z.string(),
    llm: llmInput.nullable().optional(),
    embedding: embeddingInput.nullable().optional(),
    caps: caps.nullable().optional(),
    prices: prices.nullable().optional(),
  })
  .strict();

const testBody = z.object({ reason: z.string(), target: z.enum(AI_TEST_TARGETS) }).strict();

const PARTS = ['llm', 'embedding', 'caps', 'prices'] as const;

export interface PlatformAiSettingsRoutesOptions {
  env: Env;
  platform: PlatformEnv;
  /** The connection test and re-embedding — the server's one instance (`app.platformAiOperations`). */
  operations: PlatformAiOperations;
}

export default async function platformAiSettingsRoutes(
  app: FastifyInstance,
  options: PlatformAiSettingsRoutesOptions,
): Promise<void> {
  const { env, operations } = options;
  const store = new PlatformAiSettingsStore(app.platformDb, app.redis, {
    rootKey: options.platform.settingsKey,
    env,
  });

  app.get(
    '/settings/ai',
    { config: { platform: { permission: 'ai.read' } } },
    async (_request, reply) => reply.header('cache-control', 'no-store').send(await store.read()),
  );

  app.put(
    '/settings/ai',
    {
      config: {
        platform: {
          permission: 'ai.manage',
          recentTotp: true,
          audit: { action: 'ai_settings.updated', target: 'settings' },
        },
      },
    },
    async (request, reply) => {
      const body = parse(putBody, request.body);
      if (!PARTS.some((part) => body[part] !== undefined)) {
        throw ApiError.validation(`body: name at least one of ${PARTS.join(', ')}.`);
      }
      const session = request.requirePlatformSession();
      const outcome = await store.update(body, session.adminId, async (tx, change) => {
        await app.platformAuditLog.record(
          request.platformAuditEntry({
            targetId: change.keys.join(','),
            payload: { changed: change.changed },
          }),
          tx,
        );
      });
      // Unchanged: nothing written, nothing to record.
      request.platformAudit!.recorded = true;
      if (outcome.keys.length > 0) {
        try {
          await announceAiSettingsChanged(app.redis, outcome.keys);
          if (outcome.keys.includes('ai.caps')) await publishAiCapsChanged(app.redis, null);
        } catch (error) {
          request.log.warn(
            { err: error },
            'ai.settings_changed not announced; tenants rebuild within a minute',
          );
        }
      }
      return reply.header('cache-control', 'no-store').send(outcome.settings);
    },
  );

  app.post(
    '/settings/ai/test-connection',
    {
      config: {
        platform: {
          permission: 'ai.manage',
          audit: { action: 'ai_settings.connection_tested', target: 'settings' },
        },
      },
    },
    async (request, reply) => {
      const body = parse(testBody, request.body);
      const session = request.requirePlatformSession();
      await operations.limit(session.adminId);
      const result = await operations.testConnection(await store.stored(), body.target);
      request.platformAudit!.targetId = body.target;
      request.platformAudit!.payload = {
        target: result.target,
        provider: result.provider,
        source: result.source,
        ok: result.ok,
        latency_ms: result.latency_ms,
        error: result.error,
      };
      return reply.header('cache-control', 'no-store').send(result);
    },
  );

  app.post(
    '/settings/ai/reembed',
    {
      config: {
        platform: {
          permission: 'operations.run',
          audit: { action: 'ai_settings.reembed_started', target: 'settings' },
        },
      },
    },
    async (request, reply) => {
      const status = await operations.startReembed(await store.stored());
      request.platformAudit!.targetId = 'reembed';
      request.platformAudit!.payload = { target: status.target };
      return reply.code(202).header('cache-control', 'no-store').send(status);
    },
  );
}
