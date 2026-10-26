/**
 * `buildPlatformServer()` — the root panel's API process (tm 389.3 ·
 * docs/platform-admin/design.md §A).
 *
 * A second Fastify process from the same image as the tenant API
 * (`node dist/src/platform.js`, port 4002), serving only `/platform/v1`. The
 * tenant API (`buildServer`) registers nothing under that prefix and answers
 * 404 there; this process registers nothing under `/api/v1`. They share no
 * memory and call each other synchronously never — Postgres and Redis are the
 * only shared state.
 *
 * What it registers, in order: the error envelope, lifecycle, telemetry
 * (`siyahtus-platform`), sensible, helmet, CORS for the admin SPA alone, the
 * `siyahtus_platform` database, Redis, background mail, the platform rate
 * limit, operator authentication (`plugins/platform-auth.ts`, 389.4), and then
 * the routes. The platform audit chain (389.5) slots in after authentication.
 *
 * What it deliberately does not: the scheduler (the tenant API's leader owns
 * every sweep), the tenant auth, licence, entitlement, sandbox and pilot gates,
 * metering and the AI budget. All of them read a workspace principal this
 * process never has, and several decorate `app.db`, which this process does
 * not have either (`plugins/platform-database.ts` says why).
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './config/env.js';
import { assertPlatformEnv, type PlatformEnv } from './config/platform-env.js';
import { baseFastifyOptions } from './lib/fastify-options.js';
import backgroundMail from './plugins/background-mail.js';
import errorHandler from './plugins/error-handler.js';
import lifecycle from './plugins/lifecycle.js';
import platformAudit from './plugins/platform-audit.js';
import platformAuth from './plugins/platform-auth.js';
import platformDatabase from './plugins/platform-database.js';
import platformRateLimit from './plugins/platform-rate-limit.js';
import redis from './plugins/redis.js';
import telemetryPlugin from './plugins/telemetry.js';
import platformAccountsRoutes from './routes/platform/accounts.js';
import platformAdminsRoutes from './routes/platform/admins.js';
import platformAuditRoutes from './routes/platform/audit.js';
import platformAuthRoutes from './routes/platform/auth.js';
import platformDashboardRoutes from './routes/platform/dashboard.js';
import platformHealthRoutes from './routes/platform/health.js';
import platformMetaRoutes from './routes/platform/meta.js';
import platformOperationsRoutes from './routes/platform/operations.js';
import platformSupportRoutes from './routes/platform/support.js';
import platformWorkspacesRoutes from './routes/platform/workspaces.js';
import { createMailer, type Mailer } from './services/mail/mailer.js';
import { WorkspacePurgeRunner } from './services/platform/workspace-purge.js';
import { createTelemetry, type Telemetry } from './telemetry/telemetry.js';
import { VERSION } from './version.js';

export const PLATFORM_PREFIX = '/platform/v1';

declare module 'fastify' {
  interface FastifyInstance {
    /** The purge job (tm 389.10) — `run()` plays one pass in a test. */
    workspacePurge: WorkspacePurgeRunner;
  }
}

export interface BuildPlatformServerOptions {
  env: Env;
  /**
   * The platform settings. Omitted, `assertPlatformEnv(env)` — which refuses
   * to build a server on a configuration it would refuse to boot.
   */
  platform?: PlatformEnv;
  /** Outgoing mail (invitations, impersonation notices — 389.4/389.15); `buildServer`'s terms. */
  mailer?: Mailer;
  /** `buildServer`'s terms: omitted it follows `env.otelEnabled`, `null` forces it off. */
  telemetry?: Telemetry | null;
  /** Where log lines go — a test reads them back. */
  logStream?: NodeJS.WritableStream;
  /**
   * The operator sign-in's clock (session lifetimes, TOTP steps), milliseconds
   * since the epoch. `Date.now` unless a test moves time.
   */
  now?: () => number;
}

export async function buildPlatformServer({
  env,
  platform = assertPlatformEnv(env),
  mailer: injectedMailer,
  telemetry,
  logStream,
  now,
}: BuildPlatformServerOptions): Promise<FastifyInstance> {
  const telemetryInstance =
    telemetry !== undefined
      ? telemetry
      : env.otelEnabled
        ? createTelemetry({
            serviceName: 'siyahtus-platform',
            serviceVersion: VERSION,
            spanExporter: env.OTEL_EXPORTER,
            metricExporter: env.OTEL_EXPORTER,
            otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
          })
        : null;

  const app = Fastify(baseFastifyOptions({ env, logStream, service: 'platform' }));

  // The carrier alone, without the tenant API's daily caps (`CappedMailer`):
  // those count per workspace through a function only `siyahtus_app` may call,
  // and the platform sends a handful of operator mails a day.
  const mailer =
    injectedMailer ??
    createMailer(env.MAIL_PROVIDER, {
      ...env.mail,
      logger: app.log.child({ component: 'mailer' }),
    });

  await app.register(errorHandler);
  await app.register(lifecycle);
  await app.register(telemetryPlugin, { telemetry: telemetryInstance });
  await app.register(sensible);
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  // One origin in every environment, production or not — unlike the tenant
  // API, which reflects any origin outside production. Nothing but the admin
  // SPA has a reason to call this from a browser, and the operator session is
  // a bearer token, never a cookie, so no credentials mode either.
  await app.register(cors, {
    origin: [platform.adminOrigin],
    credentials: false,
    exposedHeaders: [
      'X-Request-Id',
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
  });

  await app.register(platformDatabase, { env, platform });
  await app.register(redis, { env });
  await app.register(backgroundMail, { mailer });
  await app.register(platformRateLimit, { env, platform });
  await app.register(platformAuth, { env, platform, ...(now ? { now } : {}) });
  await app.register(platformAudit, { env, platform, ...(now ? { now } : {}) });

  for (const warning of platform.warnings) app.log.warn({ event: 'platform.env_warning' }, warning);

  // Scheduled deletions (tm 389.10): here rather than in the tenant API's
  // scheduler, because the purge records itself in the platform chain in the
  // same transaction (`services/platform/workspace-purge.ts`).
  const workspacePurge = new WorkspacePurgeRunner({
    db: app.platformDb,
    redis: app.redis,
    audit: app.platformAuditLog,
    logger: app.log.child({ component: 'workspace_purge' }),
    enabled: env.schedulerEnabled,
    ...(now ? { now } : {}),
  });
  app.decorate('workspacePurge', workspacePurge);
  app.addHook('onReady', async () => {
    workspacePurge.start();
  });
  app.addHook('onClose', async () => {
    await workspacePurge.stop();
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  await app.register(
    async (api) => {
      await api.register(platformHealthRoutes);
      await api.register(platformMetaRoutes, { env, version: VERSION });
      await api.register(platformAuthRoutes, { env });
      await api.register(platformAdminsRoutes, { platform, mailer });
      await api.register(platformAuditRoutes);
      await api.register(platformDashboardRoutes, { platform, ...(now ? { now } : {}) });
      await api.register(platformWorkspacesRoutes, { env, mailer, ...(now ? { now } : {}) });
      await api.register(platformSupportRoutes);
      await api.register(platformAccountsRoutes, { env, mailer, ...(now ? { now } : {}) });
      await api.register(platformOperationsRoutes, { env, ...(now ? { now } : {}) });
    },
    { prefix: PLATFORM_PREFIX },
  );

  return app;
}
