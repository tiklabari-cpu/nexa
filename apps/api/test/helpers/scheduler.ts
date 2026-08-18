/**
 * Test doubles for the background job scheduler (M-SCHED-a).
 *
 * Two of them, for two different questions:
 *
 *   - {@link FakeRedis} stands in for the sliver of Redis the job lock uses. The
 *     lock's real behaviour is proved against a real Redis in
 *     `test/integration/scheduler-lock.test.ts`; this exists for the unit suite,
 *     where the question is about the *scheduler* — does a thrown job stop its
 *     neighbours, does a failing one escalate — and where a network round trip
 *     under a fake clock would only add flakes. Its expiry reads `Date.now()`,
 *     so it follows vitest's fake timers the way Redis follows the wall clock.
 *   - {@link recordingLogger} keeps what was logged, because the level a
 *     scheduler chooses is part of its contract: a sweep that has failed three
 *     times in a row has to be louder than one that failed once.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { LockRedis } from '../../src/services/scheduler/lock.js';

interface Entry {
  value: string;
  expiresAt: number;
}

export class FakeRedis implements LockRedis {
  readonly #store = new Map<string, Entry>();

  /** Set to make every command reject — the "Redis is unreachable" path. */
  failWith: Error | null = null;

  /**
   * Awaited before every command. Lets a test suspend the store mid-command and
   * so drive the one race worth driving: a scheduler that stops between taking
   * a lock and using it.
   */
  gate: Promise<void> | null = null;

  /** How many locks were actually taken, across every key. */
  acquired = 0;

  async set(
    key: string,
    value: string,
    _millisecondsToken: 'PX',
    milliseconds: number,
    _nx: 'NX',
  ): Promise<'OK' | null> {
    await this.#ready();
    if (this.#live(key) !== null) return null;
    this.#store.set(key, { value, expiresAt: Date.now() + milliseconds });
    this.acquired += 1;
    return 'OK';
  }

  /** Only ever called with the release script, so the script text is ignored. */
  async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    await this.#ready();
    const key = String(args[0]);
    const token = String(args[1]);
    if (this.#live(key)?.value !== token) return 0;
    this.#store.delete(key);
    return 1;
  }

  /** Whoever holds `key` right now, or null when free or expired. */
  holder(key: string): string | null {
    return this.#live(key)?.value ?? null;
  }

  #live(key: string): Entry | null {
    const entry = this.#store.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= Date.now()) {
      this.#store.delete(key);
      return null;
    }
    return entry;
  }

  async #ready(): Promise<void> {
    if (this.gate !== null) await this.gate;
    if (this.failWith !== null) throw this.failWith;
  }
}

export interface LogLine {
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  payload: Record<string, unknown>;
  message: string | undefined;
}

export interface RecordingLogger {
  logger: FastifyBaseLogger;
  lines: LogLine[];
  /** Lines at one level, newest last. */
  at(level: LogLine['level']): LogLine[];
}

export function recordingLogger(): RecordingLogger {
  const lines: LogLine[] = [];
  const record =
    (level: LogLine['level']) =>
    (payload: unknown, message?: string): void => {
      lines.push({
        level,
        payload: typeof payload === 'object' && payload !== null ? { ...payload } : { payload },
        message,
      });
    };

  const logger: Record<string, unknown> = {
    level: 'trace',
    silent: () => {},
    fatal: record('fatal'),
    error: record('error'),
    warn: record('warn'),
    info: record('info'),
    debug: record('debug'),
    trace: record('trace'),
  };
  // The scheduler hands each job a child logger tagged with its name; returning
  // the same recorder keeps every line in one list to assert against.
  logger['child'] = () => logger;

  return {
    logger: logger as unknown as FastifyBaseLogger,
    lines,
    at: (level) => lines.filter((line) => line.level === level),
  };
}

/** A silent logger, for suites that care about behaviour rather than output. */
export function silentLogger(): FastifyBaseLogger {
  return recordingLogger().logger;
}
