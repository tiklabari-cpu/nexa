/**
 * The `events` partition maintenance runner (tm 255.14 · §D187) — what a pass
 * does with each month's outcome, with the database replaced by a recorder.
 * The SQL it drives (the owner's rights, the refusals, the lock timeout, the
 * blocked month) is proved against real PostgreSQL in
 * `test/integration/event-partition-maintenance.test.ts`.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { recordingLogger } from '../../../test/helpers/scheduler.js';
import {
  EventPartitionMaintenance,
  PARTITION_MAINTENANCE_INTERVAL_MS,
  errorCodeOf,
  monthKey,
  windowMonths,
  type EventPartitionMaintenanceOptions,
} from './event-partitions.js';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const WINDOW = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];

/** The error Prisma raises for a raw query the database refused (measured shape, Prisma 6.19). */
function databaseError(sqlState: string, message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Raw query failed. Code: \`${sqlState}\`. Message: \`${message}\``,
    { code: 'P2010', clientVersion: 'test', meta: { code: sqlState, message } },
  );
}

/** Stands in for `events_ensure_partition`: records each month asked for, fails the ones named. */
function recorder(failures: Record<string, unknown> = {}) {
  const asked: Date[] = [];
  const ensureMonth = async (monthStart: Date): Promise<string> => {
    asked.push(monthStart);
    const key = monthKey(monthStart);
    if (key in failures) throw failures[key];
    return `events_${key.replace('-', '_')}`;
  };
  return { asked, keys: () => asked.map(monthKey), ensureMonth };
}

