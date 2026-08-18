/**
 * The scheduler's environment contract (M-SCHED-a).
 *
 * Two things could silently drift here, and both would be invisible at runtime:
 * a job whose `SCHEDULE_<JOB>_MS` key is wired to the wrong field (a
 * copy-and-paste away, and the symptom is a sweep running on somebody else's
 * schedule), and a key that `.env.example` advertises but `env.ts` never parses.
 * The parity loop below covers the first by deriving the key name from the job
 * name rather than restating it.
 */
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../config/env.js';
import { SCHEDULER_JOB_NAMES, intervalEnvKey, jobIntervalMs, jobIntervals } from './intervals.js';

/** The minimum a boot needs, so a failure below is about the scheduler alone. */
const BASE: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://nexa:nexa@127.0.0.1:5432/nexa',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SIGNING_KEY: 'dev-only-jwt-signing-key-at-least-32-chars',
  WEBHOOK_HMAC_SEED: 'dev-only-webhook-hmac-seed-at-least-32-chars',
  CUSTOMER_TOKEN_SECRET: 'dev-only-customer-token-secret-32-chars',
  UPLOAD_SIGNING_KEY: 'dev-only-upload-signing-key-at-least-32-chars',
  AUDIT_CHAIN_SECRET: 'dev-only-audit-chain-secret-at-least-32-chars',
};

describe('the job list', () => {
  it('has an interval for every job and no interval for anything else', () => {
    expect(Object.keys(jobIntervals(parseEnv(BASE))).sort()).toEqual(
      [...SCHEDULER_JOB_NAMES].sort(),
    );
  });

  it('names the five sweeps that had no scheduler, plus webhook redelivery', () => {
    // §D113/K1's list, in one place, because a job renamed here and nowhere else
    // would leave two instances holding different locks for the same sweep.
    expect([...SCHEDULER_JOB_NAMES]).toEqual([
      'chat_timeout',
      'sla',
      'siem',
      'scheduled_reports',
      'retention',
      'webhook_redelivery',
    ]);
  });
});

describe('intervals', () => {
  it('defaults to a minute for the ones a person can feel, and an hour for retention', () => {
    expect(jobIntervals(parseEnv(BASE))).toEqual({
      chat_timeout: 60_000,
      sla: 60_000,
      siem: 300_000,
      scheduled_reports: 60_000,
      retention: 3_600_000,
      webhook_redelivery: 60_000,
    });
  });

  it('wires each job to its own environment key and to no other', () => {
    for (const job of SCHEDULER_JOB_NAMES) {
      const env = parseEnv({ ...BASE, [intervalEnvKey(job)]: '4242' });
      expect(jobIntervalMs(env, job)).toBe(4242);

      const others = SCHEDULER_JOB_NAMES.filter((name) => name !== job);
      const defaults = jobIntervals(parseEnv(BASE));
      for (const other of others) expect(jobIntervalMs(env, other)).toBe(defaults[other]);
    }
  });

  it('refuses an interval that is not a positive whole number of milliseconds', () => {
    expect(() => parseEnv({ ...BASE, SCHEDULE_SLA_MS: '0' })).toThrow(/SCHEDULE_SLA_MS/);
    expect(() => parseEnv({ ...BASE, SCHEDULE_SLA_MS: '-1' })).toThrow(/SCHEDULE_SLA_MS/);
    expect(() => parseEnv({ ...BASE, SCHEDULE_SLA_MS: 'soon' })).toThrow(/SCHEDULE_SLA_MS/);
  });
});

describe('SCHEDULER_ENABLED', () => {
  it('is off under test, so no suite has a sweep archiving its fixtures', () => {
    expect(parseEnv({ ...BASE, NODE_ENV: 'test' }).schedulerEnabled).toBe(false);
  });

  it('is on everywhere else, because that is the whole point of M-SCHED', () => {
    expect(parseEnv({ ...BASE, NODE_ENV: 'development' }).schedulerEnabled).toBe(true);
  });

  it('can be forced either way', () => {
    expect(
      parseEnv({ ...BASE, NODE_ENV: 'test', SCHEDULER_ENABLED: 'true' }).schedulerEnabled,
    ).toBe(true);
    expect(
      parseEnv({ ...BASE, NODE_ENV: 'development', SCHEDULER_ENABLED: 'false' }).schedulerEnabled,
    ).toBe(false);
  });

  it('refuses anything that is not true or false', () => {
    // A typo that parsed as "off" would leave a deployment quietly not sweeping,
    // which is the failure §D113/K1 already cost once.
    expect(() => parseEnv({ ...BASE, SCHEDULER_ENABLED: 'yes' })).toThrow(/SCHEDULER_ENABLED/);
  });
});

describe('SCHEDULE_JITTER_PCT', () => {
  it('defaults to a tenth of the interval', () => {
    expect(parseEnv(BASE).SCHEDULE_JITTER_PCT).toBe(10);
  });

  it('allows turning jitter off', () => {
    expect(parseEnv({ ...BASE, SCHEDULE_JITTER_PCT: '0' }).SCHEDULE_JITTER_PCT).toBe(0);
  });

  it('refuses a spread wide enough to reorder intervals', () => {
    expect(() => parseEnv({ ...BASE, SCHEDULE_JITTER_PCT: '80' })).toThrow(/SCHEDULE_JITTER_PCT/);
    expect(() => parseEnv({ ...BASE, SCHEDULE_JITTER_PCT: '-1' })).toThrow(/SCHEDULE_JITTER_PCT/);
  });
});
