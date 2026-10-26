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
import { IMPERSONATION_TTL_DEFAULT_SECONDS } from '@siyahtus/types';
import type { Env } from './env.js';
import { parseOriginList, withPoolSize } from './env.js';
import { parseAllowlistEntry } from '../lib/ip-allowlist.js';

export interface PlatformEnv {
  /** `DATABASE_PLATFORM_URL`, with `DATABASE_POOL_SIZE` applied like the primary's. */
  databaseUrl: string;
  port: number;
  host: string;
  /** The admin SPA's origin — the one origin CORS answers. */
  adminOrigin: string;
  /** Requests per minute per address, `RATE_LIMIT_PLATFORM_PER_MIN`. */
  rateLimitPerMin: number;
  /**
   * `PLATFORM_IP_ALLOWLIST`, one entry per IP or CIDR, already validated. Empty
   * admits every address (`decideIpAccess`'s rule) — production warns.
   */
  ipAllowlist: string[];
  /** A session's absolute lifetime in seconds (`PLATFORM_SESSION_TTL`, 8 h). */
  sessionTtlS: number;
  /** How long a session may sit without a request (`PLATFORM_IDLE_TTL`, 15 min). */
  idleTtlS: number;
  /**
   * How long "enter as the customer" lasts (`PLATFORM_IMPERSONATION_TTL`,
   * 30 min, tm 389.15). No extension: a longer look is a new session.
   */
  impersonationTtlS: number;
  /**
   * `PLATFORM_SETTINGS_KEY` — the root the platform's sub-keys are derived
   * from (`lib/platform-keys.ts`); operator TOTP secrets are sealed under one.
   * Outside production an unset key falls back to {@link DEV_PLATFORM_SETTINGS_KEY}
   * with a warning; production refuses to start without a real one.
   */
  settingsKey: string;
  /** What is allowed but worth saying at boot; `buildPlatformServer` logs each. */
  warnings: string[];
}

export const PLATFORM_DEFAULTS = {
  port: 4002,
  host: '0.0.0.0',
  /** `apps/admin`'s Vite dev server (`ADMIN_PORT`, 389.6). Never a production default. */
  adminAppUrl: 'http://localhost:5175',
  rateLimitPerMin: 300,
  sessionTtlS: 28_800,
  idleTtlS: 900,
  impersonationTtlS: IMPERSONATION_TTL_DEFAULT_SECONDS,
} as const;

/**
 * Bounds of the two session lifetimes. Five minutes is the shortest session
 * anyone could sign in and act within; a week is far past any shift, and a
 * session that outlives one is a credential nobody remembers holding.
 */
const SESSION_TTL_RANGE = { min: 300, max: 604_800 } as const;
const IDLE_TTL_MIN = 60;

/**
 * An impersonation session lasts between five minutes (long enough to look at
 * anything) and two hours (an operator who needs longer opens a new one, and
 * the workspace's Founders hear of it again).
 */
const IMPERSONATION_TTL_RANGE = { min: 300, max: 7_200 } as const;

/**
 * The published development root key — what `.env.example` ships. Used only
 * outside production when `PLATFORM_SETTINGS_KEY` is unset, so a fresh clone's
 * platform process starts; production refuses it like every `dev-only-` value.
 */
export const DEV_PLATFORM_SETTINGS_KEY =
  'dev-only-platform-settings-key-change-me-0123456789abcdef';

/** The shortest root key accepted — the floor `env.ts` holds every other secret to. */
const SETTINGS_KEY_MIN_LENGTH = 32;

/** The role the platform connection is meant to log in as (migration 20261101090000). */
export const PLATFORM_DB_ROLE = 'siyahtus_platform';

function positiveInt(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= max ? parsed : null;
}

