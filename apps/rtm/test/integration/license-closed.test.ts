/**
 * A closed workspace on the socket (tm 389.2 · docs/platform-admin/design.md §B3).
 *
 * The API refuses a suspended workspace's credential with 403
 * `workspace_suspended` at its own edge; this gateway is a separate process
 * and would otherwise keep streaming the workspace's events to it. The same
 * rule is proved here against a real gateway: a suspension refuses the login
 * with the same type and reason, lifting it lets the very same token in, and a
 * cancellation is refused exactly as it always was — the undifferentiated
 * `authentication`.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedRtmFixtures, type RtmFixtures } from '../helpers/fixtures.js';
import { startRtm, TestSocket } from '../helpers/rtm-harness.js';

describe('closed licences on the socket (tm 389.2)', () => {
  let db: PrismaClient;
  let rtm: Awaited<ReturnType<typeof startRtm>>;
  let fx: RtmFixtures;
  const sockets: TestSocket[] = [];

  beforeAll(async () => {
    db = ownerClient();
    rtm = await startRtm();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await rtm.close();
    await db.$disconnect();
  });

  beforeEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    fx = await seedRtmFixtures(db);
  });

  async function login(token: string) {
    const socket = await TestSocket.connect(rtm.port, {
      organizationId: fx.a.organizationId,
      side: 'agent',
    });
    sockets.push(socket);
    return socket.request('login', { token: `Bearer ${token}` });
  }

  function agentToken() {
    return grantToken(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--access:rw'],
    });
  }

  function errorOf(response: { payload: Record<string, unknown> }) {
    return response.payload['error'] as { type: string; details?: { reason?: string } };
  }

  it('refuses a suspended workspace with not_allowed/workspace_suspended, and admits it once lifted', async () => {
    const token = await agentToken();
    await db.license.update({
      where: { id: fx.a.licenseId },
      data: { status: 'suspended', suspendedAt: new Date(), suspendedReason: 'abuse review' },
    });

    const refused = await login(token);
    expect(refused.success).toBe(false);
    expect(errorOf(refused).type).toBe('not_allowed');
    expect(errorOf(refused).details?.reason).toBe('workspace_suspended');
    // The operator's words stay with the platform.
    expect(JSON.stringify(refused)).not.toContain('abuse review');

    await db.license.update({
      where: { id: fx.a.licenseId },
      data: { status: 'active', suspendedAt: null, suspendedReason: null },
    });
    expect((await login(token)).success).toBe(true);
  });

  it('refuses a canceled workspace exactly as before — authentication, no reason', async () => {
    const token = await agentToken();
    await db.license.update({ where: { id: fx.a.licenseId }, data: { status: 'canceled' } });

    const refused = await login(token);
    expect(refused.success).toBe(false);
    expect(errorOf(refused).type).toBe('authentication');
    expect(errorOf(refused).details?.reason).toBeUndefined();
  });

  it('refuses every token of an account the root panel suspended, and admits it once lifted (tm 389.11)', async () => {
    const token = await agentToken();
    await db.account.update({
      where: { id: fx.a.agentAccountId },
      data: { platformSuspendedAt: new Date(), platformSuspendedReason: 'account takeover review' },
    });

    const refused = await login(token);
    expect(refused.success).toBe(false);
    // The REST edge's answer to the same token: a dead credential, no reason.
    expect(errorOf(refused).type).toBe('authentication');
    expect(JSON.stringify(refused)).not.toContain('account takeover review');
    // The owner of the same workspace is somebody else, and still in.
    const ownerToken = await grantToken(db, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--access:rw'],
    });
    expect((await login(ownerToken)).success).toBe(true);

    await db.account.update({
      where: { id: fx.a.agentAccountId },
      data: { platformSuspendedAt: null, platformSuspendedReason: null },
    });
    expect((await login(token)).success).toBe(true);
  });

  it('leaves the other workspace on the gateway untouched', async () => {
    await db.license.update({
      where: { id: fx.b.licenseId },
      data: { status: 'suspended', suspendedAt: new Date() },
    });
    expect((await login(await agentToken())).success).toBe(true);
  });
});
