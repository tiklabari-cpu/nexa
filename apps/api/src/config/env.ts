/**
 * Environment parsing. Validated once at boot so a misconfigured deployment
 * fails immediately with a readable message, rather than at the first request
 * that happens to touch the missing value.
 */
import { z } from 'zod';
import { DEFAULT_REGION, REGIONS } from '@nexa/types';
import { TENANT_TRANSACTION_TIMEOUT_MS } from '../lib/tenant.js';

const secret = (minLength: number) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((v) => !/^(changeme|secret|password)$/i.test(v), 'must not be a placeholder value');

const envSchema = z.object({
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
  /// in for a signed request. Optional: unset in dev/test leaves the endpoint
  /// open (the recipient address is the only routing key), enforced when set.
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
  MAIL_PROVIDER: z.enum(['mock']).default('mock'),
  STORAGE_PROVIDER: z.enum(['local']).default('local'),
  /** Where the `local` provider keeps uploads. Inside `.data/`, which is ignored. */
  STORAGE_LOCAL_DIR: z.string().default('.data/uploads'),
  /** How long a signed upload URL stays usable. One shot, so this is short. */
  UPLOAD_URL_TTL: z.coerce.number().int().positive().max(3600).default(300),
  STRIPE_PROVIDER: z.enum(['mock']).default('mock'),
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

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  const env = result.data;

  if (env.NODE_ENV === 'production') {
    if (!env.DATABASE_APP_URL) {
      throw new Error(
        'DATABASE_APP_URL is required in production: connecting as the table owner bypasses row level security.',
      );
    }
    for (const key of [
      'JWT_SIGNING_KEY',
      'WEBHOOK_HMAC_SEED',
      'CUSTOMER_TOKEN_SECRET',
      'UPLOAD_SIGNING_KEY',
      'AUDIT_CHAIN_SECRET',
    ] as const) {
      if (env[key].startsWith('dev-only-')) {
        throw new Error(`${key} still holds its development placeholder value.`);
      }
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
