/**
 * `/platform/v1/operations/*` — the Operations page (tm 389.14 · FR-ADMIN-20 ·
 * design.md §C operations).
 *
 *   GET  /operations/scheduler                 operations.read     the job table (the leader's publication)
 *   POST /operations/scheduler/{name}/run      operations.trigger  "run now" over `siyahtus:platform:ops`
 *   GET  /operations/webhooks                  operations.read     delivery backlog and failure rate, all workspaces
 *   GET  /operations/siem                      operations.read     export status across workspaces
 *   GET  /operations/partitions                operations.read     `events` partitions and the months missing
 *   POST /operations/partitions/ensure         operations.trigger  `events_ensure_partition`, one month or the window
 *   GET  /operations/unverified-signups        operations.read     what a purge would look at
 *   POST /operations/unverified-signups/purge  operations.run      recentTotp — `purge_unverified_signups`
 *   GET  /operations/jobs                      operations.read     `ai_jobs`, `knowledge_jobs`, the document worker
 *   GET  /operations/components                operations.read     the component record
 *
 * Reads change nothing and write no audit entry. The three mutations take
 * `{reason}` and are recorded once each (`operations.job_run_requested`,
 * `operations.partition_ensured`, `security.unverified_signups_purged`), with
 * what the platform could observe in the payload — never a tenant's content,
 * which none of these paths ever holds.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { PlatformOperations } from '../../services/platform/operations.js';
import { parse } from './auth.js';

const ensureBody = z.object({ month: z.string().trim().max(7).optional() }).passthrough();

export default async function platformOperationsRoutes(
  app: FastifyInstance,
  options: { env: Env; now?: () => number },
): Promise<void> {
  const operations = new PlatformOperations(app.platformDb, app.redis, {
    now: options.now ?? Date.now,
    unverifiedTtlHours: options.env.UNVERIFIED_SIGNUP_TTL_HOURS,
    siemProvider: options.env.SIEM_PROVIDER,
  });
  const read = { platform: { permission: 'operations.read' as const } };

  app.get('/operations/scheduler', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await operations.scheduler()),
  );

  app.post(
    '/operations/scheduler/:name/run',
    {
      config: {
        platform: {
          permission: 'operations.trigger' as const,
          audit: {
            action: 'operations.job_run_requested' as const,
            target: 'job' as const,
            targetParam: 'name',
          },
        },
      },
    },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const outcome = await operations.requestRun(name);
      request.platformAudit!.payload = { result: outcome.result, request_id: outcome.request_id };
      return reply.header('cache-control', 'no-store').send({ name, ...outcome });
    },
  );

  app.get('/operations/webhooks', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await operations.webhooks()),
  );

  app.get('/operations/siem', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await operations.siem()),
  );

  app.get('/operations/partitions', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await operations.partitions()),
  );

  app.post(
    '/operations/partitions/ensure',
    {
      config: {
        platform: {
          permission: 'operations.trigger' as const,
          audit: { action: 'operations.partition_ensured' as const, target: 'partition' as const },
        },
      },
    },
    async (request, reply) => {
      const { month } = parse(ensureBody, request.body ?? {});
      const result = await operations.ensurePartitions(month);
      request.platformAudit!.targetId = month ?? null;
      request.platformAudit!.payload = {
        ensured: result.ensured.map((row) => row.month),
        failed: result.failed,
      };
      return reply.header('cache-control', 'no-store').send(result);
    },
  );

  app.get('/operations/unverified-signups', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await operations.unverifiedSignups()),
  );

  app.post(
    '/operations/unverified-signups/purge',
    {
      config: {
        platform: {
          permission: 'operations.run' as const,
          recentTotp: true,
          audit: {
            action: 'security.unverified_signups_purged' as const,
            target: 'signup' as const,
          },
        },
      },
    },
    async (request, reply) => {
      const result = await operations.purgeUnverifiedSignups();
      request.platformAudit!.payload = { ...result };
      return reply.header('cache-control', 'no-store').send(result);
    },
  );

  app.get('/operations/jobs', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await operations.jobs()),
  );

  app.get('/operations/components', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await operations.components()),
  );
}
