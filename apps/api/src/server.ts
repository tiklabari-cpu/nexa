import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Env } from './config/env.js';
import errorHandler from './plugins/error-handler.js';
import telemetryPlugin from './plugins/telemetry.js';
import { createTelemetry, type Telemetry } from './telemetry/telemetry.js';
import auth from './plugins/auth.js';
import audit from './plugins/audit.js';
import database from './plugins/database.js';
import licenseGate from './plugins/license-gate.js';
import metering from './plugins/metering.js';
import rateLimit from './plugins/rate-limit.js';
import redis from './plugins/redis.js';
import authRoutes from './routes/auth.js';
import agentRoutes from './routes/agents.js';
import chatRoutes from './routes/chats.js';
import customerRoutes from './routes/customer.js';
import customerDirectoryRoutes from './routes/customers.js';
import trafficRoutes from './routes/traffic.js';
import campaignRoutes from './routes/campaigns.js';
import ticketRoutes from './routes/tickets.js';
import ticketRuleRoutes from './routes/ticket-rules.js';
import ticketEmailTemplateRoutes from './routes/ticket-email-templates.js';
import customFieldRoutes from './routes/custom-fields.js';
import channelRoutes from './routes/channels.js';
import accountLifecycleRoutes from './routes/account-lifecycle.js';
import { FileMailer, NullMailer, type Mailer } from './services/mail/mailer.js';
import reportRoutes from './routes/reports.js';
import homeRoutes from './routes/home.js';
import settingsRoutes from './routes/settings.js';
import onboardingRoutes from './routes/onboarding.js';
import websiteRoutes from './routes/websites.js';
import webhookRoutes from './routes/webhooks.js';
import uploadRoutes from './routes/uploads.js';
import playbookRoutes from './routes/playbook.js';
import copilotRoutes from './routes/copilot.js';
import healthRoutes from './routes/health.js';

export const API_PREFIX = '/api/v1';
export const VERSION = '0.1.0';

export interface BuildServerOptions {
  env: Env;
  /**
   * Outgoing mail. Defaults to writing files (PLAN A4); the test server passes
   * a null one so a suite that sends hundreds of invitations leaves nothing
   * behind, and the tests that care about delivery pass their own.
   */
  mailer?: Mailer;
  /**
   * OpenTelemetry instrumentation. Omitted, it follows `env.otelEnabled`
   * (console exporter in dev/prod, off under test). Pass an instance to inject
   * in-memory exporters, or `null` to force it off.
   */
  telemetry?: Telemetry | null;
}

export async function buildServer({
  env,
  mailer = env.NODE_ENV === 'test' ? new NullMailer() : new FileMailer(env.MAIL_DIR),
  telemetry,
}: BuildServerOptions): Promise<FastifyInstance> {
  const telemetryInstance =
    telemetry !== undefined
      ? telemetry
      : env.otelEnabled
        ? createTelemetry({ serviceName: 'nexa-api', serviceVersion: VERSION })
        : null;
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Secrets must never reach the log, even at trace level.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.client_secret',
          'req.body.code_verifier',
          'req.body.token',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino/file', options: { destination: 1 } }
          : undefined,
    },
    // Correlates the log line, the trace and the `request_id` the client sees.
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
    disableRequestLogging: env.isTest,
    bodyLimit: 1_048_576, // 1 MiB — attachments go through signed upload URLs
  });

  await app.register(errorHandler);
  // Registered before the rest so its onRequest span opens ahead of auth and
  // rate limiting, and its onResponse metrics see the final status code.
  await app.register(telemetryPlugin, { telemetry: telemetryInstance });
  await app.register(sensible);
  await app.register(helmet, {
    // The API serves JSON only; a restrictive default CSP is right here and the
    // widget/web apps set their own.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: env.isProduction ? [env.WEB_ORIGIN] : true,
    credentials: true,
    exposedHeaders: [
      'X-Request-Id',
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
  });

  await app.register(database, { env });
  await app.register(redis, { env });
  await app.register(auth, { env });
  await app.register(audit);
  await app.register(rateLimit, { env });
  await app.register(licenseGate);
  await app.register(metering, { env });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { env, version: VERSION });
      await api.register(authRoutes, { env });
      await api.register(accountLifecycleRoutes, { env, mailer });
      await api.register(chatRoutes, { env, mailer });
      await api.register(agentRoutes);
      await api.register(customerRoutes, { env, mailer });
      await api.register(customerDirectoryRoutes);
      await api.register(trafficRoutes);
      await api.register(campaignRoutes);
      await api.register(ticketRoutes);
      await api.register(ticketRuleRoutes);
      await api.register(ticketEmailTemplateRoutes);
      await api.register(customFieldRoutes);
      await api.register(channelRoutes, { env });
      await api.register(reportRoutes, { env });
      await api.register(homeRoutes);
      await api.register(settingsRoutes);
      await api.register(onboardingRoutes);
      await api.register(websiteRoutes, { env });
      await api.register(webhookRoutes);
      await api.register(uploadRoutes, { env });
      await api.register(playbookRoutes);
      await api.register(copilotRoutes, { env });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
