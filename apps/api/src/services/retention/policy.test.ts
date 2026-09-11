/**
 * Retention policy maths and its one load-bearing guard.
 *
 * The cutoff is what stands between a retention sweep and a table wipe, so the
 * refusal of a non-positive window is tested as carefully as the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import {
  applyTenantWindows,
  capRetentionForHipaa,
  cutoffFor,
  cutoffForWindow,
  HIPAA_RETENTION_CEILING,
  hipaaCeilingDays,
  readTenantWindow,
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
    expect(cutoffs.threads?.getTime()).toBe(NOW.getTime() - 365 * DAY);
    expect(cutoffs.visits?.getTime()).toBe(NOW.getTime() - 90 * DAY);
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

  it('clamps a deliberate "unlimited" to the ceiling rather than aborting the run', () => {
    // NFR-C8 offers "unlimited" beside 30/60/365, and since tm 241 a workspace
    // can actually choose it — which means it can be chosen *before* a BAA is
    // signed and still be sitting there afterwards. That is an ordinary
    // sequence of user actions, not a bug, so the sweep applies the ceiling
    // instead of throwing: throwing would abort the whole run and leave every
    // OTHER workspace unswept in order to punish this one. The write path is
    // where the refusal belongs (`PATCH /settings/retention`), because that is
    // where there is an admin to tell.
    const capped = capRetentionForHipaa(
      policy({ threadDays: 'unlimited', visitDays: 'unlimited' }),
    );

    expect(capped.threadDays).toBe(HIPAA_RETENTION_CEILING.threadDays);
    expect(capped.visitDays).toBe(HIPAA_RETENTION_CEILING.visitDays);
  });

  it('still refuses a non-finite NUMBER — that is arithmetic junk, not a choice', () => {
    // The distinction the string sentinel buys. `Infinity`/`NaN` cannot be
    // selected by anyone; they are a bad coercion, and a sweep proceeding under
    // a policy nobody chose is worse than a sweep that stops. `'unlimited'`
    // above is a deliberate answer and is treated as one.
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

/**
 * Per-workspace windows (NFR-C8) — the three layers, and the order they apply in.
 *
 * The requirement's word is "yapılandırılabilir": the deployment default is a
 * fallback, not the answer. What has to be provable here is that a workspace's
 * own choice actually reaches the sweep, that "no choice" is a different state
 * from "unlimited", and that the HIPAA ceiling is still the last word.
 */
describe('applyTenantWindows (NFR-C8)', () => {
  const DEPLOYMENT: RetentionPolicy = {
    threadDays: 365,
    visitDays: 90,
    mailDays: 30,
    auditDays: 30,
  };

  it('leaves the deployment default in place when the workspace has chosen nothing', () => {
    expect(applyTenantWindows(DEPLOYMENT, { threadWindow: null, visitWindow: null })).toEqual(
      DEPLOYMENT,
    );
  });

  it('applies the workspace’s own tier over the default', () => {
    const policy = applyTenantWindows(DEPLOYMENT, { threadWindow: '30d', visitWindow: '60d' });

    expect(policy.threadDays).toBe(30);
    expect(policy.visitDays).toBe(60);
  });

  it('moves one window without disturbing the other', () => {
    // The `null` = "leave alone" half of the contract. A workspace setting only
    // its conversation window must not have its telemetry window reset with it.
    const policy = applyTenantWindows(DEPLOYMENT, { threadWindow: '60d', visitWindow: null });

    expect(policy.threadDays).toBe(60);
    expect(policy.visitDays).toBe(90);
  });

  it('never touches the mail or audit windows — they are not per workspace', () => {
    // `mailDays`: the spool files carry no licence, so there is nothing to look
    // a choice up against. `auditDays`: NFR-S12 floors the trail at 30 days on
    // every plan, and a workspace that could shorten the record of its own
    // deletions is precisely the "erişim ≠ silme" hole NFR-C8 names.
    const policy = applyTenantWindows(DEPLOYMENT, { threadWindow: '30d', visitWindow: '30d' });

    expect(policy.mailDays).toBe(DEPLOYMENT.mailDays);
    expect(policy.auditDays).toBe(DEPLOYMENT.auditDays);
  });

  it('carries "unlimited" through as itself, not as a number', () => {
    const policy = applyTenantWindows(DEPLOYMENT, { threadWindow: 'unlimited', visitWindow: null });

    expect(policy.threadDays).toBe('unlimited');
    // The defect this shape exists to prevent, asserted on the value: 0 would
    // put the cutoff at "now" and delete everything the switch was meant to
    // protect.
    expect(policy.threadDays).not.toBe(0);
  });

  it('applies the HIPAA ceiling LAST, so it outranks the workspace’s choice', () => {
    // Order is the design: choice over default, ceiling over choice. A covered
    // workspace asking for unlimited retention of conversations gets 365.
    const chosen = applyTenantWindows(DEPLOYMENT, {
      threadWindow: 'unlimited',
      visitWindow: '365d',
    });

    expect(capRetentionForHipaa(chosen)).toEqual({
      threadDays: 365,
      visitDays: 90,
      mailDays: 30,
      auditDays: 30,
    });
  });

  it('a shorter choice survives the ceiling — it is a maximum, not a schedule', () => {
    const chosen = applyTenantWindows(DEPLOYMENT, { threadWindow: '30d', visitWindow: '30d' });

    expect(capRetentionForHipaa(chosen).threadDays).toBe(30);
    expect(capRetentionForHipaa(chosen).visitDays).toBe(30);
  });
});

