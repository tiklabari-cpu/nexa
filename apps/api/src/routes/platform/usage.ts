/**
 * `/platform/v1/usage/*` and `/settings/ai-caps` — usage across every
 * workspace and the daily AI allowance (tm 389.12 · FR-ADMIN-13 · design.md
 * §C usage, §B3).
 *
 *   GET /usage/global                         usage.read     ?days=1..90
 *   GET /usage/workspaces                     usage.read     ?meter&top=1..100
 *   GET /usage/workspaces/{licenseId}         usage.read     caps, today, 30 days
 *   PUT /usage/workspaces/{licenseId}/ai-caps usage.manage   workspace.ai_caps_changed
 *   GET /settings/ai-caps                     usage.read     each plan's default
 *   PUT /settings/ai-caps                     usage.manage   settings.updated
 *
 * The plan defaults live under `/settings` beside the deployment's other
 * settings, but they are a billing decision, so they take the usage
 * permissions (`billing` writes, `support` reads — decision 4) rather than
 * `settings.manage`, which is superadmin's alone.
 *
 * After each write commits, `ai.caps_changed` is published — the licence, or
 * `*` for a plan default — and the tenant API drops its cached caps at once
 * (decision 5). A failed publish is logged, never the request's failure: the
 * change still lands within the tenant's cached minute.
 */
import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { publishAiCapsChanged } from '../../services/ai/ai-caps-events.js';
import { AI_CAPS_SETTING_KEY, AI_DAILY_CAP_MAX } from '../../services/ai/ai-plan-caps.js';
import { PLAN_IDS, type PlanId } from '../../services/billing/subscription-service.js';
import {
  GLOBAL_USAGE_DAYS_DEFAULT,
  GLOBAL_USAGE_DAYS_MAX,
  PlatformUsage,
  putPlanAiCaps,
  putWorkspaceAiCaps,
  TOP_USAGE_DEFAULT,
  TOP_USAGE_MAX,
  TOP_USAGE_METERS,
} from '../../services/platform/usage.js';
import type { PlatformAuditEntry } from '../../services/platform/platform-audit.js';
import type { ActionOutcome } from '../../services/platform/workspace-actions.js';
import { parse } from './auth.js';

const LICENSE_ID_RE = /^[1-9]\d{0,18}$/;
const cap = z.number().int().min(1).max(AI_DAILY_CAP_MAX).nullable();

const globalQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(GLOBAL_USAGE_DAYS_MAX)
    .default(GLOBAL_USAGE_DAYS_DEFAULT),
});

const topQuery = z.object({
  meter: z.enum(TOP_USAGE_METERS).default('llm'),
  top: z.coerce.number().int().min(1).max(TOP_USAGE_MAX).default(TOP_USAGE_DEFAULT),
});

const aiCapsBody = z.object({
  llm_daily_tokens_cap: cap,
  embedding_daily_tokens_cap: cap,
  expires_at: z.string().datetime({ offset: true }).nullable().default(null),
});

const planFigures = z.object({ llm: cap, embedding: cap }).strict();
const planCapsBody = z.object({
  plans: z
    .object(
      Object.fromEntries(PLAN_IDS.map((plan) => [plan, planFigures.optional()])) as Record<
        PlanId,
        z.ZodOptional<typeof planFigures>
      >,
    )
    .strict(),
});

