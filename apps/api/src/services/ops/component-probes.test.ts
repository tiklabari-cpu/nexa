/**
 * What the health leader says about the modules it can see (tm 389.14).
 * Pure functions of a status object, so the whole matrix is cheap to cover.
 */
import { describe, expect, it } from 'vitest';
import type { GeoStatus } from '../geo/geo-locator.js';
import {
  AI_JOBS_DEGRADED_AFTER_S,
  AI_JOBS_DOWN_AFTER_S,
  aiJobsProbe,
  captchaProbe,
  COMPONENTS_NOT_IN_THIS_BUILD,
  GEOIP_STALE_AFTER_DAYS,
  geoipProbe,
  webhooksProbe,
} from './component-probes.js';
import { OPS_COMPONENTS } from '@siyahtus/types';

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const DAY = 86_400_000;

function geoOk(ageDays: number): GeoStatus {
  return {
    state: 'ok',
    detail: {
      db_type: 'DBIP-Country-Lite',
      db_version: '2026-08-01',
      built_at: new Date(NOW - ageDays * DAY).toISOString(),
    },
  };
}

describe('geoipProbe', () => {
  it('is ok with the file, its type, version and age', () => {
    expect(geoipProbe(geoOk(10), NOW)).toEqual({
      key: 'geoip',
      state: 'ok',
      detail: 'DBIP-Country-Lite 2026-08-01 · 10 days old',
    });
  });

  it('degrades once the file is older than the runbook allows', () => {
    expect(geoipProbe(geoOk(GEOIP_STALE_AFTER_DAYS), NOW).state).toBe('ok');
    expect(geoipProbe(geoOk(GEOIP_STALE_AFTER_DAYS + 1), NOW)).toMatchObject({
      state: 'degraded',
      detail: expect.stringContaining('91 days old'),
    });
  });

  it('is not_installed with no file configured, and down when the file cannot be read', () => {
    expect(
      geoipProbe(
        { state: 'disabled', detail: { db_type: null, db_version: null, built_at: null } },
        NOW,
      ),
    ).toMatchObject({ state: 'not_installed' });
    expect(
      geoipProbe(
        {
          state: 'error',
          detail: { db_type: null, db_version: null, built_at: null, error: 'bad magic' },
        },
        NOW,
      ),
    ).toEqual({ key: 'geoip', state: 'down', detail: 'bad magic' });
  });

  it('copes with a file that carries no build date', () => {
    const status = geoOk(0);
    status.detail.built_at = null;
    expect(geoipProbe(status, NOW)).toMatchObject({
      state: 'ok',
      detail: 'DBIP-Country-Lite 2026-08-01',
    });
  });
});

describe('captchaProbe', () => {
  it('is not_installed with the provider off', () => {
    expect(captchaProbe('none', false)).toMatchObject({ key: 'captcha', state: 'not_installed' });
  });

  it('degrades when a provider is named but cannot run', () => {
    expect(captchaProbe('turnstile', false)).toMatchObject({ state: 'degraded' });
  });

  it('is ok with a usable provider and says only that keys are set, never which', () => {
    const result = captchaProbe('turnstile', true);
    expect(result).toEqual({ key: 'captcha', state: 'ok', detail: 'turnstile, keys set' });
  });
});

describe('aiJobsProbe', () => {
  it('says nothing when the queue could not be read', () => {
    expect(aiJobsProbe(null)).toBeNull();
  });

  it('is ok while the oldest owed reply is fresh, or there is none', () => {
    expect(aiJobsProbe({ pending: 0, running: 0, oldest_age_s: null })).toMatchObject({
      state: 'ok',
    });
    expect(
      aiJobsProbe({ pending: 3, running: 1, oldest_age_s: AI_JOBS_DEGRADED_AFTER_S }),
    ).toMatchObject({ state: 'ok', detail: '3 pending, 1 running' });
  });

  it('degrades, then goes down, as the oldest reply waits', () => {
    expect(
      aiJobsProbe({ pending: 3, running: 0, oldest_age_s: AI_JOBS_DEGRADED_AFTER_S + 1 }),
    ).toMatchObject({ state: 'degraded' });
    expect(
      aiJobsProbe({ pending: 3, running: 0, oldest_age_s: AI_JOBS_DOWN_AFTER_S + 1 }),
    ).toMatchObject({ state: 'down' });
  });
});

describe('webhooksProbe', () => {
  const job = (overrides: Record<string, unknown>) => ({
    name: 'webhook_redelivery',
    interval_ms: 60_000,
    enabled: true,
    last_run_at: null,
    last_status: 'ok' as const,
    ...overrides,
  });

  it('follows the redelivery sweep', () => {
    expect(webhooksProbe([job({})])).toMatchObject({ key: 'webhooks', state: 'ok' });
    expect(
      webhooksProbe([
        job({ last_status: 'error', last_error_class: 'PrismaClientKnownRequestError' }),
      ]),
    ).toMatchObject({
      state: 'degraded',
      detail: expect.stringContaining('PrismaClientKnownRequestError'),
    });
    expect(webhooksProbe([job({ enabled: false })])).toMatchObject({ state: 'not_installed' });
  });

  it('says nothing when the job is not registered', () => {
    expect(webhooksProbe([])).toBeNull();
  });
});

describe('COMPONENTS_NOT_IN_THIS_BUILD', () => {
  it('names real component keys, each once', () => {
    const keys = COMPONENTS_NOT_IN_THIS_BUILD.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(OPS_COMPONENTS).toContain(key);
  });
});
