/**
 * An agent's presence, from their sockets (WG-03 · tm 340.3, `src/presence.ts`).
 *
 * Real gateways over real sockets against real Postgres and Redis, at a 600 ms
 * tolerance instead of two minutes — the derived lease (300 ms), renewal
 * (100 ms) and sweep (150 ms) scale with it, so the timings asserted here are
 * the production ones divided by 200.
 *
 * What is under test is the one thing a closed browser must not do any more:
 * stay "accepting chats". Routing hands new conversations only to
 * `accepting_chats` members (`routing-service.ts` `#candidates`), so an agent
 * this suite sees go `offline` is an agent the router stops choosing.
 */
import type { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import {
  PRESENCE_DUE_KEY,
  presenceDueMember,
  presenceSocketsKey,
  presenceTiming,
} from '../../src/presence.js';
import {
  customerToken,
  grantToken,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../helpers/fixtures.js';
import { settle, startRtm, TestSocket } from '../helpers/rtm-harness.js';

const TOLERANCE_MS = 600;
const TIMING = presenceTiming(TOLERANCE_MS);
const PRESENCE_ENV = { RTM_DISCONNECT_OFFLINE_MS: String(TOLERANCE_MS) };

describe('agent presence from sockets (tm 340.3)', () => {
  let db: PrismaClient;
  let redis: Redis;
  let rtm: Awaited<ReturnType<typeof startRtm>>;
  let fx: RtmFixtures;
  const sockets: TestSocket[] = [];
  const extraGateways: Array<Awaited<ReturnType<typeof startRtm>>> = [];
  const customerSecret = process.env['CUSTOMER_TOKEN_SECRET'] ?? '';

  beforeAll(async () => {
    db = ownerClient();
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6380');
    rtm = await startRtm(PRESENCE_ENV);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await rtm.close();
    await redis.quit();
    await db.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedRtmFixtures(db);
    // The previous test's agents are gone from the database, but not from Redis.
    await redis.del(PRESENCE_DUE_KEY);
  });

  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    for (const gateway of extraGateways.splice(0)) await gateway.close();
    // Let the closes above land before the next test truncates the tables.
    await settle(100);
  });

  async function login(
    tenant: RtmTenant,
    accountId: string,
    options: { port?: number; pushes?: string[] } = {},
  ): Promise<TestSocket> {
    const token = await grantToken(db, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: accountId,
      scopes: ['chats--access:rw'],
    });
    const socket = await TestSocket.connect(options.port ?? rtm.port, {
      organizationId: tenant.organizationId,
    });
    sockets.push(socket);
    const response = await socket.request('login', {
      token: `Bearer ${token}`,
      pushes: options.pushes ?? ['routing_status_set'],
    });
    expect(response.success).toBe(true);
    return socket;
  }

  async function statusOf(tenant: RtmTenant, accountId: string): Promise<string> {
    const membership = await db.agentMembership.findFirstOrThrow({
      where: { licenseId: tenant.licenseId, agentId: accountId },
      select: { routingStatus: true },
    });
    return membership.routingStatus;
  }

  async function presenceRows(tenant: RtmTenant, accountId: string): Promise<string[]> {
    const rows = await db.agentPresenceEvent.findMany({
      where: { licenseId: tenant.licenseId, agentId: accountId },
      orderBy: { changedAt: 'asc' },
      select: { status: true },
    });
    return rows.map((row) => row.status);
  }

  /** Polls until the agent is offline; returns how long that took. */
  async function untilOffline(tenant: RtmTenant, accountId: string, timeoutMs = 4_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if ((await statusOf(tenant, accountId)) === 'offline') return Date.now() - startedAt;
      await delay(25);
    }
    throw new Error(`still ${await statusOf(tenant, accountId)} after ${timeoutMs} ms`);
  }

  /** Long enough for any offline that was going to happen to have happened. */
  const pastTolerance = (): Promise<void> => delay(TOLERANCE_MS * 2 + TIMING.sweepMs * 2);

  it('sets a closed browser offline after the tolerance — membership, one presence row, and the roster push (FR-MOD-01.1.4)', async () => {
    const watcher = await login(fx.a, fx.a.ownerAccountId);
    const outsider = await login(fx.b, fx.b.ownerAccountId);
    const agent = await login(fx.a, fx.a.agentAccountId);

    const closedAt = Date.now();
    agent.close();

    // Not before the tolerance: a reload must not cost the agent their status.
    await delay(TOLERANCE_MS / 2);
    expect(await statusOf(fx.a, fx.a.agentAccountId)).toBe('accepting_chats');

    await untilOffline(fx.a, fx.a.agentAccountId);
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(TOLERANCE_MS);
    expect(await presenceRows(fx.a, fx.a.agentAccountId)).toEqual(['offline']);

    const push = await watcher.waitFor(
      (frame) =>
        frame.type === 'push' &&
        frame.action === 'routing_status_set' &&
        frame.payload['agent_id'] === fx.a.agentAccountId,
    );
    expect(push.payload).toEqual({
      agent_id: fx.a.agentAccountId,
      status: 'offline',
      reason: 'agent_disconnected',
      after_seconds: 1,
    });
    // Nobody else changed, and another workspace heard nothing.
    expect(await statusOf(fx.a, fx.a.ownerAccountId)).toBe('accepting_chats');
    expect(await statusOf(fx.b, fx.b.agentAccountId)).toBe('accepting_chats');
    expect(outsider.pushes('routing_status_set')).toEqual([]);
  });

  it('changes nothing when the agent is back within the tolerance', async () => {
    const watcher = await login(fx.a, fx.a.ownerAccountId);
    const first = await login(fx.a, fx.a.agentAccountId);
    first.close();
    await delay(TOLERANCE_MS / 3);
    await login(fx.a, fx.a.agentAccountId);

    await pastTolerance();
    expect(await statusOf(fx.a, fx.a.agentAccountId)).toBe('accepting_chats');
    expect(await presenceRows(fx.a, fx.a.agentAccountId)).toEqual([]);
    expect(watcher.pushes('routing_status_set')).toEqual([]);
  });

  it('keeps an agent online while a second tab is open, and starts the clock when the last one closes', async () => {
    const one = await login(fx.a, fx.a.agentAccountId);
    const two = await login(fx.a, fx.a.agentAccountId);

    one.close();
    await pastTolerance();
    expect(await statusOf(fx.a, fx.a.agentAccountId)).toBe('accepting_chats');

    const closedAt = Date.now();
    two.close();
    await untilOffline(fx.a, fx.a.agentAccountId);
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(TOLERANCE_MS);
    expect(await presenceRows(fx.a, fx.a.agentAccountId)).toEqual(['offline']);
  });

  it('counts sockets on every gateway: one open elsewhere keeps the agent online, and both gone write one row', async () => {
    const other = await startRtm(PRESENCE_ENV);
    extraGateways.push(other);

    const here = await login(fx.a, fx.a.agentAccountId);
    const there = await login(fx.a, fx.a.agentAccountId, { port: other.port });

    here.close();
    await pastTolerance();
    expect(await statusOf(fx.a, fx.a.agentAccountId)).toBe('accepting_chats');

    there.close();
    await untilOffline(fx.a, fx.a.agentAccountId);
    // Both gateways sweep the same due set; the claim lets one of them act.
    await pastTolerance();
    expect(await presenceRows(fx.a, fx.a.agentAccountId)).toEqual(['offline']);
  });

  it('stops counting the sockets of a gateway that stopped renewing them — a dead gateway costs one lease', async () => {
    const dying = await startRtm(PRESENCE_ENV);
    extraGateways.push(dying);
    await login(fx.a, fx.a.agentAccountId, { port: dying.port });
    // Connected for longer than the open's own due entry: by now a sweep has
    // found it due, seen the live lease and dropped it, so only the renewals
    // keep this agent where a sweep will look again.
    await pastTolerance();
    expect(await statusOf(fx.a, fx.a.agentAccountId)).toBe('accepting_chats');

    // What a crash leaves behind: the socket's lease in Redis, nobody renewing
    // it and nobody closing it. The socket itself stays open on purpose.
    const stoppedAt = Date.now();
    await dying.server.presence!.stop();

    await untilOffline(fx.a, fx.a.agentAccountId);
    expect(Date.now() - stoppedAt).toBeGreaterThanOrEqual(TOLERANCE_MS);
    expect(await presenceRows(fx.a, fx.a.agentAccountId)).toEqual(['offline']);
  });

  it('sets an agent who chose not to accept chats offline too, and leaves one already offline alone', async () => {
    await db.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      data: { routingStatus: 'not_accepting_chats' },
    });
    await db.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId, agentId: fx.a.outsiderAccountId },
      data: { routingStatus: 'offline' },
    });
    const watcher = await login(fx.a, fx.a.ownerAccountId);
    (await login(fx.a, fx.a.agentAccountId)).close();
    (await login(fx.a, fx.a.outsiderAccountId)).close();

    await untilOffline(fx.a, fx.a.agentAccountId);
    await pastTolerance();
    expect(await presenceRows(fx.a, fx.a.agentAccountId)).toEqual(['offline']);
    // Already offline: no row, no push — the log is a history of changes.
    expect(await presenceRows(fx.a, fx.a.outsiderAccountId)).toEqual([]);
    expect(watcher.pushes('routing_status_set').map((frame) => frame.payload['agent_id'])).toEqual([
      fx.a.agentAccountId,
    ]);
  });

  it('does not track a visitor’s socket', async () => {
    const token = customerToken({
      secret: customerSecret,
      organizationId: fx.a.organizationId,
      licenseId: fx.a.licenseId,
      customerId: fx.a.customerId,
    });
    const visitor = await TestSocket.connect(rtm.port, {
      organizationId: fx.a.organizationId,
      side: 'customer',
    });
    sockets.push(visitor);
    expect((await visitor.request('login', { token: `Bearer ${token}` })).success).toBe(true);
    visitor.close();
    await pastTolerance();

    expect(await redis.zcard(PRESENCE_DUE_KEY)).toBe(0);
    expect(await redis.exists(presenceSocketsKey(fx.a.licenseId.toString(), fx.a.customerId))).toBe(
      0,
    );
  });

  it('never leaves a socket that closed during its login counted', async () => {
    const token = await grantToken(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--access:rw'],
    });
    const socket = await TestSocket.connect(rtm.port, { organizationId: fx.a.organizationId });
    // The login is in flight when the socket goes; whichever finishes first,
    // nothing may keep renewing a socket nobody holds.
    void socket.request('login', { token: `Bearer ${token}` }).catch(() => undefined);
    socket.close();

    await delay(TIMING.leaseMs * 3);
    const key = presenceSocketsKey(fx.a.licenseId.toString(), fx.a.agentAccountId);
    expect(await redis.zcount(key, Date.now(), '+inf')).toBe(0);
  });

  it('puts an agent whose sockets are all gone in the due set, and takes them out when one opens', async () => {
    const member = presenceDueMember({
      licenseId: fx.a.licenseId.toString(),
      organizationId: fx.a.organizationId,
      agentId: fx.a.agentAccountId,
    });
    const socket = await login(fx.a, fx.a.agentAccountId);
    await settle(50);
    // Connected: due no earlier than the lease plus the tolerance.
    const connected = Number(await redis.zscore(PRESENCE_DUE_KEY, member));
    expect(connected).toBeGreaterThanOrEqual(Date.now() + TOLERANCE_MS);

    const closedAt = Date.now();
    socket.close();
    await settle(50);
    const pending = Number(await redis.zscore(PRESENCE_DUE_KEY, member));
    expect(pending).toBeGreaterThanOrEqual(closedAt + TOLERANCE_MS);
    expect(pending).toBeLessThan(closedAt + TOLERANCE_MS + 200);

    await login(fx.a, fx.a.agentAccountId);
    await settle(50);
    expect(Number(await redis.zscore(PRESENCE_DUE_KEY, member))).toBeGreaterThan(pending);
  });

  it('keeps a connected agent online when an entry comes due early — another gateway’s clock is not the truth', async () => {
    const member = presenceDueMember({
      licenseId: fx.a.licenseId.toString(),
      organizationId: fx.a.organizationId,
      agentId: fx.a.agentAccountId,
    });
    await login(fx.a, fx.a.agentAccountId);
    await settle(50);
    await redis.zadd(PRESENCE_DUE_KEY, Date.now() - 1, member);

    // Swept at once, before a renewal can raise the entry again: the claim
    // itself has to see the live lease.
    expect(await rtm.server.presence!.sweep()).toBe(0);
    expect(await statusOf(fx.a, fx.a.agentAccountId)).toBe('accepting_chats');

    await pastTolerance();
    expect(await statusOf(fx.a, fx.a.agentAccountId)).toBe('accepting_chats');
    expect(await presenceRows(fx.a, fx.a.agentAccountId)).toEqual([]);
    // The claim dropped the early entry; the renewal put the agent back.
    expect(Number(await redis.zscore(PRESENCE_DUE_KEY, member))).toBeGreaterThan(Date.now());
  });

  it('does nothing on a gateway where the tolerance is off', async () => {
    const off = await startRtm({ RTM_DISCONNECT_OFFLINE_MS: '0' });
    extraGateways.push(off);
    expect(off.server.presence).toBeNull();

    (await login(fx.a, fx.a.outsiderAccountId, { port: off.port })).close();
    await pastTolerance();
    expect(await statusOf(fx.a, fx.a.outsiderAccountId)).toBe('accepting_chats');
    expect(await redis.zcard(PRESENCE_DUE_KEY)).toBe(0);
  });
});