export default async function platformUsageRoutes(
  app: FastifyInstance,
  options: { env: Env; now?: () => number },
): Promise<void> {
  const clock = options.now ?? Date.now;
  const usage = new PlatformUsage(app.platformDb, {
    env: options.env,
    ...(options.now ? { now: options.now } : {}),
  });
  const read = { platform: { permission: 'usage.read' as const } };

  function licenseIdOf(request: FastifyRequest): bigint {
    const raw = (request.params as Record<string, unknown>)['licenseId'];
    if (typeof raw !== 'string' || !LICENSE_ID_RE.test(raw)) {
      throw ApiError.notFound('Workspace not found.');
    }
    return BigInt(raw);
  }

  /** Tell every tenant API process; a lost message costs the cache's minute, not the change. */
  async function announce(request: FastifyRequest, licenseId: bigint | null): Promise<void> {
    try {
      await publishAiCapsChanged(app.redis, licenseId);
    } catch (error) {
      request.log.warn(
        { err: error },
        'ai.caps_changed not published; caps refresh within a minute',
      );
    }
  }

  /** The change and its audit entries in one transaction; an unchanged outcome records nothing. */
  async function perform(
    request: FastifyRequest,
    entry: Partial<PlatformAuditEntry>,
    action: (tx: Prisma.TransactionClient, now: Date) => Promise<ActionOutcome>,
  ): Promise<ActionOutcome> {
    const outcome = await app.platformDb.$transaction(
      async (tx) => {
        const result = await action(tx, new Date(clock()));
        if (!result.unchanged) {
          await app.platformAuditLog.record(
            request.platformAuditEntry({ ...entry, payload: result.payload }),
            tx,
          );
        }
        return result;
      },
      { timeout: 30_000 },
    );
    request.platformAudit!.recorded = true;
    return outcome;
  }

  app.get('/usage/global', { config: read }, async (request, reply) => {
    const { days } = parse(globalQuery, request.query);
    return reply.header('cache-control', 'no-store').send(await usage.global(days));
  });

  app.get('/usage/workspaces', { config: read }, async (request, reply) => {
    const { meter, top } = parse(topQuery, request.query);
    return reply.header('cache-control', 'no-store').send(await usage.top(meter, top));
  });

  app.get('/usage/workspaces/:licenseId', { config: read }, async (request, reply) => {
    const detail = await usage.workspace(licenseIdOf(request));
    if (!detail) throw ApiError.notFound('Workspace not found.');
    return reply.header('cache-control', 'no-store').send(detail);
  });

  app.put(
    '/usage/workspaces/:licenseId/ai-caps',
    {
      config: {
        platform: {
          permission: 'usage.manage',
          audit: {
            action: 'workspace.ai_caps_changed',
            target: 'workspace',
            targetParam: 'licenseId',
          },
        },
      },
    },
    async (request, reply) => {
      const licenseId = licenseIdOf(request);
      const body = parse(aiCapsBody, request.body);
      const outcome = await perform(request, { licenseId }, (tx, now) =>
        putWorkspaceAiCaps(
          tx,
          licenseId,
          {
            llm: body.llm_daily_tokens_cap,
            embedding: body.embedding_daily_tokens_cap,
            expiresAt: body.expires_at === null ? null : new Date(body.expires_at),
          },
          now,
        ),
      );
      if (!outcome.unchanged) await announce(request, licenseId);
      const detail = await usage.workspace(licenseId);
      if (!detail) throw ApiError.notFound('Workspace not found.');
      return reply
        .header('cache-control', 'no-store')
        .send({ unchanged: outcome.unchanged, usage: detail });
    },
  );

  app.get('/settings/ai-caps', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await usage.planCaps()),
  );

  app.put(
    '/settings/ai-caps',
    {
      config: {
        platform: {
          permission: 'usage.manage',
          audit: { action: 'settings.updated', target: 'settings' },
        },
      },
    },
    async (request, reply) => {
      const body = parse(planCapsBody, request.body);
      const adminId = request.platformSession!.adminId;
      const plans = Object.fromEntries(
        Object.entries(body.plans).filter(([, figures]) => figures !== undefined),
      ) as Partial<Record<PlanId, { llm: number | null; embedding: number | null }>>;
      const outcome = await perform(request, { targetId: AI_CAPS_SETTING_KEY }, (tx, now) =>
        putPlanAiCaps(tx, plans, adminId, now),
      );
      if (!outcome.unchanged) await announce(request, null);
      return reply
        .header('cache-control', 'no-store')
        .send({ unchanged: outcome.unchanged, caps: await usage.planCaps() });
    },
  );
}
