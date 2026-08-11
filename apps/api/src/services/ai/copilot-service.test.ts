/**
 * The window arithmetic behind Copilot's BI command (12.4-bi-c).
 *
 * `resolveBiQuestion` deliberately knows no clock — it names a window
 * ("last week") and leaves the dates to the caller. This is that caller, and
 * the dates are where a BI answer can be quietly wrong in a way nobody
 * double-checks: "how many chats closed yesterday" answered over the wrong
 * 24 hours still reads like a report.
 *
 * Pinned against a fixed instant rather than `new Date()`, so the assertions
 * are the real boundaries and not whatever day the suite runs on.
 */
import { describe, expect, it } from 'vitest';
import type { RelativeRange } from '@nexa/ai-mock';
import { biWindow } from './copilot-service.js';

/** A Saturday, mid-morning UTC. Its ISO week opened Monday 2026-08-03. */
const SATURDAY = new Date('2026-08-08T09:30:00.000Z');
const DAY_MS = 86_400_000;

describe('biWindow', () => {
  it.each<[RelativeRange, string, string]>([
    // A period still running ends *now*, never at its calendar end: reporting
    // "today" up to midnight would quote hours that have not happened.
    ['today', '2026-08-08T00:00:00.000Z', SATURDAY.toISOString()],
    ['this_week', '2026-08-03T00:00:00.000Z', SATURDAY.toISOString()],
    ['this_month', '2026-08-01T00:00:00.000Z', SATURDAY.toISOString()],
    ['last_7_days', '2026-08-01T09:30:00.000Z', SATURDAY.toISOString()],
    ['last_30_days', '2026-07-09T09:30:00.000Z', SATURDAY.toISOString()],
    // A completed period ends on its last millisecond — the interval every
    // report aggregation closes at both ends.
    ['yesterday', '2026-08-07T00:00:00.000Z', '2026-08-07T23:59:59.999Z'],
    ['last_week', '2026-07-27T00:00:00.000Z', '2026-08-02T23:59:59.999Z'],
  ])('resolves %s', (range, from, to) => {
    const window = biWindow(range, SATURDAY);
    expect(window.from.toISOString()).toBe(from);
    expect(window.to.toISOString()).toBe(to);
  });

  it('falls back to the report default (30 days) when the question named no window', () => {
    // Identical to `last_30_days` on purpose: both go through `resolveRange`, so
    // "the last 30 days" has one definition shared with every report route.
    expect(biWindow(null, SATURDAY)).toEqual(biWindow('last_30_days', SATURDAY));
  });

  it('opens the week on Monday, on both edges of it', () => {
    // The (day + 6) % 7 shift is the classic off-by-one here: getUTCDay() is
    // Sunday-first, ISO weeks are not.
    const monday = new Date('2026-08-03T00:00:00.000Z');
    expect(biWindow('this_week', monday).from.toISOString()).toBe('2026-08-03T00:00:00.000Z');

    const sunday = new Date('2026-08-09T23:00:00.000Z');
    expect(biWindow('this_week', sunday).from.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(biWindow('last_week', sunday).to.toISOString()).toBe('2026-08-02T23:59:59.999Z');
  });

  it('crosses a month boundary without a special case', () => {
    const firstOfMonth = new Date('2026-08-01T00:00:30.000Z');
    expect(biWindow('yesterday', firstOfMonth).from.toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(biWindow('this_month', firstOfMonth).from.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('crosses a year boundary without a special case', () => {
    const newYearsDay = new Date('2027-01-01T05:00:00.000Z');
    expect(biWindow('yesterday', newYearsDay).from.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(biWindow('this_month', newYearsDay).from.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('never returns an inverted or empty window, for any range', () => {
    // `resolveReportQuery` rejects `from > to` with a 400; a window this
    // function built must never be the thing that trips it.
    const ranges: Array<RelativeRange | null> = [
      null,
      'today',
      'yesterday',
      'this_week',
      'last_week',
      'this_month',
      'last_7_days',
      'last_30_days',
    ];
    // Just past midnight is the tightest case: "today" is then ~1ms wide.
    for (const now of [SATURDAY, new Date('2026-08-08T00:00:00.001Z')]) {
      for (const range of ranges) {
        const window = biWindow(range, now);
        expect(window.from.getTime(), `${String(range)} @ ${now.toISOString()}`).toBeLessThan(
          window.to.getTime(),
        );
        expect(window.to.getTime() - window.from.getTime()).toBeLessThanOrEqual(31 * DAY_MS);
      }
    }
  });
});
