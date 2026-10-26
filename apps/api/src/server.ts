import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './config/env.js';
import errorHandler from './plugins/error-handler.js';
import telemetryPlugin from './plugins/telemetry.js';
import { createTelemetry, type Telemetry } from './telemetry/telemetry.js';
import auth from './plugins/auth.js';
import logContext from './plugins/log-context.js';
import audit from './plugins/audit.js';
import aiResidency from './plugins/ai-residency.js';
import aiBudget from './plugins/ai-budget.js';
import aiJobs, { type AiJobDiscovery } from './plugins/ai-jobs.js';
import aiTesting from './plugins/ai-testing.js';
import backgroundMail from './plugins/background-mail.js';
import database from './plugins/database.js';
import entitlementGate from './plugins/entitlement-gate.js';
import { baseFastifyOptions } from './lib/fastify-options.js';
import { VERSION } from './version.js';
import licenseGate from './plugins/license-gate.js';
import lifecycle from './plugins/lifecycle.js';
import metering from './plugins/metering.js';
import sandboxGate from './plugins/sandbox-gate.js';
import pendingAudit from './plugins/pending-audit.js';
import permissionMatrix from './plugins/permission-matrix.js';
import pilotGate, { PILOT_REFUSED_PATHS, type PilotRefusedPath } from './plugins/pilot-gate.js';
import type { SafeHttp } from './lib/safe-fetch.js';
import { liveAppIds } from './services/apps/verifiers/registry.js';
import type { ProviderEndpoints } from './services/apps/verifiers/types.js';
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
import memberRecognitionRoutes from './routes/member-recognition.js';
import trafficRoutes from './routes/traffic.js';
import campaignRoutes from './routes/campaigns.js';
import goalRoutes from './routes/goals.js';
import ticketRoutes from './routes/tickets.js';
import ticketRuleRoutes from './routes/ticket-rules.js';
import botRoutes from './routes/bots.js';
import ticketEmailTemplateRoutes from './routes/ticket-email-templates.js';
import customFieldRoutes from './routes/custom-fields.js';
import channelRoutes from './routes/channels.js';
import accountLifecycleRoutes from './routes/account-lifecycle.js';
import { createGeoLocator, type GeoLocator } from './services/geo/geo-locator.js';
import { AbuseGuard } from './services/security/abuse-guard.js';
import { resolveCaptcha } from './services/security/captcha.js';
import { createMailer, type Mailer } from './services/mail/mailer.js';
import { CappedMailer, mailDailyCaps } from './services/mail/mail-caps.js';
import { createLlmProvider, type LlmProvider } from './services/ai/provider/llm-provider.js';
import { KnowledgeService } from './services/ai/knowledge-service.js';
import { AiDailyBudget, aiDailyCaps } from './services/ai/ai-daily-budget.js';
import { listenForAiCapsChanges } from './services/ai/ai-caps-events.js';
import { AiUsageAlerts } from './services/ai/ai-usage-alerts.js';
import { RealtimePublisher } from './services/realtime/publisher.js';
import { MeteredEmbeddings } from './services/ai/metered-embeddings.js';
import { MeteredLlm } from './services/ai/metered-llm.js';
import { createEmbeddingProvider } from './services/ai/provider/create-embedding-provider.js';
import type { EmbeddingProvider } from './services/ai/provider/embedding-provider.js';
import { createWorkspaceEventDispatcher } from './services/webhooks/workspace-events.js';
import { RiskFlagAnnouncer } from './services/risk/risk-announce.js';
import type { WebhookSender } from './services/webhooks/webhook-dispatcher.js';
import { createPushProvider, type PushProvider } from './services/push/push-provider.js';
import reportRoutes from './routes/reports.js';
import scheduledReportRoutes from './routes/scheduled-reports.js';
import homeRoutes from './routes/home.js';
import settingsRoutes from './routes/settings.js';
import permissionRoutes from './routes/permissions.js';
import onboardingRoutes from './routes/onboarding.js';
import websiteRoutes from './routes/websites.js';
import brandRoutes from './routes/brands.js';
import webhookRoutes from './routes/webhooks.js';
import partnerAppRoutes from './routes/partner-apps.js';
import mcpRoutes from './routes/mcp.js';
import uploadRoutes from './routes/uploads.js';
import playbookRoutes from './routes/playbook.js';
import aiTestingRoutes from './routes/ai-testing.js';
import aiUnresolvedRoutes from './routes/ai-unresolved.js';
import aiGuidanceRoutes from './routes/ai-guidance.js';
import aiHandoffRulesRoutes from './routes/ai-handoff-rules.js';
import handoffRoutesRoutes from './routes/handoff-routes.js';
import aiTemplateRoutes from './routes/ai-templates.js';
import aiGuardrailRoutes from './routes/ai-guardrails.js';
import { riskFlagRoutes } from './routes/risk-flags.js';
import { aiHandoffRoutes } from './routes/ai-handoffs.js';
import kbRoutes from './routes/kb.js';
import knowledgeTableRoutes from './routes/knowledge-tables.js';
import publicKbRoutes from './routes/public-kb.js';
import publicKbHtmlRoutes from './routes/public-kb-html.js';
import publicKbSitemapRoutes from './routes/public-kb-sitemap.js';
import copilotRoutes from './routes/copilot.js';
import commandPaletteRoutes from './routes/command-palette.js';
import archiveRoutes from './routes/archive.js';
import searchRoutes from './routes/search.js';
import appRoutes from './routes/apps.js';
import auditLogRoutes from './routes/audit-log.js';
import aiUsageRoutes from './routes/ai-usage.js';
import healthRoutes from './routes/health.js';
import deploymentRoutes from './routes/deployment.js';

