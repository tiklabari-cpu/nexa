/**
 * An operator signed in as a member, on the socket (tm 389.15 · FR-ADMIN-21 ·
 * docs/platform-admin/design.md §G).
 *
 * The REST edge resolves an impersonation token as the member, held to the
 * session's terms; this gateway is a separate process and must reach the same
 * answer. Proved against a real gateway: a `read_only` session's socket logs
 * in and hears what the member would, but says nothing — no typing, and no
 * presence (the person is not there, so nothing may be routed to them) — a
 * `full` one may type, and an ended session's token opens nothing.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { presenceSocketsKey } from '../../src/presence.js';
import { ownerClient, seedRtmFixtures, type RtmFixtures } from '../helpers/fixtures.js';
import { startRtm, TestSocket } from '../helpers/rtm-harness.js';

/** Presence on, so a socket that should say "here" would. */
const PRESENCE_ENV = { RTM_DISCONNECT_OFFLINE_MS: '2000' };

describe('impersonation sockets (tm 389.15)', () => {
  let db: PrismaClient;
  let redis: Redis;
  let rtm: Awaited<ReturnType<typeof startRtm>>;
  let fx: RtmFixtures;
  const sockets: TestSocket[] = [];

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
  });

  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    await delay(100);
  });

  /** A session on the agent of A, and the token it was traded for — as 389.2's trade writes them. */
  async function impersonationToken(
    mode: 'read_only' | 'full',
    options: { ended?: boolean } = {},
  ): Promise<string> {
    const admin = await db.platformAdmin.create({
      data: {
        id: randomUUID(),
        email: `operator-${randomUUID()}@ops.siyahtus.test`,
        passwordHash: 'x',
        role: mode === 'full' ? 'superadmin' : 'support',
      },
      select: { id: true },
    });
    const now = Date.now();
    const session = await db.platformImpersonationSession.create({
      data: {
        id: randomUUID(),
        adminId: admin.id,
        licenseId: fx.a.licenseId,
        accountId: fx.a.agentAccountId,
        mode,
        startedAt: new Date(now - 1000),
        endsAt: new Date(now + 30 * 60_000),
        ...(options.ended ? { endedAt: new Date(now), endReason: 'ended_by_operator' } : {}),
      },
      select: { id: true, endsAt: true },
    });
    const token = `imp_${randomUUID()}`;
    await db.apiToken.create({
      data: {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        kind: 'impersonation',
        tokenHash: createHash('sha256').update(token, 'utf8').digest('base64url'),
        scopes: [],
        expiresAt: session.endsAt,
        impersonationSessionId: session.id,
      },
    });
    return token;
  }

  async function login(token: string) {
    const socket = await TestSocket.connect(rtm.port, {
      organizationId: fx.a.organizationId,
      side: 'agent',
    });
    sockets.push(socket);
    const response = await socket.request('login', { token: `Bearer ${token}` });
    return { socket, response };
  }

  const errorOf = (response: { payload: Record<string, unknown> }) =>
    response.payload['error'] as { type: string } | undefined;

  async function presenceCount(): Promise<number> {
    const key = presenceSocketsKey(fx.a.licenseId.toString(), fx.a.agentAccountId);
    return redis.zcount(key, '-inf', '+inf');
  }

  const routingStatus = async () =>
    (
      await db.agentMembership.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        select: { routingStatus: true },
      })
    ).routingStatus;

  it('lets a read-only session in as the member, and lets it say nothing', async () => {
    const before = await routingStatus();
    const { socket, response } = await login(await impersonationToken('read_only'));
    expect(response.success, JSON.stringify(response)).toBe(true);
    expect(response.payload['my_profile']).toMatchObject({
      id: fx.a.agentAccountId,
      kind: 'agent',
    });

    const typing = await socket.request('send_typing_indicator', {
      chat_id: 'TJ1H8CFKRV',
      is_typing: true,
    });
    expect(typing.success).toBe(false);
    expect(errorOf(typing)?.type).toBe('impersonation_read_only');

    // Nobody is there: no presence, and the member's routing status is theirs.
    await delay(200);
    expect(await presenceCount()).toBe(0);
    expect(await routingStatus()).toBe(before);
  });

  it('lets a full session type, and still writes no presence', async () => {
    const { socket, response } = await login(await impersonationToken('full'));
    expect(response.success, JSON.stringify(response)).toBe(true);
    const typing = await socket.request('send_typing_indicator', {
      chat_id: 'TJ1H8CFKRV',
      is_typing: true,
    });
    // Whatever the chat says, it is not the session's mode refusing it.
    expect(errorOf(typing)?.type).not.toBe('impersonation_read_only');
    await delay(200);
    expect(await presenceCount()).toBe(0);
  });

  it('opens nothing for a session that has ended', async () => {
    const { response } = await login(await impersonationToken('read_only', { ended: true }));
    expect(response.success).toBe(false);
    expect(errorOf(response)?.type).toBe('authentication');
  });

  it('opens presence for the member’s own socket, as before', async () => {
    const token = `pat_${randomUUID()}`;
    await db.apiToken.create({
      data: {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        kind: 'pat',
        tokenHash: createHash('sha256').update(token, 'utf8').digest('base64url'),
        scopes: ['chats--access:rw'],
      },
    });
    const { response } = await login(token);
    expect(response.success).toBe(true);
    await delay(200);
    expect(await presenceCount()).toBe(1);
  });
});
