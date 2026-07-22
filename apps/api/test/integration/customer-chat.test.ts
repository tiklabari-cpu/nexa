/**
 * Customer Chat API — the widget's surface.
 *
 * This is the only endpoint family reachable by an unauthenticated visitor, so
 * the tests concentrate on what a hostile page could try: reaching another
 * tenant, another customer, or the agent API.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('customer chat api', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;

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

    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw'],
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function widgetToken(tenant = fx.a, customerId?: string) {
    const response = await server.post(
      '/customer/token',
      {
        organization_id: tenant.organizationId,
        ...(customerId ? { customer_id: customerId } : {}),
      },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string };
  }

  // =========================================================================

  describe('starting a conversation', () => {
    it('creates a routed chat from the first message', async () => {
      const { token } = await widgetToken();

      const response = await server.post(
        '/customer/chat/events',
        { text: 'Hello, my order is late' },
        auth(token),
      );

      expect(response.statusCode).toBe(201);
      expect(response.json().chat_id).toBeTruthy();

      // Routed to the agent, not left unassigned.
      const thread = await owner.thread.findFirstOrThrow({
        where: { chatId: response.json().chat_id },
      });
      expect(thread.assigneeId).toBe(fx.a.agentAccountId);
    });

    it('adds to the existing conversation rather than opening a second', async () => {
      const { token } = await widgetToken();

      const first = await server.post('/customer/chat/events', { text: 'one' }, auth(token));
      const second = await server.post('/customer/chat/events', { text: 'two' }, auth(token));

      expect(second.json().chat_id).toBe(first.json().chat_id);
      expect(await owner.chat.count()).toBe(1);
    });

    it('routes by the page the visitor is on', async () => {
      const sales = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sales' },
        select: { id: true },
      });
      await owner.groupAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          groupId: sales.id,
          agentId: fx.a.ownerAccountId,
          priority: 'normal',
        },
      });
      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          conditions: { url_contains: ['/pricing'] },
          targetGroupId: sales.id,
          priority: 1,
        },
      });

      const { token } = await widgetToken();
      const response = await server.post(
        '/customer/chat/events',
        { text: 'What does it cost?', url: 'https://shop.test/pricing' },
        auth(token),
      );

      const access = await owner.chatAccess.findMany({
        where: { chatId: response.json().chat_id },
      });
      expect(access.map((a) => a.groupId)).toEqual([sales.id]);
    });

    it('records pre-chat details and marks the visitor a lead', async () => {
      const { token, customer_id } = await widgetToken();
      await server.post(
        '/customer/chat/events',
        { text: 'Hi', name: 'Robin Fields', email: 'robin@example.test' },
        auth(token),
      );

      const customer = await owner.customer.findUniqueOrThrow({ where: { id: customer_id } });
      expect(customer.name).toBe('Robin Fields');
      expect(customer.email).toBe('robin@example.test');
      expect(customer.isLead).toBe(true);
    });

    it('rejects an empty message', async () => {
      const { token } = await widgetToken();
      for (const text of ['', '   ']) {
        expect((await server.post('/customer/chat/events', { text }, auth(token))).statusCode).toBe(
          400,
        );
      }
    });

    it('does not post twice when a request is retried', async () => {
      const { token } = await widgetToken();
      const first = await server.post('/customer/chat/events', { text: 'once' }, auth(token));

      // The widget generates a fresh key per send, so this simulates the API
      // being called with the same one after a timeout.
      const chatId = first.json().chat_id;
      const body = { type: 'message', text: 'retried', idempotency_key: 'k1' };
      const a = await server.post(`/chats/${chatId}/events`, body, auth(token));
      const b = await server.post(`/chats/${chatId}/events`, body, auth(token));

      expect(a.json().id).toBe(b.json().id);
      expect(await owner.event.count({ where: { chatId, text: 'retried' } })).toBe(1);
    });
  });

  // =========================================================================

  describe('reading the conversation', () => {
    it('returns the whole widget state in one call', async () => {
      const { token } = await widgetToken();
      await server.post('/customer/chat/events', { text: 'Hello' }, auth(token));

      const state = await server.get('/customer/chat', auth(token));
      expect(state.statusCode).toBe(200);
      expect(state.json().online).toBe(true);
      expect(state.json().chat.id).toBeTruthy();
      expect(state.json().events.map((e: { text: string }) => e.text)).toContain('Hello');
    });

    it('reports offline when nobody is accepting', async () => {
      await owner.agentMembership.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { routingStatus: 'offline' },
      });

      const { token } = await widgetToken();
      const state = await server.get('/customer/chat', auth(token));
      // Honest rather than encouraging: pretending someone will answer turns a
      // short wait into an abandoned conversation.
      expect(state.json().online).toBe(false);
    });

    it('shows a queue position when everyone is busy', async () => {
      await owner.agentMembership.updateMany({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        data: { concurrentChatsLimit: 1 },
      });
      await owner.agentMembership.updateMany({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId },
        data: { routingStatus: 'not_accepting_chats' },
      });

      // Fill the only agent's single slot.
      const first = await widgetToken();
      await server.post('/customer/chat/events', { text: 'first' }, auth(first.token));

      const second = await widgetToken();
      await server.post('/customer/chat/events', { text: 'second' }, auth(second.token));

      const state = await server.get('/customer/chat', auth(second.token));
      expect(state.json().chat.queue_position).toBe(1);
    });

    it('never shows an internal note', async () => {
      const { token } = await widgetToken();
      const started = await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));

      await server.post(
        `/chats/${started.json().chat_id}/events`,
        { type: 'message', text: 'INTERNAL-ONLY', recipients: 'agents' },
        auth(agentToken),
      );

      const state = await server.get('/customer/chat', auth(token));
      expect(state.body).not.toContain('INTERNAL-ONLY');
    });

    it('returns an empty state before any conversation exists', async () => {
      const { token } = await widgetToken();
      const state = await server.get('/customer/chat', auth(token));
      expect(state.statusCode).toBe(200);
      expect(state.json().chat).toBeNull();
      expect(state.json().events).toEqual([]);
    });
  });

  // =========================================================================

  describe('boundaries', () => {
    it('refuses an agent token on the widget surface', async () => {
      const response = await server.get('/customer/chat', auth(agentToken));
      expect(response.statusCode).toBe(404);
    });

    it('refuses a widget token on the agent surface', async () => {
      const { token } = await widgetToken();
      expect((await server.get('/chats', auth(token))).statusCode).toBe(404);
      expect((await server.get('/agents', auth(token))).statusCode).toBe(404);
    });

    it("shows one visitor nothing of another's conversation", async () => {
      const alice = await widgetToken();
      await server.post('/customer/chat/events', { text: 'ALICE-SECRET' }, auth(alice.token));

      const bob = await widgetToken();
      const state = await server.get('/customer/chat', auth(bob.token));

      expect(state.json().chat).toBeNull();
      expect(state.body).not.toContain('ALICE-SECRET');
    });

    it('keeps tenants apart', async () => {
      const acme = await widgetToken(fx.a);
      await server.post('/customer/chat/events', { text: 'ACME-SECRET' }, auth(acme.token));

      const northwind = await widgetToken(fx.b);
      const state = await server.get('/customer/chat', auth(northwind.token));

      expect(state.json().chat).toBeNull();
      expect(state.body).not.toContain('ACME-SECRET');
    });

    it('requires a token at all', async () => {
      expect((await server.get('/customer/chat')).statusCode).toBe(401);
      expect((await server.post('/customer/chat/events', { text: 'hi' })).statusCode).toBe(401);
    });
  });

  // =========================================================================

  describe('closing and rating', () => {
    it('lets the visitor end the conversation', async () => {
      const { token } = await widgetToken();
      const started = await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));

      expect((await server.post('/customer/chat/close', undefined, auth(token))).statusCode).toBe(
        204,
      );

      const chat = await owner.chat.findUniqueOrThrow({
        where: { id: started.json().chat_id },
      });
      expect(chat.active).toBe(false);
    });

    it('reports closing an already-closed conversation', async () => {
      const { token } = await widgetToken();
      await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));
      await server.post('/customer/chat/close', undefined, auth(token));

      const again = await server.post('/customer/chat/close', undefined, auth(token));
      expect(again.statusCode).toBe(409);
    });

    it('accepts a rating after the conversation ends', async () => {
      const { token } = await widgetToken();
      await server.post('/customer/chat/events', { text: 'Thanks!' }, auth(token));
      await server.post('/customer/chat/close', undefined, auth(token));

      // Ratings usually arrive just after closing, so the most recent chat is
      // the right target even though it is no longer active.
      const response = await server.post('/customer/chat/rating', { value: 'good' }, auth(token));
      expect(response.statusCode).toBe(201);
      expect(response.json().value).toBe('good');
    });

    it('rejects an invalid rating value', async () => {
      const { token } = await widgetToken();
      await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));

      const response = await server.post('/customer/chat/rating', { value: 'meh' }, auth(token));
      expect(response.statusCode).toBe(400);
    });

    it('refuses a rating with no conversation to rate', async () => {
      const { token } = await widgetToken();
      expect(
        (await server.post('/customer/chat/rating', { value: 'good' }, auth(token))).statusCode,
      ).toBe(404);
    });
  });
});