export const API_PREFIX = '/api/v1';
export { VERSION } from './version.js';

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
   * (off under test) and `env.OTEL_EXPORTER` (console by default when on —
   * M-OTEL-a). Pass an instance to inject in-memory exporters, or `null` to
   * force it off.
   */
  telemetry?: Telemetry | null;
  /**
   * Where log lines go. Omitted, pino's default (stdout). A test passes a stream
   * to read back what was actually written — the only way to assert that a
   * redaction happened rather than that a helper exists.
   */
  logStream?: NodeJS.WritableStream;
  /**
   * How an outbound webhook leaves the process (FR-MOD-09.4 / 08.8.4). Omitted,
   * the real HTTP sender — no request is ever made unless a workspace has
   * registered a subscription. A test passes a recorder, on exactly the terms
   * the mailer and push provider are injected: the network is mocked
   * (MASTER-PROMPT §5), never contacted.
   */
  webhookSender?: WebhookSender;
  /**
   * Who writes AI text (tm 255.5). Omitted, whatever `LLM_PROVIDER` names —
   * the deterministic in-process stub by default. A test passes its own
   * recorder on the mailer's terms, which is how a suite counts the calls a
   * skill run makes without any network (MASTER-PROMPT §5).
   */
  llm?: LlmProvider;
  /**
   * Who writes Copilot's summary (tm 257.5). Omitted, `llm` when a test
   * injected one — so a suite that hands in one recorder sees every call —
   * and otherwise a second instance built from the same `LLM_PROVIDER`, with
   * a circuit breaker of its own.
   */
  copilotLlm?: LlmProvider;
  /**
   * How the `openai` adapter reaches the network (tm 255.6). Omitted, the
   * global `fetch`. A test passes a recorder here rather than a whole `llm`
   * when the point is the adapter the *server* builds from `env` — its logger,
   * its redaction and its circuit breaker — with no request leaving the process.
   */
  llmFetch?: typeof fetch;
  /**
   * Who embeds knowledge and questions (tm 255.7). Omitted, whatever
   * `EMBEDDING_PROVIDER` names — the lexical stub by default. A test passes a
   * recorder, on `llm`'s terms, to count and fail embedding calls.
   */
  embeddings?: EmbeddingProvider;
  /** How the `openai` embedding adapter reaches the network — `llmFetch`'s counterpart. */
  embeddingFetch?: typeof fetch;
  /**
   * The surfaces `PILOT_MODE=true` refuses by path (tm 257.13). Omitted,
   * `PILOT_REFUSED_PATHS`. A test passes its own list to prove the matching
   * against routes it registers itself, rather than against whichever real
   * surface happens to be on the list.
   */
  pilotRefusedPaths?: readonly PilotRefusedPath[];
  /**
   * How the live Apps cards and the live Telegram channel reach their
   * providers (tm 263). Omitted, the real safe client (`lib/safe-fetch.ts`). A
   * test passes one pinned to a local HTTPS fake (`test/helpers/fake-provider.ts`),
   * with `appsEndpoints` pointing the adaptors at it — no request leaves the
   * machine.
   */
  appsHttp?: SafeHttp;
  /** Provider hosts for `appsHttp` (tm 263). Omitted, the real ones. */
  appsEndpoints?: ProviderEndpoints;
  /**
   * How the access information's `dynamic_url` is fetched (tm 310.4 · K13).
   * Omitted, the real safe client; a test pins one to a local HTTPS fake.
   */
  accessInfoHttp?: SafeHttp;
  /**
   * How the AI job worker finds jobs it was not woken for (tm 289.5,
   * `plugins/ai-jobs.ts`). Omitted, `shared`: the poll and the doorbell, so
   * any process answers any visitor message. The test fixture passes
   * `in_process`, so one suite's two servers never answer each other's.
   */
  aiJobDiscovery?: AiJobDiscovery;
  /**
   * Where a visitor's address is (GEOIP-COUNTRY · tm 330). Omitted, the file
   * `GEOIP_DB_PATH` names — or off without one. Tests pass a
   * `StaticGeoLocator`: no file, no network.
   */
  geo?: GeoLocator;
  /**
   * The fetch Turnstile's check goes through (tm 339.2). Omitted, the global
   * one; a suite that runs `CAPTCHA_PROVIDER=turnstile` passes a stub, so no
   * test reaches Cloudflare.
   */
  captchaFetch?: (input: string, init: RequestInit) => Promise<Response>;
}

