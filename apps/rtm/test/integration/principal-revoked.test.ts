/**
 * A credential the API stopped honouring closes the sockets it opened (tm 426.1).
 *
 * The 2026-11-06 audit's F08: the gateway checked a socket's credential at
 * `login` and, after that, only re-derived its reach when the permission matrix
 * moved. A member removed from the workspace, a session signed out, a workspace
 * suspended — each refused on the REST edge from the commit on — kept every tab
 * already open, and the tab kept receiving the workspace's conversations.
 *
 * The API now announces it on the licence's bus channel (`principal_revoked`),
 * after its commit. Until its own revocation points do (tm 426.2) this suite
 * publishes the envelope itself (`helpers/bus.ts`), after committing the change
 * the way the API will. Against a real gateway and real sockets:
 *
 *   - a token envelope closes only the socket that logged in with it — the same
 *     member's other session stays;
 *   - an agent envelope closes every socket of that member, each session;
 *   - a licence envelope closes every agent-door socket of the licence, and
 *     nothing of another licence; a visitor's socket stays, its token being
 *     signed rather than stored;
 *   - a push published after the envelope reaches no closed socket;
 *   - the reconnect is refused at `login`, with the reason;
 *   - a closed socket whose peer never answers the close takes no more requests.
 *
 * The gates one by one: `src/revocation.test.ts`, `src/fanout.test.ts`,
 * `src/dispatcher.test.ts`.
 */
import type { Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { Redis } from 'ioredis';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, principalRevokedEnvelope, typingStateKey } from '@siyahtus/types';
import { publishPush, publishRevocation } from '../helpers/bus.js';
import {
  createConversation,
  customerToken,
  grantTokenRow,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../helpers/fixtures.js';
import { settle, startRtm, TestSocket, type Frame } from '../helpers/rtm-harness.js';
import { CREDENTIAL_REVOKED_CLOSE_CODE } from '../../src/revocation.js';
import { createTelemetry, type Telemetry } from '../../src/telemetry/telemetry.js';

let db: PrismaClient;
let redis: Redis;
let fx: RtmFixtures;
const customerSecret = process.env['CUSTOMER_TOKEN_SECRET'] ?? '';
const running: Array<{ close: () => Promise<void> }> = [];
const sockets: TestSocket[] = [];
const clients: WebSocket[] = [];

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
  while (clients.length > 0) clients.pop()?.terminate();
  while (sockets.length > 0) sockets.pop()?.close();
  while (running.length > 0)
    await running
      .pop()
      ?.close()
      .catch(() => {});
});

async function start(telemetry?: Telemetry) {
  const rtm = await startRtm({}, undefined, telemetry);
  running.push({ close: rtm.close });
  return rtm;
}

type Rtm = Awaited<ReturnType<typeof start>>;

/** A member's socket at the agent door, logged in and listening for `incoming_event`. */
async function member(rtm: Rtm, tenant: RtmTenant, ownerId: string) {
  const credential = await grantTokenRow(db, {
    licenseId: tenant.licenseId,
    organizationId: tenant.organizationId,
    ownerId,
    scopes: ['chats--access:rw', 'chats--all:rw'],
  });
  const socket = await TestSocket.connect(rtm.port, {
    organizationId: tenant.organizationId,
    side: 'agent',
  });
  sockets.push(socket);
  const answer = await socket.request('login', {
    token: `Bearer ${credential.token}`,
    pushes: ['incoming_event'],
  });
  expect(answer.success).toBe(true);
  return { socket, ...credential };
}

/** The tenant's visitor at the customer door, logged in. */
async function visitor(rtm: Rtm, tenant: RtmTenant): Promise<TestSocket> {
  const socket = await TestSocket.connect(rtm.port, {
    organizationId: tenant.organizationId,
    side: 'customer',
  });
  sockets.push(socket);
  const token = customerToken({
    customerId: tenant.customerId,
    organizationId: tenant.organizationId,
    licenseId: tenant.licenseId,
    secret: customerSecret,
  });
  expect((await socket.request('login', { token, pushes: ['incoming_event'] })).success).toBe(true);
  return socket;
}

/** What the client does after a close it did not ask for: a new socket, the same token. */
async function reconnect(rtm: Rtm, tenant: RtmTenant, token: string): Promise<Frame> {
  const socket = await TestSocket.connect(rtm.port, {
    organizationId: tenant.organizationId,
    side: 'agent',
  });
  sockets.push(socket);
  return socket.request('login', { token: `Bearer ${token}` });
}

function pushToEveryone(tenant: RtmTenant, text: string): Promise<void> {
  return publishPush(redis, tenant, 'incoming_event', { allAgents: true }, { chat_id: 'C1', text });
}

function errorOf(frame: Frame) {
  return frame.payload['error'] as { type: string; details?: { reason?: string } } | undefined;
}

async function until(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await delay(20);
  return check();
}

