/**
 * Environment parsing. Validated once at boot so a misconfigured deployment
 * fails immediately with a readable message, rather than at the first request
 * that happens to touch the missing value.
 */
import { z } from 'zod';
import { DEFAULT_REGION, REGIONS } from '@nexa/types';
import { TENANT_TRANSACTION_TIMEOUT_MS } from '../lib/tenant.js';
// The provider vocabularies live with their factories, not here: a value this
// schema accepts and no factory implements is exactly the drift M-PROV-a exists
// to close, and one list read from both ends cannot drift. None of these
// modules reaches back into this one, so there is no import cycle.
import { SIEM_PROVIDERS } from '../services/audit/siem-target.js';
import { PAYMENT_PROVIDERS } from '../services/billing/payment-provider.js';
import { MAIL_PROVIDERS } from '../services/mail/mailer.js';
import { PUSH_PROVIDERS } from '../services/push/push-provider.js';
import { STORAGE_PROVIDERS } from '../services/storage/object-store.js';

const secret = (minLength: number) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((v) => !/^(changeme|secret|password)$/i.test(v), 'must not be a placeholder value');

/** Exported so `env.parity.test.ts` can enumerate keys off `.shape` rather than re-parsing this file as text. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Which region *this process* serves (C4-a). Not the region of any workspace
   * it happens to hold — a workspace carries its own on `organizations.region`,
   * and reconciling the two is C4-b's job, where a mismatch becomes a 421.
   * Widened from `z.literal('eu')`: `us` has to pass here and in the RTM
   * gateway's identical schema, or a US deployment cannot boot at all.
   */
  NEXA_REGION: z.enum(REGIONS).default(DEFAULT_REGION),

  DATABASE_URL: z.string().url(),
  /**
   * Runtime connection. Uses the non-owner `nexa_app` role, because Postgres
   * exempts table owners and superusers from row level security — connecting as
   * the owner would silently disable every tenant isolation policy.
   */
  DATABASE_APP_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  /// Where invitation links point. The agent app, not the API.
  WEB_APP_URL: z.string().url().default('http://localhost:5173'),
  /// Outgoing mail is written here rather than sent (PLAN A4).
  MAIL_DIR: z.string().default('.data/mail'),
  /// Push notifications are written here rather than delivered — there is no
  /// APNs/FCM key to hold (13.7-d). Partitioned by license underneath, so a
  /// cross-tenant delivery would be visible as a file in the wrong directory.
  PUSH_DIR: z.string().default('.data/push'),
  RTM_BASE_URL: z.string().default('ws://localhost:4001'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /// Origin serving the widget loader + iframe. The install snippet points
  /// `window.__nexa.widgetOrigin` and the async `loader.js` at it.
  WIDGET_BASE_URL: z.string().url().default('http://localhost:5174'),
  /// Domain a workspace forwards its support mail to (FR-MOD-08.5.3). The
  /// per-workspace address is `<organization_id>@<domain>`; the inbound webhook
  /// reads the local part back to route the message. Must match what the web
  /// app shows on the Email channel card (`VITE_INBOUND_EMAIL_DOMAIN`).
  INBOUND_EMAIL_DOMAIN: z.string().default('inbound.nexa.localhost'),
  /// Shared secret the mail provider presents on the inbound webhook, standing
  /// in for a signed request. Optional in dev/test, where leaving it unset keeps
  /// the endpoint open (the recipient address is the only routing key) and the
  /// alternative would be a key nobody has. **Required in production** — see
  /// `productionProblems` below, which is where "optional" stops being safe.
  INBOUND_EMAIL_SECRET: z.string().optional(),

  JWT_SIGNING_KEY: secret(32),
  WEBHOOK_HMAC_SEED: secret(32),
  CUSTOMER_TOKEN_SECRET: secret(32),
  UPLOAD_SIGNING_KEY: secret(32),
  /**
   * Root of the audit chain's per-workspace HMAC keys (NFR-C6 · C6-c).
   *
   * The one secret in this list that must survive a database restore: it is
   * held here precisely so that whoever holds the database does not hold it,
   * which is what makes a hash chain evidence of tampering rather than a
   * checksum against corruption. Rotating it does not invalidate the trail —
   * entries already written keep verifying under the old value — but it does
   * mean the old value has to be kept to verify them, so treat a rotation as
   * archiving a key rather than replacing one.
   */
  AUDIT_CHAIN_SECRET: secret(32),

  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().max(3600).default(3600),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),
  CUSTOMER_TOKEN_TTL: z.coerce.number().int().positive().default(28_800),
  AUTH_CODE_TTL: z.coerce.number().int().positive().max(600).default(120),
  /**
   * How long the two-factor enrollment ticket lives (NFR-S11 · S11-2FA-k).
   *
   * Longer than `AUTH_CODE_TTL` because a person is doing more than a redirect:
   * installing an authenticator app, typing or scanning a secret, waiting for
   * the next code. Ten minutes is enough for that on a first attempt and short
   * enough that a ticket left in a closed tab is dead before anyone could go
   * looking for it. Capped at half an hour — past that it stops being a step in
   * a sign-in and starts being a session, which is the one thing it must not be.
   */
  TWO_FACTOR_ENROLLMENT_TICKET_TTL: z.coerce.number().int().positive().max(1800).default(600),

  RATE_LIMIT_AGENT_PER_MIN: z.coerce.number().int().positive().default(180),
  RATE_LIMIT_AGENT_BURST: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_CUSTOMER_PER_MIN: z.coerce.number().int().positive().default(60),
  /** Unauthenticated callers, per IP: sign-in, token exchange, widget tokens. */
  RATE_LIMIT_ANON_PER_MIN: z.coerce.number().int().positive().default(30),
  /**
   * Anonymous public-KB reads, per IP (PUBKB-c). Higher than the general anon
   * limit because this is the SEO surface a search crawler indexes — the shared
   * 30/min would throttle a legitimate crawl. Its own `rl:pubkb:<ip>` bucket.
   */
  RATE_LIMIT_PUBKB_PER_MIN: z.coerce.number().int().positive().default(300),
  /**
   * SCIM provisioning connectors, per token (NFR-S11 · ADR-07). Higher than the
   * agent limit because a directory sync is bursty by nature — a full
   * reconciliation pages the whole workspace and then patches everyone who
   * changed — and one connector's burst must not be able to throttle another
   * workspace's, which the per-token key already guarantees. Still bounded: a
   * stolen SCIM token is the credential for an entire organisation's user
   * lifecycle, so it gets a ceiling like everything else.
   */
  RATE_LIMIT_SCIM_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_RTM_PER_SEC: z.coerce.number().int().positive().default(10),
  /**
   * `/health`, per IP (M-SEC-b2 · §D116 MEDIUM (b)). Anonymous, but no longer
   * `skipRateLimit` — a bare probe is unauthenticated by nature, so it shares
   * the anon bucket's shape (keyed by IP) rather than the anon bucket itself:
   * a monitor polling every few seconds must never compete with sign-in/token
   * traffic for the same 30/min. High on purpose — this ceiling exists only to
   * bound abuse of a public endpoint, not to throttle legitimate polling; set
   * it too low and an orchestrator's own liveness probe starts failing the
   * instance it is trying to keep in rotation.
   */
  RATE_LIMIT_HEALTH_PER_MIN: z.coerce.number().int().positive().default(600),
  /**
   * Second-factor code presentations at `/auth/authorize`, per **account** and
   * per **hour** (NFR-S11 · S11-2FA-e).
   *
   * Keyed by account rather than by IP because the thing being guessed belongs
   * to an account: a six-digit code with a one-step drift window either side is
   * three live values in a million, and spreading the guesses across addresses
   * is the first thing anyone would do. Unreachable without the password —
   * the gate runs after it has been verified — so this cannot be used to lock a
   * stranger out; whoever can spend a slot could, before this existed, have
   * signed in outright.
   *
   * An hour, not a minute, and that is the whole point. Every other bucket here
   * shapes traffic, where a short window is right; this one has to *bound a
   * search*, and a window that resets every minute bounds nothing — 20/min is
   * 28,800 guesses a day and a six-digit code inside a fortnight. At 20/hour the
   * same search runs for years, while a person mistyping their code three times
   * and a client retrying on a flaky connection never come close.
   */
  RATE_LIMIT_TWO_FACTOR_PER_HOUR: z.coerce.number().int().positive().default(20),

  /**
   * Data retention windows in days (NFR-C8). Each is a positive integer; the
   * pruning job hard-deletes data older than its window. Defaults sit at the top
   * of the PRD's configurable tiers (conversations 365) and tighter for pure
   * telemetry and transient mail. See services/retention/policy.ts.
   */
  RETENTION_THREAD_DAYS: z.coerce.number().int().positive().default(365),
  RETENTION_VISIT_DAYS: z.coerce.number().int().positive().default(90),
  RETENTION_MAIL_DAYS: z.coerce.number().int().positive().default(30),
  /** Audit log window (NFR-S12: "last 30 days" of basic audit, every plan). */
  RETENTION_AUDIT_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * How far behind "now" the SIEM export stops (NFR-C6 · C6-b), in
   * milliseconds.
   *
   * Not a throttle — a correctness bound. An audit row's `created_at` is
   * `CURRENT_TIMESTAMP`, which Postgres fixes at the *start* of the writing
   * transaction, so a row can become visible with a timestamp already behind
   * one the export has passed. Exporting right up to `now()` would therefore
   * step over entries written by transactions still in flight, and step over
   * them permanently: the cursor only moves forward. The default is
   * `TENANT_TRANSACTION_TIMEOUT_MS` — the longest a tenant transaction may run
   * before Prisma rolls it back, and so the longest an entry's timestamp can
   * precede its commit.
   *
   * Zero disables the horizon. Legitimate where nothing writes concurrently
   * with the export (the integration suites, a single-user e2e run); a
   * deployment that sets it is choosing to lose entries under load.
   */
  SIEM_EXPORT_HORIZON_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(TENANT_TRANSACTION_TIMEOUT_MS),
  /**
   * Where the scheduled sink writes the mock SIEM target (NFR-C6 · C6-d).
   * Inside `.data/`, like `MAIL_DIR` and `STORAGE_LOCAL_DIR` — ignored, and the
   * whole of what this deployment can honestly offer in place of a real
   * Splunk/Sentinel/Datadog connector (a project boundary).
   */
  SIEM_DIR: z.string().default('.data/siem'),
  /**
   * Where the scheduled sink delivers (NFR-C6 · C6-d · M-PROV-a). `file` writes
   * the sealed NDJSON page plus its `.sig` sidecar under `SIEM_DIR`. A workspace
   * may only choose a `SIEM_EXPORT_TARGETS` value this deployment implements —
   * the sink fails loudly on a row naming anything else, rather than quietly
   * shipping nothing. See services/audit/siem-target.ts.
   */
  SIEM_PROVIDER: z.enum(SIEM_PROVIDERS).default('file'),

  TRIAL_DAYS: z.coerce.number().int().positive().default(14),
  UNIT_PRICE_CENTS: z.coerce.number().int().nonnegative().default(9900),
  AI_RESOLUTIONS_INCLUDED: z.coerce.number().int().nonnegative().default(200),
  AI_OVERAGE_CENTS: z.coerce.number().int().nonnegative().default(50),
  // API-call metering (FR-MOD-10.1.5). Overage is sold by the block: $29.50 per
  // 100,000 calls beyond the included allowance (PRD §10.1.5). The defaults are
  // the same numbers the seed stamps onto a usage record, so the meter and the
  // seeded demo can never quote different figures.
  API_CALLS_INCLUDED: z.coerce.number().int().nonnegative().default(100_000),
  API_CALL_OVERAGE_CENTS: z.coerce.number().int().nonnegative().default(2_950),

  LLM_PROVIDER: z.enum(['mock']).default('mock'),
  /**
   * Where `LLM_PROVIDER` runs the inference (NFR-C4 · C4-e). Unset means "the
   * same region as this process", which is the truth for the in-process stub and
   * the only honest default: a deployment pointing at a model service somewhere
   * else has to say so, because a workspace under a signed BAA may not have its
   * content inferred outside its own region. See services/ai/inference.ts.
   */
  LLM_PROVIDER_REGION: z.enum(REGIONS).optional(),
  /**
   * Outgoing mail (M-PROV-a). `file` writes each message under `MAIL_DIR`
   * instead of sending it (PLAN A4); `null` discards, which is what the test
   * fixture asks for so a suite that sends hundreds of invitations leaves
   * nothing behind. Named after what the implementation does rather than after
   * the environment that wants it: `server.ts` used to pick off `NODE_ENV`,
   * which made this key validated-but-unread.
   */
  MAIL_PROVIDER: z.enum(MAIL_PROVIDERS).default('file'),
  /**
   * Outgoing push (M-PROV-a). Same pair of mocks as the mailer, spooling under
   * `PUSH_DIR` (13.7-d). A newer key than the rest — this channel arrived after
   * the others had theirs, and inherited the `NODE_ENV` branch instead.
   */
  PUSH_PROVIDER: z.enum(PUSH_PROVIDERS).default('file'),
  STORAGE_PROVIDER: z.enum(STORAGE_PROVIDERS).default('local'),
  /** Where the `local` provider keeps uploads. Inside `.data/`, which is ignored. */
  STORAGE_LOCAL_DIR: z.string().default('.data/uploads'),
  /** How long a signed upload URL stays usable. One shot, so this is short. */
  UPLOAD_URL_TTL: z.coerce.number().int().positive().max(3600).default(300),
  /**
   * The payment processor (M-PROV-a). `mock` accepts any unexpired card and
   * charges nothing (ADR-13); a real Stripe provider slots in behind
   * `PaymentProvider`. See services/billing/payment-provider.ts.
   */
  STRIPE_PROVIDER: z.enum(PAYMENT_PROVIDERS).default('mock'),
  /**
   * Upload virus scanning (FR-MOD-08.9.4). `mock` flags the EICAR test file and
   * passes the rest; `unavailable` is always-down, for exercising the fail-closed
   * path in tests and drills. A real ClamAV provider slots in here later.
   */
  VIRUS_SCANNER: z.enum(['mock', 'unavailable']).default('mock'),

  /**
   * Background job scheduler (M-SCHED · §D113/K1). Unset it follows the
   * environment: on in dev/prod, off under test — the suites must not have a
   * sweep archiving their fixtures underneath them, and every one of them boots
   * a server. `true`/`false` overrides either way.
   *
   * Off does not mean the sweeps are unreachable: each one keeps its
   * `pnpm --filter @nexa/api <job>:run` script, which is also how a deployment
   * that would rather drive them from a host cron does it.
   */
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /**
   * How far each interval is spread, in percent. Instances that came up from one
   * deploy would otherwise tick in lockstep forever, and every tick but one
   * would be a wasted round trip to the lock. Capped well below 100 because a
   * spread wide enough to reorder intervals is no longer jitter.
   */
  SCHEDULE_JITTER_PCT: z.coerce.number().int().min(0).max(50).default(10),
  /**
   * Per-job intervals in milliseconds (see services/scheduler/intervals.ts).
   *
   * The minute-scale ones are latency budgets a person can feel: an idle chat
   * that stays open, an SLA breach that is not yet marked, a scheduled report
   * that has not gone out. SIEM is coarser because its consumer batches anyway,
   * and retention is hourly because it deletes — there is nothing to gain from
   * looking more often, and a tight loop over every tenant's old rows is real
   * database load.
   */
  SCHEDULE_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  SCHEDULE_SLA_MS: z.coerce.number().int().positive().default(60_000),
  SCHEDULE_SIEM_MS: z.coerce.number().int().positive().default(300_000),
  SCHEDULE_SCHEDULED_REPORTS_MS: z.coerce.number().int().positive().default(60_000),
  SCHEDULE_RETENTION_MS: z.coerce.number().int().positive().default(3_600_000),
  SCHEDULE_WEBHOOK_REDELIVERY_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * Lets the retention job actually run its scheduled pass (M-SCHED-b ·
   * `services/scheduler/types.ts`'s `JobDefinition.enabled`). Off by default:
   * this is the one sweep that hard-deletes data, and there is no operator
   * here to type `--apply` the way `retention:run` asks for outside a
   * scheduler. The job is registered either way, so `/health` always shows
   * it — `disabled` until this is set, never simply absent.
   */
  RETENTION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Attempts a webhook delivery gets in total — the three inside the triggering
   * request plus every scheduled redelivery after them (M-SCHED-e).
   *
   * Eight covers roughly four hours of the backoff curve
   * (`webhook-dispatcher.ts`), which is long enough to ride out a receiver's
   * deploy or a brief outage and short enough that a permanently dead endpoint
   * is declared dead the same day. Lowering it takes effect on rows already
   * queued: the sweep will not retry past a cap the deployment has withdrawn.
   */
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * OpenTelemetry tracing + metrics (NFR-M5). Left unset it follows the
   * environment: on in dev/prod (console exporter — there is no collector here,
   * a project boundary), off under test so the suites stay fast. Set it to
   * `true`/`false` to override either way.
   */
  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type Env = z.infer<typeof envSchema> & {
  /** Connection string the request path should use — app role when available. */
  runtimeDatabaseUrl: string;
  isProduction: boolean;
  isTest: boolean;
  /** Whether OpenTelemetry instrumentation is active for this process. */
  otelEnabled: boolean;
  /** Whether this process runs the background sweeps (M-SCHED). */
  schedulerEnabled: boolean;
};

/**
 * The keys `secret()` builds — everything this schema treats as key material.
 *
 * Exported so the production check below and its test read one list rather than
 * two that drift: a sixth secret added to the schema and not here would boot in
 * production still holding its published `dev-only-` placeholder, and
 * `env.test.ts` derives the same set from `envSchema.shape`, so the omission
 * fails the suite instead of shipping.
 */
export const SECRET_KEYS = [
  'JWT_SIGNING_KEY',
  'WEBHOOK_HMAC_SEED',
  'CUSTOMER_TOKEN_SECRET',
  'UPLOAD_SIGNING_KEY',
  'AUDIT_CHAIN_SECRET',
] as const;

/**
 * What production refuses, and why each one is a refusal rather than a default.
 *
 * Every problem is collected before anything is thrown. Failing on the first
 * would turn a misconfigured deployment into a queue of one-line failures —
 * fix, redeploy, discover the next — which defeats the reason this runs at boot
 * at all: whoever is deploying should learn everything that is wrong before any
 * traffic arrives, not one thing per attempt.
 */
function productionProblems(env: z.infer<typeof envSchema>): string[] {
  const problems: string[] = [];

  if (!env.DATABASE_APP_URL) {
    problems.push(
      'DATABASE_APP_URL is required in production: Postgres exempts table owners from row level security, so connecting as the owner silently disables every tenant policy.',
    );
  }

  for (const key of SECRET_KEYS) {
    if (env[key].startsWith('dev-only-')) {
      problems.push(`${key} still holds its development placeholder value.`);
    }
  }

  // Unset, `routes/channels.ts` skips its check entirely and the inbound mail
  // webhook authenticates nobody: the recipient address is the only routing key,
  // and a workspace hands that address to the customers it asks to forward mail
  // to. Fine in development, where the alternative is a key nobody has; in
  // production it is an open door into any workspace whose address is known.
  if (!env.INBOUND_EMAIL_SECRET) {
    problems.push(
      'INBOUND_EMAIL_SECRET is required in production: unset, the inbound mail webhook accepts anyone who knows a workspace address.',
    );
  }

  return problems;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  const env = result.data;

  if (env.NODE_ENV === 'production') {
    const problems = productionProblems(env);
    if (problems.length > 0) {
      throw new Error(
        `Invalid environment for NODE_ENV=production:\n${problems.map((p) => `  ${p}`).join('\n')}`,
      );
    }
  }

  return {
    ...env,
    runtimeDatabaseUrl: env.DATABASE_APP_URL ?? env.DATABASE_URL,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    otelEnabled: env.OTEL_ENABLED ?? env.NODE_ENV !== 'test',
    schedulerEnabled: env.SCHEDULER_ENABLED ?? env.NODE_ENV !== 'test',
  };
}
