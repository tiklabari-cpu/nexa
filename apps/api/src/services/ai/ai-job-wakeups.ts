/**
 * The AI job worker's doorbell (tm 289.3 · ADR-11a §2.4, §3.1).
 *
 * One long-lived connection of its own, `LISTEN ai_jobs`, ringing the worker
 * whenever migration 20261016140000's triggers `pg_notify` — a job enqueued, or
 * one released so its chat's next job may be due. Not Prisma's: its pool hands
 * a connection back after every query, and a `LISTEN` lives on the session.
 *
 * An accelerator, never a correctness condition. The worker polls every
 * 500 ms whatever happens here, so this never throws, never blocks a boot, and
 * a lost connection is one warning, a reconnect with backoff, and a wake-up
 * once it is back (anything committed in between is due by then).
 *
 * Behind PgBouncer in transaction mode (`pgbouncer=true` on the URL, README
 * "PgBouncer transaction-mode compatibility") a `LISTEN` is accepted and then
 * silently never delivered, so there is no doorbell at all: polling alone.
 */
import pg from 'pg';

/** The channel the triggers notify on. */
export const AI_JOBS_CHANNEL = 'ai_jobs';

/** Where `pg_stat_activity` shows the doorbell's connection. */
export const AI_JOBS_LISTENER_APPLICATION_NAME = 'siyahtus-ai-jobs';

export interface AiJobWakeups {
  /**
   * Start listening. `onWake` is called for every notification, and once
   * every time the connection (re)opens. Never throws; a second call is ignored.
   */
  start(onWake: () => void): void;
  stop(): Promise<void>;
}

export interface WakeupLogger {
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
}

export interface PgWakeupsOptions {
  /** From {@link listenConnectionString}. */
  connectionString: string;
  logger: WakeupLogger;
  /** The first reconnect delay; doubles up to {@link maxReconnectMs}. */
  reconnectMs?: number;
  maxReconnectMs?: number;
  /** A connect that has not answered by then is a failed one. */
  connectTimeoutMs?: number;
}

/** What the driver reads off a URL; the rest are Prisma's (`schema`, `connection_limit`, …). */
const DRIVER_PARAMS = new Set([
  'host',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'application_name',
  'options',
]);

/**
 * The runtime database URL as the doorbell connects with it: the same role and
 * server, Prisma's own parameters dropped, named in `pg_stat_activity`. Null
 * when the URL goes through PgBouncer in transaction mode — no doorbell then.
 */
export function listenConnectionString(databaseUrl: string): string | null {
  const url = new URL(databaseUrl);
  if (url.searchParams.get('pgbouncer') === 'true') return null;
  for (const key of [...url.searchParams.keys()]) {
    if (!DRIVER_PARAMS.has(key)) url.searchParams.delete(key);
  }
  if (!url.searchParams.has('application_name')) {
    url.searchParams.set('application_name', AI_JOBS_LISTENER_APPLICATION_NAME);
  }
  return url.toString();
}

/** A doorbell on `LISTEN ai_jobs` over its own `pg` connection. */
export function pgWakeups(options: PgWakeupsOptions): AiJobWakeups {
  const baseDelay = options.reconnectMs ?? 1_000;
  const maxDelay = options.maxReconnectMs ?? 30_000;
  let onWake: () => void = () => {};
  let client: pg.Client | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = true;
  let delay = baseDelay;
  // One warning per outage, not one per failed reconnect.
  let down = false;

  const reconnectLater = (): void => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
    timer.unref();
    delay = Math.min(delay * 2, maxDelay);
  };

  /** The connection `current` is gone: forget it and try again later. Once per connection. */
  const lost = (current: pg.Client, error: unknown): void => {
    if (client !== current) return;
    client = null;
    void current.end().catch(() => undefined);
    if (stopped) return;
    if (!down) {
      down = true;
      options.logger.warn(
        { err: error },
        'ai job wake-ups lost; the worker polls alone until they are back',
      );
    }
    reconnectLater();
  };

  async function connect(): Promise<void> {
    const current = new pg.Client({
      connectionString: options.connectionString,
      connectionTimeoutMillis: options.connectTimeoutMs ?? 10_000,
      // A peer that vanished without a FIN is noticed, rather than listened to forever.
      keepAlive: true,
    });
    current.on('error', (error) => lost(current, error));
    current.on('end', () => lost(current, new Error('connection ended')));
    current.on('notification', (message) => {
      if (message.channel === AI_JOBS_CHANNEL) onWake();
    });
    client = current;
    try {
      await current.connect();
      await current.query(`LISTEN ${AI_JOBS_CHANNEL}`);
    } catch (error) {
      lost(current, error);
      return;
    }
    if (client !== current) return;
    delay = baseDelay;
    if (down) {
      down = false;
      options.logger.info({}, 'ai job wake-ups are back');
    }
    // Whatever was enqueued while nobody was listening is due by now.
    onWake();
  }

  return {
    start(callback) {
      if (!stopped) return;
      stopped = false;
      onWake = callback;
      void connect();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const current = client;
      client = null;
      if (current) await current.end().catch(() => undefined);
    },
  };
}