function closedCounted(metrics: ResourceMetrics[], reason: string): number {
  const latest = metrics[metrics.length - 1];
  if (!latest) return 0;
  let total = 0;
  for (const scope of latest.scopeMetrics) {
    for (const metric of scope.metrics) {
      if (metric.descriptor.name !== 'rtm.connections.closed') continue;
      for (const point of metric.dataPoints) {
        if (point.attributes['reason'] === reason) total += point.value as number;
      }
    }
  }
  return total;
}

describe('principal_revoked closes the sockets it names (tm 426.1)', () => {
  it("closes with 4401 only the socket that logged in with a revoked token — the member's other session and a colleague keep hearing — and the token is refused on reconnect (NFR-S2)", async () => {
    const rtm = await start();
    const signedOut = await member(rtm, fx.a, fx.a.ownerAccountId);
    const otherSession = await member(rtm, fx.a, fx.a.ownerAccountId);
    const colleague = await member(rtm, fx.a, fx.a.agentAccountId);

    // As the API does it: the commit, then the announcement.
    await db.apiToken.update({ where: { id: signedOut.id }, data: { revokedAt: new Date() } });
    await publishRevocation(redis, fx.a, { kind: 'token', tokenId: signedOut.id });
    // Published after the revocation, on the same channel: it arrives after it.
    await pushToEveryone(fx.a, 'after the sign-out');

    expect(await signedOut.socket.waitForClose()).toBe(CREDENTIAL_REVOKED_CLOSE_CODE);
    expect(CREDENTIAL_REVOKED_CLOSE_CODE).toBe(4401);
    await otherSession.socket.waitForPush('incoming_event');
    await colleague.socket.waitForPush('incoming_event');
    expect(signedOut.socket.pushes()).toEqual([]);
    expect(otherSession.socket.closed).toBe(false);
    expect(colleague.socket.closed).toBe(false);
    expect(await until(() => rtm.server.registry.size === 2)).toBe(true);

    // The client reconnects, as it does on any close it did not ask for.
    const again = await reconnect(rtm, fx.a, signedOut.token);
    expect(again.success).toBe(false);
    expect(errorOf(again)?.type).toBe('authentication');
  });

  it("closes every socket of a member whose membership was suspended — each session — and no colleague's; the next login is refused (NFR-S2)", async () => {
    const rtm = await start();
    const tab = await member(rtm, fx.a, fx.a.agentAccountId);
    const phone = await member(rtm, fx.a, fx.a.agentAccountId);
    const owner = await member(rtm, fx.a, fx.a.ownerAccountId);

    await db.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      data: { suspended: true },
    });
    await publishRevocation(redis, fx.a, { kind: 'agent', agentId: fx.a.agentAccountId });
    await pushToEveryone(fx.a, 'after the suspension');

    expect(await tab.socket.waitForClose()).toBe(CREDENTIAL_REVOKED_CLOSE_CODE);
    expect(await phone.socket.waitForClose()).toBe(CREDENTIAL_REVOKED_CLOSE_CODE);
    await owner.socket.waitForPush('incoming_event');
    expect(tab.socket.pushes()).toEqual([]);
    expect(phone.socket.pushes()).toEqual([]);
    expect(owner.socket.closed).toBe(false);
    expect(
      await until(
        () => rtm.server.registry.forActor(fx.a.organizationId, fx.a.agentAccountId).length === 0,
      ),
    ).toBe(true);

    const again = await reconnect(rtm, fx.a, phone.token);
    expect(errorOf(again)?.type).toBe('authentication');
  });

  it("closes every agent-door socket of a suspended workspace and nothing of another; the workspace's visitor stays, and the reconnect is told why (NFR-S2 · NFR-S4)", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = createTelemetry({
      serviceName: 'siyahtus-rtm-test',
      serviceVersion: '0.0.0-test',
      metricExporter: exporter,
    });
    const rtm = await start(telemetry);
    const owner = await member(rtm, fx.a, fx.a.ownerAccountId);
    const agent = await member(rtm, fx.a, fx.a.agentAccountId);
    const guest = await visitor(rtm, fx.a);
    const elsewhere = await member(rtm, fx.b, fx.b.agentAccountId);

    await db.license.update({
      where: { id: fx.a.licenseId },
      data: { status: 'suspended', suspendedAt: new Date(), suspendedReason: 'abuse review' },
    });
    await publishRevocation(redis, fx.a, { kind: 'license' });
    await publishPush(
      redis,
      fx.a,
      'incoming_event',
      { customerId: fx.a.customerId },
      { chat_id: 'C1', text: 'to the visitor' },
    );
    await pushToEveryone(fx.b, 'the other workspace');

    expect(await owner.socket.waitForClose()).toBe(CREDENTIAL_REVOKED_CLOSE_CODE);
    expect(await agent.socket.waitForClose()).toBe(CREDENTIAL_REVOKED_CLOSE_CODE);
    // A visitor's token is signed, not stored: a widget closed for it would
    // only log straight back in.
    await guest.waitForPush('incoming_event');
    await elsewhere.socket.waitForPush('incoming_event');
    expect(guest.closed).toBe(false);
    expect(elsewhere.socket.closed).toBe(false);

    const again = await reconnect(rtm, fx.a, owner.token);
    expect(errorOf(again)).toMatchObject({
      type: 'not_allowed',
      details: { reason: 'workspace_suspended' },
    });

    // Counted by what the gateway decided, not by the code it shares with the
    // login window.
    expect(
      await until(
        () =>
          rtm.server.registry.forActor(fx.a.organizationId, fx.a.ownerAccountId).length === 0 &&
          rtm.server.registry.forActor(fx.a.organizationId, fx.a.agentAccountId).length === 0,
      ),
    ).toBe(true);
    await telemetry.flushMetrics();
    expect(closedCounted(exporter.getMetrics(), 'credential_revoked')).toBe(2);
    expect(closedCounted(exporter.getMetrics(), 'identity_timeout')).toBe(0);
  });

  it('closes nothing for an envelope about another licence — on its own channel, or carried on this one (NFR-S4)', async () => {
    const rtm = await start();
    const here = await member(rtm, fx.a, fx.a.agentAccountId);
    const there = await member(rtm, fx.b, fx.b.agentAccountId);

    // B's licence naming A's member: not B's member, so nothing of B closes either.
    await publishRevocation(redis, fx.b, { kind: 'agent', agentId: fx.a.agentAccountId });
    // B's licence, on A's channel: an envelope acts only on the licence it came for.
    await redis.publish(
      licenseChannel(fx.a.licenseId),
      JSON.stringify(principalRevokedEnvelope(fx.b, { kind: 'license' })),
    );
    await pushToEveryone(fx.a, 'still here');
    await pushToEveryone(fx.b, 'still here');

    await here.socket.waitForPush('incoming_event');
    await there.socket.waitForPush('incoming_event');
    await settle();
    expect(here.socket.closed).toBe(false);
    expect(there.socket.closed).toBe(false);
  });
});

