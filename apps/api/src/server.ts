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
import aiResidency from './plugins/ai-residency.js';
import database from './plugins/database.js';
import entitlementGate from './plugins/entitlement-gate.js';
import { logSafeUrl } from './lib/log-redact.js';
import licenseGate from './plugins/license-gate.js';
import metering from './plugins/metering.js';
import sandboxGate from './plugins/sandbox-gate.js';
import rateLimit from './plugins/rate-limit.js';
import redis from './plugins/redis.js';
import scheduler from './plugins/scheduler.js';
import authRoutes from './routes/auth.js';
import samlRoutes from './routes/saml.js';
import scimRoutes from './routes/scim.js';
import agentRoutes from './routes/agents.js';
import notificationRoutes from './routes/notifications.js';
import chatRoutes from './routes/chats.js';
import customerRoutes from './routes/customer.js';
import customerDirectoryRoutes from './routes/customers.js';
import trafficRoutes from './routes/traffic.js';
import campaignRoutes from './routes/campaigns.js';
import goalRoutes from './routes/goals.js';
import ticketRoutes from './routes/tickets.js';
import ticketRuleRoutes from './routes/ticket-rules.js';
import ticketEmailTemplateRoutes from './routes/ticket-email-templates.js';
import customFieldRoutes from './routes/custom-fields.js';
import channelRoutes from './routes/channels.js';
import accountLifecycleRoutes from './routes/account-lifecycle.js';
import { createMailer, type Mailer } from './services/mail/mailer.js';
import { createPushProvider, type PushProvider } from './services/push/push-provider.js';
import reportRoutes from './routes/reports.js';
import scheduledReportRoutes from './routes/scheduled-reports.js';
import homeRoutes from './routes/home.js';
import settingsRoutes from './routes/settings.js';
import onboardingRoutes from './routes/onboarding.js';
import websiteRoutes from './routes/websites.js';
import brandRoutes from './routes/brands.js';
import webhookRoutes from './routes/webhooks.js';
import partnerAppRoutes from './routes/partner-apps.js';
import mcpRoutes from './routes/mcp.js';
import uploadRoutes from './routes/uploads.js';
import playbookRoutes from './routes/playbook.js';
import kbRoutes from './routes/kb.js';
import publicKbRoutes from './routes/public-kb.js';
import publicKbHtmlRoutes from './routes/public-kb-html.js';
import publicKbSitemapRoutes from './routes/public-kb-sitemap.js';
import copilotRoutes from './routes/copilot.js';
import commandPaletteRoutes from './routes/command-palette.js';
import appRoutes from './routes/apps.js';
import auditLogRoutes from './routes/audit-log.js';
import healthRoutes from './routes/health.js';

export const API_PREFIX = '/api/v1';
export const VERSION = '0.1.0';

export interface BuildServerOptions {
  env: Env;
  /**
   * Outgoing mail. Defaults to whatever `MAIL_PROVIDER` names (PLAN A4 —
   * `file` writes the message instead of sending it). The test fixture sets
   * that key to `null` so a suite sending hundreds of invitations leaves
   * nothing behind; the tests that care about delivery still pass their own.
   */
  mailer?: Mailer;
  /**
   * Outgoing push. Defaults to whatever `PUSH_PROVIDER` names (13.7-d) — there
   * is no APNs/FCM key to hold, so both values are mocks. Same arrangement as
   * the mailer, including the test fixture's `null`.
   */
  push?: PushProvider;
  /**
   * OpenTelemetry instrumentation. Omitted, it follows `env.otelEnabled`
   * (console exporter in dev/prod, off under test). Pass an instance to inject
   * in-memory exporters, or `null` to force it off.
   */
  telemetry?: Telemetry | null;
  /**
   * Where log lines go. Omitted, pino's default (stdout). A test passes a stream
   * to read back what was actually written — the only way to assert that a
   * redaction happened rather than that a helper exists.
   */
  logStream?: NodeJS.WritableStream;
}

