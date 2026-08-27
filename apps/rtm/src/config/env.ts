/**
 * Gateway environment parsing. Validated once at boot, for the reason the API's
 * is (`apps/api/src/config/env.ts`): a misconfigured deployment should fail
 * immediately with a readable message rather than at the first socket that
 * happens to touch the missing value.
 *
 * Kept deliberately parallel to the API's, because these are two processes
 * reading the same variables out of the same environment. A guard on one side
 * only is worse than no guard: it produces a deployment that looks safe because
 * the API refused to start, while the gateway — which reads the same database
 * and verifies the same tokens — came up on the values the API rejected.
 */
import { z } from 'zod';
import { DEFAULT_REGION, REGIONS } from '@nexa/types';

/**
 * Same shape as the API's `secret()`: a minimum length and a refusal of the
 * obvious placeholders. Both processes must accept exactly the same key, so a
 * value one of them rejects must be a value the other rejects too.
 */
const secret = (minLength: number) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((v) => !/^(changeme|secret|password)$/i.test(v), 'must not be a placeholder value');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Kept identical to the API's (`apps/api/src/config/env.ts`) on purpose. These
   * are separate processes reading the same variable, and a gateway that
   * refuses a value the API accepts is a US deployment with no realtime.
   */
  NEXA_REGION: z.enum(REGIONS).default(DEFAULT_REGION),

  DATABASE_URL: z.string().url(),
  /**
   * Runtime connection, non-owner `nexa_app` role. The gateway reads through
   * `set_config('app.current_license', …)` exactly as the REST API does
   * (`auth.ts#scoped`), so connecting as the table owner would exempt it from
   * every row level security policy and the tenant scoping above it would be
   * decoration. Required in production for that reason — see
   * `productionProblems`.
   */
  DATABASE_APP_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),

  // 0 is allowed on purpose: it asks the OS for an ephemeral port, which is how
  // tests run several gateways at once without colliding on a fixed one.
  RTM_PORT: z.coerce.number().int().min(0).max(65_535).default(4001),
  RTM_HOST: z.string().default('0.0.0.0'),

  JWT_SIGNING_KEY: secret(32),
  /** Must match the API's, or customer tokens will not verify here. */
  CUSTOMER_TOKEN_SECRET: secret(32),
  RATE_LIMIT_RTM_PER_SEC: z.coerce.number().int().positive().default(10),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/**
 * The keys this schema treats as key material. The API's list is longer — it
 * holds secrets the gateway never reads — but every key named here appears
 * there too, and holds the same value in a working deployment.
 */
export const SECRET_KEYS = ['JWT_SIGNING_KEY', 'CUSTOMER_TOKEN_SECRET'] as const;

/**
 * What production refuses. The API's `productionProblems` refuses the same two
 * classes of thing for the same two reasons; collected rather than thrown one
 * at a time so whoever is deploying learns everything at once.
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
      // Worse here than almost anywhere else: `CUSTOMER_TOKEN_SECRET` is what
      // makes a customer token unforgeable, and the placeholder is published in
      // `.env.example`. A gateway holding it accepts sockets from anyone.
      problems.push(`${key} still holds its development placeholder value.`);
    }
  }

  return problems;
}

export type RtmEnv = z.infer<typeof envSchema> & {
  runtimeDatabaseUrl: string;
  isProduction: boolean;
  isTest: boolean;
  /** Alias kept explicit so the server reads clearly at the call site. */
  JWT_SIGNING_KEY_CUSTOMER: string;
};

export function parseEnv(source: NodeJS.ProcessEnv = process.env): RtmEnv {
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
    JWT_SIGNING_KEY_CUSTOMER: env.CUSTOMER_TOKEN_SECRET,
  };
}