/** `PLATFORM_IP_ALLOWLIST`'s entries — comma- or whitespace-separated, blanks dropped. */
export function allowlistEntries(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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

  // An entry that does not parse is refused rather than dropped: dropping it
  // could turn a list that was meant to restrict into an empty one, which
  // admits everybody.
  const unparsable = allowlistEntries(env.PLATFORM_IP_ALLOWLIST).filter(
    (entry) => parseAllowlistEntry(entry) === null,
  );
  if (unparsable.length > 0) {
    problems.push(
      `PLATFORM_IP_ALLOWLIST holds entries that are not an IP address or CIDR: ${unparsable.join(', ')}.`,
    );
  }

  const sessionTtl = positiveInt(
    env.PLATFORM_SESSION_TTL,
    PLATFORM_DEFAULTS.sessionTtlS,
    SESSION_TTL_RANGE.max,
  );
  const sessionTtlValid = sessionTtl !== null && sessionTtl >= SESSION_TTL_RANGE.min;
  if (!sessionTtlValid) {
    problems.push(
      `PLATFORM_SESSION_TTL must be a whole number of seconds between ${SESSION_TTL_RANGE.min} and ${SESSION_TTL_RANGE.max}.`,
    );
  }
  const idleTtl = positiveInt(
    env.PLATFORM_IDLE_TTL,
    PLATFORM_DEFAULTS.idleTtlS,
    SESSION_TTL_RANGE.max,
  );
  if (idleTtl === null || idleTtl < IDLE_TTL_MIN) {
    problems.push(`PLATFORM_IDLE_TTL must be a whole number of seconds, at least ${IDLE_TTL_MIN}.`);
  } else if (sessionTtlValid && sessionTtl !== null && idleTtl > sessionTtl) {
    problems.push('PLATFORM_IDLE_TTL cannot be longer than PLATFORM_SESSION_TTL.');
  }

  const impersonationTtl = positiveInt(
    env.PLATFORM_IMPERSONATION_TTL,
    PLATFORM_DEFAULTS.impersonationTtlS,
    IMPERSONATION_TTL_RANGE.max,
  );
  if (impersonationTtl === null || impersonationTtl < IMPERSONATION_TTL_RANGE.min) {
    problems.push(
      `PLATFORM_IMPERSONATION_TTL must be a whole number of seconds between ${IMPERSONATION_TTL_RANGE.min} and ${IMPERSONATION_TTL_RANGE.max}.`,
    );
  }

  const settingsKey = env.PLATFORM_SETTINGS_KEY?.trim();
  if (!settingsKey) {
    if (env.isProduction) {
      problems.push(
        'PLATFORM_SETTINGS_KEY is required in production: operator TOTP secrets are sealed under a key derived from it.',
      );
    }
  } else if (settingsKey.length < SETTINGS_KEY_MIN_LENGTH) {
    problems.push(`PLATFORM_SETTINGS_KEY must be at least ${SETTINGS_KEY_MIN_LENGTH} characters.`);
  } else if (env.isProduction && settingsKey.startsWith('dev-only-')) {
    problems.push('PLATFORM_SETTINGS_KEY still holds its development placeholder value.');
  }

  return problems;
}

/**
 * What the platform process accepts but says out loud at boot. Not problems:
 * an empty allow-list is a legitimate choice behind an edge that restricts
 * access itself (Cloudflare Access, a VPN), and the owner's rule is that a
 * setting the deployment may not have yet never stops a start.
 */
export function platformEnvWarnings(env: Env): string[] {
  const warnings: string[] = [];
  if (env.isProduction && allowlistEntries(env.PLATFORM_IP_ALLOWLIST).length === 0) {
    warnings.push(
      'PLATFORM_IP_ALLOWLIST is empty: the platform API admits every address. Restrict it here or at the edge.',
    );
  }
  if (!env.PLATFORM_SETTINGS_KEY?.trim()) {
    warnings.push(
      'PLATFORM_SETTINGS_KEY is unset: using the published development key, so operator TOTP secrets are sealed under a key anyone can read.',
    );
  }
  return warnings;
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
    ipAllowlist: allowlistEntries(env.PLATFORM_IP_ALLOWLIST),
    sessionTtlS: positiveInt(
      env.PLATFORM_SESSION_TTL,
      PLATFORM_DEFAULTS.sessionTtlS,
      SESSION_TTL_RANGE.max,
    )!,
    idleTtlS: positiveInt(
      env.PLATFORM_IDLE_TTL,
      PLATFORM_DEFAULTS.idleTtlS,
      SESSION_TTL_RANGE.max,
    )!,
    impersonationTtlS: positiveInt(
      env.PLATFORM_IMPERSONATION_TTL,
      PLATFORM_DEFAULTS.impersonationTtlS,
      IMPERSONATION_TTL_RANGE.max,
    )!,
    settingsKey: env.PLATFORM_SETTINGS_KEY?.trim() || DEV_PLATFORM_SETTINGS_KEY,
    warnings: platformEnvWarnings(env),
  };
}
