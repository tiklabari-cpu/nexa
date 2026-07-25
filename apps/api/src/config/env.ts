/**
 * Environment parsing. Validated once at boot so a misconfigured deployment
 * fails immediately with a readable message, rather than at the first request
 * that happens to touch the missing value.
 */
import { z } from 'zod';

const secret = (minLength: number) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((v) => !/^(changeme|secret|password)$/i.test(v), 'must not be a placeholder value');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXA_REGION: z.literal('eu').default('eu'),

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

  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().max(3600).default(3600),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),
  CUSTOMER_TOKEN_TTL: z.coerce.number().int().positive().default(28_800),
  AUTH_CODE_TTL: z.coerce.number().int().positive().max(600).default(120),

  RATE_LIMIT_AGENT_PER_MIN: z.coerce.number().int().positive().default(180),
  RATE_LIMIT_AGENT_BURST: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_CUSTOMER_PER_MIN: z.coerce.number().int().positive().default(60),
  /** Unauthenticated callers, per IP: sign-in, token exchange, widget tokens. */
  RATE_LIMIT_ANON_PER_MIN: z.coerce.number().int().positive().default(30),
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

  TRIAL_DAYS: z.coerce.number().int().positive().default(14),
  UNIT_PRICE_CENTS: z.coerce.number().int().nonnegative().default(9900),
  AI_RESOLUTIONS_INCLUDED: z.coerce.number().int().nonnegative().default(200),
  AI_OVERAGE_CENTS: z.coerce.number().int().nonnegative().default(50),

  LLM_PROVIDER: z.enum(['mock']).default('mock'),
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

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema> & {
  /** Connection string the request path should use — app role when available. */
  runtimeDatabaseUrl: string;
  isProduction: boolean;
  isTest: boolean;
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
  };
}
