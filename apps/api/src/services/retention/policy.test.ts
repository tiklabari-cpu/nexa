/**
 * Retention policy maths and its one load-bearing guard.
 *
 * The cutoff is what stands between a retention sweep and a table wipe, so the
 * refusal of a non-positive window is tested as carefully as the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import {
  capRetentionForHipaa,
  cutoffFor,
  HIPAA_RETENTION_CEILING,
  resolveCutoffs,
  resolveRetentionPolicy,
  type RetentionPolicy,
} from './policy.js';

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
  it('derives all four windows from a single reference instant', () => {
    const cutoffs = resolveCutoffs(
      { threadDays: 365, visitDays: 90, mailDays: 30, auditDays: 30 },
      NOW,
    );
    expect(cutoffs.threads.getTime()).toBe(NOW.getTime() - 365 * DAY);
    expect(cutoffs.visits.getTime()).toBe(NOW.getTime() - 90 * DAY);
    expect(cutoffs.mail.getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(cutoffs.audit.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it('propagates the guard when any window is invalid', () => {
    expect(() =>
      resolveCutoffs({ threadDays: 365, visitDays: 0, mailDays: 30, auditDays: 30 }, NOW),
    ).toThrow(RangeError);
  });

  it('propagates the guard when the audit window is invalid', () => {
    expect(() =>
      resolveCutoffs({ threadDays: 365, visitDays: 90, mailDays: 30, auditDays: 0 }, NOW),
    ).toThrow(RangeError);
  });
});

describe('resolveRetentionPolicy', () => {
  it('reads the windows straight out of the environment', () => {
    expect(
      resolveRetentionPolicy({
        RETENTION_THREAD_DAYS: 200,
        RETENTION_VISIT_DAYS: 60,
        RETENTION_MAIL_DAYS: 14,
        RETENTION_AUDIT_DAYS: 45,
      }),
    ).toEqual({ threadDays: 200, visitDays: 60, mailDays: 14, auditDays: 45 });
  });

  // env.ts declares RETENTION_AUDIT_DAYS with `.default(30)` — the NFR-S12
  // "last 30 days" value. Pinned here so a change to that default is a
  // deliberate, visible edit rather than a silent drift.
  it('the NFR-S12 default (30 days) round-trips into the policy unchanged', () => {
    expect(
      resolveRetentionPolicy({
        RETENTION_THREAD_DAYS: 365,
        RETENTION_VISIT_DAYS: 90,
        RETENTION_MAIL_DAYS: 30,
        RETENTION_AUDIT_DAYS: 30,
      }).auditDays,
    ).toBe(30);
  });
});

/**
 * The HIPAA ceiling (NFR-C4 · C4-e).
 *
 * The rule is one sentence — a covered workspace may shorten a window and may
 * not lengthen one — and every case below is that sentence read from a
 * different side: above the ceiling, below it, exactly on it, and the shape
 * "unlimited" would arrive in.
 */
describe('capRetentionForHipaa', () => {
  const policy = (over: Partial<RetentionPolicy> = {}): RetentionPolicy => ({
    threadDays: 365,
    visitDays: 90,
    mailDays: 30,
    auditDays: 30,
    ...over,
  });

  it('caps a window configured above the ceiling', () => {
    // 3650 days is how "keep it forever" is actually spelled in an environment
    // that only admits positive integers — a decade, which for a conversation
    // containing PHI is the outcome the agreement exists to prevent.
    const capped = capRetentionForHipaa(policy({ threadDays: 3650, visitDays: 3650 }));

    expect(capped.threadDays).toBe(HIPAA_RETENTION_CEILING.threadDays);
    expect(capped.visitDays).toBe(HIPAA_RETENTION_CEILING.visitDays);
  });

  it('leaves a shorter window alone — the ceiling is a maximum, not a schedule', () => {
    // A covered workspace that keeps less than the ceiling is more compliant,
    // not less. Raising it to the ceiling would be this code choosing a
    // retention period for somebody's medical conversations.
    const capped = capRetentionForHipaa(policy({ threadDays: 30, visitDays: 7, mailDays: 1 }));

    expect(capped).toEqual({ threadDays: 30, visitDays: 7, mailDays: 1, auditDays: 30 });
  });

  it('is a no-op on the shipped defaults, which are the ceiling', () => {
    expect(capRetentionForHipaa(policy())).toEqual(policy());
  });

  it('never shortens the audit window — a floor, not a ceiling', () => {
    // NFR-S12 keeps 30 days of audit on every plan and HIPAA §164.316 requires
    // the access record be *kept*. Capping it would shorten the one trail an
    // investigation reads, in the name of the rule that makes the investigation
    // possible. Tested with a long window precisely because every other field
    // here would be cut back.
    const capped = capRetentionForHipaa(policy({ auditDays: 2190 }));

    expect(capped.auditDays).toBe(2190);
  });

  it('refuses an unlimited window rather than clamping it', () => {
    // NFR-C8 offers "unlimited" beside 30/60/365. Whatever shape a per-workspace
    // setting gives it, `Math.min` would return it unchanged and grant the
    // covered workspace exactly the indefinite retention the agreement forbids —
    // so it stops the sweep and says so instead.
    expect(() => capRetentionForHipaa(policy({ threadDays: Number.POSITIVE_INFINITY }))).toThrow(
      /unlimited/,
    );
    expect(() => capRetentionForHipaa(policy({ visitDays: Number.NaN }))).toThrow(RangeError);
  });

  it('names the window it refused', () => {
    // The operator reading this has four windows to look at; a message that
    // does not say which one sends them to check all four.
    expect(() => capRetentionForHipaa(policy({ mailDays: Number.POSITIVE_INFINITY }))).toThrow(
      /mailDays/,
    );
  });
});
