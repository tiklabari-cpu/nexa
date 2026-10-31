/**
 * The new-ticket alert's push (IN-10 · tm 367, `incoming_ticket`): who is told
 * a ticket exists, and — as important — who is not.
 *
 * The audience is the assignee and the team the ticket ended up with; ids only
 * (the subject is the player's own words); the agent who did it is named so
 * the console does not alert them to their own action.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { licenseChannel } from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Envelope {
  action: string;
  audience: { agentIds?: string[]; groupIds?: number[] };
  payload: Record<string, unknown>;
}

describe('incoming_ticket push', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;
  let groupId: bigint;
  let listener: Redis;
  let pushes: Envelope[];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const group = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    groupId = group.id;
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:rw', 'tickets--all:ro', 'chats--all:rw', 'customers:ro'],
    });

    pushes = [];
    listener = server.app.redis.duplicate();
    listener.on('message', (_channel: string, raw: string) => {
      const envelope = JSON.parse(raw) as Envelope;
      if (envelope.action === 'incoming_ticket') pushes.push(envelope);
    });
    await listener.subscribe(licenseChannel(fx.a.licenseId));
  });

  afterEach(async () => {
    await listener.quit();
  });

  it('tells the assignee and the team of a new ticket — ids only, naming the actor (FR-MOD-13.8)', async () => {
    const created = await server.post(
      '/tickets',
      {
        subject: 'Withdrawal never arrived — card 4111 1111 1111 1111',
        customer_id: fx.a.customerId,
        assignee_id: fx.a.agentAccountId,
        group_id: Number(groupId),
      },
      auth(adminToken),
    );
    expect(created.statusCode, created.body).toBe(201);
    const ticketId = (created.json() as { id: string }).id;

    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    const push = pushes[0]!;
    expect(push.audience.agentIds).toEqual([fx.a.agentAccountId]);
    expect(push.audience.groupIds).toEqual([Number(groupId)]);
    expect(push.payload).toEqual({
      ticket_id: ticketId,
      reason: 'created',
      assignee_id: fx.a.agentAccountId,
      group_id: Number(groupId),
      actor_id: fx.a.ownerAccountId,
    });
    expect(JSON.stringify(push)).not.toContain('Withdrawal');
  });

  it('tells nobody about a ticket that belongs to nobody (FR-MOD-13.8)', async () => {
    const created = await server.post(
      '/tickets',
      { subject: 'Orphan', customer_id: fx.a.customerId },
      auth(adminToken),
    );
    expect(created.statusCode, created.body).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(pushes).toEqual([]);
  });

  it('tells the new assignee when a ticket is handed over, and nobody when it is only edited (FR-MOD-13.8)', async () => {
    const created = await server.post(
      '/tickets',
      { subject: 'Hand me over', customer_id: fx.a.customerId },
      auth(adminToken),
    );
    const ticketId = (created.json() as { id: string }).id;

    const renamed = await server.patch(
      `/tickets/${ticketId}`,
      { subject: 'Renamed' },
      auth(adminToken),
    );
    expect(renamed.statusCode, renamed.body).toBe(200);

    const handed = await server.patch(
      `/tickets/${ticketId}`,
      { assignee_id: fx.a.agentAccountId },
      auth(adminToken),
    );
    expect(handed.statusCode, handed.body).toBe(200);

    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0]!.payload).toMatchObject({
      ticket_id: ticketId,
      reason: 'assigned',
      assignee_id: fx.a.agentAccountId,
      actor_id: fx.a.ownerAccountId,
    });

    // The same assignee again is not a hand-over.
    await server.patch(
      `/tickets/${ticketId}`,
      { assignee_id: fx.a.agentAccountId },
      auth(adminToken),
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(pushes).toHaveLength(1);
  });
});