export async function buildServer({
  env,
  mailer: injectedMailer,
  push = createPushProvider(env.PUSH_PROVIDER, { dir: env.PUSH_DIR }),
  telemetry,
  logStream,
  webhookSender,
  llm: injectedLlm,
  copilotLlm: injectedCopilotLlm,
  llmFetch,
  embeddings: injectedEmbeddings,
  embeddingFetch,
  pilotRefusedPaths = PILOT_REFUSED_PATHS,
  appsHttp,
  appsEndpoints,
  accessInfoHttp,
  aiJobDiscovery,
  geo: injectedGeo,
  captchaFetch,
}: BuildServerOptions): Promise<FastifyInstance> {
  const telemetryInstance =
    telemetry !== undefined
      ? telemetry
      : env.otelEnabled
        ? createTelemetry({
            serviceName: 'siyahtus-api',
            serviceVersion: VERSION,
            spanExporter: env.OTEL_EXPORTER,
            metricExporter: env.OTEL_EXPORTER,
            otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
          })
        : null;
  const app = Fastify(baseFastifyOptions({ env, logStream }));

  // An Apps setting that cannot work never stops the boot (tm 263, owner
  // 2026-10-10): the live cards stay demos and the reason is logged here.
  for (const warning of env.appsLiveWarnings)
    app.log.warn({ event: 'apps.live_disabled' }, warning);

  // The visitor-country database (tm 330) follows the same rule: a missing or
  // unreadable file leaves countries empty and says so, the boot goes on.
  let geo = injectedGeo;
  if (!geo) {
    const created = createGeoLocator(env.GEOIP_DB_PATH);
    if (created.warning) app.log.warn({ event: 'geoip.disabled' }, created.warning);
    geo = created.locator;
  }
  app.decorate('geo', geo);

  // The provider is chosen by the setting that names it, not by `NODE_ENV`
  // (M-PROV-a · §D113/K3). The branch that used to be here meant `MAIL_PROVIDER`
  // was validated at boot and then never read, so an operator who set it got a
  // different mailer than the one they asked for — and a test that wanted a real
  // spool had to lie about the environment to get one. Built after the app
  // rather than as a parameter default so the `smtp` carrier logs through this
  // logger — its stream, its level and its redaction paths (tm 255.3).
  const carrier =
    injectedMailer ??
    createMailer(env.MAIL_PROVIDER, {
      ...env.mail,
      logger: app.log.child({ component: 'mailer' }),
    });
  // After the app for the mailer's reason: the `openai` adapter logs its
  // retries, failures and circuit changes through this logger (tm 255.6).
  const llm =
    injectedLlm ??
    createLlmProvider(env.LLM_PROVIDER, env.llm, {
      logger: app.log.child({ component: 'llm' }),
      ...(llmFetch ? { fetchImpl: llmFetch } : {}),
    });
  // Copilot's own instance of the same provider (tm 257.5 · ADR
  // `pilot-public-readiness.md` K-h). The circuit breaker lives on the
  // instance, so sharing one would let five failed summaries — long
  // transcripts are the likeliest to time out — hand every visitor's next
  // question to a human for thirty seconds. Same settings, same logger
  // component; `surface` tells the two apart in the log. Embeddings are
  // shared on purpose (below): a reply draft's question is one short query,
  // and the knowledge it searches was indexed by that one provider.
  const copilotLlm =
    injectedCopilotLlm ??
    injectedLlm ??
    createLlmProvider(env.LLM_PROVIDER, env.llm, {
      logger: app.log.child({ component: 'llm', surface: 'copilot' }),
      ...(llmFetch ? { fetchImpl: llmFetch } : {}),
    });
  // One provider and one knowledge service for the whole process (tm 255.7):
  // the customer path, the playbook and copilot routes and the freshness sweep
  // all index and search through it, so they write and read one space and
  // share one circuit breaker. Before, each built its own over the stub.
  const embeddings =
    injectedEmbeddings ??
    createEmbeddingProvider(env.EMBEDDING_PROVIDER, env.embedding, {
      logger: app.log.child({ component: 'embedding' }),
      ...(embeddingFetch ? { fetchImpl: embeddingFetch } : {}),
    });

  await app.register(errorHandler);
  // First, and with no dependencies of its own: `/health/ready` has to be able
  // to answer "draining" even when the drain started while Postgres was
  // unreachable, and those are two different 503s that must not be confused.
  await app.register(lifecycle);
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
  // The widget's human check (tm 339.2 · GV-01): a provider that cannot work
  // leaves it off and says so, the boot goes on (owner, 2026-10-10).
  const captcha = resolveCaptcha(env, captchaFetch);
  for (const warning of captcha.warnings) app.log.warn({ event: 'captcha.disabled' }, warning);
  app.decorate(
    'abuseGuard',
    new AbuseGuard(app.redis, captcha.verifier, {
      newCustomersPerIp: env.CAPTCHA_RISK_NEW_CUSTOMERS_PER_IP,
      messagesPerMinute: env.CAPTCHA_RISK_MESSAGES_PER_MIN,
      aiTurnsToday: env.CAPTCHA_RISK_AI_TURNS_TODAY,
    }),
  );
  // Each workspace's permission matrix (tm 325.2 · RL-02): cached for a
  // minute, dropped everywhere when a change is announced.
  await app.register(permissionMatrix);
  // The daily AI caps (tm 257.8): one budget over the primary, and every
  // model the routes call goes through it — the visitor's and Copilot's
  // instances alike, so both spend from the same workspace and deployment
  // allowance. On `mock` nothing is counted.
  const aiDailyBudget = new AiDailyBudget(app.db, aiDailyCaps(env), {
    logger: app.log.child({ component: 'ai-budget' }),
  });
  // A workspace's caps are its licence's override, its plan's and then the
  // deployment's (tm 283.2), cached for a minute; a change announced on
  // `ai.caps_changed` drops the cache at once. Its own connection — a
  // subscribed client can do nothing else — and never a reason not to boot:
  // without it a change still lands within the cache's minute.
  const capsEvents = app.redis.duplicate({ connectionName: 'siyahtus-api-ai-caps' });
  capsEvents.on('error', (error) => {
    app.log.error({ err: error }, 'redis ai.caps_changed subscriber error');
  });
  await listenForAiCapsChanges(capsEvents, (licenseId) =>
    aiDailyBudget.invalidateCaps(licenseId),
  ).catch((error: unknown) => {
    app.log.warn({ err: error }, 'ai.caps_changed not subscribed; caps refresh every minute');
  });
  app.addHook('onClose', async () => {
    await capsEvents.quit().catch(() => capsEvents.disconnect());
  });
  const meteredLlm = new MeteredLlm(llm, aiDailyBudget);
  const meteredCopilotLlm = new MeteredLlm(copilotLlm, aiDailyBudget);
  // Every embedding too (tm 257.20), through the one knowledge service: the
  // panel's indexing, the bulk import, Copilot's sources and drafts, the
  // visitor's question and the freshness sweep all spend from the same
  // workspace and deployment allowance on the embedding meter.
  const knowledge = new KnowledgeService({
    embeddings: new MeteredEmbeddings(embeddings, aiDailyBudget),
    retrievalThreshold: env.RETRIEVAL_THRESHOLD,
  });
  // The daily mail caps (tm 257.14): every mail this process sends — routes,
  // background mail, sweeps — goes through this one wrapper, around whatever
  // carrier was built or injected, so an injected test spool is capped exactly
  // like `smtp`. Over the primary, like the AI budget, once `database` exists.
  const mailer = new CappedMailer(carrier, app.db, mailDailyCaps(env), {
    logger: app.log.child({ component: 'mailer' }),
  });
  // The 80%/100% notices of a workspace's AI allowance (tm 283.3): told by
  // the budget after every settle and every refusal, beside the call and never
  // in its way. Built here because it mails; drained on close so a notice that
  // was claimed is not abandoned mid-send.
  const aiUsageAlerts = new AiUsageAlerts(app.db, {
    mailer,
    publisher: new RealtimePublisher(app.redis, app.log),
    appUrl: env.WEB_APP_URL.replace(/\/+$/, ''),
    logger: app.log.child({ component: 'ai-usage-alerts' }),
  });
  aiDailyBudget.observe(aiUsageAlerts);
  app.decorate('aiUsageAlerts', aiUsageAlerts);
  app.addHook('onClose', async () => {
    aiDailyBudget.observe(null);
    await aiUsageAlerts.idle();
  });
  // One emitter for the whole server: the caller the webhook stack never had
  // (FR-MOD-09.4). Built here, once `database` has decorated `app.db`, and
  // handed both to the sweeps and to every route that commits an event
  // somebody can subscribe to — a chat the timeout sweep archives has to reach
  // the same zap as one an agent archived.
  const automations = createWorkspaceEventDispatcher(app.db, {
    ...(webhookSender ? { sender: webhookSender } : {}),
    logger: app.log,
  });
  // What a raised or cleared risk flag sets off once committed (tm 302.2 ·
  // AI-27): the push, the webhook, the urgent mail. One for the server — the
  // routes and the AI's hand-over both raise flags — drained on close so an
  // urgent notice that was decided is not abandoned mid-send.
  const riskFlags = new RiskFlagAnnouncer(app.db, {
    mailer,
    publisher: new RealtimePublisher(app.redis, app.log),
    automations,
    appUrl: env.WEB_APP_URL.replace(/\/+$/, ''),
    logger: app.log.child({ component: 'risk-flags' }),
  });
  app.decorate('riskFlags', riskFlags);
  app.addHook('onClose', async () => {
    await riskFlags.idle();
  });
  // After both stores it reads through, before anything request-facing: the
  // five sweeps are background work, not part of answering a request.
  await app.register(scheduler, {
    env,
    mailer,
    telemetry: telemetryInstance,
    automations,
    knowledge,
    publisher: new RealtimePublisher(app.redis, app.log),
    llm: meteredLlm,
    geo,
    captchaUsable: captcha.verifier !== null,
  });
  // Mail a response must not wait for — the password reset's (tm 255.4), so its
  // answer cannot depend on the carrier, and since tm 256.4 the assignee notice,
  // the close transcript and the ticket notice. Before the routes that use it.
  await app.register(backgroundMail, { mailer });
  // The durable AI job worker (tm 289.3 · ADR-11a): what a visitor's message
  // sets off after its response — the rule bot, the AI Agent and the
  // assignee's notice, started by the customer routes (tm 289.5). After
  // `database` and `backgroundMail`, which the notice writes to, so its
  // bounded drain on close runs while both are still open.
  await app.register(aiJobs, {
    env,
    ...(aiJobDiscovery ? { discovery: aiJobDiscovery } : {}),
  });
  // The AI test bench (tm 314.2 · AI-19): the scenario runner on the live
  // engine and the worker that plays the queued runs with it, found the way
  // the AI job worker finds its jobs. After `database`, for its drain on close.
  await app.register(aiTesting, {
    env,
    llm: meteredLlm,
    knowledge,
    ...(accessInfoHttp ? { accessInfoHttp } : {}),
    ...(aiJobDiscovery ? { discovery: aiJobDiscovery } : {}),
  });
  // Before `auth`, and that order is load-bearing (M-SEC-c1 · §D116 LOW/1).
  // Fastify runs every `onRequest` hook before any `preHandler`, and within a
  // phase in registration order — so this is what puts the rate limiter's
  // pre-auth hook ahead of authentication's, which is what stops a flood of
  // invalid bearer tokens buying one `auth_resolve_token` lookup per request
  // before any limit is consulted. The account-scoped buckets still run in
  // `preHandler`, after authentication has resolved the principal; both hooks
  // and the reasoning are in `plugins/rate-limit.ts`. Swapping these two lines
  // back would silently restore the unbounded path, so `rate-limit.test.ts`
  // asserts the ordering by its effect rather than trusting this comment.
  await app.register(rateLimit, { env });
  await app.register(auth, { env });
  // After `auth`, so its `onRequest` hook adds the route's chat, connection and
  // customer ids to a logger that already says whose request it is (ID-08).
  await app.register(logContext);
  await app.register(audit, { env });
  // Entries a migration recorded but could not chain (tm 324.3), signed before
  // the server is ready.
  await app.register(pendingAudit, { env });
  // After `audit`, which it writes through, and before the routes that declare
  // `aiInference` (NFR-C4 · C4-e).
  await app.register(aiResidency, { env });
  await app.register(licenseGate, { pilotMode: env.PILOT_MODE });
  // After the licence gate, so an expired trial is told it is read-only rather
  // than told what its plan does not include — the first is the reason it
  // cannot write, and the second would be a confusing answer to it.
  await app.register(entitlementGate);
  // Billing writes are refused inside a sandbox (FR-MOD-11.5 · 11.5-f). Last of
  // the three gates because it is the narrowest: it costs a query only on a
  // write under `/billing/`, where the two above have already answered the
  // general questions.
  await app.register(sandboxGate);
  // The daily AI caps' early answer (tm 257.8) — after the gates above, so an
  // expired or out-of-region workspace is told that first, and before any
  // handler that would call a model.
  await app.register(aiBudget, {
    budget: aiDailyBudget,
    metered: meteredLlm.metered || meteredCopilotLlm.metered,
    minimum: env.LLM_MAX_OUTPUT_TOKENS,
  });
  // The public pilot's refusals (tm 257.13). Registered after the three gates
  // above but it answers before all of them: it hooks `onRequest`, which runs
  // ahead of every `preHandler`, because a refused route must not parse its
  // body. After `auth` on purpose — `onRequest` hooks run in registration
  // order, so a route that needs a credential still answers 401 to a caller
  // without one, the way every other route does, and only then "not in the
  // pilot". It reads no principal either way; see the file header.
  await app.register(pilotGate, {
    env,
    paths: pilotRefusedPaths,
    // The cards (and the Telegram channel) this deployment runs live: the only
    // way through a `pilotRefused` route (tm 263).
    liveApps: liveAppIds(env.APPS_LIVE_PROVIDERS),
  });
  await app.register(metering, { env });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { env, version: VERSION });
      await api.register(deploymentRoutes, { env });
      await api.register(authRoutes, { env, mailer });
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
      await api.register(chatRoutes, {
        env,
        push,
        automations,
        ...(appsHttp ? { appsHttp } : {}),
        ...(appsEndpoints ? { appsEndpoints } : {}),
      });
      await api.register(agentRoutes);
      await api.register(notificationRoutes);
      await api.register(customerRoutes, {
        env,
        push,
        automations,
        llm: meteredLlm,
        knowledge,
        ...(accessInfoHttp ? { accessInfoHttp } : {}),
      });
      await api.register(customerDirectoryRoutes);
      await api.register(memberRecognitionRoutes);
      await api.register(trafficRoutes);
      await api.register(campaignRoutes);
      await api.register(goalRoutes);
      await api.register(ticketRoutes, { env, automations, pilotMode: env.PILOT_MODE });
      await api.register(ticketRuleRoutes);
      await api.register(botRoutes);
      await api.register(ticketEmailTemplateRoutes);
      await api.register(customFieldRoutes);
      await api.register(channelRoutes, {
        env,
        automations,
        ...(appsHttp ? { appsHttp } : {}),
        ...(appsEndpoints ? { appsEndpoints } : {}),
      });
      await api.register(reportRoutes, { env });
      await api.register(scheduledReportRoutes);
      await api.register(homeRoutes);
      await api.register(settingsRoutes, { env, mailer });
      await api.register(permissionRoutes, { env });
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
      await api.register(playbookRoutes, {
        env,
        llm: meteredLlm,
        knowledge,
        ...(accessInfoHttp ? { accessInfoHttp } : {}),
      });
      await api.register(aiGuidanceRoutes, { env, llm: meteredLlm });
      await api.register(aiHandoffRulesRoutes);
      await api.register(handoffRoutesRoutes);
      await api.register(aiTemplateRoutes);
      await api.register(aiTestingRoutes);
      await api.register(aiUnresolvedRoutes, { knowledge });
      await api.register(aiGuardrailRoutes);
      await api.register(riskFlagRoutes);
      await api.register(aiHandoffRoutes);
      await api.register(kbRoutes, { knowledge });
      await api.register(knowledgeTableRoutes, { knowledge });
      await api.register(publicKbRoutes);
      await api.register(publicKbHtmlRoutes, {
        canonicalBase: `${env.API_BASE_URL}${API_PREFIX}`,
      });
      await api.register(publicKbSitemapRoutes, {
        canonicalBase: `${env.API_BASE_URL}${API_PREFIX}`,
      });
      await api.register(copilotRoutes, { env, automations, knowledge, llm: meteredCopilotLlm });
      await api.register(commandPaletteRoutes);
      await api.register(searchRoutes);
      await api.register(archiveRoutes, { env });
      await api.register(appRoutes, {
        env,
        ...(appsHttp ? { appsHttp } : {}),
        ...(appsEndpoints ? { appsEndpoints } : {}),
      });
      await api.register(auditLogRoutes, { env });
      await api.register(aiUsageRoutes, { env, budget: aiDailyBudget });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
