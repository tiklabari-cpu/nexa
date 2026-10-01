/**
 * The `last_used_at` stamp must never be able to take the request path with it
 * (tm 256.8).
 *
 * Every authenticated request stamps its token (`TokenService.touch`), fire and
 * forget, right after `resolve()`. Fire-and-forget frees the *request* from
 * waiting — not the *pool*: the `UPDATE` borrows one of the process's pooled
 * connections and keeps it for as long as it waits. Before tm 256.8 every
 * request issued its own, so a page load's burst of parallel requests — one
 * session, one token, one row — queued one `UPDATE` per request behind that
 * row's lock, each holding a connection until the one ahead had committed and
 * flushed its WAL.
 *
 * Measured in the full e2e suite (`pg_stat_activity` sampled every 250 ms, run
 * straight after the integration suites the way the readiness check runs it):
 * 17 to 20 of the API's 29 connections parked in one such queue with two left
 * idle, the queue's head waiting on `IO:WalSync` / `LWLock:WALWrite` for up to
 * 1.4 s. One slower flush from an empty pool — and with the pool empty, the
 * next request's first query waits Prisma's `pool_timeout` (10 s) for a
 * connection and then fails: a write that answers nothing for ten seconds and
 * leaves no row, which is what the suite caught twice (`a11y.spec.ts` "the
 * skill editor", 2026-09-30; `campaigns.spec.ts`, 2026-09-15).
 *
 * The row lock is held here by an open transaction instead of a slow disk: it
 * is the deterministic way to make "the stamp ahead has not committed yet" last
 * exactly as long as the test needs. The pool is pinned small, and its timeout
 * short, so the property is about the bound — not about how many cores the
 * machine running the suite has (Prisma's default is two per core plus one).
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/crypto.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** Connections in the server's pool. Fewer than a burst, on purpose. */
const POOL_SIZE = 4;
/** Seconds Prisma waits for a free connection before failing the query. */
const POOL_TIMEOUT_SECONDS = 3;
/** A page load's worth of parallel requests — the playbook page fires 12. */
const BURST = 12;
/**
 * Well under the pool timeout: a request that had to queue for a connection
 * cannot come in under it, one that never queued always does.
 */
const PROMPT_MS = 2_000;

/** The runtime connection string with a short `pool_timeout`. */
function runtimeUrlWithPoolTimeout(): string {
  const url = new URL(process.env['DATABASE_APP_URL'] ?? process.env['DATABASE_URL'] ?? '');
  url.searchParams.set('pool_timeout', String(POOL_TIMEOUT_SECONDS));
  return url.toString();
}

describe('token last-used stamp — bounded while the token row is locked (tm 256.8)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** Ends the transaction holding the row lock; set by `lockTokenRow`. */
  let release: (() => void) | undefined;
  let holder: Promise<unknown> | undefined;

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A console session, the credential a page load's burst is made with. */
  const sessionToken = () =>
    grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--my:ro', 'agents-bot--all:rw'],
      kind: 'oauth',
    });

  const tokenRow = (token: string) =>
    owner.apiToken.findFirstOrThrow({
      where: { tokenHash: hashToken(token) },
      select: { id: true, lastUsedAt: true },
    });

  /**
   * Take the token row's lock and keep it until `release()` — what a stamp
   * whose commit is still waiting on its WAL flush looks like to every stamp
   * queued behind it. Resolves once the lock is actually held.
   */
  async function lockTokenRow(tokenId: string): Promise<Date> {
    let locked!: (at: Date) => void;
    const isLocked = new Promise<Date>((resolve) => (locked = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    holder = owner.$transaction(
      async (tx) => {
        await tx.$executeRaw`UPDATE api_tokens SET last_used_at = now() WHERE id = ${tokenId}::uuid`;
        const [row] = await tx.$queryRaw<Array<{ at: Date }>>`SELECT now() AS at`;
        locked(row!.at);
        await released;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return isLocked;
  }

  async function unlock(): Promise<void> {
    release?.();
    release = undefined;
    await holder;
    holder = undefined;
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({
      DATABASE_POOL_SIZE: String(POOL_SIZE),
      DATABASE_APP_URL: runtimeUrlWithPoolTimeout(),
    });
  });

  afterAll(async () => {
    await unlock();
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  // A failed assertion must not leave the lock behind for the next test.
  afterEach(unlock);

  it('answers a page-load burst and the write after it while the row is locked', async () => {
    const token = await sessionToken();
    const { id } = await tokenRow(token);
    await lockTokenRow(id);

    const started = Date.now();
    const burst = await Promise.all(
      Array.from({ length: BURST }, () => server.get('/auth/me', bearer(token))),
    );
    expect(burst.map((response) => response.statusCode)).toEqual(Array(BURST).fill(200));
    expect(Date.now() - started).toBeLessThan(PROMPT_MS);

    // The write the burst used to starve: before tm 256.8 it waited the pool
    // timeout for a connection and answered 500, with no row behind it.
    const writeStarted = Date.now();
    const created = await server.post('/skills', { name: 'Order status' }, bearer(token));
    expect(Date.now() - writeStarted).toBeLessThan(PROMPT_MS);
    expect(created.statusCode).toBe(201);
    const skillId = (created.json() as { id: string }).id;
    await expect(owner.skill.count({ where: { id: skillId } })).resolves.toBe(1);
  });

  it('still lands the stamp once the lock clears, and stamps again after that', async () => {
    const token = await sessionToken();
    const { id } = await tokenRow(token);
    const lockedAt = await lockTokenRow(id);

    // Made while the stamp is held up: it must land after the lock clears, not
    // be dropped on the way.
    expect((await server.get('/auth/me', bearer(token))).statusCode).toBe(200);
    await unlock();

    const stampedAfter = async (after: Date): Promise<Date> => {
      const deadline = Date.now() + 5_000;
      for (;;) {
        const { lastUsedAt } = await tokenRow(token);
        if (lastUsedAt && lastUsedAt.getTime() > after.getTime()) return lastUsedAt;
        if (Date.now() > deadline)
          throw new Error(`last_used_at never moved past ${after.toISOString()}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    const first = await stampedAfter(lockedAt);

    // A stamp that has settled must not keep suppressing the next one.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await server.get('/auth/me', bearer(token))).statusCode).toBe(200);
    await stampedAfter(first);
  });
});
