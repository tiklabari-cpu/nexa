import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXA_REGION: z.literal('eu').default('eu'),

  DATABASE_URL: z.string().url(),
  DATABASE_APP_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),

  RTM_PORT: z.coerce.number().int().positive().default(4001),
  RTM_HOST: z.string().default('0.0.0.0'),

  JWT_SIGNING_KEY: z.string().min(32),
  RATE_LIMIT_RTM_PER_SEC: z.coerce.number().int().positive().default(10),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type RtmEnv = z.infer<typeof envSchema> & {
  runtimeDatabaseUrl: string;
  isTest: boolean;
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
  };
}