/**
 * An agent client whose TCP reads can be stopped: it never sees the gateway's
 * close frame, so it never answers it, and the gateway's side stays open-ish
 * until `ws`'s close timeout — while this client can still send.
 */
class DeafClient {
  readonly frames: Frame[] = [];
  #counter = 0;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      this.frames.push(JSON.parse(raw.toString()) as Frame);
    });
  }

  static open(port: number, organizationId: string): Promise<DeafClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/v1/agent/rtm/ws?organization_id=${organizationId}`,
      );
      clients.push(ws);
      const client = new DeafClient(ws);
      ws.on('open', () => resolve(client));
      ws.on('error', reject);
    });
  }

  send(action: string, payload: Record<string, unknown>): string {
    const requestId = `deaf-${++this.#counter}`;
    this.ws.send(JSON.stringify({ version: '3.6', request_id: requestId, action, payload }));
    return requestId;
  }

  async request(action: string, payload: Record<string, unknown>): Promise<Frame> {
    const requestId = this.send(action, payload);
    const deadline = Date.now() + 5_000;
    for (;;) {
      const answer = this.frames.find((frame) => frame.request_id === requestId);
      if (answer) return answer;
      if (Date.now() > deadline) throw new Error(`no answer to ${action}`);
      await delay(10);
    }
  }

  stopReading(): void {
    (this.ws as unknown as { _socket: Socket })._socket.pause();
  }
}

describe('a socket closed for a revoked credential (tm 426.1)', () => {
  it('takes no more requests while its peer has not answered the close (NFR-S2)', async () => {
    const rtm = await start();
    const { chatId, threadId } = await createConversation(db, {
      tenant: fx.a,
      agentIds: [fx.a.agentAccountId],
    });
    await db.thread.update({ where: { id: threadId }, data: { assigneeId: fx.a.agentAccountId } });
    const credential = await grantTokenRow(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--access:rw'],
    });
    const client = await DeafClient.open(rtm.port, fx.a.organizationId);
    expect((await client.request('login', { token: `Bearer ${credential.token}` })).success).toBe(
      true,
    );
    const [connection] = rtm.server.registry.forActor(fx.a.organizationId, fx.a.agentAccountId);

    // While the credential stands, the assignee's typing reaches the visitor's poll.
    const flag = typingStateKey(fx.a.licenseId, chatId);
    const typing = { chat_id: chatId, is_typing: true };
    expect((await client.request('send_typing_indicator', typing)).success).toBe(true);
    expect(await redis.exists(flag)).toBe(1);
    await redis.del(flag);

    client.stopReading();
    await db.apiToken.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
    await publishRevocation(redis, fx.a, { kind: 'token', tokenId: credential.id });
    expect(await until(() => connection?.closedBy === 'credential_revoked')).toBe(true);

    // The peer never read the close frame; it is still sending.
    client.send('send_typing_indicator', typing);
    await settle(500);
    expect(await redis.exists(flag)).toBe(0);
    // Still waiting on the peer, not gone: what held it was the socket's state.
    expect(rtm.server.registry.get(connection!.id)).toBe(connection);
  });
});
