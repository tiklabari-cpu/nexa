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
import { DEFAULT_REGION, DISCONNECT_OFFLINE_DEFAULT_MS, REGIONS } from '@siyahtus/types';
import { OTEL_EXPORTERS } from '../telemetry/telemetry.js';

/**
 * `RTM_MAX_BUFFERED_BYTES`' floor (tm 428): the draft preview's congestion
 * threshold (`fanout.ts` `SNEAK_PEEK_COALESCE_BUFFERED_BYTES`), so a socket
 * is held before it is closed. Here rather than imported, because `fanout.ts`
 * pulls the gateway's runtime in and this file is read at boot before it.
 */
export const RTM_MAX_BUFFERED_BYTES_MIN = 64 * 1024;

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
  SIYAHTUS_REGION: z.enum(REGIONS).default(DEFAULT_REGION),

  DATABASE_URL: z.string().url(),
  /**
   * Runtime connection, non-owner `siyahtus_app` role. The gateway reads through
   * `set_config('app.current_license', …)` exactly as the REST API does
   * (`auth.ts#scoped`), so connecting as the table owner would exempt it from
   * every row level security policy and the tenant scoping above it would be
   * decoration. Required in production for that reason — see
   * `productionProblems`.
   */
  DATABASE_APP_URL: z.string().url().optional(),
  /**
   * Prisma connection pool size for this process (M-SCALE-b). Kept identical
   * to the API's (`apps/api/src/config/env.ts`) — both processes read the
   * same variable out of the same environment and each opens its own pool
   * against the same `max_connections` budget. See "Connection pool budget"
   * in README.md.
   */
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().optional(),
  REDIS_URL: z.string().url(),

  // 0 is allowed on purpose: it asks the OS for an ephemeral port, which is how
  // tests run several gateways at once without colliding on a fixed one.
  RTM_PORT: z.coerce.number().int().min(0).max(65_535).default(4001),
  RTM_HOST: z.string().default('0.0.0.0'),

  JWT_SIGNING_KEY: secret(32),
  /** Must match the API's, or customer tokens will not verify here. */
  CUSTOMER_TOKEN_SECRET: secret(32),
  RATE_LIMIT_RTM_PER_SEC: z.coerce.number().int().positive().default(10),
  /**
   * How many concurrent WebSocket connections this gateway holds before it
   * starts refusing upgrades by name (M-LOAD-CAP · §D127).
   *
   * Unset means unlimited — precisely what the gateway did before this key
   * existed. Opening the seam is the point; changing what a running deployment
   * does on the way is not, and a ceiling that appeared with a default would be
   * a silent capacity regression rather than a control.
   *
   * `0` is refused rather than read as "no ceiling": zero accepts nobody, and
   * reading the most restrictive value in the range as the least restrictive
   * one is how a typo becomes an outage. Blank, however, *is* read as unset —
   * unlike `SHUTDOWN_DRAIN_MS` above, where `z.coerce` turns `''` into a
   * harmless `0`. Here `''` would coerce to exactly the value the previous
   * sentence refuses, and a deployment template interpolating an unset variable
   * (`RTM_MAX_CONNECTIONS=${RTM_MAX_CONNECTIONS}`) writes exactly that — so
   * blank has to mean what whoever wrote it meant: no ceiling.
   */
  RTM_MAX_CONNECTIONS: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  /**
   * How many sockets one client address may hold before they log in (tm 405,
   * `prelogin-limit.ts`). Past it the next upgrade from that address is refused
   * with 429 `prelogin_limit_reached`; logged-in sockets do not count.
   *
   * Defaulted, unlike `RTM_MAX_CONNECTIONS` above, because this is not a
   * capacity number — it does not depend on the pod. A legitimate client logs
   * in on its first frame, so it waits for one round trip and one token check;
   * {@link RTM_MAX_PRELOGIN_PER_IP_DEFAULT} says what the default leaves room for.
   *
   * `0` turns it off — a cap of zero would accept nobody, so the value has no
   * other use, and a load generator on one machine (`apps/load`) or a topology
   * that collapses every visitor onto one proxy address needs a way out.
   * Blank is unset, for the reason it is on `RTM_MAX_CONNECTIONS`.
   */
  RTM_MAX_PRELOGIN_PER_IP: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().min(0).max(100_000).optional(),
  ),
  /**
   * How many logged-in sockets one visitor may hold (tm 427,
   * `customer-socket-limit.ts`) — one per widget tab. Past it the visitor's
   * next login is answered 429-style `socket_limit_reached` and the socket is
   * closed with 1013; the tab stays on the widget's poll. Member and bot
   * sockets are not counted. Unset is {@link RTM_MAX_SOCKETS_PER_CUSTOMER_DEFAULT};
   * `0` turns it off; blank is unset, as on the keys above.
   */
  RTM_MAX_SOCKETS_PER_CUSTOMER: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().min(0).max(1_000).optional(),
  ),
  /**
   * How many logged-in visitor sockets one client network may hold (tm 427) —
   * an IPv4 address or an IPv6 /64, counted as `RTM_MAX_PRELOGIN_PER_IP`
   * counts it, so minting a visitor per socket does not get past the cap
   * above. Unset is {@link RTM_MAX_CUSTOMER_SOCKETS_PER_IP_DEFAULT}; `0` turns
   * it off; blank is unset.
   */
  RTM_MAX_CUSTOMER_SOCKETS_PER_IP: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().min(0).max(100_000).optional(),
  ),
  /**
   * How many unsent bytes a socket may hold before the gateway stops writing to
   * it and closes it with 1013 (tm 428, `socket-writer.ts`). Unset is
   * {@link RTM_MAX_BUFFERED_BYTES_DEFAULT}; `0` turns it off; blank is unset.
   * Otherwise at least {@link RTM_MAX_BUFFERED_BYTES_MIN}: below the level at
   * which the draft preview starts holding frames on a congested socket
   * (`fanout.ts`, 64 KiB) that holding could never begin — the socket would be
   * closed first.
   */
  RTM_MAX_BUFFERED_BYTES: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce
      .number()
      .int()
      .min(0)
      .max(256 * 1024 * 1024)
      .refine((v) => v === 0 || v >= RTM_MAX_BUFFERED_BYTES_MIN, {
        message: 'must be 0 (off) or at least 65536',
      })
      .optional(),
  ),
  /**
   * How many reverse proxies in front of this process appended to the
   * forwarded-for header (tm 405). Same key, same schema, same default as the
   * API's (`apps/api/src/config/env.ts`, where the reasoning is): both
   * processes sit behind the same edge, and this one derives the address the
   * pre-login cap counts by exactly the rule the API derives `request.ip` by
   * (`client-address.ts`). A value the API refuses is refused here too.
   */
  TRUST_PROXY_HOPS: z
    .preprocess(
      // '' would coerce to 0, which is a real topology here, not "unset".
      (value) => (value === '' ? Number.NaN : value),
      z.coerce.number().int().min(0).max(8),
    )
    .default(1),
  /**
   * Shutdown drain window in milliseconds (M-OPS-b). Same key, same meaning and
   * the same environment-following default as the API's
   * (`apps/api/src/config/env.ts`) — two processes reading one variable out of
   * one environment must not disagree about what it means, and a deployment
   * that drains the API for five seconds while the gateway drops its sockets
   * instantly has not drained.
   *
   * Here the window buys the gateway's clients the same thing: readiness turns
   * false first, so the orchestrator stops sending new upgrades this way before
   * the sockets already attached are told to go somewhere else.
   */
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(120_000).optional(),
  /**
   * How long an agent may have no open socket — on any gateway — before this
   * gateway sets them `offline` (WG-03 · tm 340.3, `presence.ts`). Unset is
   * `DISCONNECT_OFFLINE_DEFAULT_MS` (two minutes: RP-03's tolerance for a
   * reload or a network blip); `0` turns it off, and so does running under
   * test unless the suite sets it — a gateway that changes routing status is a
   * second writer every other suite would have to declare. Capped at an hour:
   * past that it is not a tolerance, and a closed browser keeps receiving
   * chats for as long as the number says.
   */
  RTM_DISCONNECT_OFFLINE_MS: z.coerce.number().int().min(0).max(3_600_000).optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * OpenTelemetry metrics (NFR-M5 · M-OTEL-b). Same key, same "follows the
   * environment unless told otherwise" default as the API's
   * (`apps/api/src/config/env.ts`) — one variable, two processes, so pointing
   * the stack at a real collector does not mean forgetting the gateway half.
   */
  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Which exporter carries the three RTM metrics once `OTEL_ENABLED` is on — see `telemetry.ts`. */
  OTEL_EXPORTER: z.enum(OTEL_EXPORTERS).default('console'),
  /** The collector `OTEL_EXPORTER=otlp` sends to — same key the API reads. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
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

  // The API's `TEMPLATE_PLACEHOLDER` rule, kept identical (tm 255.15): both
  // processes read the pilot's one `.env`, copied from
  // `.env.production.example`, and a `<…>` fill-in left in it is refused by
  // name rather than booted with.
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && /<[^<>]+>/.test(value)) {
      problems.push(`${key} still holds a .env.production.example placeholder (<…>).`);
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
  /** Resolved shutdown drain window in milliseconds (M-OPS-b). */
  shutdownDrainMs: number;
  /**
   * Resolved telemetry switch (M-OTEL-b). Same computation as the API's
   * `otelEnabled` — on by default everywhere except under test, so the 106+
   * existing rtm suites do not pay for a stack they never asked for.
   */
  otelEnabled: boolean;
  /**
   * Resolved connection ceiling (M-LOAD-CAP). `null` is "no ceiling", spelled
   * as a value rather than as `undefined` so a call site that forgets to handle
   * it fails to compile instead of comparing against `NaN`.
   */
  maxConnections: number | null;
  /**
   * Resolved pre-login cap per client address (tm 405). `null` is off
   * (`RTM_MAX_PRELOGIN_PER_IP=0`); unset is {@link RTM_MAX_PRELOGIN_PER_IP_DEFAULT}.
   */
  maxPreLoginPerIp: number | null;
  /** Resolved logged-in sockets per visitor (tm 427); `null` is off. */
  maxSocketsPerCustomer: number | null;
  /** Resolved logged-in visitor sockets per client network (tm 427); `null` is off. */
  maxCustomerSocketsPerIp: number | null;
  /** Resolved unsent-bytes limit per socket (tm 428); `null` is off. */
  maxBufferedBytes: number | null;
  /**
   * Resolved disconnect tolerance (tm 340.3): milliseconds an agent may have
   * no open socket before going offline, or `null` when this gateway does not
   * change routing status at all.
   */
  disconnectOfflineMs: number | null;
};

