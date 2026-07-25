/**
 * Retention policy maths and its one load-bearing guard.
 *
 * The cutoff is what stands between a retention sweep and a table wipe, so the
 * refusal of a non-positive window is tested as carefully as the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { cutoffFor, resolveCutoffs, resolveRetentionPolicy } from './policy.js';

const NOW = new Date('2026-07-25T00:00:00.000Z');
const DAY = 86_400_000;

describe('cutoffFor', () => {
  it('returns the instant exactly N days before now', () => {
    expect(cutoffFor(30, NOW).toISOString()).toBe('2026-06-25T00:00:00.000Z');
    expect(cutoffFor(1, NOW).getTime()).toBe(NOW.getTime() - DAY);
    expect(cutoffFor(365, NOW).getTime()).toBe(NOW.getTime() - 365 * DAY);
  });

  it('never returns an instant at or after now', () => {
    // The whole point: a valid window always puts the cutoff strictly in the past.
    expect(cutoffFor(1, NOW).getTime()).toBeLessThan(NOW.getTime());
  });

  it('refuses a non-positive or non-integer window — the table-wipe guard', () => {
    // Zero or a negative window would place the cutoff at/after now and match
    // every row; a fractional window is a sign of a bad coercion. All rejected.
    expect(() => cutoffFor(0, NOW)).toThrow(RangeError);
    expect(() => cutoffFor(-5, NOW)).toThrow(RangeError);
    expect(() => cutoffFor(1.5, NOW)).toThrow(RangeError);
    expect(() => cutoffFor(Number.NaN, NOW)).toThrow(RangeError);
  });
});

describe('resolveCutoffs', () => {
  it('derives all three windows from a single reference instant', () => {
    const cutoffs = resolveCutoffs({ threadDays: 365, visitDays: 90, mailDays: 30 }, NOW);
    expect(cutoffs.threads.getTime()).toBe(NOW.getTime() - 365 * DAY);
    expect(cutoffs.visits.getTime()).toBe(NOW.getTime() - 90 * DAY);
    expect(cutoffs.mail.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it('propagates the guard when any window is invalid', () => {
    expect(() => resolveCutoffs({ threadDays: 365, visitDays: 0, mailDays: 30 }, NOW)).toThrow(
      RangeError,
    );
  });
});

describe('resolveRetentionPolicy', () => {
  it('reads the windows straight out of the environment', () => {
    expect(
      resolveRetentionPolicy({
        RETENTION_THREAD_DAYS: 200,
        RETENTION_VISIT_DAYS: 60,
        RETENTION_MAIL_DAYS: 14,
      }),
    ).toEqual({ threadDays: 200, visitDays: 60, mailDays: 14 });
  });
});
