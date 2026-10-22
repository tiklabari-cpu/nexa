/**
 * The gateway under the permission matrix (tm 325.3 · SiyahTuş analysis RL-02,
 * owner decision K7).
 *
 * The KK asks for "API ve RTM": a Founder's change reaches the sockets already
 * open, within the minute and without a new login, and a socket logs in with
 * the answer the REST edge gives for the same token. What is pinned here:
 *
 *   - **Login parity.** Session, partner grant and personal token log in with
 *     exactly what the shared rule (`@siyahtus/types` · `credential-scopes.ts`)
 *     answers — the rule the API suite pins `/auth/me` to.
 *   - **Open sockets follow.** A change announced on `permissions.changed`
 *     widens or narrows the fan-out of a member's open socket; one nobody
 *     announced is caught by the gateway's sweep.
 *   - **`own`** keeps a socket to the chats its member is in.
 *   - **Nothing else moves:** a personal token and a partner grant never widen
 *     past their lists, and another workspace's sockets never notice.
 *
 * The matrix is written straight to the database here — the API's PUT is the
 * API suite's subject — with a version unique to the run, so the gateway's
 * cache can never answer one test with another test's rows.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PERMISSIONS_CHANGED_CHANNEL,
  defaultScopesForRole,
  licenseChannel,
  permissionsChangedMessage,
  scopesForCredential,
  type BusEnvelope,
  type CapabilityOverride,
  type CredentialGrant,
  type PushAudience,
} from '@siyahtus/types';
import type { Connection } from '../../src/connection.js';
import {
  grantToken,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../helpers/fixtures.js';
import { settle, startRtm, TestSocket } from '../helpers/rtm-harness.js';

const PUSHES = ['incoming_chat', 'incoming_event'];

describe('the gateway under the permission matrix (RL-02 · tm 325.3)', () => {
  let db: PrismaClient;
  let redis: Redis;
  let rtm: Awaited<ReturnType<typeof startRtm>>;
  let fx: RtmFixtures;
  /** Unique to the run: a cached snapshot from another test can never match. */
  let version = 1_000 + Math.floor(Math.random() * 1_000_000);
  const sockets: TestSocket[] = [];

  beforeAll(async () => {
    db = ownerClient();
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6380');
    rtm = await startRtm();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await rtm.close();
    await redis.quit();
    await db.$disconnect();
  });

  beforeEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    fx = await seedRtmFixtures(db);
  });

  /** A client registered with no scope list: the workspace's sign-in client. */
  async function client(t: RtmTenant, scopes: string[]): Promise<string> {
    const id = `client_${randomUUID()}`;
    await db.oauthClient.create({
      data: {
        id,
        organizationId: t.organizationId,
        displayName: scopes.length === 0 ? 'SiyahTuş Agent App' : 'Shift dashboard',
        clientType: 'public',
        redirectUris: ['https://app.example.test/callback'],
        scopes,
      },
    });
    return id;
  }

  /** Replace `t`'s stored choices and move its version, as a committed PUT would. */
  async function setMatrix(t: RtmTenant, overrides: CapabilityOverride[]): Promise<number> {
    version += 1;
    await db.$executeRaw`DELETE FROM role_capability_overrides WHERE license_id = ${t.licenseId}`;
    for (const o of overrides) {
      await db.$executeRaw`
        INSERT INTO role_capability_overrides (license_id, role, capability, value)
        VALUES (${t.licenseId}, ${o.role}, ${o.capability}, ${o.value})`;
    }
    await db.$executeRaw`UPDATE licenses SET permissions_version = ${version} WHERE id = ${t.licenseId}`;
    return version;
  }

  /**
   * Announce `t`'s matrix until the gateway has acted on it. Repeating is
   * harmless — each announcement only drops a snapshot and derives again — and
   * it does not depend on the gateway's subscription being up by the first one.
   */
  async function announceUntil(t: RtmTenant, done: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await redis.publish(
        PERMISSIONS_CHANGED_CHANNEL,
        permissionsChangedMessage(t.licenseId, version),
      );
      await delay(100);
      if (done()) return;
    }
    throw new Error('the gateway never derived the open socket again');
  }

  async function login(
    t: RtmTenant,
    token: string,
  ): Promise<{ socket: TestSocket; scopes: string[]; connection: Connection }> {
    const licence = t.licenseId.toString();
    const before = new Set(rtm.server.registry.members(licence).map((c) => c.id));
    const socket = await TestSocket.connect(rtm.port, { organizationId: t.organizationId });
    sockets.push(socket);
    const response = await socket.request('login', {
      token: `Bearer ${token}`,
      pushes: { '3.6': PUSHES },
    });
    expect(response.success).toBe(true);
    const scopes = (response.payload['my_profile'] as { scopes: string[] }).scopes;
    const connection = rtm.server.registry.members(licence).find((c) => !before.has(c.id));
    if (!connection) throw new Error('the login left no member socket behind');
    return { socket, scopes, connection };
  }

  async function session(t: RtmTenant, accountId: string, scopes: string[], clientId: string) {
    return grantToken(db, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: accountId,
      kind: 'oauth',
      clientId,
      scopes,
    });
  }

  async function publish(t: RtmTenant, audience: PushAudience, text: string): Promise<void> {
    const envelope: BusEnvelope = {
      v: 1,
      licenseId: t.licenseId.toString(),
      organizationId: t.organizationId,
      action: 'incoming_event',
      audience,
      payload: { text },
      at: Date.now(),
    };
    await redis.publish(licenseChannel(t.licenseId), JSON.stringify(envelope));
  }

  const texts = (socket: TestSocket): string[] =>
    socket.pushes('incoming_event').map((p) => p.payload['text'] as string);

  const agentSet = defaultScopesForRole('agent');

  // =========================================================================
  // Login parity
  // =========================================================================

  it('logs a member in with what the REST edge resolves, for every kind of credential (FR-MOD-04.RBAC)', async () => {
    const overrides: CapabilityOverride[] = [
      { role: 'agent', capability: 'reports.view', value: 'all' },
      { role: 'agent', capability: 'tickets.view', value: 'none' },
      { role: 'agent', capability: 'chats.view', value: 'own' },
    ];
    await setMatrix(fx.a, overrides);
    const credentials: Array<[CredentialGrant, string]> = [
      ['session', await session(fx.a, fx.a.agentAccountId, agentSet, await client(fx.a, []))],
      [
        'delegated',
        await session(
          fx.a,
          fx.a.agentAccountId,
          agentSet,
          await client(fx.a, ['chats--access:rw']),
        ),
      ],
      [
        'personal',
        await grantToken(db, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          scopes: agentSet,
        }),
      ],
    ];
    for (const [grant, token] of credentials) {
      const { scopes, connection } = await login(fx.a, token);
      expect(scopes, grant).toEqual(
        scopesForCredential({ grant, role: 'agent', stored: agentSet, overrides }),
      );
      // `own`: no team reaches a chat for this member — only being in it does.
      expect(connection.groupIds, grant).toEqual([]);
      expect(connection.unrestricted, grant).toBe(false);
    }
  });

  // =========================================================================
  // Open sockets follow the matrix
  // =========================================================================

  describe('an open socket follows the matrix without a new login', () => {
    it('widens to every chat when the Founder lends it, and narrows back (FR-MOD-04.RBAC)', async () => {
      const { socket, connection } = await login(
        fx.a,
        await session(fx.a, fx.a.agentAccountId, agentSet, await client(fx.a, [])),
      );
      await publish(fx.a, { groupIds: [Number(fx.a.salesGroupId)] }, 'sales before');
      await settle();
      expect(texts(socket)).toEqual([]);

      await setMatrix(fx.a, [{ role: 'agent', capability: 'chats.view', value: 'all' }]);
      await announceUntil(fx.a, () => connection.unrestricted);
      await publish(fx.a, { groupIds: [Number(fx.a.salesGroupId)] }, 'sales lent');
      await socket.waitFor((f) => f.type === 'push' && f.payload['text'] === 'sales lent');

      await setMatrix(fx.a, []);
      await announceUntil(fx.a, () => !connection.unrestricted);
      await publish(fx.a, { groupIds: [Number(fx.a.salesGroupId)] }, 'sales after');
      await settle();
      expect(texts(socket)).toEqual(['sales lent']);
      expect(connection.groupIds).toEqual([Number(fx.a.supportGroupId)]);
    });

    it('keeps the socket to the chats its member is in once the Founder sets own (FR-MOD-04.RBAC)', async () => {
      const { socket, connection } = await login(
        fx.a,
        await session(fx.a, fx.a.agentAccountId, agentSet, await client(fx.a, [])),
      );
      await publish(fx.a, { groupIds: [Number(fx.a.supportGroupId)] }, 'team before');
      await socket.waitFor((f) => f.type === 'push' && f.payload['text'] === 'team before');

      await setMatrix(fx.a, [{ role: 'agent', capability: 'chats.view', value: 'own' }]);
      await announceUntil(fx.a, () => connection.groupIds.length === 0);
      await publish(fx.a, { groupIds: [Number(fx.a.supportGroupId)] }, 'team after');
      await publish(fx.a, { agentIds: [fx.a.agentAccountId] }, 'mine');
      await socket.waitFor((f) => f.type === 'push' && f.payload['text'] === 'mine');
      await settle();
      expect(texts(socket)).toEqual(['team before', 'mine']);
    });

    it('catches on its sweep a change nobody announced', async () => {
      const { socket, connection } = await login(
        fx.a,
        await session(fx.a, fx.a.agentAccountId, agentSet, await client(fx.a, [])),
      );
      await setMatrix(fx.a, [{ role: 'agent', capability: 'chats.view', value: 'all' }]);
      await settle();
      expect(connection.unrestricted).toBe(false);

      await rtm.server.authority.sweep();
      expect(connection.unrestricted).toBe(true);
      expect(connection.authority?.version).toBe(version);
      await publish(fx.a, { groupIds: [Number(fx.a.salesGroupId)] }, 'sales swept');
      await socket.waitFor((f) => f.type === 'push' && f.payload['text'] === 'sales swept');
    });
  });

  // =========================================================================
  // What does not move
  // =========================================================================

  describe('what does not move', () => {
    it('never widens a personal token or a partner grant past its list, but narrows both (FR-MOD-04.RBAC)', async () => {
      const pat = await login(
        fx.a,
        await grantToken(db, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          scopes: agentSet,
        }),
      );
      const partner = await login(
        fx.a,
        await session(
          fx.a,
          fx.a.agentAccountId,
          agentSet,
          await client(fx.a, ['chats--access:rw']),
        ),
      );

      const lent = await setMatrix(fx.a, [
        { role: 'agent', capability: 'chats.view', value: 'all' },
      ]);
      await announceUntil(
        fx.a,
        () =>
          pat.connection.authority?.version === lent &&
          partner.connection.authority?.version === lent,
      );
      for (const { connection } of [pat, partner]) expect(connection.unrestricted).toBe(false);
      await publish(fx.a, { groupIds: [Number(fx.a.salesGroupId)] }, 'sales lent');
      await settle();
      expect(texts(pat.socket)).toEqual([]);
      expect(texts(partner.socket)).toEqual([]);

      await setMatrix(fx.a, [{ role: 'agent', capability: 'chats.view', value: 'own' }]);
      await announceUntil(
        fx.a,
        () => pat.connection.groupIds.length === 0 && partner.connection.groupIds.length === 0,
      );
      await publish(fx.a, { groupIds: [Number(fx.a.supportGroupId)] }, 'team after');
      await settle();
      expect(texts(pat.socket)).toEqual([]);
      expect(texts(partner.socket)).toEqual([]);
    });

    it("leaves another workspace's sockets alone (NFR-S4)", async () => {
      const elsewhere = await login(
        fx.b,
        await session(fx.b, fx.b.agentAccountId, agentSet, await client(fx.b, [])),
      );
      const here = await login(
        fx.a,
        await session(fx.a, fx.a.agentAccountId, agentSet, await client(fx.a, [])),
      );

      await setMatrix(fx.a, [{ role: 'agent', capability: 'chats.view', value: 'own' }]);
      await announceUntil(fx.a, () => here.connection.groupIds.length === 0);

      expect(elsewhere.connection.groupIds).toEqual([Number(fx.b.supportGroupId)]);
      await publish(fx.b, { groupIds: [Number(fx.b.supportGroupId)] }, 'b team');
      await elsewhere.socket.waitFor((f) => f.type === 'push' && f.payload['text'] === 'b team');
    });
  });
});
