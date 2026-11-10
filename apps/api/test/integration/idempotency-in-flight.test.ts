/**
 * One send per idempotency key at a time (tm 448 · audit F27).
 *
 * A send remembers the event it wrote under its `idempotency_key` only once
 * its transaction commits. A retry arriving while the first attempt was still
 * writing found nothing to replay and wrote the message again — and a
 * visitor's second copy carried a second AI job, a second AI turn. Now the
 * send claims the key's flight before its transaction: the retry waits a
 * moment, then replays the first attempt's event or answers
 * `409 idempotency_in_flight` having written nothing.
 *
 * "Still writing" is staged, not hoped for: the test holds the chat's row, so
 * the first request waits inside its transaction (its flight claimed) until
 * the test lets go — observable as a backend waiting on a lock.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '../../src/lib/tenant.js';
import type { CustomerPrincipal } from '../../src/services/auth/principal.js';
import { aiJobOutbox } from '../../src/services/ai/ai-jobs.js';
import { ChatService, type EventOutbox } from '../../src/services/chat/chat-service.js';
import { flightName } from '../../src/services/chat/idempotency-flight.js';
import {
  auditContextFor,
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { assignForReply } from '../helpers/reply-assignment.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

describe('one send per idempotency key at a time (tm 448)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;

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
    await seedDefaultBrand(owner, fx.a.licenseId);
    await clearRateLimits(server.app);

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw'],
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function widgetToken(): Promise<{ token: string; customer_id: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  /** A visitor's conversation, open, with one message in it. */
  async function visitorChat(): Promise<{ token: string; customerId: string; chatId: string }> {
    const { token, customer_id } = await widgetToken();
    const opened = await server.post('/customer/chat/events', { text: 'hello' }, auth(token));
    expect(opened.statusCode).toBe(201);
    return { token, customerId: customer_id, chatId: opened.json().chat_id };
  }

  /**
   * Holds the chat's row until `release`. A send to it then waits inside its
   * transaction at its first write (`#appendEvent` updates the chat row first).
   */
  async function holdChatRow(chatId: string): Promise<{ release: () => Promise<void> }> {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    const done = owner.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM chats WHERE id = ${chatId} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    return {
      release: async () => {
        open();
        await done;
      },
    };
  }

  /** Until a request is waiting on the held row — inside its transaction, its flight claimed. */
  async function untilWaitingOnTheRow(): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const [row] = await owner.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (row && row.n > 0n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the first request never reached the held row');
  }

  const eventsWith = (chatId: string, text: string) =>
    owner.event.findMany({ where: { chatId, text }, select: { id: true } });

  // ===========================================================================

  describe("an agent's send", () => {
    async function agentChat(): Promise<string> {
      const { chatId } = await visitorChat();
      await assignForReply(owner, chatId, fx.a.ownerAccountId);
      return chatId;
    }

    it('answers a retry racing the first attempt 409 idempotency_in_flight and writes the message once (FR-MOD-02.3.6)', async () => {
      const chatId = await agentChat();
      const body = { type: 'message', text: 'Only once', idempotency_key: 'agent-k1' };

      const hold = await holdChatRow(chatId);
      let first: ReturnType<typeof server.post> | undefined;
      try {
        first = server.post(`/chats/${chatId}/events`, body, auth(adminToken));
        await untilWaitingOnTheRow();
        // The flight is the chat's, and it is held.
        expect(
          await server.app.redis.exists(flightName(fx.a.licenseId, { chatId }, 'agent-k1')),
        ).toBe(1);

        const retry = await server.post(`/chats/${chatId}/events`, body, auth(adminToken));

        expect(retry.statusCode).toBe(409);
        expect(retry.json().error.type).toBe('idempotency_in_flight');
        expect(retry.headers['retry-after']).toBe('1');
      } finally {
        await hold.release();
      }

      const written = await first!;
      expect(written.statusCode).toBe(201);
      // The next retry is the first attempt's replay; the flight is gone.
      const later = await server.post(`/chats/${chatId}/events`, body, auth(adminToken));
      expect(later.statusCode).toBe(200);
      expect(later.json().id).toBe(written.json().id);
      expect(await eventsWith(chatId, 'Only once')).toEqual([{ id: written.json().id }]);
      expect(
        await server.app.redis.exists(flightName(fx.a.licenseId, { chatId }, 'agent-k1')),
      ).toBe(0);
    });

    it('writes the message once when sends with one key race (FR-MOD-02.3.6)', async () => {
      const chatId = await agentChat();
      const body = { type: 'message', text: 'Raced', idempotency_key: 'agent-race' };

      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          server.post(`/chats/${chatId}/events`, body, auth(adminToken)),
        ),
      );

      const events = await eventsWith(chatId, 'Raced');
      expect(events).toHaveLength(1);
      expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
      for (const response of responses) {
        if (response.statusCode === 409) {
          expect(response.json().error.type).toBe('idempotency_in_flight');
        } else {
          expect([200, 201]).toContain(response.statusCode);
          expect(response.json().id).toBe(events[0]!.id);
        }
      }
    });

    it('does not use the key up when the send is refused — the next one with it is written', async () => {
      const { chatId } = await visitorChat();
      // A colleague has the conversation: the admin's reply is refused.
      await assignForReply(owner, chatId, fx.a.agentAccountId);
      const body = { type: 'message', text: 'After taking it', idempotency_key: 'agent-k2' };

      const refused = await server.post(`/chats/${chatId}/events`, body, auth(adminToken));
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.type).toBe('reply_requires_assignment');

      await assignForReply(owner, chatId, fx.a.ownerAccountId);
      const sent = await server.post(`/chats/${chatId}/events`, body, auth(adminToken));

      expect(sent.statusCode).toBe(201);
      expect(await eventsWith(chatId, 'After taking it')).toHaveLength(1);
    });
  });

  // ===========================================================================

  describe("a visitor's send", () => {
    const jobsTriggeredBy = (eventId: string) =>
      owner.aiJob.count({ where: { triggerEventId: eventId } });

    it('answers a retry racing the first attempt 409 idempotency_in_flight: one message, one AI job (FR-MOD-02.3.6)', async () => {
      const { token, customerId, chatId } = await visitorChat();
      const body = { text: 'Are you there?', idempotency_key: 'visitor-k1' };

      const hold = await holdChatRow(chatId);
      let first: ReturnType<typeof server.post> | undefined;
      try {
        first = server.post('/customer/chat/events', body, auth(token));
        await untilWaitingOnTheRow();
        // The flight is the member's: the chat is decided inside the transaction.
        expect(
          await server.app.redis.exists(flightName(fx.a.licenseId, { customerId }, 'visitor-k1')),
        ).toBe(1);

        const retry = await server.post('/customer/chat/events', body, auth(token));
        expect(retry.statusCode).toBe(409);
        expect(retry.json().error.type).toBe('idempotency_in_flight');

        // The same retry through the chat's own send path is held by the same flight.
        const sideways = await server.post(
          `/chats/${chatId}/events`,
          { type: 'message', text: 'Are you there?', idempotency_key: 'visitor-k1' },
          auth(token),
        );
        expect(sideways.statusCode).toBe(409);
        expect(sideways.json().error.type).toBe('idempotency_in_flight');
      } finally {
        await hold.release();
      }

      const written = await first!;
      expect(written.statusCode).toBe(201);
      const later = await server.post('/customer/chat/events', body, auth(token));
      expect(later.statusCode).toBe(200);
      expect(later.json().event.id).toBe(written.json().event.id);

      expect(await eventsWith(chatId, 'Are you there?')).toEqual([{ id: written.json().event.id }]);
      // One message, one turn owed to the AI.
      expect(await jobsTriggeredBy(written.json().event.id)).toBe(1);
    });

    it('writes the opening message once when sends with one key race (FR-MOD-02.3.6)', async () => {
      const { token, customer_id } = await widgetToken();
      const body = { text: 'First words', idempotency_key: 'visitor-race' };

      const responses = await Promise.all(
        Array.from({ length: 4 }, () => server.post('/customer/chat/events', body, auth(token))),
      );

      const events = await owner.event.findMany({
        where: { text: 'First words', authorId: customer_id },
        select: { id: true },
      });
      expect(events).toHaveLength(1);
      expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
      for (const response of responses) {
        if (response.statusCode === 409) {
          expect(response.json().error.type).toBe('idempotency_in_flight');
        } else {
          expect([200, 201]).toContain(response.statusCode);
          expect(response.json().event.id).toBe(events[0]!.id);
        }
      }
      expect(await jobsTriggeredBy(events[0]!.id)).toBe(1);
    });

    it('does not use the key up when the send fails — the next one with it is written', async () => {
      const appRole = new PrismaClient({ datasourceUrl: APP_URL });
      try {
        const { customer_id } = await widgetToken();
        const chats = new ChatService(appRole, server.app.redis);
        const tenant: TenantContext = {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
        };
        const principal: CustomerPrincipal = {
          kind: 'customer',
          customerId: customer_id,
          organizationId: fx.a.organizationId,
          licenseId: fx.a.licenseId,
        };
        const send = (outbox: EventOutbox) =>
          chats.openOrContinueConnection(tenant, principal, {
            customerId: customer_id,
            event: {
              type: 'message',
              text: 'Second try',
              recipients: 'all',
              idempotencyKey: 'visitor-k2',
            },
            audit: auditContextFor(fx.a, { actorId: customer_id, actorType: 'customer' }),
            outbox,
          });
        const failing: EventOutbox = async () => {
          throw new Error('the transaction fails');
        };

        await expect(send(failing)).rejects.toThrow('the transaction fails');
        const sent = await send(aiJobOutbox());

        expect(sent.replayed).toBe(false);
        expect(
          await owner.event.count({
            where: { text: 'Second try', authorId: customer_id },
          }),
        ).toBe(1);
        expect(
          await server.app.redis.exists(
            flightName(fx.a.licenseId, { customerId: customer_id }, 'visitor-k2'),
          ),
        ).toBe(0);
      } finally {
        await appRole.$disconnect();
      }
    });
  });
});
