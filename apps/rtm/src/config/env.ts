import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXA_REGION: z.literal('eu').default('eu'),

  DATABASE_URL: z.string().url(),
  DATABASE_APP_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),

  // 0 is allowed on purpose: it asks the OS for an ephemeral port, which is how
  // tests run several gateways at once without colliding on a fixed one.
  RTM_PORT: z.coerce.number().int().min(0).max(65_535).default(4001),
  RTM_HOST: z.string().default('0.0.0.0'),

  JWT_SIGNING_KEY: z.string().min(32),
  /** Must match the API's, or customer tokens will not verify here. */
  CUSTOMER_TOKEN_SECRET: z.string().min(32),
  RATE_LIMIT_RTM_PER_SEC: z.coerce.number().int().positive().default(10),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type RtmEnv = z.infer<typeof envSchema> & {
  runtimeDatabaseUrl: string;
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
  return {
    ...result.data,
    runtimeDatabaseUrl: result.data.DATABASE_APP_URL ?? result.data.DATABASE_URL,
    isTest: result.data.NODE_ENV === 'test',
    JWT_SIGNING_KEY_CUSTOMER: result.data.CUSTOMER_TOKEN_SECRET,
  };
}
