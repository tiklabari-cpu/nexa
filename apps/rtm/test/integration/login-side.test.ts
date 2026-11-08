/**
 * A credential logs in only at its own door, and only once per socket (tm 425).
 *
 * Found by the 2026-11-06 audit (F07, F26), both rooted in `login`:
 *
 *   - the door was chosen by the URL and the principal by the token, and nothing
 *     held the two together. A visitor's token — anyone's, for a page view —
 *     logged in at `/v1/agent/rtm/ws` and was addressed as an agent: the
 *     workspace-wide pushes (routing status, traffic, AI configuration) reached
 *     it;
 *   - two `login`s sent at once on one socket both passed the "already logged
 *     in?" check, both awaited their tokens, and both succeeded — the second
 *     identity replaced the first, and the actor index kept the first one's
 *     entry for as long as the process lived.
 *
 * Against a real gateway and real sockets; the gates one by one are in
 * `src/dispatcher.test.ts` and `src/auth.test.ts`.
 */
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { licenseChannel, type BusEnvelope, type PushAudience } from '@siyahtus/types';
import {
  customerToken,
  grantToken,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../helpers/fixtures.js';
import { settle, startRtm, TestSocket } from '../helpers/rtm-harness.js';

/** What a member's panel subscribes to that only people working here may hear. */
const STAFF_PUSHES = ['routing_status_set', 'traffic_visitor_updated', 'ai_config_published'];

let db: PrismaClient;
let redis: Redis;
let fx: RtmFixtures;
const customerSecret = process.env['CUSTOMER_TOKEN_SECRET'] ?? '';
const running: Array<{ close: () => Promise<void> }> = [];
const sockets: TestSocket[] = [];

beforeAll(() => {
  db = ownerClient();
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6380');
});

afterAll(async () => {
  await redis.quit();
  await db.$disconnect();
});

beforeEach(async () => {
  fx = await seedRtmFixtures(db);
});

afterEach(async () => {
  while (sockets.length > 0) sockets.pop()?.close();
  while (running.length > 0)
    await running
      .pop()
      ?.close()
      .catch(() => {});
});

async function start() {
  const rtm = await startRtm();
  running.push({ close: rtm.close });
  return rtm;
}

async function connect(
  port: number,
  side: 'agent' | 'customer',
  tenant: RtmTenant = fx.a,
): Promise<TestSocket> {
  const socket = await TestSocket.connect(port, { organizationId: tenant.organizationId, side });
  sockets.push(socket);
  return socket;
}

function visitorToken(tenant: RtmTenant = fx.a): string {
  return customerToken({
    customerId: tenant.customerId,
    organizationId: tenant.organizationId,
    licenseId: tenant.licenseId,
    secret: customerSecret,
  });
}

function memberToken(ownerId: string = fx.a.agentAccountId): Promise<string> {
  return grantToken(db, {
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
    ownerId,
    scopes: ['chats--access:rw', 'chats--all:rw'],
  });
}

async function publish(action: string, audience: PushAudience, payload: unknown): Promise<void> {
  const envelope: BusEnvelope = {
    v: 1,
    licenseId: fx.a.licenseId.toString(),
    organizationId: fx.a.organizationId,
    action: action as BusEnvelope['action'],
    audience,
    payload,
    at: Date.now(),
  };
  await redis.publish(licenseChannel(fx.a.licenseId), JSON.stringify(envelope));
}

async function until(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await delay(20);
  return check();
}

function errorOf(frame: { payload: Record<string, unknown> }) {
  return frame.payload['error'] as { type: string; message: string } | undefined;
}

describe('a credential logs in only at its own door (tm 425)', () => {
  it("refuses a visitor's token at the agent door, closes the socket with 1008, and no staff push reaches it (NFR-S3)", async () => {
    const rtm = await start();
    // A member on the same workspace, so a push that reaches nobody would not
    // pass for one that was withheld.
    const member = await connect(rtm.port, 'agent');
    expect(
      (
        await member.request('login', {
          token: `Bearer ${await memberToken()}`,
          pushes: STAFF_PUSHES,
        })
      ).success,
    ).toBe(true);

    const visitor = await connect(rtm.port, 'agent');
    const response = await visitor.request('login', {
      token: visitorToken(),
      pushes: { '3.6': STAFF_PUSHES },
    });

    expect(response.success).toBe(false);
    // Undifferentiated, like every refused credential.
    expect(errorOf(response)).toMatchObject({
      type: 'authentication',
      message: 'Invalid or expired credentials.',
    });
    expect(await visitor.waitForClose()).toBe(1008);

    await publish(
      'routing_status_set',
      { allAgents: true },
      { agent_id: fx.a.agentAccountId, status: 'not_accepting_chats' },
    );
    await member.waitForPush('routing_status_set');
    await settle();
    expect(visitor.pushes()).toEqual([]);
    // Gone from the gateway, and never indexed as anybody.
    expect(await until(() => rtm.server.registry.size === 1)).toBe(true);
    expect(rtm.server.registry.forActor(fx.a.organizationId, fx.a.customerId)).toEqual([]);
  });

  it("refuses a member's token at the customer door the same way (NFR-S3)", async () => {
    const rtm = await start();
    const socket = await connect(rtm.port, 'customer');

    const response = await socket.request('login', { token: `Bearer ${await memberToken()}` });

    expect(response.success).toBe(false);
    expect(errorOf(response)).toMatchObject({ type: 'authentication' });
    expect(await socket.waitForClose()).toBe(1008);
    expect(rtm.server.registry.forActor(fx.a.organizationId, fx.a.agentAccountId)).toEqual([]);
  });

  it('still lets a member in at the agent door and a visitor at the customer door', async () => {
    const rtm = await start();
    const member = await connect(rtm.port, 'agent');
    const visitor = await connect(rtm.port, 'customer');

    const asMember = await member.request('login', { token: `Bearer ${await memberToken()}` });
    const asVisitor = await visitor.request('login', { token: visitorToken() });

    expect(asMember.payload['my_profile']).toMatchObject({ kind: 'agent' });
    expect(asVisitor.payload['my_profile']).toMatchObject({ kind: 'customer' });
    await settle(100);
    expect(member.closed).toBe(false);
    expect(visitor.closed).toBe(false);
  });
});

describe('one login per socket, even sent twice at once (tm 425)', () => {
  it('answers two logins sent in one breath with one success and one not_allowed — one identity, one index entry', async () => {
    const rtm = await start();
    const socket = await connect(rtm.port, 'agent');
    const ownerToken = await memberToken(fx.a.ownerAccountId);
    const agentToken = await memberToken(fx.a.agentAccountId);

    // `request` writes its frame before it returns, so both are on the wire
    // before the gateway has answered either — the first one's token check is
    // a database round trip, which is the window the second one used to race.
    const [first, second] = await Promise.all([
      socket.request('login', { token: `Bearer ${ownerToken}` }),
      socket.request('login', { token: `Bearer ${agentToken}` }),
    ]);

    expect(first.success).toBe(true);
    expect(first.payload['my_profile']).toMatchObject({ id: fx.a.ownerAccountId });
    expect(second.success).toBe(false);
    expect(errorOf(second)).toEqual({
      type: 'not_allowed',
      message: 'A login is already in progress on this socket.',
      request_id: second.request_id,
    });

    expect(rtm.server.registry.actors).toBe(1);
    expect(rtm.server.registry.forActor(fx.a.organizationId, fx.a.ownerAccountId)).toHaveLength(1);
    expect(rtm.server.registry.forActor(fx.a.organizationId, fx.a.agentAccountId)).toEqual([]);

    // Logged in, the socket stays itself.
    const again = await socket.request('login', { token: `Bearer ${agentToken}` });
    expect(errorOf(again)?.message).toBe('This socket is already authenticated.');

    socket.close();
    expect(await until(() => rtm.server.registry.size === 0)).toBe(true);
    expect(rtm.server.registry.actors).toBe(0);
  });

  it('lets a socket whose login was refused log in afterwards', async () => {
    const rtm = await start();
    const socket = await connect(rtm.port, 'agent');

    expect((await socket.request('login', { token: 'Bearer not-a-real-token' })).success).toBe(
      false,
    );
    const retried = await socket.request('login', { token: `Bearer ${await memberToken()}` });
    expect(retried.success).toBe(true);
    expect(rtm.server.registry.actors).toBe(1);
  });
});