function maintenance(
  ensureMonth: EventPartitionMaintenanceOptions['ensureMonth'],
  overrides: Partial<EventPartitionMaintenanceOptions> = {},
) {
  const log = recordingLogger();
  let clock = NOW;
  const runner = new EventPartitionMaintenance({
    ensureMonth,
    logger: log.logger,
    now: () => clock,
    ...overrides,
  });
  return {
    runner,
    log,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe('the window (SEMA-MIMARI.8.4c)', () => {
  it('is the current month, one before and three after — each month by its first UTC instant', () => {
    const months = windowMonths(NOW, 1, 3);
    expect(months.map(monthKey)).toEqual(WINDOW);
    for (const month of months) expect(month.toISOString()).toMatch(/-01T00:00:00\.000Z$/);
  });

  it('crosses a year in both directions', () => {
    expect(windowMonths(new Date('2026-12-31T23:59:59.999Z'), 1, 3).map(monthKey)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
    expect(windowMonths(new Date('2027-01-01T00:00:00.000Z'), 1, 0).map(monthKey)).toEqual([
      '2026-12',
      '2027-01',
    ]);
  });

  it('refuses a window that is not a whole, non-negative number of months', () => {
    const { ensureMonth } = recorder();
    for (const bad of [{ monthsAhead: -1 }, { monthsBehind: 1.5 }, { monthsAhead: Number.NaN }]) {
      expect(() => maintenance(ensureMonth, bad)).toThrow(/whole number of months/);
    }
  });
});

describe('a pass (SEMA-MIMARI.8.4c)', () => {
  it('has nothing to report before its first pass, and says which window it keeps', () => {
    const { runner } = maintenance(recorder().ensureMonth);
    expect(runner.snapshot()).toEqual({
      interval_ms: PARTITION_MAINTENANCE_INTERVAL_MS,
      months_ahead: 3,
      months_behind: 1,
      last_run_at: null,
      last_status: null,
      consecutive_errors: 0,
      failed_months: [],
    });
    expect(PARTITION_MAINTENANCE_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('asks for every month of the window once, oldest first, and reports a clean pass quietly', async () => {
    const database = recorder();
    const { runner, log, advance } = maintenance(async (month) => {
      advance(250);
      return database.ensureMonth(month);
    });

    await runner.run();

    expect(database.keys()).toEqual(WINDOW);
    expect(runner.snapshot()).toMatchObject({
      // The clock at the end of the pass, not at its start.
      last_run_at: new Date(NOW.getTime() + 5 * 250).toISOString(),
      last_status: 'ok',
      consecutive_errors: 0,
      failed_months: [],
    });
    expect(log.lines).toEqual([]);
  });

  it('keeps going past a month that fails — a blocked month does not cost the ones after it', async () => {
    // The shape the old single `events_maintain_partitions(3, 1)` call got
    // wrong: its loop aborted at the first failure, so a blocked November also
    // meant no December — and every month after it, pass after pass.
    const database = recorder({
      '2026-11': databaseError('23514', 'events_default holds rows for 2026-11'),
    });
    const { runner, log } = maintenance(database.ensureMonth);

    await runner.run();

    expect(database.keys()).toEqual(WINDOW);
    expect(runner.snapshot()).toMatchObject({
      last_status: 'error',
      consecutive_errors: 1,
      failed_months: [{ month: '2026-11', error_code: '23514' }],
    });

    const [line, ...more] = log.at('error');
    expect(more).toEqual([]);
    expect(line?.message).toBe('event partition maintenance failed');
    expect(line?.payload).toEqual({
      window: { from: '2026-08', to: '2026-12' },
      failed_months: [
        {
          month: '2026-11',
          error_code: '23514',
          message: 'events_default holds rows for 2026-11',
        },
      ],
      consecutive_errors: 1,
    });
  });

  it('shows /health the month and the SQLSTATE, never the database’s sentence', async () => {
    const database = recorder({
      '2026-12': databaseError('42501', 'ERROR: permission denied for schema public'),
    });
    const { runner } = maintenance(database.ensureMonth);

    await runner.run();

    const [failed] = runner.snapshot().failed_months;
    expect(failed).toEqual({ month: '2026-12', error_code: '42501' });
    expect(Object.keys(failed ?? {})).toEqual(['month', 'error_code']);
  });

  it('counts failing passes in a row, and says so once when a pass is clean again', async () => {
    const failures: Record<string, unknown> = {
      '2026-12': databaseError('55P03', 'canceling statement due to lock timeout'),
    };
    const database = recorder(failures);
    const { runner, log } = maintenance(database.ensureMonth);

    await runner.run();
    await runner.run();
    expect(runner.snapshot()).toMatchObject({ last_status: 'error', consecutive_errors: 2 });
    expect(log.at('error').map((line) => line.payload['consecutive_errors'])).toEqual([1, 2]);

    delete failures['2026-12'];
    await runner.run();

    expect(runner.snapshot()).toMatchObject({
      last_status: 'ok',
      consecutive_errors: 0,
      failed_months: [],
    });
    const recovered = log.at('info');
    expect(recovered.map((line) => line.message)).toEqual([
      'event partition maintenance recovered',
    ]);
    expect(recovered[0]?.payload).toEqual({
      window: { from: '2026-08', to: '2026-12' },
      previous_consecutive_errors: 2,
    });

    await runner.run();
    expect(log.at('info')).toHaveLength(1);
  });

  it('never rejects, even when the call throws before it returns a promise', async () => {
    const { runner } = maintenance(() => {
      throw new TypeError('not even a promise');
    });

    await expect(runner.run()).resolves.toBeUndefined();
    expect(runner.snapshot()).toMatchObject({
      last_status: 'error',
      failed_months: WINDOW.map((month) => ({ month, error_code: 'TypeError' })),
    });
  });

  it('shares the pass in flight with a second caller instead of starting another beside it', async () => {
    const database = recorder();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runner } = maintenance(async (month) => {
      await gate;
      return database.ensureMonth(month);
    });

    const first = runner.run();
    const second = runner.run();
    expect(second).toBe(first);

    release();
    await Promise.all([first, second, runner.settled()]);
    expect(database.keys()).toEqual(WINDOW);

    // And once it has settled, the next call is a new pass.
    await runner.run();
    expect(database.keys()).toEqual([...WINDOW, ...WINDOW]);
  });
});

describe('errorCodeOf', () => {
  it('reads the SQLSTATE Prisma carries for a refused raw query', () => {
    expect(errorCodeOf(databaseError('42501', 'permission denied'))).toBe('42501');
    expect(errorCodeOf(databaseError('23514', 'check violation'))).toBe('23514');
  });

  it('falls back to what is safe to show when the database never answered', () => {
    const noSqlState = new Prisma.PrismaClientKnownRequestError('pool timeout', {
      code: 'P2024',
      clientVersion: 'test',
    });
    expect(errorCodeOf(noSqlState)).toBe('P2024');
    expect(
      errorCodeOf(new Prisma.PrismaClientInitializationError('unreachable', 'test', 'P1001')),
    ).toBe('P1001');
    expect(errorCodeOf(new TypeError('x'))).toBe('TypeError');
    expect(errorCodeOf('a thrown string')).toBe('string');
  });
});
