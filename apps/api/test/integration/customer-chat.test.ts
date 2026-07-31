/**
 * Customer Chat API — the widget's surface.
 *
 * This is the only endpoint family reachable by an unauthenticated visitor, so
 * the tests concentrate on what a hostile page could try: reaching another
 * tenant, another customer, or the agent API.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, typingStateKey } from '@nexa/types';
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

  describe('live typing preview', () => {
    /** Capture the realtime envelopes published while `run` executes. */
    async function captureBus(run: () => Promise<void>): Promise<Array<Record<string, unknown>>> {
      const sub = server.app.redis.duplicate();
      const seen: Array<Record<string, unknown>> = [];
      await sub.subscribe(licenseChannel(fx.a.licenseId));
      sub.on('message', (_channel, raw) => {
        try {
          seen.push(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          /* not our shape — ignore */
        }
      });
      try {
        await run();
        // The publish completes before the HTTP response, but the subscriber
        // receives it a tick later.
        await new Promise((resolve) => setTimeout(resolve, 150));
      } finally {
        await sub.unsubscribe(licenseChannel(fx.a.licenseId));
        sub.disconnect();
      }
      return seen;
    }

    it("fans a visitor's sneak-peek out to agents, never back to the visitor", async () => {
      const { token } = await widgetToken();
      await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));

      const envelopes = await captureBus(async () => {
        const response = await server.post(
          '/customer/chat/typing',
          { is_typing: true, text: 'my order is la' },
          auth(token),
        );
        expect(response.statusCode).toBe(204);
      });

      const typing = envelopes.find((e) => e['action'] === 'incoming_typing_indicator');
      const peek = envelopes.find((e) => e['action'] === 'incoming_sneak_peek');
      expect(typing).toBeDefined();
      expect(peek).toBeDefined();

      // Addressed to agents — a visitor must never be shown their own draft.
      for (const envelope of [typing!, peek!]) {
        const audience = envelope['audience'] as Record<string, unknown>;
        expect(audience['customerId']).toBeUndefined();
        expect(audience['groupIds']).not.toEqual([]);
      }

      const indicator = (typing!['payload'] as { typing_indicator: Record<string, unknown> })
        .typing_indicator;
      expect(indicator['is_typing']).toBe(true);
      expect(indicator['author_type']).toBe('customer');
      expect(indicator['recipients']).toBe('agents');

      const sneak = (peek!['payload'] as { sneak_peek: Record<string, unknown> }).sneak_peek;
      expect(sneak['text']).toBe('my order is la');
    });

    it('sends no preview when the visitor stops typing', async () => {
      const { token } = await widgetToken();
      await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));

      const envelopes = await captureBus(async () => {
        await server.post('/customer/chat/typing', { is_typing: false }, auth(token));
      });

      expect(envelopes.some((e) => e['action'] === 'incoming_sneak_peek')).toBe(false);
      const typing = envelopes.find((e) => e['action'] === 'incoming_typing_indicator');
      expect(
        (typing?.['payload'] as { typing_indicator?: { is_typing?: boolean } } | undefined)
          ?.typing_indicator?.is_typing,
      ).toBe(false);
    });

    it('reflects an agent-typing flag back to the visitor state (FR-MOD-02.9)', async () => {
      const { token } = await widgetToken();
      const started = await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));
      const chatId = started.json().chat_id as string;
      const key = typingStateKey(fx.a.licenseId, chatId);

      // The RTM gateway would set this on `send_typing_indicator`; the poll reads
      // it back because the widget holds no socket.
      await server.app.redis.set(key, '1', 'EX', 8);
      const typing = await server.get('/customer/chat', auth(token));
      expect(typing.json().agent_typing).toBe(true);

      await server.app.redis.del(key);
      const idle = await server.get('/customer/chat', auth(token));
      expect(idle.json().agent_typing).toBe(false);
    });

    it('accepts typing into a panel with no open conversation as a no-op', async () => {
      const { token } = await widgetToken();
      const response = await server.post(
        '/customer/chat/typing',
        { is_typing: true, text: 'hello?' },
        auth(token),
      );
      expect(response.statusCode).toBe(204);
    });

    it('rejects a malformed typing body', async () => {
      const { token } = await widgetToken();
      const response = await server.post('/customer/chat/typing', { text: 'no flag' }, auth(token));
      expect(response.statusCode).toBe(400);
    });

    it('refuses an agent token', async () => {
      const response = await server.post(
        '/customer/chat/typing',
        { is_typing: true },
        auth(agentToken),
      );
      expect(response.statusCode).toBe(404);
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

  // =========================================================================

  describe('attachments (FR-MOD-11.4)', () => {
    const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

    /** A customer's own upload: grant → PUT → file_url, the widget's real path. */
    async function customerUpload(token: string): Promise<string> {
      const granted = await server.post(
        '/uploads',
        { content_type: 'image/png', size_bytes: PNG.byteLength },
        auth(token),
      );
      expect(granted.statusCode).toBe(201);
      const grant = granted.json() as { upload_url: string; file_url: string };
      const put = await server.app.inject({
        method: 'PUT',
        url: grant.upload_url,
        headers: { 'content-type': 'image/png' },
        payload: PNG,
      });
      expect(put.statusCode).toBe(201);
      return grant.file_url;
    }

    it('sends an attachment with no text and shows it back on the event', async () => {
      const { token } = await widgetToken();
      const fileUrl = await customerUpload(token);

      const sent = await server.post('/customer/chat/events', { attachment_url: fileUrl }, auth(token));
      expect(sent.statusCode).toBe(201);

      const state = await server.get('/customer/chat', auth(token));
      const events = (state.json() as { events: Array<{ attachment_url: string | null }> }).events;
      expect(events.at(-1)?.attachment_url).toBe(fileUrl);
    });

    it('sends text and an attachment together', async () => {
      const { token } = await widgetToken();
      const fileUrl = await customerUpload(token);

      const sent = await server.post(
        '/customer/chat/events',
        { text: 'Here is the screenshot', attachment_url: fileUrl },
        auth(token),
      );
      expect(sent.statusCode).toBe(201);
    });

    it('refuses a message with neither text nor an attachment', async () => {
      const { token } = await widgetToken();
      const empty = await server.post('/customer/chat/events', {}, auth(token));
      expect(empty.statusCode).toBe(400);
    });

    it('refuses an attachment_url that is not a file from /uploads', async () => {
      const { token } = await widgetToken();
      const evil = await server.post(
        '/customer/chat/events',
        { attachment_url: 'https://evil.example/tracker.png' },
        auth(token),
      );
      expect(evil.statusCode).toBe(400);
      expect((evil.json() as { error: { type: string } }).error.type).toBe('validation');
    });

    it("refuses another tenant's uploaded file", async () => {
      // Tenant B uploads a file, tenant A's visitor tries to attach it.
      const agentTokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      const grantedB = await server.post(
        '/uploads',
        { content_type: 'image/png', size_bytes: PNG.byteLength },
        auth(agentTokenB),
      );
      const foreignUrl = (grantedB.json() as { file_url: string }).file_url;

      const { token } = await widgetToken();
      const refused = await server.post(
        '/customer/chat/events',
        { attachment_url: foreignUrl },
        auth(token),
      );
      expect(refused.statusCode).toBe(400);
    });
  });

  // =========================================================================

  describe('agent identity (FR-MOD-11.3)', () => {
    interface AgentState {
      agent: { name: string; avatar_url: string | null } | null;
    }

    it('names the active AI persona when no one has taken over', async () => {
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', avatarUrl: null, active: true },
      });

      const { token } = await widgetToken();
      const state = await server.get('/customer/chat', auth(token));
      expect((state.json() as AgentState).agent?.name).toBe('Ada');
    });

    it('names the human agent once the conversation is assigned', async () => {
      const { token } = await widgetToken();
      await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));

      // Hand the conversation to a person; the header should follow.
      await owner.thread.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { assigneeId: fx.a.agentAccountId },
      });

      const state = await server.get('/customer/chat', auth(token));
      expect((state.json() as AgentState).agent?.name).toBe('Agent a');
    });

    it('prefers a human assignee over the active AI persona', async () => {
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', active: true },
      });

      const { token } = await widgetToken();
      await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));
      await owner.thread.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { assigneeId: fx.a.agentAccountId },
      });

      const state = await server.get('/customer/chat', auth(token));
      expect((state.json() as AgentState).agent?.name).toBe('Agent a');
    });

    it('shows no identity when there is neither a person nor an active AI', async () => {
      const { token } = await widgetToken();
      const state = await server.get('/customer/chat', auth(token));
      expect((state.json() as AgentState).agent).toBeNull();
    });

    it('does not leak another license\'s AI persona', async () => {
      // B has an active persona; A's visitor must never see it.
      await owner.aiAgent.create({
        data: { licenseId: fx.b.licenseId, name: 'Bea', active: true },
      });

      const { token } = await widgetToken();
      const state = await server.get('/customer/chat', auth(token));
      expect((state.json() as AgentState).agent).toBeNull();
    });
  });

  // =========================================================================

  describe('hosted chat page (FR-MOD-08.5.9)', () => {
    // The widget origin the test env serves the Chat page from; its host is the
    // "self" the token route recognises as exempt from the allowlist.
    const CHAT_PAGE_ORIGIN = 'http://localhost:5174';

    it('mints a token for our own hosted page with no trusted domain', async () => {
      // `localhost` is not on any tenant's allowlist — an embed there is refused
      // — but the Chat page runs on our own origin and is exempt.
      const response = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: CHAT_PAGE_ORIGIN },
        { origin: CHAT_PAGE_ORIGIN },
      );
      expect(response.statusCode).toBe(200);
      expect((response.json() as { token: string }).token).toBeTruthy();
    });

    it('still refuses a third-party origin that is not trusted', async () => {
      const response = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: 'https://evil.example' },
        { origin: CHAT_PAGE_ORIGIN },
      );
      expect(response.statusCode).toBe(403);
    });

    it('starts a real conversation from the chat page', async () => {
      const granted = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: CHAT_PAGE_ORIGIN },
        { origin: CHAT_PAGE_ORIGIN },
      );
      const { token } = granted.json() as { token: string };

      const sent = await server.post('/customer/chat/events', { text: 'From the link' }, auth(token));
      expect(sent.statusCode).toBe(201);
      expect((sent.json() as { chat_id: string }).chat_id).toBeTruthy();
    });

    it('resolves the licence for a token minted this way', async () => {
      // Cross-tenant guard: the chat page for A must never resolve B's licence.
      const granted = await server.post(
        '/customer/token',
        { organization_id: fx.b.organizationId, host_origin: CHAT_PAGE_ORIGIN },
        { origin: CHAT_PAGE_ORIGIN },
      );
      expect(granted.statusCode).toBe(200);
      expect((granted.json() as { organization_id: string }).organization_id).toBe(
        fx.b.organizationId,
      );
    });
  });

  // The forms builder (FR-MOD-08.7.7): a workspace's pre-chat fields are contact
  // custom fields flagged `pre_chat`. They ride the token to the widget, and the
  // answers ride the first message to the contact — validated by type on the way.
  describe('pre-chat form', () => {
    async function preChatField(
      label: string,
      type: 'text' | 'number' = 'text',
      required = false,
    ): Promise<string> {
      const created = await owner.customFieldDefinition.create({
        data: {
          licenseId: fx.a.licenseId,
          entity: 'contact',
          label,
          type,
          required,
          formPlacement: 'pre_chat',
        },
        select: { id: true },
      });
      return created.id;
    }

    it('delivers the configured fields on the widget token (KK "widget\'ta gösterim")', async () => {
      await preChatField('Order number');

      const response = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      const body = response.json() as {
        pre_chat_form: Array<{ definition_id: string; label: string; type: string; required: boolean }>;
      };
      expect(body.pre_chat_form.map((field) => field.label)).toContain('Order number');
    });

    it('writes an answer to the contact (KK "contact\'a yazma")', async () => {
      const fieldId = await preChatField('Order number', 'text', true);
      const { token, customer_id } = await widgetToken();

      const sent = await server.post(
        '/customer/chat/events',
        { text: 'My order is late', custom_fields: { [fieldId]: 'ORD-42' } },
        auth(token),
      );
      expect(sent.statusCode).toBe(201);

      // The answer is on the contact, readable by an agent through the CRM detail.
      const detail = await server.get(`/customers/${customer_id}`, auth(agentToken));
      expect(detail.statusCode).toBe(200);
      const stored = (
        detail.json() as { custom_fields: Array<{ definition_id: string; value: string | null }> }
      ).custom_fields.find((field) => field.definition_id === fieldId);
      expect(stored?.value).toBe('ORD-42');
    });

    it('rejects an answer of the wrong type and opens no chat (KK negatif: geçersiz alan)', async () => {
      const fieldId = await preChatField('Balance', 'number');
      const { token } = await widgetToken();

      const sent = await server.post(
        '/customer/chat/events',
        { text: 'Hi', custom_fields: { [fieldId]: 'not-a-number' } },
        auth(token),
      );
      expect(sent.statusCode).toBe(400);
      expect((sent.json() as { error: { type: string } }).error.type).toBe('validation');
      // The bad form is refused before any conversation is created.
      expect(await owner.chat.count()).toBe(0);
    });

    it('refuses to write another tenant\'s field id', async () => {
      // A field that belongs to tenant B, offered to a tenant-A visitor. RLS on
      // the definitions means A cannot see it, so it reads as an unknown field.
      const foreign = await owner.customFieldDefinition.create({
        data: {
          licenseId: fx.b.licenseId,
          entity: 'contact',
          label: 'Secret',
          type: 'text',
          formPlacement: 'pre_chat',
        },
        select: { id: true },
      });
      const { token } = await widgetToken();

      const sent = await server.post(
        '/customer/chat/events',
        { text: 'Hi', custom_fields: { [foreign.id]: 'x' } },
        auth(token),
      );
      expect(sent.statusCode).toBe(400);
      expect(await owner.chat.count()).toBe(0);
    });
  });

  // =========================================================================
  // Banned IPs (FR-MOD-08.9.2)
  //
  // The visitor ban travels with an identity (`Customer.bannedAt`); this is the
  // other half — a ban on the address, enforced where the client IP is known:
  // the token mint and the one visitor-facing write path.
  // =========================================================================

  describe('banned IPs', () => {
    const BANNED_IP = '198.51.100.9';
    const ALLOWED_IP = '203.0.113.20';

    /** Mint a widget token, presenting `ip` as the client address. */
    function tokenFrom(ip: string, tenant = fx.a) {
      return server.post(
        '/customer/token',
        { organization_id: tenant.organizationId },
        { origin: `https://${tenant.trustedDomain}`, 'x-forwarded-for': ip },
      );
    }

    it('refuses a widget token to a banned address', async () => {
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, bannedCustomerIps: [BANNED_IP] },
      });

      const response = await tokenFrom(BANNED_IP);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.type).toBe('customer_banned');
    });

    it('still issues a token to an address that is not banned', async () => {
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, bannedCustomerIps: [BANNED_IP] },
      });

      const response = await tokenFrom(ALLOWED_IP);
      expect(response.statusCode).toBe(200);
    });

    it('blocks a banned address from starting a chat, even with a token minted before the ban', async () => {
      // Token issued while the address was still allowed.
      const minted = await tokenFrom(ALLOWED_IP);
      expect(minted.statusCode).toBe(200);
      const { token } = minted.json() as { token: string };

      // The address is banned only afterwards.
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, bannedCustomerIps: [BANNED_IP] },
      });

      const blocked = await server.post(
        '/customer/chat/events',
        { text: 'let me in' },
        { ...auth(token), 'x-forwarded-for': BANNED_IP },
      );
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.type).toBe('customer_banned');
      // The ban is a refusal, not a half-started conversation.
      expect(await owner.chat.count()).toBe(0);
    });

    it('lets the address start a chat again once the ban is lifted', async () => {
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, bannedCustomerIps: [BANNED_IP] },
      });
      const { token } = (await tokenFrom(ALLOWED_IP)).json() as { token: string };

      await owner.securitySettings.update({
        where: { licenseId: fx.a.licenseId },
        data: { bannedCustomerIps: [] },
      });

      const response = await server.post(
        '/customer/chat/events',
        { text: 'hello again' },
        { ...auth(token), 'x-forwarded-for': BANNED_IP },
      );
      expect(response.statusCode).toBe(201);
    });

    it("does not let one tenant's ban block another tenant's visitors", async () => {
      // Tenant A bans the address...
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, bannedCustomerIps: [BANNED_IP] },
      });

      // ...the same address reaching tenant B, which has not, is unaffected.
      const response = await tokenFrom(BANNED_IP, fx.b);
      expect(response.statusCode).toBe(200);
    });

    it('recognises an IPv4-mapped IPv6 address as the banned bare IPv4', async () => {
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, bannedCustomerIps: [BANNED_IP] },
      });

      // A proxy reporting the mapped form must still match the ban.
      const response = await tokenFrom(`::ffff:${BANNED_IP}`);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.type).toBe('customer_banned');
    });
  });
});