/**
 * Applies `DATABASE_POOL_SIZE` to a Postgres connection string as Prisma's
 * `connection_limit` query parameter. Kept identical to the API's
 * (`apps/api/src/config/env.ts`). A URL that already names `connection_limit`
 * is left alone — a deployment default, not a way to fight a more specific
 * override.
 */
function withPoolSize(url: string, poolSize: number | undefined): string {
  if (poolSize === undefined) return url;
  const parsed = new URL(url);
  if (parsed.searchParams.has('connection_limit')) return url;
  parsed.searchParams.set('connection_limit', String(poolSize));
  return parsed.toString();
}

/**
 * `RTM_MAX_PRELOGIN_PER_IP` when unset (tm 405).
 *
 * What it has to leave room for is the worst legitimate case: many people
 * behind one address all reconnecting at once — an office NAT after a gateway
 * restart. The panel's first retry lands uniformly within 500 ms
 * (`apps/web/src/lib/realtime.ts`), and a socket waits only until its login is
 * answered, one round trip plus a token check. Two hundred agents behind one
 * address, each waiting ~100 ms, is about 40 at once; fifty covers that, and a
 * refused socket simply retries on the same backoff. What it costs an attacker
 * on one address: fifty sockets, each closed after the 30 s login window.
 */
export const RTM_MAX_PRELOGIN_PER_IP_DEFAULT = 50;

