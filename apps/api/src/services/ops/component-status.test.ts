/**
 * The component status record (tm 389.8) against an in-memory hash — the Redis behaviour itself
 * is exercised end to end in `test/integration/platform-dashboard.test.ts`.
 */
import { OPS_COMPONENTS } from '@siyahtus/types';
import { describe, expect, it, vi } from 'vitest';
import {
  COMPONENT_DETAIL_MAX,
  emptyComponentStatuses,
  OPS_COMPONENTS_KEY,
  readComponentStatuses,
  reportComponentNotInstalled,
  reportComponentStatus,
} from './component-status.js';

function fakeRedis() {
  const hash: Record<string, string> = {};
  return {
    hash,
    hset: vi.fn(async (_key: string, field: string, value: string) => {
      hash[field] = value;
      return 1;
    }),
    hgetall: vi.fn(async () => ({ ...hash })),
  };
}

describe('reportComponentStatus', () => {
  it('writes one JSON document per component under the record key', async () => {
    const redis = fakeRedis();
    const ok = await reportComponentStatus(redis, 'geoip', {
      state: 'not_installed',
      detail: '  no database file  ',
      updatedAt: '2026-10-26T10:00:00.000Z',
    });

    expect(ok).toBe(true);
    expect(redis.hset).toHaveBeenCalledWith(OPS_COMPONENTS_KEY, 'geoip', expect.any(String));
    expect(JSON.parse(redis.hash['geoip']!)).toEqual({
      state: 'not_installed',
      detail: 'no database file',
      updatedAt: '2026-10-26T10:00:00.000Z',
    });
  });

  it('caps the detail and stamps the time when none is given', async () => {
    const redis = fakeRedis();
    await reportComponentStatus(redis, 'mail', { state: 'ok', detail: 'x'.repeat(1000) });
    const stored = JSON.parse(redis.hash['mail']!) as { detail: string; updatedAt: string };
    expect(stored.detail).toHaveLength(COMPONENT_DETAIL_MAX);
    expect(Number.isNaN(Date.parse(stored.updatedAt))).toBe(false);
  });

  it('refuses a key outside the closed list and a state outside the vocabulary', async () => {
    const redis = fakeRedis();
    expect(await reportComponentStatus(redis, 'made_up' as never, { state: 'ok' })).toBe(false);
    expect(await reportComponentStatus(redis, 'mail', { state: 'fine' as never })).toBe(false);
    expect(redis.hset).not.toHaveBeenCalled();
  });

  it('never throws, so a caller inside a request cannot be taken down by the record', async () => {
    const redis = fakeRedis();
    redis.hset.mockRejectedValue(new Error('connection lost'));
    const debug = vi.fn();
    await expect(reportComponentStatus(redis, 'mail', { state: 'down' }, { debug })).resolves.toBe(
      false,
    );
    expect(debug).toHaveBeenCalledOnce();
  });
});

describe('readComponentStatuses', () => {
  it('lists every component in the closed order, unknown where nothing reported', async () => {
    const redis = fakeRedis();
    await reportComponentStatus(redis, 'redis', { state: 'ok', detail: '0.5 ms' });

    const all = await readComponentStatuses(redis);
    expect(all.map((c) => c.key)).toEqual([...OPS_COMPONENTS]);
    expect(all.find((c) => c.key === 'redis')).toMatchObject({ state: 'ok', detail: '0.5 ms' });
    expect(all.find((c) => c.key === 'mail')).toEqual({
      key: 'mail',
      state: 'unknown',
      detail: null,
      updated_at: null,
    });
  });

  it('reads a field that is not valid JSON, or names no state, as unknown', async () => {
    const redis = fakeRedis();
    redis.hash['mail'] = '{oops';
    redis.hash['db'] = '{"state":"on fire"}';
    redis.hash['unlisted'] = '{"state":"ok"}';

    const all = await readComponentStatuses(redis);
    expect(all.find((c) => c.key === 'mail')?.state).toBe('unknown');
    expect(all.find((c) => c.key === 'db')?.state).toBe('unknown');
    expect(all).toHaveLength(OPS_COMPONENTS.length);
  });

  it('has an empty list for a reader that could not reach Redis', () => {
    expect(emptyComponentStatuses().every((c) => c.state === 'unknown')).toBe(true);
  });
});

describe('reportComponentNotInstalled (tm 389.14)', () => {
  function hashRedis() {
    const hash: Record<string, string> = {};
    return {
      hash,
      hsetnx: vi.fn(async (_key: string, field: string, value: string) => {
        if (field in hash) return 0;
        hash[field] = value;
        return 1;
      }),
    };
  }

  it('writes the placeholder only while nothing has reported', async () => {
    const redis = hashRedis();
    redis.hash['doc_worker'] = JSON.stringify({ state: 'ok', detail: 'real', updatedAt: 'x' });

    await reportComponentNotInstalled(redis, 'doc_worker', 'not in this build');
    await reportComponentNotInstalled(redis, 'knowledge_jobs', 'not in this build');

    // The module that reported for itself keeps its word; the silent one is marked.
    expect(JSON.parse(redis.hash['doc_worker']!)).toMatchObject({ state: 'ok', detail: 'real' });
    expect(JSON.parse(redis.hash['knowledge_jobs']!)).toMatchObject({
      state: 'not_installed',
      detail: 'not in this build',
    });
  });

  it('refuses a key the record does not list, and swallows a Redis failure', async () => {
    const redis = hashRedis();
    expect(await reportComponentNotInstalled(redis, 'nope' as never, 'x')).toBe(false);
    redis.hsetnx.mockRejectedValueOnce(new Error('down'));
    expect(await reportComponentNotInstalled(redis, 'geoip', 'x')).toBe(false);
  });
});
