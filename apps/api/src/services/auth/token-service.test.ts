import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { TokenService } from './token-service.js';

/**
 * A database whose `last_used_at` stamps settle only when the test says so —
 * the shape of a stamp still queued behind the token row's lock.
 */
function stampingDb() {
  const pending: Array<{ land: () => void; fail: (error: Error) => void }> = [];
  const $executeRaw = vi.fn(
    () =>
      new Promise<number>((resolve, reject) => {
        pending.push({ land: () => resolve(1), fail: reject });
      }),
  );
  return { db: { $executeRaw } as unknown as PrismaClient, $executeRaw, pending };
}

/** Let the stamp's `.catch`/`.finally` chain run. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

/** The token id a stamp was sent for — the tagged template's one value. */
const stampedIds = (fn: ReturnType<typeof stampingDb>['$executeRaw']) =>
  fn.mock.calls.map((call) => (call as unknown[])[1]);

describe('TokenService.touch — one last-used stamp in flight per token (tm 256.8)', () => {
  it('sends one stamp for a burst made with one token', () => {
    const { db, $executeRaw } = stampingDb();
    const tokens = new TokenService(db);

    for (let i = 0; i < 12; i++) tokens.touch('t-1');

    expect(stampedIds($executeRaw)).toEqual(['t-1']);
  });

  it('stamps each token on its own, so one session cannot hold up another', () => {
    const { db, $executeRaw } = stampingDb();
    const tokens = new TokenService(db);

    tokens.touch('t-1');
    tokens.touch('t-2');
    tokens.touch('t-1');

    expect(stampedIds($executeRaw)).toEqual(['t-1', 't-2']);
  });

  it('stamps again once the stamp in flight has landed', async () => {
    const { db, $executeRaw, pending } = stampingDb();
    const tokens = new TokenService(db);

    tokens.touch('t-1');
    pending[0]!.land();
    await settled();
    tokens.touch('t-1');

    expect(stampedIds($executeRaw)).toEqual(['t-1', 't-1']);
  });

  it('stamps again after a failed stamp, and the failure never reaches the caller', async () => {
    const { db, $executeRaw, pending } = stampingDb();
    const tokens = new TokenService(db);

    tokens.touch('t-1');
    // An unhandled rejection here would fail the run on its own.
    pending[0]!.fail(new Error('pool timeout'));
    await settled();
    tokens.touch('t-1');

    expect(stampedIds($executeRaw)).toEqual(['t-1', 't-1']);
  });
});
