/**
 * One send per idempotency key at a time (tm 448 · audit F27), against an
 * in-memory Redis — the orderings a live stack cannot stage on demand: the
 * holder finishing between a poll and the next, a holder that outlived its
 * flight, a release Redis refuses. The two send paths against the real Redis
 * and Postgres: `test/integration/idempotency-in-flight.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  claimFlight,
  FLIGHT_POLL_MS,
  FLIGHT_POLLS,
  FLIGHT_TTL_SECONDS,
  flightName,
  type FlightRedis,
} from './idempotency-flight.js';

/** `SET … EX … NX` and the release script, atomic as Redis's are (one JS turn each). */
function fakeRedis(): FlightRedis & { held: Map<string, string>; ttls: number[] } {
  const held = new Map<string, string>();
  const ttls: number[] = [];
  return {
    held,
    ttls,
    set: vi.fn(async (key: string, value: string, _mode: 'EX', ttl: number, _nx: 'NX') => {
      if (held.has(key)) return null;
      held.set(key, value);
      ttls.push(ttl);
      return 'OK';
    }),
    eval: vi.fn(async (_script: string, _numKeys: number, ...args: Array<string | number>) => {
      const [key, token] = args as [string, string];
      if (held.get(key) !== token) return 0;
      held.delete(key);
      return 1;
    }),
  };
}

const NAME = flightName(7n, { chatId: 'CHAT1' }, 'key-1');
const noSleep = async (): Promise<void> => {};
const nothing = async (): Promise<null> => null;

describe('claimFlight', () => {
  it('claims a free key for its TTL and gives it back on release', async () => {
    const redis = fakeRedis();

    const claim = await claimFlight(redis, NAME, nothing, { sleep: noSleep });

    expect('flight' in claim).toBe(true);
    expect(redis.held.has(NAME)).toBe(true);
    expect(redis.ttls).toEqual([FLIGHT_TTL_SECONDS]);
    if ('flight' in claim) await claim.flight.release();
    expect(redis.held.has(NAME)).toBe(false);
  });

  it('refuses a key in flight with 409 idempotency_in_flight after its polls, writing nothing', async () => {
    const redis = fakeRedis();
    const holder = await claimFlight(redis, NAME, nothing, { sleep: noSleep });
    const sleep = vi.fn(noSleep);
    const finished = vi.fn(nothing);

    await expect(claimFlight(redis, NAME, finished, { sleep })).rejects.toMatchObject({
      type: 'idempotency_in_flight',
      status: 409,
      headers: { 'Retry-After': '1' },
    });

    // Three short looks, each asking whether the holder's event is in.
    expect(sleep).toHaveBeenCalledTimes(FLIGHT_POLLS);
    expect(sleep).toHaveBeenCalledWith(FLIGHT_POLL_MS);
    expect(finished).toHaveBeenCalledTimes(FLIGHT_POLLS);
    // The holder's flight is untouched.
    expect('flight' in holder && redis.held.get(NAME)).toBeTruthy();
  });

  it('replays the holder’s event when it lands during the wait', async () => {
    const redis = fakeRedis();
    await claimFlight(redis, NAME, nothing, { sleep: noSleep });
    let polls = 0;
    // The holder commits during the second wait; its flight is not given back yet.
    const finished = vi.fn(async () => (polls >= 2 ? 'EVENT1' : null));
    const sleep = vi.fn(async () => {
      polls += 1;
    });

    const claim = await claimFlight(redis, NAME, finished, { sleep });

    expect(claim).toEqual({ replay: 'EVENT1' });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('takes the key over when the holder gave it back without an event (its send failed)', async () => {
    const redis = fakeRedis();
    const holder = await claimFlight(redis, NAME, nothing, { sleep: noSleep });
    const sleep = vi.fn(async () => {
      if ('flight' in holder) await holder.flight.release();
    });

    const claim = await claimFlight(redis, NAME, nothing, { sleep });

    expect('flight' in claim).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('replays, and gives the flight back, when the holder finished just before the claim', async () => {
    // The caller read "no event", then the holder committed, remembered its
    // event and released — all before this claim. Claiming must look again.
    const redis = fakeRedis();

    const claim = await claimFlight(redis, NAME, async () => 'EVENT1', { sleep: noSleep });

    expect(claim).toEqual({ replay: 'EVENT1' });
    expect(redis.held.has(NAME)).toBe(false);
  });

  it('gives the flight back when the read after the claim fails', async () => {
    const redis = fakeRedis();
    const failing = async (): Promise<null> => {
      throw new Error('redis read failed');
    };

    await expect(claimFlight(redis, NAME, failing, { sleep: noSleep })).rejects.toThrow(
      'redis read failed',
    );
    expect(redis.held.has(NAME)).toBe(false);
  });

  it('does not release a flight that has since passed to another request', async () => {
    const redis = fakeRedis();
    const stale = await claimFlight(redis, NAME, nothing, { sleep: noSleep });
    // Its TTL lapsed and a second request claimed the key.
    redis.held.set(NAME, 'successor-token');

    if ('flight' in stale) await stale.flight.release();

    expect(redis.held.get(NAME)).toBe('successor-token');
  });

  it('propagates a claim Redis refuses — the request fails rather than writing unguarded', async () => {
    const redis = fakeRedis();
    redis.set = vi.fn(async () => {
      throw new Error('connection closed');
    });

    await expect(claimFlight(redis, NAME, nothing, { sleep: noSleep })).rejects.toThrow(
      'connection closed',
    );
  });

  it('swallows a failed release (the flight lapses with its TTL)', async () => {
    const redis = fakeRedis();
    redis.eval = vi.fn(async () => {
      throw new Error('connection closed');
    });
    const claim = await claimFlight(redis, NAME, nothing, { sleep: noSleep });

    await expect('flight' in claim ? claim.flight.release() : null).resolves.toBeUndefined();
  });

  it('constructs with a Redis double that cannot release', async () => {
    const redis = fakeRedis();
    delete redis.eval;
    const claim = await claimFlight(redis, NAME, nothing, { sleep: noSleep });

    await expect('flight' in claim ? claim.flight.release() : null).resolves.toBeUndefined();
    expect(redis.held.has(NAME)).toBe(true);
  });
});

describe('flightName', () => {
  it('scopes a key per workspace and per chat or member', () => {
    expect(flightName(7n, { chatId: 'CHAT1' }, 'k')).toBe('idem-flight:7:chat:CHAT1:k');
    expect(flightName(7n, { customerId: 'c-1' }, 'k')).toBe('idem-flight:7:customer:c-1:k');
    expect(flightName(8n, { chatId: 'CHAT1' }, 'k')).not.toBe(
      flightName(7n, { chatId: 'CHAT1' }, 'k'),
    );
  });
});
