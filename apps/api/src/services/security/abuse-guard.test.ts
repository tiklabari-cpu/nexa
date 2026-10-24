/**
 * The widget's risk signals (tm 339.2 · GV-01), without a server: where each
 * threshold sits, how long a pass lasts, what a verdict does at the door, and
 * that Redis being away is no signal rather than a closed door.
 */
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { ApiError } from '../../lib/api-error.js';
import {
  AbuseGuard,
  assessRisk,
  passedRecently,
  type RiskSignals,
  type RiskThresholds,
} from './abuse-guard.js';
import { MockCaptchaVerifier } from './captcha.js';

const DEFAULTS: RiskThresholds = { newCustomersPerIp: 30, messagesPerMinute: 20, aiTurnsToday: 20 };
const QUIET: RiskSignals = { newCustomersFromIp: 0, messagesLastMinute: 1, aiTurnsToday: 0 };
const log = { warn: vi.fn() };

describe('assessRisk — the thresholds (GV-01)', () => {
  it('flags nobody at a normal pace: one visitor, one message, no AI yet', () => {
    expect(assessRisk(QUIET, DEFAULTS)).toBeNull();
  });

  it('lets an address open 30 new visitors in the window and asks the 31st', () => {
    expect(assessRisk({ ...QUIET, newCustomersFromIp: 29 }, DEFAULTS)).toBeNull();
    expect(assessRisk({ ...QUIET, newCustomersFromIp: 30 }, DEFAULTS)).toBe('new_customers_per_ip');
  });

  it('lets a visitor send 20 messages a minute and asks at the 21st', () => {
    expect(assessRisk({ ...QUIET, messagesLastMinute: 20 }, DEFAULTS)).toBeNull();
    expect(assessRisk({ ...QUIET, messagesLastMinute: 21 }, DEFAULTS)).toBe('messages_per_minute');
  });

  it('asks a member who has had 20 AI turns today, not one who has had 19', () => {
    expect(assessRisk({ ...QUIET, aiTurnsToday: 19 }, DEFAULTS)).toBeNull();
    expect(assessRisk({ ...QUIET, aiTurnsToday: 20 }, DEFAULTS)).toBe('ai_turns_today');
  });

  it('names the address first when several signals fire', () => {
    expect(
      assessRisk({ newCustomersFromIp: 99, messagesLastMinute: 99, aiTurnsToday: 99 }, DEFAULTS),
    ).toBe('new_customers_per_ip');
  });

  it('reads an unreadable signal (null) as no signal', () => {
    expect(
      assessRisk(
        { newCustomersFromIp: null, messagesLastMinute: null, aiTurnsToday: null },
        DEFAULTS,
      ),
    ).toBeNull();
  });
});

describe('passedRecently — a pass lasts 12 hours', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  it('spares a member who passed 11 h 59 min ago and asks one who passed 12 h ago', () => {
    expect(passedRecently(new Date('2026-10-24T00:01:00Z'), now)).toBe(true);
    expect(passedRecently(new Date('2026-10-24T00:00:00Z'), now)).toBe(false);
    expect(passedRecently(null, now)).toBe(false);
  });
});

describe('AbuseGuard.decide — a flagged request', () => {
  const guard = new AbuseGuard({} as Redis, new MockCaptchaVerifier(), DEFAULTS);

  it('goes through with a pass, through without AI when the provider gave no verdict', () => {
    expect(guard.decide('new_customers_per_ip', 'passed', log)).toBe('passed');
    expect(guard.decide('new_customers_per_ip', 'unavailable', log)).toBe('withhold');
  });

  it('is refused challenge_required with its reason, or challenge_failed for a refused token', () => {
    const refusal = (verdict: 'failed' | null) => {
      try {
        guard.decide('messages_per_minute', verdict, log);
      } catch (error) {
        return error as ApiError;
      }
      throw new Error('not refused');
    };
    const asked = refusal(null);
    expect(asked.type).toBe('challenge_required');
    expect(asked.status).toBe(403);
    expect(asked.details).toEqual({
      reason: 'messages_per_minute',
      provider: 'mock',
      site_key: 'mock-site-key',
    });
    expect(refusal('failed').details).toMatchObject({ reason: 'challenge_failed' });
  });

  it('asks nothing while the deployment has no provider or the workspace is off', () => {
    expect(new AbuseGuard({} as Redis, null, DEFAULTS).asks('risk')).toBe(false);
    expect(guard.asks('off')).toBe(false);
    expect(guard.asks('risk')).toBe(true);
    expect(guard.asks('always_on_chat_start')).toBe(true);
  });
});

describe('AbuseGuard with Redis away', () => {
  const broken = {
    multi: () => {
      throw new Error('ECONNREFUSED');
    },
    set: () => Promise.reject(new Error('ECONNREFUSED')),
    exists: () => Promise.reject(new Error('ECONNREFUSED')),
  } as unknown as Redis;
  const guard = new AbuseGuard(broken, new MockCaptchaVerifier(), DEFAULTS);

  it('reads every counter as unreadable — no check is asked on it — and never throws', async () => {
    expect(await guard.newCustomersFromIp(1n, '203.0.113.9', log)).toBeNull();
    expect(await guard.recordMessage(1n, 'c', log)).toBeNull();
    await expect(guard.recordNewCustomer(1n, '203.0.113.9', log)).resolves.toBeUndefined();
    await expect(guard.withholdAi(1n, 'c', log)).resolves.toBeUndefined();
    expect(await guard.isAiWithheld(1n, 'c')).toBe(false);
  });
});