describe('readTenantWindow', () => {
  it('accepts the four tiers', () => {
    expect(readTenantWindow('30d')).toBe('30d');
    expect(readTenantWindow('unlimited')).toBe('unlimited');
  });

  it('reads an unknown or absent value as "no choice"', () => {
    // The rollout case CONVENTIONS §6.3 is about: a replica of the previous
    // release meeting a row a newer one wrote. Falling back to the deployment
    // default keeps the sweep running under a window somebody configured;
    // raising would stop retention for every workspace because one of them used
    // a tier this build has not shipped yet.
    expect(readTenantWindow('90d')).toBeNull();
    expect(readTenantWindow(null)).toBeNull();
    expect(readTenantWindow(undefined)).toBeNull();
    // And never as zero, which is the value the sweep's guard refuses.
    expect(readTenantWindow('0')).toBeNull();
  });
});

describe('cutoffForWindow', () => {
  it('is the ordinary cutoff for a finite window', () => {
    expect(cutoffForWindow(30, NOW)?.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it('returns null for an unlimited window — no cutoff at all', () => {
    // Not a very old date, and not epoch: a caller has to *branch*, and null is
    // the only value that will not survive a `<` comparison by accident.
    expect(cutoffForWindow('unlimited', NOW)).toBeNull();
  });

  it('still refuses a zero or negative window', () => {
    expect(() => cutoffForWindow(0, NOW)).toThrow(RangeError);
    expect(() => cutoffForWindow(-1, NOW)).toThrow(RangeError);
  });
});

describe('resolveCutoffs with an unlimited window', () => {
  it('hands back a null cutoff for the unlimited class and real ones for the rest', () => {
    const cutoffs = resolveCutoffs(
      { threadDays: 'unlimited', visitDays: 90, mailDays: 30, auditDays: 30 },
      NOW,
    );

    expect(cutoffs.threads).toBeNull();
    expect(cutoffs.visits?.getTime()).toBe(NOW.getTime() - 90 * DAY);
    // The two windows that are never per-workspace keep their cutoffs: choosing
    // unlimited conversations does not switch off the audit window NFR-S12
    // floors.
    expect(cutoffs.audit.getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(cutoffs.mail.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });
});

describe('hipaaCeilingDays', () => {
  it('is null when nothing caps the workspace', () => {
    expect(hipaaCeilingDays('threadDays', false)).toBeNull();
    expect(hipaaCeilingDays('visitDays', false)).toBeNull();
  });

  it('is the ceiling under HIPAA scope', () => {
    expect(hipaaCeilingDays('threadDays', true)).toBe(365);
    expect(hipaaCeilingDays('visitDays', true)).toBe(90);
  });
});
