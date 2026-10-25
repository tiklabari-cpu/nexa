/**
 * The platform-api process's own boot rules (tm 389.3 · design.md §E).
 *
 * The platform process reads the same environment as the tenant API — one
 * `.env`, one `parseEnv` — and then this, which only it calls. The split is the
 * point: the tenant API must never stop booting because of a root-panel
 * setting (owner rule 2026-10-10), so `env.ts` holds the platform keys as plain
 * optional strings, and every refusal lives here, where a bad value costs the
 * back office its start and nothing else.
 *
 * Like `parseEnv`, every problem is collected before anything is thrown, so
 * whoever deploys learns all of them at once.
 */
import type { Env } from './env.js';
import { parseOriginList, withPoolSize } from './env.js';

export interface PlatformEnv {
  /** `DATABASE_PLATFORM_URL`, with `DATABASE_POOL_SIZE` applied like the primary's. */
  databaseUrl: string;
  port: number;
  host: string;
  /** The admin SPA's origin — the one origin CORS answers. */
  adminOrigin: string;
  /** Requests per minute per address, `RATE_LIMIT_PLATFORM_PER_MIN`. */
  rateLimitPerMin: number;
}

export const PLATFORM_DEFAULTS = {
  port: 4002,
  host: '0.0.0.0',
  /** `apps/admin`'s Vite dev server (`ADMIN_PORT`, 389.6). Never a production default. */
  adminAppUrl: 'http://localhost:5175',
  rateLimitPerMin: 300,
} as const;

/** The role the platform connection is meant to log in as (migration 20261101090000). */
export const PLATFORM_DB_ROLE = 'siyahtus_platform';

function positiveInt(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= max ? parsed : null;
}

function username(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return null;
  }
}

/**
 * Everything wrong with the platform settings, or nothing.
 *
 * `DATABASE_PLATFORM_URL` is checked hardest, because each wrong value fails
 * silently in its own way: the table owner skips the grants 389.1 revoked (an
 * `audit_log` row becomes editable from the back office), and the tenant role
 * sees no workspace at all without a tenant context, so every list would be
 * empty rather than refused.
 */
export function platformEnvProblems(env: Env): string[] {
  const problems: string[] = [];

  const url = env.DATABASE_PLATFORM_URL;
  if (!url) {
    problems.push(
      `DATABASE_PLATFORM_URL is required: the platform process connects as ${PLATFORM_DB_ROLE} and has no other connection.`,
    );
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      problems.push('DATABASE_PLATFORM_URL is not a URL.');
    }
    if (parsed && parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      problems.push('DATABASE_PLATFORM_URL must be a postgresql:// connection string.');
    }
    const user = username(url);
    if (parsed && user === username(env.DATABASE_URL)) {
      problems.push(
        'DATABASE_PLATFORM_URL connects as the table owner (DATABASE_URL): the owner skips the grants the platform role is held to, append-only audit_log included.',
      );
    } else if (parsed && env.DATABASE_APP_URL && user === username(env.DATABASE_APP_URL)) {
      problems.push(
        'DATABASE_PLATFORM_URL connects as the tenant role (DATABASE_APP_URL): row level security would hide every workspace from the back office.',
      );
    }
  }

  if (positiveInt(env.PLATFORM_PORT, PLATFORM_DEFAULTS.port, 65_535) === null) {
    problems.push('PLATFORM_PORT must be a port number (1-65535).');
  }
  if (env.PLATFORM_HOST !== undefined && env.PLATFORM_HOST.trim() === '') {
    problems.push('PLATFORM_HOST is set but empty.');
  }
  if (
    positiveInt(env.RATE_LIMIT_PLATFORM_PER_MIN, PLATFORM_DEFAULTS.rateLimitPerMin, 1_000_000) ===
    null
  ) {
    problems.push('RATE_LIMIT_PLATFORM_PER_MIN must be a positive whole number.');
  }

  if (env.ADMIN_APP_URL === undefined || env.ADMIN_APP_URL.trim() === '') {
    if (env.isProduction) {
      problems.push(
        'ADMIN_APP_URL is required in production: it is the one origin the platform API answers, and there is no address to assume.',
      );
    }
  } else {
    const origins = parseOriginList(env.ADMIN_APP_URL);
    if (origins === null || origins.length !== 1) {
      problems.push(
        'ADMIN_APP_URL must be one origin (scheme://host[:port]), not a list or a URL.',
      );
    } else if (env.isProduction && !origins[0]!.startsWith('https://')) {
      problems.push('ADMIN_APP_URL must be https in production.');
    }
  }

  return problems;
}

/**
 * The platform settings, or a refusal naming every problem. Called once, by
 * `platform.ts` and `buildPlatformServer`, never by the tenant API.
 */
export function assertPlatformEnv(env: Env): PlatformEnv {
  const problems = platformEnvProblems(env);
  if (problems.length > 0) {
    throw new Error(
      `Invalid environment for the platform process:\n${problems.map((p) => `  ${p}`).join('\n')}`,
    );
  }
  const adminAppUrl = env.ADMIN_APP_URL?.trim() || PLATFORM_DEFAULTS.adminAppUrl;
  return {
    databaseUrl: withPoolSize(env.DATABASE_PLATFORM_URL!, env.DATABASE_POOL_SIZE),
    port: positiveInt(env.PLATFORM_PORT, PLATFORM_DEFAULTS.port, 65_535)!,
    host: env.PLATFORM_HOST?.trim() || PLATFORM_DEFAULTS.host,
    adminOrigin: parseOriginList(adminAppUrl)![0]!,
    rateLimitPerMin: positiveInt(
      env.RATE_LIMIT_PLATFORM_PER_MIN,
      PLATFORM_DEFAULTS.rateLimitPerMin,
      1_000_000,
    )!,
  };
}