/** `RTM_MAX_PRELOGIN_PER_IP`, with its default and its off switch (tm 405). */
function resolvePreLoginPerIp(env: z.infer<typeof envSchema>): number | null {
  const limit = env.RTM_MAX_PRELOGIN_PER_IP ?? RTM_MAX_PRELOGIN_PER_IP_DEFAULT;
  return limit === 0 ? null : limit;
}

/**
 * `RTM_MAX_SOCKETS_PER_CUSTOMER` when unset (tm 427): one visitor's tabs. The
 * widget holds one socket per tab, and five tabs of one site open at once is a
 * lot of tabs; a sixth stays on the widget's poll, which is how every visitor
 * was served before the socket existed. What one minted token is then worth:
 * five sockets, not as many as it can open.
 */
export const RTM_MAX_SOCKETS_PER_CUSTOMER_DEFAULT = 5;

/**
 * `RTM_MAX_CUSTOMER_SOCKETS_PER_IP` when unset (tm 427): visitors behind one
 * address — an office, a school, a carrier's shared address — with the widget
 * open at the same moment, on any site this gateway serves. Fifty, the
 * pre-login cap's number: past it a visitor stays on the poll rather than
 * being turned away. Without it a fresh token per socket gets past the cap
 * above, five sockets at a time.
 */
