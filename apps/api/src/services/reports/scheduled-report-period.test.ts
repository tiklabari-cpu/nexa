/**
 * `periodFor` — the deduplication key and the window it labels (07.9-sched-e).
 *
 * The cases below are the ones where a plausible implementation goes wrong
 * quietly: the exact boundary instant, a month that rolls the year, February in
 * a leap year, and the two ISO weeks whose week-numbering year is not the
 * calendar year of their days. A key that is wrong in any of those does not
 * throw — it either collides with a neighbouring period (a report that is never
 * delivered again) or misses one (a report delivered twice).
 */
import { describe, expect, it } from 'vitest';
import { duePeriods, periodFor } from './scheduled-report-period.js';

/** `scheduled_report_runs_period_key_check`, copied from the migration. */
const PERIOD_KEY_CHECK = /^[0-9]{4}-(W[0-9]{2}|[0-9]{2}(-[0-9]{2})?)$/;

const at = (iso: string): Date => new Date(iso);
const iso = (date: Date): string => date.toISOString();

describe('periodFor', () => {
  describe('daily', () => {
    it('reports on yesterday, not on the part of today that has elapsed', () => {
      const period = periodFor('daily', at('2026-08-08T09:30:00.000Z'));
      expect(period.periodKey).toBe('2026-08-07');
      expect(iso(period.from)).toBe('2026-08-07T00:00:00.000Z');
      expect(iso(period.to)).toBe('2026-08-07T23:59:59.999Z');
    });

    it('still reports on yesterday at the instant the day turns over', () => {
      // Midnight belongs to the new day, so the last *complete* day is still
      // the one that just ended — an off-by-one here would deliver a period
      // that is zero seconds old and burn its key.
      const period = periodFor('daily', at('2026-08-08T00:00:00.000Z'));
      expect(period.periodKey).toBe('2026-08-07');
    });

    it('crosses a month boundary', () => {
      const period = periodFor('daily', at('2026-08-01T05:00:00.000Z'));
      expect(period.periodKey).toBe('2026-07-31');
      expect(iso(period.from)).toBe('2026-07-31T00:00:00.000Z');
    });

    it('crosses a year boundary', () => {
      const period = periodFor('daily', at('2027-01-01T00:00:01.000Z'));
      expect(period.periodKey).toBe('2026-12-31');
      expect(iso(period.to)).toBe('2026-12-31T23:59:59.999Z');
    });

    it('reports on 29 February in a leap year', () => {
      const period = periodFor('daily', at('2028-03-01T12:00:00.000Z'));
      expect(period.periodKey).toBe('2028-02-29');
      expect(iso(period.from)).toBe('2028-02-29T00:00:00.000Z');
    });
  });

  describe('weekly', () => {
    it('reports on the previous ISO week, Monday to Sunday', () => {
      // 2026-08-08 is a Saturday; its week opened Monday 2026-08-03, so the
      // last complete week is 2026-07-27 .. 2026-08-02.
      const period = periodFor('weekly', at('2026-08-08T09:30:00.000Z'));
      expect(period.periodKey).toBe('2026-W31');
      expect(iso(period.from)).toBe('2026-07-27T00:00:00.000Z');
      expect(iso(period.to)).toBe('2026-08-02T23:59:59.999Z');
    });

    it('reports on the week that just ended when swept on a Monday', () => {
      const period = periodFor('weekly', at('2026-08-03T00:00:00.000Z'));
      expect(period.periodKey).toBe('2026-W31');
      expect(iso(period.from)).toBe('2026-07-27T00:00:00.000Z');
    });

    it('labels a week by its ISO year, not the calendar year of its days', () => {
      // The week 2026-12-28 .. 2027-01-03 is 2026-W53 — 2026 has 53 ISO weeks
      // because it opens on a Thursday — even though three of its days are in
      // 2027. Labelling it `2027-…` would collide with the real 2027-W01.
      const period = periodFor('weekly', at('2027-01-04T00:00:00.000Z'));
      expect(period.periodKey).toBe('2026-W53');
      expect(iso(period.from)).toBe('2026-12-28T00:00:00.000Z');
      expect(iso(period.to)).toBe('2027-01-03T23:59:59.999Z');
    });

    it('labels a week that starts in December by the year it belongs to', () => {
      // The mirror image: 2029-12-31 is a Monday, so its week is 2030-W01.
      const period = periodFor('weekly', at('2030-01-07T12:00:00.000Z'));
      expect(period.periodKey).toBe('2030-W01');
      expect(iso(period.from)).toBe('2029-12-31T00:00:00.000Z');
      expect(iso(period.to)).toBe('2030-01-06T23:59:59.999Z');
    });
  });

  describe('monthly', () => {
    it('reports on last month', () => {
      const period = periodFor('monthly', at('2026-08-08T09:30:00.000Z'));
      expect(period.periodKey).toBe('2026-07');
      expect(iso(period.from)).toBe('2026-07-01T00:00:00.000Z');
      expect(iso(period.to)).toBe('2026-07-31T23:59:59.999Z');
    });

    it('crosses a year boundary', () => {
      const period = periodFor('monthly', at('2027-01-15T00:00:00.000Z'));
      expect(period.periodKey).toBe('2026-12');
      expect(iso(period.from)).toBe('2026-12-01T00:00:00.000Z');
      expect(iso(period.to)).toBe('2026-12-31T23:59:59.999Z');
    });

    it('ends February on the 29th in a leap year', () => {
      const period = periodFor('monthly', at('2028-03-10T00:00:00.000Z'));
      expect(period.periodKey).toBe('2028-02');
      expect(iso(period.to)).toBe('2028-02-29T23:59:59.999Z');
    });

    it('ends February on the 28th otherwise', () => {
      const period = periodFor('monthly', at('2026-03-10T00:00:00.000Z'));
      expect(period.periodKey).toBe('2026-02');
      expect(iso(period.to)).toBe('2026-02-28T23:59:59.999Z');
    });
  });

  // ==========================================================================
  // Properties the database and the claim depend on
  // ==========================================================================

  it('produces keys the database CHECK accepts', () => {
    const now = at('2027-01-04T08:00:00.000Z');
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      expect(periodFor(frequency, now).periodKey).toMatch(PERIOD_KEY_CHECK);
    }
  });

  it('always yields from < to, as scheduled_report_runs_period_range_check requires', () => {
    const now = at('2028-03-01T00:00:00.000Z');
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      const period = periodFor(frequency, now);
      expect(period.from.getTime()).toBeLessThan(period.to.getTime());
    }
  });

  it('is a function of the period, not of the moment inside it', () => {
    // Two sweeps hours apart must claim the same key, or the second mails the
    // report again. This is the single-delivery guarantee at its root.
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      const early = periodFor(frequency, at('2026-08-08T00:00:00.000Z'));
      const late = periodFor(frequency, at('2026-08-08T23:59:59.999Z'));
      expect(late).toEqual(early);
    }
  });

  it('refuses a frequency it cannot derive a period for', () => {
    expect(() => periodFor('hourly' as 'daily', at('2026-08-08T00:00:00.000Z'))).toThrow(
      RangeError,
    );
  });
});

