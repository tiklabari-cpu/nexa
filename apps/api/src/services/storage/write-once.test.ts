/**
 * One use per upload grant (tm 446 · audit F43), against an in-memory Redis
 * and store — the cases a live stack cannot stage on demand: a store that
 * fails mid-write, a Redis that forgot its claim, a Redis that is gone.
 */
import { describe, expect, it, vi } from 'vitest';
import { CLAIM_GRACE_SECONDS, claimName, writeOnce, type ClaimRedis } from './write-once.js';

const NOW = 1_800_000_000;
const GRANT = {
  key: '42-0b8f6a3e-6a8e-4c39-9f2e-0d1e2f3a4b5c.png',
  contentType: 'image/png',
  sizeBytes: 4,
  expiresAt: NOW + 300,
};

/** `SET … EX … NX` and `DEL`, atomic as Redis's are (one JS turn each). */
function fakeRedis(): ClaimRedis & { held: Map<string, number> } {
  const held = new Map<string, number>();
  return {
    held,
    set: vi.fn(async (key: string, _value: string, _mode: 'EX', ttl: number, _nx: 'NX') => {
      if (held.has(key)) return null;
      held.set(key, ttl);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (held.delete(key) ? 1 : 0)),
  };
}

function fakeStore() {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    exists: vi.fn(async (key: string) => objects.has(key)),
    put: vi.fn(async (key: string, bytes: Buffer) => {
      objects.set(key, bytes);
    }),
  };
}

const log = () => ({ warn: vi.fn() });
const first = Buffer.from('aaaa');
const second = Buffer.from('bbbb');

describe('writeOnce', () => {
  it('stores the first write, refuses the second with 409 and keeps the first bytes', async () => {
    const redis = fakeRedis();
    const store = fakeStore();
    const deps = { redis, store, log: log() };

    await writeOnce(deps, GRANT, first, NOW);
    await expect(writeOnce(deps, GRANT, second, NOW)).rejects.toMatchObject({
      type: 'upload_already_written',
      status: 409,
    });

    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.objects.get(GRANT.key)).toEqual(first);
  });

  it('holds the claim until the grant expires, plus the grace for clock skew', async () => {
    const redis = fakeRedis();
    await writeOnce({ redis, store: fakeStore(), log: log() }, GRANT, first, NOW);
    expect(redis.held.get(claimName(GRANT.key))).toBe(300 + CLAIM_GRACE_SECONDS);
  });

  it('lets one of two concurrent writes through, never both', async () => {
    const store = fakeStore();
    const deps = { redis: fakeRedis(), store, log: log() };

    const results = await Promise.allSettled([
      writeOnce(deps, GRANT, first, NOW),
      writeOnce(deps, GRANT, second, NOW),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it('refuses a key the store already holds even when Redis has forgotten the claim', async () => {
    const redis = fakeRedis();
    const store = fakeStore();
    store.objects.set(GRANT.key, first);

    await expect(writeOnce({ redis, store, log: log() }, GRANT, second, NOW)).rejects.toMatchObject(
      { type: 'upload_already_written' },
    );
    expect(store.put).not.toHaveBeenCalled();
    // The claim stays: the key is spent, and the next PUT need not ask the store.
    expect(redis.held.has(claimName(GRANT.key))).toBe(true);
  });

  it('does not spend the grant on a write the store failed — the retry lands', async () => {
    const redis = fakeRedis();
    const store = fakeStore();
    const outage = new Error('bucket unreachable');
    store.put.mockRejectedValueOnce(outage);
    const deps = { redis, store, log: log() };

    await expect(writeOnce(deps, GRANT, first, NOW)).rejects.toBe(outage);
    expect(redis.held.has(claimName(GRANT.key))).toBe(false);

    await writeOnce(deps, GRANT, first, NOW);
    expect(store.objects.get(GRANT.key)).toEqual(first);
  });

  it('reports the store’s failure, not the release’s, when both fail', async () => {
    const redis = fakeRedis();
    vi.mocked(redis.del).mockRejectedValueOnce(new Error('redis gone'));
    const store = fakeStore();
    const outage = new Error('bucket unreachable');
    store.put.mockRejectedValueOnce(outage);
    const warn = log();

    await expect(writeOnce({ redis, store, log: warn }, GRANT, first, NOW)).rejects.toBe(outage);
    expect(warn.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'upload claim release failed',
    );
  });

  it('refuses with 503 and stores nothing when Redis cannot be asked', async () => {
    const redis = fakeRedis();
    vi.mocked(redis.set).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const store = fakeStore();

    await expect(writeOnce({ redis, store, log: log() }, GRANT, first, NOW)).rejects.toMatchObject({
      type: 'service_unavailable',
      status: 503,
    });
    expect(store.exists).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });
});