export const RTM_MAX_CUSTOMER_SOCKETS_PER_IP_DEFAULT = 50;

/**
 * `RTM_MAX_BUFFERED_BYTES` when unset (tm 428): one mebibyte of frames the peer
 * has not read. A connected client reads as fast as its network carries, so
 * what waits is the kernel's backlog plus at most a frame or two; a socket a
 * megabyte behind is not keeping up. Closing it costs the client a reconnect
 * and a `sync`; not closing it costs this process memory without limit.
 */
export const RTM_MAX_BUFFERED_BYTES_DEFAULT = 1024 * 1024;

/** A count with a default, where `0` is the off switch (tm 427 · tm 428). */
function resolveLimit(value: number | undefined, fallback: number): number | null {
  const limit = value ?? fallback;
  return limit === 0 ? null : limit;
}

/** `RTM_DISCONNECT_OFFLINE_MS`, with its default and its off switch (tm 340.3). */
function resolveDisconnectOffline(env: z.infer<typeof envSchema>): number | null {
  const ms =
    env.RTM_DISCONNECT_OFFLINE_MS ?? (env.NODE_ENV === 'test' ? 0 : DISCONNECT_OFFLINE_DEFAULT_MS);
  return ms === 0 ? null : ms;
}

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
    runtimeDatabaseUrl: withPoolSize(
      env.DATABASE_APP_URL ?? env.DATABASE_URL,
      env.DATABASE_POOL_SIZE,
    ),
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    JWT_SIGNING_KEY_CUSTOMER: env.CUSTOMER_TOKEN_SECRET,
    shutdownDrainMs: env.SHUTDOWN_DRAIN_MS ?? (env.NODE_ENV === 'production' ? 5_000 : 0),
    maxConnections: env.RTM_MAX_CONNECTIONS ?? null,
    maxPreLoginPerIp: resolvePreLoginPerIp(env),
    maxSocketsPerCustomer: resolveLimit(
      env.RTM_MAX_SOCKETS_PER_CUSTOMER,
      RTM_MAX_SOCKETS_PER_CUSTOMER_DEFAULT,
    ),
    maxCustomerSocketsPerIp: resolveLimit(
      env.RTM_MAX_CUSTOMER_SOCKETS_PER_IP,
      RTM_MAX_CUSTOMER_SOCKETS_PER_IP_DEFAULT,
    ),
    maxBufferedBytes: resolveLimit(env.RTM_MAX_BUFFERED_BYTES, RTM_MAX_BUFFERED_BYTES_DEFAULT),
    disconnectOfflineMs: resolveDisconnectOffline(env),
    otelEnabled: env.OTEL_ENABLED ?? env.NODE_ENV !== 'test',
  };
}