describe('duePeriods — missed periods are caught up within a bound (tm 460)', () => {
  const keys = (periods: { periodKey: string }[]): string[] => periods.map((p) => p.periodKey);
  const LONG_AGO = at('2026-01-01T00:00:00.000Z');

  it('a schedule that has never run sends the current period only', () => {
    const due = duePeriods('daily', at('2026-11-07T09:00:00.000Z'), {
      lastClaimedFrom: null,
      enabledAt: LONG_AGO,
    });
    expect(keys(due.deliver)).toEqual(['2026-11-06']);
    expect(due.missed).toEqual([]);
  });

  it('a sweep the day after the last run has nothing to catch up', () => {
    const due = duePeriods('daily', at('2026-11-07T09:00:00.000Z'), {
      lastClaimedFrom: at('2026-11-05T00:00:00.000Z'),
      enabledAt: LONG_AGO,
    });
    expect(keys(due.deliver)).toEqual(['2026-11-06']);
  });

  it('last run 4 November, now 7 November: the 5th and the 6th, oldest first', () => {
    const due = duePeriods('daily', at('2026-11-07T09:00:00.000Z'), {
      lastClaimedFrom: at('2026-11-04T00:00:00.000Z'),
      enabledAt: LONG_AGO,
    });
    expect(keys(due.deliver)).toEqual(['2026-11-05', '2026-11-06']);
    expect(due.missed).toEqual([]);
  });

  it('ten missed days: the newest seven are mailed, the three before are recorded', () => {
    const due = duePeriods('daily', at('2026-11-11T09:00:00.000Z'), {
      lastClaimedFrom: at('2026-10-31T00:00:00.000Z'),
      enabledAt: LONG_AGO,
    });
    expect(keys(due.deliver)).toEqual([
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
    ]);
    expect(keys(due.missed)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('weekly catches up two weeks, monthly one month', () => {
    const weekly = duePeriods('weekly', at('2026-11-11T09:00:00.000Z'), {
      lastClaimedFrom: at('2026-10-05T00:00:00.000Z'), // 2026-W41
      enabledAt: LONG_AGO,
    });
    expect(keys(weekly.deliver)).toEqual(['2026-W44', '2026-W45']);
    expect(keys(weekly.missed)).toEqual(['2026-W42', '2026-W43']);

    const monthly = duePeriods('monthly', at('2026-11-11T09:00:00.000Z'), {
      lastClaimedFrom: at('2026-08-01T00:00:00.000Z'),
      enabledAt: LONG_AGO,
    });
    expect(keys(monthly.deliver)).toEqual(['2026-10']);
    expect(keys(monthly.missed)).toEqual(['2026-09']);
  });

  it('never reaches behind the moment the schedule was switched back on', () => {
    // Paused from 1 October, back on at 15:00 on 9 November: 9 November is a
    // missed delivery if the host was then down, 8 November was the pause.
    const due = duePeriods('daily', at('2026-11-11T09:00:00.000Z'), {
      lastClaimedFrom: at('2026-09-30T00:00:00.000Z'),
      enabledAt: at('2026-11-09T15:00:00.000Z'),
    });
    expect(keys(due.deliver)).toEqual(['2026-11-09', '2026-11-10']);
    expect(due.missed).toEqual([]);
  });

  it('bounds the look-back, so a year off does not record a year of rows', () => {
    const due = duePeriods('daily', at('2026-11-11T09:00:00.000Z'), {
      lastClaimedFrom: at('2025-11-01T00:00:00.000Z'),
      enabledAt: LONG_AGO,
    });
    expect(due.deliver).toHaveLength(7);
    expect(due.deliver.length + due.missed.length).toBe(92);
  });

  it('a newest run at or past the current period changes nothing — the claim decides', () => {
    const due = duePeriods('daily', at('2026-11-07T09:00:00.000Z'), {
      lastClaimedFrom: at('2026-11-20T00:00:00.000Z'),
      enabledAt: LONG_AGO,
    });
    expect(keys(due.deliver)).toEqual(['2026-11-06']);
    expect(due.missed).toEqual([]);
  });

  it('compares by instant across a change of frequency', () => {
    // Daily until 4 November, weekly since: W45 (2–8 Nov) began before the last
    // daily run, so only the current week is due.
    const due = duePeriods('weekly', at('2026-11-11T09:00:00.000Z'), {
      lastClaimedFrom: at('2026-11-04T00:00:00.000Z'),
      enabledAt: LONG_AGO,
    });
    expect(keys(due.deliver)).toEqual(['2026-W45']);
  });
});