export async function buildServer({
  env,
  // The provider is chosen by the setting that names it, not by `NODE_ENV`
  // (M-PROV-a · §D113/K3). The branch that used to be here meant `MAIL_PROVIDER`
  // was validated at boot and then never read, so an operator who set it got a
  // different mailer than the one they asked for — and a test that wanted a real
  // spool had to lie about the environment to get one.
  mailer = createMailer(env.MAIL_PROVIDER, { dir: env.MAIL_DIR }),
  push = createPushProvider(env.PUSH_PROVIDER, { dir: env.PUSH_DIR }),
  telemetry,
  logStream,
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
      // Secrets must never reach the log, even at trace level — and neither
      // must people (NFR-C4 · C4-e). The two are handled by one mechanism but
      // are not the same problem: a secret is removed, while `req.url` is
      // *masked* and survives, because the request line with no URL is a log
      // line with nothing to debug from. `lib/log-redact.ts` says why the
      // masking is unconditional rather than reserved for covered workspaces.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.client_secret',
          'req.body.code_verifier',
          'req.body.token',
          // Telegram's connect body carries a caller-supplied bot token
          // (`08.5.8-b`) — a real credential, unlike the other channels' mock
          // OAuth `code`.
          'req.body.bot_token',
          'res.headers["set-cookie"]',
          // The request line. This API puts personal data in query strings —
          // the customer search takes an address — so the URL is where PII
          // reaches the log first, and it is not covered by any secret path.
          'req.url',
        ],
        censor: (value: unknown, path: string[]) =>
          path.join('.') === 'req.url' && typeof value === 'string'
            ? logSafeUrl(value)
            : '[redacted]',
      },
      ...(logStream
        ? { stream: logStream }
        : {
            transport:
              env.NODE_ENV === 'development'
                ? { target: 'pino/file' as const, options: { destination: 1 } }
                : undefined,
          }),
    },
    // Correlates the log line, the trace and the `request_id` the client sees.
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    // Trust exactly `TRUST_PROXY_HOPS` proxy hops, not the whole
    // `X-Forwarded-For` chain.
    //
    // `request.ip` feeds security decisions — the anonymous rate-limit key, the
    // customer IP ban, and the agent IP allow-list (FR-MOD-08.9.6). With
    // `trustProxy: true` proxy-addr trusts every hop and returns the *left-most*
    // XFF entry, which is whatever the client wrote: a caller could send
    // `X-Forwarded-For: <an-allowed-ip>` and walk straight through the allow-list.
    // Trusting a bounded number of hops makes proxy-addr stop that many entries
    // from the right — at the address the outermost proxy *we* operate attested
    // — so a client-prepended value is ignored and cannot be spoofed.
    //
    // How many that is belongs to the deployment, not to this file
    // (M-PROD-CFG-b): one reverse proxy is the common case and the default, a
    // CDN in front of an ingress is two, and a process reached directly is zero.
    // This used to be the literal `1` with a comment declaring the assumption,
    // which meant a topology change silently produced either a bypass (count too
    // high) or every request appearing to come from our own proxy (too low).
    // `test/integration/trust-proxy.test.ts` runs both mistakes against the
    // allow-list. Zero is not "off": Fastify skips the decoration entirely and
    // `request.ip` is the socket peer, which is the correct — and the only safe
    // — reading when nothing in front of us appends to the header.
    trustProxy: env.TRUST_PROXY_HOPS,
    // A test that hands us a stream is asking to read the request line; every
    // other test keeps it off, because thousands of lines nobody reads is what
    // made it off in the first place.
    disableRequestLogging: env.isTest && !logStream,
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
    // Production answers only the origins `WEB_ORIGIN` names — a list, because a
    // deployment routinely serves the agent panel and the hosted chat page from
    // different hosts (M-PROD-CFG-b). Everywhere else reflects whatever asks,
    // which is what lets a dev server on any port and the e2e stack work.
    origin: env.isProduction ? env.webOrigins : true,
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
  // After both stores it reads through, before anything request-facing: the
  // five sweeps are background work, not part of answering a request.
  await app.register(scheduler, { env, mailer, telemetry: telemetryInstance });
  await app.register(auth, { env });
  await app.register(audit, { env });
  // After `audit`, which it writes through, and before the routes that declare
  // `aiInference` (NFR-C4 · C4-e).
  await app.register(aiResidency, { env });
  await app.register(rateLimit, { env });
  await app.register(licenseGate);
  // After the licence gate, so an expired trial is told it is read-only rather
  // than told what its plan does not include — the first is the reason it
  // cannot write, and the second would be a confusing answer to it.
  await app.register(entitlementGate);
  // Billing writes are refused inside a sandbox (FR-MOD-11.5 · 11.5-f). Last of
  // the three gates because it is the narrowest: it costs a query only on a
  // write under `/billing/`, where the two above have already answered the
  // general questions.
  await app.register(sandboxGate);
  await app.register(metering, { env });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { env, version: VERSION });
      await api.register(authRoutes, { env });
      // Its own plugin scope, not part of `authRoutes`: the SAML response
      // arrives as a form post, and the content-type parser that reads it is
      // encapsulated here rather than loosened across the whole auth surface.
      await api.register(samlRoutes, { env, apiBase: `${env.API_BASE_URL}${API_PREFIX}` });
      // Also its own scope, for two reasons of the same kind: SCIM speaks
      // `application/scim+json` and answers failures in RFC 7644's error
      // envelope rather than ADR-06's. Both are encapsulated here so nothing
      // outside `/scim/v2` changes shape (see the file header for why the
      // exception is deliberate).
      await api.register(scimRoutes, { baseUrl: `${env.API_BASE_URL}${API_PREFIX}/scim/v2` });
      await api.register(accountLifecycleRoutes, { env, mailer });
      await api.register(chatRoutes, { env, mailer, push });
      await api.register(agentRoutes);
      await api.register(notificationRoutes);
      await api.register(customerRoutes, { env, mailer, push });
      await api.register(customerDirectoryRoutes);
      await api.register(trafficRoutes);
      await api.register(campaignRoutes);
      await api.register(goalRoutes);
      await api.register(ticketRoutes);
      await api.register(ticketRuleRoutes);
      await api.register(ticketEmailTemplateRoutes);
      await api.register(customFieldRoutes);
      await api.register(channelRoutes, { env });
      await api.register(reportRoutes, { env });
      await api.register(scheduledReportRoutes);
      await api.register(homeRoutes);
      await api.register(settingsRoutes, { env });
      await api.register(onboardingRoutes);
      await api.register(websiteRoutes, { env });
      await api.register(brandRoutes);
      await api.register(webhookRoutes);
      await api.register(partnerAppRoutes);
      await api.register(mcpRoutes, {
        serverUrl: `${env.API_BASE_URL}${API_PREFIX}/mcp`,
        version: VERSION,
      });
      await api.register(uploadRoutes, { env });
      await api.register(playbookRoutes);
      await api.register(kbRoutes);
      await api.register(publicKbRoutes);
      await api.register(publicKbHtmlRoutes, {
        canonicalBase: `${env.API_BASE_URL}${API_PREFIX}`,
      });
      await api.register(publicKbSitemapRoutes, {
        canonicalBase: `${env.API_BASE_URL}${API_PREFIX}`,
      });
      await api.register(copilotRoutes, { env });
      await api.register(commandPaletteRoutes);
      await api.register(appRoutes, { env });
      await api.register(auditLogRoutes, { env });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
