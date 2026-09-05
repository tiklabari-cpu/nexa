/**
 * Agent Chat API.
 *
 * Attacks and edge cases first. The failures that matter here are not "the
 * endpoint returned 500" but the quiet ones: an internal note reaching a
 * customer, a retry posting a message twice, an agent reading a team's
 * conversations they were never given.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const AGENT_SCOPES = ['chats--access:rw', 'tags--all:rw', 'customers:ro'];
/** NFR-P2: reads are budgeted at p99 < 150 ms. */
const READ_BUDGET_MS = 150;
const ADMIN_SCOPES = ['chats--all:rw', 'tags--all:rw', 'customers:rw'];

describe('agent chat api', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;

  /** Tokens and the team wiring each tenant's agents sit in. */
  let acmeAdminToken: string;
  let acmeAgentToken: string;
  let northwindToken: string;
  let supportGroupId: bigint;
  let salesGroupId: bigint;

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

    // Two teams so "scoped agent cannot see another team's chats" is testable.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    const sales = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Sales' },
      select: { id: true },
    });
    supportGroupId = support.id;
    salesGroupId = sales.id;

    // The regular agent is in Support only.
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

    const northwindGroup = await owner.group.create({
      data: { licenseId: fx.b.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.b.licenseId,
        groupId: northwindGroup.id,
        agentId: fx.b.agentAccountId,
        priority: 'normal',
      },
    });

    acmeAdminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ADMIN_SCOPES,
    });
    acmeAgentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: AGENT_SCOPES,
    });
    northwindToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ADMIN_SCOPES,
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function startChat(
    token: string,
    options: { customerId?: string; groupIds?: number[]; text?: string } = {},
  ) {
    const response = await server.post(
      '/chats',
      {
        customer_id: options.customerId ?? fx.a.customerId,
        ...(options.groupIds ? { group_ids: options.groupIds } : {}),
        ...(options.text ? { initial_event: { type: 'message', text: options.text } } : {}),
      },
      auth(token),
    );
    expect([200, 201]).toContain(response.statusCode);
    return response.json() as { id: string; thread: { id: string } | null };
  }

  async function customerTokenFor(tenant: TenantFixture, customerId?: string) {
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
  // Access control
  // =========================================================================

  describe('access control', () => {
    it('hides a chat belonging to another tenant', async () => {
      const chat = await startChat(acmeAdminToken);

      const response = await server.get(`/chats/${chat.id}`, auth(northwindToken));
      // 404, not 403: a 403 would confirm the id is real.
      expect(response.statusCode).toBe(404);
    });

    it("refuses to write into another tenant's chat", async () => {
      const chat = await startChat(acmeAdminToken);

      const response = await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'injected' },
        auth(northwindToken),
      );
      expect(response.statusCode).toBe(404);

      const events = await owner.event.count({ where: { chatId: chat.id } });
      expect(events).toBe(0);
    });

    it('hides a chat routed to a team the agent is not in', async () => {
      // Created against Sales; the regular agent is only in Support.
      const chat = await startChat(acmeAdminToken, { groupIds: [Number(salesGroupId)] });

      expect((await server.get(`/chats/${chat.id}`, auth(acmeAgentToken))).statusCode).toBe(404);
      // The admin token carries `chats--all`, so it still sees everything.
      expect((await server.get(`/chats/${chat.id}`, auth(acmeAdminToken))).statusCode).toBe(200);
    });

    it('keeps it hidden from the list, not just from direct fetch', async () => {
      await startChat(acmeAdminToken, { groupIds: [Number(salesGroupId)] });

      const listed = await server.get('/chats', auth(acmeAgentToken));
      expect(listed.json().items).toHaveLength(0);
    });

    it('lets an agent keep a chat transferred to them personally', async () => {
      // Access via team is not the only route: someone handed this chat
      // directly to them, and losing it on the next team change would be wrong.
      const chat = await startChat(acmeAdminToken, { groupIds: [Number(salesGroupId)] });
      const transferred = await server.post(
        `/chats/${chat.id}/transfer`,
        { agent_id: fx.a.agentAccountId },
        auth(acmeAdminToken),
      );
      expect(transferred.statusCode).toBe(200);

      expect((await server.get(`/chats/${chat.id}`, auth(acmeAgentToken))).statusCode).toBe(200);
    });

    it('reflects a team removal immediately', async () => {
      const chat = await startChat(acmeAdminToken, { groupIds: [Number(supportGroupId)] });
      expect((await server.get(`/chats/${chat.id}`, auth(acmeAgentToken))).statusCode).toBe(200);

      await owner.groupAgent.deleteMany({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      });

      // Teams are read per request rather than baked into the token, so this
      // does not wait for a token rotation.
      expect((await server.get(`/chats/${chat.id}`, auth(acmeAgentToken))).statusCode).toBe(404);
    });

    it('refuses a token without any chat scope', async () => {
      const chat = await startChat(acmeAdminToken);
      const scopeless = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });

      expect((await server.get(`/chats/${chat.id}`, auth(scopeless))).statusCode).toBe(403);
    });

    it('refuses a read-only token for writes', async () => {
      const chat = await startChat(acmeAdminToken);
      const readOnly = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });

      expect((await server.get(`/chats/${chat.id}`, auth(readOnly))).statusCode).toBe(200);
      const write = await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'nope' },
        auth(readOnly),
      );
      expect(write.statusCode).toBe(403);
    });

    it('rejects a malformed chat id without touching the database', async () => {
      for (const id of ['../../etc/passwd', 'short', 'lowercase!!', "'; DROP TABLE chats; --"]) {
        const response = await server.get(`/chats/${encodeURIComponent(id)}`, auth(acmeAdminToken));
        expect([400, 404]).toContain(response.statusCode);
      }
      // The table is still there.
      expect(await owner.chat.count()).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // Internal notes must never reach the customer
  // =========================================================================

  describe('internal notes', () => {
    it('is withheld from the customer transcript', async () => {
      const { customer_id, token } = await customerTokenFor(fx.a);
      const chat = await startChat(acmeAdminToken, { customerId: customer_id, text: 'Hello' });

      await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'Card ends 4242 — verified', recipients: 'agents' },
        auth(acmeAdminToken),
      );
      await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'How can I help?' },
        auth(acmeAdminToken),
      );

      const agentView = await server.get(`/chats/${chat.id}/events`, auth(acmeAdminToken));
      const customerView = await server.get(`/chats/${chat.id}/events`, auth(token));

      const agentTexts = agentView.json().items.map((e: { text: string }) => e.text);
      const customerTexts = customerView.json().items.map((e: { text: string }) => e.text);

      expect(agentTexts).toContain('Card ends 4242 — verified');
      expect(customerTexts).not.toContain('Card ends 4242 — verified');
      expect(customerTexts).toContain('How can I help?');
    });

    it('does not leak a note through the whole response body', async () => {
      const { customer_id, token } = await customerTokenFor(fx.a);
      const chat = await startChat(acmeAdminToken, { customerId: customer_id, text: 'Hi' });
      await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'SECRET-NOTE-VALUE', recipients: 'agents' },
        auth(acmeAdminToken),
      );

      // Belt and braces: the string must not appear anywhere the customer can
      // read, including fields the transcript test does not inspect.
      const customerView = await server.get(`/chats/${chat.id}/events`, auth(token));
      expect(customerView.body).not.toContain('SECRET-NOTE-VALUE');
    });

    it('will not let a customer author an internal note', async () => {
      const { customer_id, token } = await customerTokenFor(fx.a);
      const chat = await startChat(acmeAdminToken, { customerId: customer_id, text: 'Hi' });

      const response = await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'sneaky', recipients: 'agents' },
        auth(token),
      );
      expect(response.statusCode).toBe(201);
      // Downgraded rather than rejected: the customer gets a normal message,
      // and no agent-only surface is created from the widget.
      expect(response.json().recipients).toBe('all');
      expect(response.json().author_type).toBe('customer');
    });
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================

  describe('lifecycle', () => {
    it('refuses to send into a closed conversation', async () => {
      const chat = await startChat(acmeAdminToken, { text: 'Hello' });
      await server.post(`/chats/${chat.id}/deactivate`, undefined, auth(acmeAdminToken));

      const response = await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'still here?' },
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(409);
      expect(response.json().error.type).toBe('chat_inactive');
    });

    it('refuses to close a conversation twice', async () => {
      const chat = await startChat(acmeAdminToken);
      expect(
        (await server.post(`/chats/${chat.id}/deactivate`, undefined, auth(acmeAdminToken)))
          .statusCode,
      ).toBe(200);
      expect(
        (await server.post(`/chats/${chat.id}/deactivate`, undefined, auth(acmeAdminToken)))
          .statusCode,
      ).toBe(409);
    });

    it('refuses to resume an already active conversation', async () => {
      const chat = await startChat(acmeAdminToken);
      const response = await server.post(
        `/chats/${chat.id}/resume`,
        undefined,
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(409);
    });

    it('opens a new thread on resume and leaves the archived one untouched', async () => {
      const chat = await startChat(acmeAdminToken, { text: 'First visit' });
      const originalThread = chat.thread!.id;

      await server.post(`/chats/${chat.id}/deactivate`, undefined, auth(acmeAdminToken));
      const resumed = await server.post(
        `/chats/${chat.id}/resume`,
        undefined,
        auth(acmeAdminToken),
      );
      expect(resumed.statusCode).toBe(200);

      const newThread = resumed.json().thread.id;
      expect(newThread).not.toBe(originalThread);

      // The archived exchange is preserved exactly as it was.
      const archived = await owner.thread.findUnique({ where: { id: originalThread } });
      expect(archived?.active).toBe(false);
      expect(archived?.closedAt).not.toBeNull();

      const archivedEvents = await server.get(
        `/chats/${chat.id}/events?thread_id=${originalThread}`,
        auth(acmeAdminToken),
      );
      expect(
        archivedEvents.json().items.some((e: { text: string }) => e.text === 'First visit'),
      ).toBe(true);
    });

    it('refuses to resume when the customer already has another open chat', async () => {
      const first = await startChat(acmeAdminToken, { customerId: fx.a.customerId });
      await server.post(`/chats/${first.id}/deactivate`, undefined, auth(acmeAdminToken));
      await startChat(acmeAdminToken, { customerId: fx.a.customerId });

      // Resuming would create a second active chat for one customer, which the
      // database refuses — report something actionable instead of a raw error.
      const response = await server.post(
        `/chats/${first.id}/resume`,
        undefined,
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toMatch(/already has an active chat/i);
    });

    it('returns the existing chat rather than creating a second one', async () => {
      const first = await startChat(acmeAdminToken, { customerId: fx.a.customerId });
      const again = await server.post(
        '/chats',
        { customer_id: fx.a.customerId },
        auth(acmeAdminToken),
      );

      expect(again.statusCode).toBe(200); // 200, not 201 — nothing was created
      expect(again.json().id).toBe(first.id);
      expect(await owner.chat.count({ where: { customerId: fx.a.customerId } })).toBe(1);
    });

    it('refuses to start a chat with a banned customer', async () => {
      await owner.customer.update({
        where: { id: fx.a.customerId },
        data: { bannedAt: new Date() },
      });
      const response = await server.post(
        '/chats',
        { customer_id: fx.a.customerId },
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().error.type).toBe('customer_banned');
    });

    it("refuses to start a chat with another tenant's customer", async () => {
      const response = await server.post(
        '/chats',
        { customer_id: fx.b.customerId },
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // Event integrity
  // =========================================================================

  describe('events', () => {
    // The server half of the composer's Retry (FR-MOD-02.3.6): the console
    // re-posts a failed send under the same key, so this replay is what stands
    // between "try again" and two copies in the customer's transcript.
    it('replays an idempotent send instead of duplicating it (FR-MOD-02.3.6)', async () => {
      const chat = await startChat(acmeAdminToken);
      const body = { type: 'message', text: 'Only once', idempotency_key: 'req-1' };

      const first = await server.post(`/chats/${chat.id}/events`, body, auth(acmeAdminToken));
      const retry = await server.post(`/chats/${chat.id}/events`, body, auth(acmeAdminToken));

      expect(first.statusCode).toBe(201);
      expect(retry.statusCode).toBe(200); // replay, nothing created
      expect(retry.json().id).toBe(first.json().id);

      const count = await owner.event.count({ where: { chatId: chat.id, text: 'Only once' } });
      expect(count).toBe(1);
    });

    it('treats different idempotency keys as different messages', async () => {
      const chat = await startChat(acmeAdminToken);
      await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'same text', idempotency_key: 'a' },
        auth(acmeAdminToken),
      );
      await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'same text', idempotency_key: 'b' },
        auth(acmeAdminToken),
      );

      expect(await owner.event.count({ where: { chatId: chat.id, text: 'same text' } })).toBe(2);
    });

    it("does not let one tenant replay another's idempotency key", async () => {
      const acme = await startChat(acmeAdminToken);
      await server.post(
        `/chats/${acme.id}/events`,
        { type: 'message', text: 'acme message', idempotency_key: 'shared-key' },
        auth(acmeAdminToken),
      );

      const northwindChat = await server.post(
        '/chats',
        { customer_id: fx.b.customerId },
        auth(northwindToken),
      );
      const response = await server.post(
        `/chats/${northwindChat.json().id}/events`,
        { type: 'message', text: 'northwind message', idempotency_key: 'shared-key' },
        auth(northwindToken),
      );

      expect(response.statusCode).toBe(201);
      expect(response.json().text).toBe('northwind message');
    });

    it('assigns unique, gapless sequence numbers under concurrency', async () => {
      const chat = await startChat(acmeAdminToken);

      // Read-then-write would let several of these observe the same value and
      // mint colliding ids; the increment happens in one UPDATE ... RETURNING.
      const sends = Array.from({ length: 12 }, (_, i) =>
        server.post(
          `/chats/${chat.id}/events`,
          { type: 'message', text: `msg-${i}` },
          auth(acmeAdminToken),
        ),
      );
      const responses = await Promise.all(sends);
      expect(responses.every((r) => r.statusCode === 201)).toBe(true);

      const ids = responses.map((r) => r.json().id as string);
      expect(new Set(ids).size).toBe(ids.length);

      const sequences = ids.map((id) => Number(id.split('_')[1])).sort((a, b) => a - b);
      expect(sequences).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    });

    it('rejects a message with neither text nor attachment', async () => {
      const chat = await startChat(acmeAdminToken);
      for (const body of [{ type: 'message' }, { type: 'message', text: '   ' }]) {
        const response = await server.post(`/chats/${chat.id}/events`, body, auth(acmeAdminToken));
        expect(response.statusCode).toBe(400);
      }
    });

    it('rejects an over-long message', async () => {
      const chat = await startChat(acmeAdminToken);
      const response = await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'x'.repeat(10_001) },
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown event type', async () => {
      const chat = await startChat(acmeAdminToken);
      const response = await server.post(
        `/chats/${chat.id}/events`,
        { type: 'telepathy', text: 'hi' },
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('stores text verbatim rather than escaping it server-side', async () => {
      // Escaping here would corrupt legitimate text and give a false sense of
      // safety; the widget escapes at render time, where the context is known.
      const chat = await startChat(acmeAdminToken);
      const payload = '<script>alert(1)</script> & "quotes"';
      const response = await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: payload },
        auth(acmeAdminToken),
      );
      expect(response.json().text).toBe(payload);
    });
  });

  // =========================================================================
  // Transcript paging and replay
  // =========================================================================

  describe('transcript', () => {
    it('replays everything after a known event', async () => {
      const chat = await startChat(acmeAdminToken);
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        const response = await server.post(
          `/chats/${chat.id}/events`,
          { type: 'message', text: `m${i}` },
          auth(acmeAdminToken),
        );
        ids.push(response.json().id);
      }

      // This is the primitive lossless reconnect is built on (slice 5).
      const after = await server.get(
        `/chats/${chat.id}/events?after_event_id=${ids[2]}`,
        auth(acmeAdminToken),
      );
      expect(after.json().items.map((e: { text: string }) => e.text)).toEqual(['m3', 'm4', 'm5']);
    });

    it('orders by sequence, not by timestamp', async () => {
      const chat = await startChat(acmeAdminToken);
      for (let i = 0; i < 12; i++) {
        await server.post(
          `/chats/${chat.id}/events`,
          { type: 'message', text: `m${i}` },
          auth(acmeAdminToken),
        );
      }

      const transcript = await server.get(`/chats/${chat.id}/events`, auth(acmeAdminToken));
      const texts = transcript.json().items.map((e: { text: string }) => e.text);
      // Lexical id ordering would put _10 before _2; sequence ordering does not.
      expect(texts).toEqual(Array.from({ length: 12 }, (_, i) => `m${i}`));
    });

    it('rejects an after_event_id from a different thread', async () => {
      const chat = await startChat(acmeAdminToken);
      const other = generateShortId();

      const response = await server.get(
        `/chats/${chat.id}/events?after_event_id=${other}_1`,
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('refuses a thread_id belonging to another chat', async () => {
      const mine = await startChat(acmeAdminToken, { customerId: fx.a.customerId });
      const otherCustomer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Other' },
        select: { id: true },
      });
      const other = await startChat(acmeAdminToken, { customerId: otherCustomer.id });

      const response = await server.get(
        `/chats/${mine.id}/events?thread_id=${other.thread!.id}`,
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(404);
    });

    it('pages without skipping or repeating', async () => {
      const chat = await startChat(acmeAdminToken);
      for (let i = 0; i < 7; i++) {
        await server.post(
          `/chats/${chat.id}/events`,
          { type: 'message', text: `m${i}` },
          auth(acmeAdminToken),
        );
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const url = `/chats/${chat.id}/events?limit=3${cursor ? `&after_event_id=${cursor}` : ''}`;
        const response = await server.get(url, auth(acmeAdminToken));
        const items = response.json().items as Array<{ id: string; text: string }>;
        if (items.length === 0) break;
        seen.push(...items.map((i) => i.text));
        cursor = response.json().next_page_id;
        if (!cursor) break;
      }

      expect(seen).toEqual(Array.from({ length: 7 }, (_, i) => `m${i}`));
      expect(new Set(seen).size).toBe(seen.length);
    });

    // A phone opens a conversation at its newest message and loads history as
    // the reader scrolls up — the opposite of the replay direction above, and
    // the reason `sort=newest` + `before_event_id` exist (13.7-f).
    it('walks the thread backwards from its newest event', async () => {
      const chat = await startChat(acmeAdminToken);
      for (let i = 0; i < 7; i++) {
        await server.post(
          `/chats/${chat.id}/events`,
          { type: 'message', text: `m${i}` },
          auth(acmeAdminToken),
        );
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const url =
          `/chats/${chat.id}/events?limit=3&sort=newest` +
          (cursor ? `&before_event_id=${cursor}` : '');
        const response = await server.get(url, auth(acmeAdminToken));
        const items = response.json().items as Array<{ id: string; text: string }>;
        if (items.length === 0) break;
        seen.push(...items.map((i) => i.text));
        cursor = response.json().next_page_id;
        if (!cursor) break;
      }

      // Newest first, no gap and no repeat — the exact reverse of the ascending
      // walk, which is what makes an inverted list render correctly.
      expect(seen).toEqual(['m6', 'm5', 'm4', 'm3', 'm2', 'm1', 'm0']);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('leaves the default direction alone when sort is omitted', async () => {
      // The web app and the realtime replay both depend on oldest-first being
      // what an unqualified request means; adding a direction must not move it.
      const chat = await startChat(acmeAdminToken);
      for (let i = 0; i < 3; i++) {
        await server.post(
          `/chats/${chat.id}/events`,
          { type: 'message', text: `m${i}` },
          auth(acmeAdminToken),
        );
      }

      const response = await server.get(`/chats/${chat.id}/events`, auth(acmeAdminToken));
      expect(response.json().items.map((e: { text: string }) => e.text)).toEqual([
        'm0',
        'm1',
        'm2',
      ]);
    });

    it('rejects a before_event_id from a different thread', async () => {
      const chat = await startChat(acmeAdminToken);
      const other = generateShortId();

      const response = await server.get(
        `/chats/${chat.id}/events?before_event_id=${other}_1`,
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('before_event_id');
    });
  });

  // =========================================================================
  // Transfer
  // =========================================================================

  describe('transfer', () => {
    it('refuses to hand a chat to a team with nobody accepting', async () => {
      const chat = await startChat(acmeAdminToken);
      // Sales has no members at all.
      const response = await server.post(
        `/chats/${chat.id}/transfer`,
        { group_id: Number(salesGroupId) },
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(409);
      expect(response.json().error.type).toBe('group_offline');
    });

    it('refuses to transfer to a team in another tenant', async () => {
      const chat = await startChat(acmeAdminToken);
      const theirGroup = await owner.group.findFirstOrThrow({
        where: { licenseId: fx.b.licenseId },
        select: { id: true },
      });

      const response = await server.post(
        `/chats/${chat.id}/transfer`,
        { group_id: Number(theirGroup.id) },
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(404);
      expect(response.json().error.type).toBe('group_not_found');
    });

    it('refuses to transfer to an offline agent (FR-MOD-02.4.1–.6)', async () => {
      const chat = await startChat(acmeAdminToken);
      await owner.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        },
        data: { routingStatus: 'offline' },
      });

      const response = await server.post(
        `/chats/${chat.id}/transfer`,
        { agent_id: fx.a.agentAccountId },
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(409);
      // The Details panel's assignee menu words this refusal specifically
      // ("that teammate is offline") by branching on the ADR-06 type, so the
      // type is part of the contract here and not merely the status.
      expect(response.json().error.type).toBe('group_unavailable');
    });

    it('refuses both or neither target', async () => {
      const chat = await startChat(acmeAdminToken);
      for (const body of [
        {},
        { group_id: Number(supportGroupId), agent_id: fx.a.agentAccountId },
      ]) {
        const response = await server.post(
          `/chats/${chat.id}/transfer`,
          body,
          auth(acmeAdminToken),
        );
        expect(response.statusCode).toBe(400);
      }
    });

    it('moves team access and records a system event', async () => {
      const chat = await startChat(acmeAdminToken, { groupIds: [Number(salesGroupId)] });
      // Give Sales a member so the transfer is permitted.
      await owner.groupAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          groupId: salesGroupId,
          agentId: fx.a.ownerAccountId,
          priority: 'normal',
        },
      });

      const response = await server.post(
        `/chats/${chat.id}/transfer`,
        { group_id: Number(supportGroupId) },
        auth(acmeAdminToken),
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().access.group_ids).toEqual([Number(supportGroupId)]);

      const transcript = await server.get(`/chats/${chat.id}/events`, auth(acmeAdminToken));
      const system = transcript
        .json()
        .items.find(
          (e: { properties: { system_event?: string } }) =>
            e.properties.system_event === 'chat_transferred',
        );
      expect(system).toBeDefined();
      expect(system.author_type).toBe('system');
    });
  });

  // =========================================================================
  // Takeover (FR-MOD-08.6.3) — a supervisor forcibly seizes a chat
  // =========================================================================

  describe('takeover', () => {
    /** A chat currently held by the regular agent, so a seizure has a real
     *  previous holder to displace. */
    async function chatHeldByAgent() {
      const chat = await startChat(acmeAdminToken);
      const transferred = await server.post(
        `/chats/${chat.id}/transfer`,
        { agent_id: fx.a.agentAccountId },
        auth(acmeAdminToken),
      );
      expect(transferred.statusCode).toBe(200);
      return chat;
    }

    // --- Negatives first ----------------------------------------------------

    it('refuses an agent-role teammate, even with the all-chats scope', async () => {
      const chat = await chatHeldByAgent();
      // Agent role but a broad token: proves the *role* gate fires, not the scope.
      const agentAllToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--all:rw'],
      });
      const res = await server.post(`/chats/${chat.id}/takeover`, {}, auth(agentAllToken));
      expect(res.statusCode).toBe(403);
      expect(res.json().error.type).toBe('authorization');
    });

    it('refuses a bot principal, even with the all-chats scope', async () => {
      const chat = await chatHeldByAgent();
      const bot = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Bot', kind: 'ai_agent', active: true },
        select: { id: true },
      });
      const botToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: bot.id,
        scopes: ['chats--all:rw'],
        kind: 'bot',
      });
      const res = await server.post(`/chats/${chat.id}/takeover`, {}, auth(botToken));
      expect(res.statusCode).toBe(403);
    });

    it('cannot take over a chat in another tenant (404, un-enumerable)', async () => {
      const chat = await chatHeldByAgent();
      const res = await server.post(`/chats/${chat.id}/takeover`, {}, auth(northwindToken));
      expect(res.statusCode).toBe(404);
      expect(res.json().error.type).toBe('not_found');
    });

    it('refuses to take over a closed chat (409 chat_inactive)', async () => {
      const chat = await chatHeldByAgent();
      await server.post(`/chats/${chat.id}/deactivate`, {}, auth(acmeAdminToken));
      const res = await server.post(`/chats/${chat.id}/takeover`, {}, auth(acmeAdminToken));
      expect(res.statusCode).toBe(409);
      expect(res.json().error.type).toBe('chat_inactive');
    });

    // --- Positive -----------------------------------------------------------

    it('reassigns to the supervisor, demotes the previous holder, records a system event', async () => {
      const chat = await chatHeldByAgent();
      const res = await server.post(
        `/chats/${chat.id}/takeover`,
        { reason: 'Escalation' },
        auth(acmeAdminToken),
      );
      expect(res.statusCode).toBe(200);
      // The owner (the admin token's account) now holds it...
      expect(res.json().thread.assignee_id).toBe(fx.a.ownerAccountId);
      // ...and the agent it was taken from stays on the chat, no longer present.
      const previous = res
        .json()
        .users.find((u: { user_id: string }) => u.user_id === fx.a.agentAccountId);
      expect(previous).toBeDefined();
      expect(previous.present).toBe(false);

      const transcript = await server.get(`/chats/${chat.id}/events`, auth(acmeAdminToken));
      const system = transcript
        .json()
        .items.find(
          (e: { properties: { system_event?: string } }) =>
            e.properties.system_event === 'chat_taken_over',
        );
      expect(system).toBeDefined();
      expect(system.author_type).toBe('system');
      expect(system.properties.previous_assignee_id).toBe(fx.a.agentAccountId);
    });

    // --- Concurrency: exactly one supervisor may win ------------------------

    it('rejects a supervisor who loses the assignee race (409 takeover_conflict)', async () => {
      const chat = await chatHeldByAgent();
      const threadId = (await server.get(`/chats/${chat.id}`, auth(acmeAdminToken))).json().thread
        .id;

      // Model the *winning* supervisor as a lock we hold: move the assignee off
      // the agent and keep the row locked until the in-flight takeover is parked
      // behind us. When we commit, the takeover's conditional
      // `WHERE assignee_id = <agent>` matches nothing — precisely the path a
      // second, concurrent supervisor takes. Deterministic: no lucky interleave.
      let release!: () => void;
      const locked = new Promise<void>((resolve) => (release = resolve));
      const winner = owner.$transaction(
        async (tx) => {
          await tx.$executeRaw`UPDATE threads SET assignee_id = ${fx.a.ownerAccountId}::uuid WHERE id = ${threadId}`;
          await locked;
        },
        { timeout: 15_000 },
      );

      const takeover = server.post(`/chats/${chat.id}/takeover`, {}, auth(acmeAdminToken));
      // Give the takeover time to read the (still-agent) assignee and block on
      // our lock, then let the winner commit and the takeover re-evaluate.
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();

      const [res] = await Promise.all([takeover, winner]);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.type).toBe('takeover_conflict');

      // The seizure that lost wrote nothing: the winner's assignee stands alone.
      const detail = await server.get(`/chats/${chat.id}`, auth(acmeAdminToken));
      expect(detail.json().thread.assignee_id).toBe(fx.a.ownerAccountId);
    });

    it('lets exactly one of two live supervisors win a simultaneous takeover', async () => {
      const chat = await chatHeldByAgent();
      // A second supervisor (admin role) racing the owner for the same chat.
      const second = await owner.account.create({
        data: { email: `admin2-${Date.now()}@example.test`, name: 'Second Admin' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: {
          licenseId: fx.a.licenseId,
          agentId: second.id,
          role: 'admin',
          routingStatus: 'accepting_chats',
        },
      });
      const secondToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: second.id,
        scopes: ['chats--all:rw'],
      });

      const [a, b] = await Promise.all([
        server.post(`/chats/${chat.id}/takeover`, {}, auth(acmeAdminToken)),
        server.post(`/chats/${chat.id}/takeover`, {}, auth(secondToken)),
      ]);

      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      const loser = a.statusCode === 409 ? a : b;
      expect(loser.json().error.type).toBe('takeover_conflict');

      // Whoever won, the chat has a single assignee and it is one of the two.
      const assignee = (await server.get(`/chats/${chat.id}`, auth(acmeAdminToken))).json().thread
        .assignee_id;
      expect([fx.a.ownerAccountId, second.id]).toContain(assignee);
    });

    // --- Surface separation: transfer vs takeover ---------------------------

    it('separates the two surfaces — an agent-role token may transfer but never take over', async () => {
      // The two paths are deliberately distinct: transfer is a consented,
      // scope-gated hand-off (no role gate); takeover is the admin-only seizure.
      // One credential pins the split — the same agent-role token, holding the
      // very scope takeover asks for, succeeds at transfer and is refused the
      // takeover on the *role* gate, not the scope.
      const chat = await chatHeldByAgent();
      const agentAllToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--all:rw'],
      });

      // Transfer: the agent hands the chat to their own team — permitted.
      const transfer = await server.post(
        `/chats/${chat.id}/transfer`,
        { group_id: Number(supportGroupId) },
        auth(agentAllToken),
      );
      expect(transfer.statusCode).toBe(200);

      // Takeover: the same token, refused on the admin role gate.
      const takeover = await server.post(`/chats/${chat.id}/takeover`, {}, auth(agentAllToken));
      expect(takeover.statusCode).toBe(403);
      expect(takeover.json().error.type).toBe('authorization');
    });
  });

  // =========================================================================
  // Tags
  // =========================================================================

  describe('tags', () => {
    it('creates the tag on demand and is idempotent', async () => {
      const chat = await startChat(acmeAdminToken);

      const first = await server.post(
        `/chats/${chat.id}/tags`,
        { tag: 'Billing' },
        auth(acmeAdminToken),
      );
      expect(first.statusCode).toBe(200);
      expect(first.json().tags).toEqual(['billing']); // normalised

      const again = await server.post(
        `/chats/${chat.id}/tags`,
        { tag: 'billing' },
        auth(acmeAdminToken),
      );
      expect(again.json().tags).toEqual(['billing']);
      expect(await owner.tag.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    });

    it('removes a tag and reports an unknown one as missing', async () => {
      const chat = await startChat(acmeAdminToken);
      await server.post(`/chats/${chat.id}/tags`, { tag: 'bug' }, auth(acmeAdminToken));

      expect(
        (await server.del(`/chats/${chat.id}/tags/bug`, auth(acmeAdminToken))).statusCode,
      ).toBe(204);
      expect(
        (await server.del(`/chats/${chat.id}/tags/bug`, auth(acmeAdminToken))).statusCode,
      ).toBe(404);
    });

    it('does not let a tag be applied across tenants', async () => {
      const chat = await startChat(acmeAdminToken);
      const response = await server.post(
        `/chats/${chat.id}/tags`,
        { tag: 'shared' },
        auth(northwindToken),
      );
      expect(response.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // Listing
  // =========================================================================

  describe('listing', () => {
    async function seedChats(count: number) {
      const created: string[] = [];
      for (let i = 0; i < count; i++) {
        const customer = await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: `Customer ${i}` },
          select: { id: true },
        });
        const chat = await startChat(acmeAdminToken, { customerId: customer.id, text: `hi ${i}` });
        created.push(chat.id);
      }
      return created;
    }

    it('separates active from archived', async () => {
      const ids = await seedChats(3);
      await server.post(`/chats/${ids[0]}/deactivate`, undefined, auth(acmeAdminToken));

      const active = await server.get('/chats?view=all', auth(acmeAdminToken));
      const archived = await server.get('/chats?view=archived', auth(acmeAdminToken));

      expect(archived.json().items.map((c: { id: string }) => c.id)).toEqual([ids[0]]);
      expect(active.json().items).toHaveLength(3); // `all` includes archived
    });

    it("filters to the caller's own chats", async () => {
      await seedChats(2);
      const mine = await server.get('/chats?view=my', auth(acmeAdminToken));
      // Every chat was started by, and assigned to, the admin.
      expect(mine.json().items.length).toBe(2);

      const theirs = await server.get('/chats?view=my', auth(acmeAgentToken));
      expect(theirs.json().items).toHaveLength(0);
    });

    it('pages through every chat exactly once', async () => {
      const ids = await seedChats(7);

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 6; page++) {
        const url = `/chats?limit=3${cursor ? `&page_id=${encodeURIComponent(cursor)}` : ''}`;
        const response = await server.get(url, auth(acmeAdminToken));
        seen.push(...response.json().items.map((c: { id: string }) => c.id));
        cursor = response.json().next_page_id;
        if (!cursor) break;
      }

      expect(new Set(seen).size).toBe(ids.length);
      expect([...seen].sort()).toEqual([...ids].sort());
    });

    it('starts over rather than failing on a corrupt cursor', async () => {
      await seedChats(2);
      const response = await server.get('/chats?page_id=not-a-cursor', auth(acmeAdminToken));
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(2);
    });

    it('includes the last event and unread state', async () => {
      const ids = await seedChats(1);
      await server.post(
        `/chats/${ids[0]}/events`,
        { type: 'message', text: 'latest' },
        auth(acmeAdminToken),
      );

      const listed = await server.get('/chats', auth(acmeAdminToken));
      const chat = listed.json().items[0];
      expect(chat.last_event.text).toBe('latest');
      expect(chat.unread_count).toBe(1);

      await server.post(
        `/chats/${ids[0]}/seen`,
        { seen_up_to: new Date(Date.now() + 1000).toISOString() },
        auth(acmeAdminToken),
      );
      const afterSeen = await server.get('/chats', auth(acmeAdminToken));
      expect(afterSeen.json().items[0].unread_count).toBe(0);
    });

    it("never returns another tenant's chats", async () => {
      await seedChats(2);
      await server.post('/chats', { customer_id: fx.b.customerId }, auth(northwindToken));

      const acme = await server.get('/chats', auth(acmeAdminToken));
      const northwind = await server.get('/chats', auth(northwindToken));

      expect(acme.json().items).toHaveLength(2);
      expect(northwind.json().items).toHaveLength(1);
    });

    // =====================================================================
    // Ordering: last activity, not creation time (PRD FR-MOD-02.2.2 —
    // «Tıklama transcript açar; RTM'de yukarı taşınır + unread»).
    //
    // The half that was missing was the second one. The list ordered on
    // `chats.created_at`, a column nothing ever updates, so a visitor who wrote
    // stayed exactly where they had started: an agent working the list from the
    // top was working it in the order conversations *opened*, which on a busy
    // inbox has nothing to do with who is waiting.
    // =====================================================================

    describe('ordering by last activity', () => {
      const ids = (body: { items: Array<{ id: string }> }): string[] =>
        body.items.map((chat) => chat.id);

      interface Page {
        items: Array<{ id: string; unread_count: number }>;
        total: number;
        next_page_id?: string;
      }

      const list = async (query = '', token = acmeAdminToken): Promise<Page> => {
        const response = await server.get(`/chats${query}`, auth(token));
        expect(response.statusCode).toBe(200);
        return response.json() as Page;
      };

      /** A conversation with a visitor who can still write into it. */
      async function conversationWithVisitor(label: string) {
        const visitor = await customerTokenFor(fx.a);
        const chat = await startChat(acmeAdminToken, {
          customerId: visitor.customer_id,
          text: `opened ${label}`,
        });
        return { chatId: chat.id, token: visitor.token };
      }

      it('moves the conversation a visitor just wrote in to the top (FR-MOD-02.2.2)', async () => {
        const a = await conversationWithVisitor('A');
        const b = await conversationWithVisitor('B');

        // As it stands: B opened last, so B is on top. Both orders agree at this
        // point, which is exactly why the defect was invisible on a fresh
        // workspace and why the assertion below is the one that matters.
        expect(ids(await list())).toEqual([b.chatId, a.chatId]);

        const wrote = await server.post(
          '/customer/chat/events',
          { text: 'are you still there?' },
          auth(a.token),
        );
        expect(wrote.statusCode).toBe(201);

        // The requirement, as one assertion: the conversation that spoke is now
        // first. Ordered by `created_at` this list would still read [B, A].
        const after = await list();
        expect(ids(after)).toEqual([a.chatId, b.chatId]);
        // «+ unread» is the same clause of the same acceptance criterion, and it
        // worked before this change — asserted here so re-ordering cannot
        // quietly cost it.
        expect(after.items[0]?.unread_count).toBe(1);
      });

      it('sorted oldest-first, puts the least recently active first (FR-MOD-02.2.1)', async () => {
        const a = await conversationWithVisitor('A');
        const b = await conversationWithVisitor('B');

        // One key, two directions: "Oldest" is the stale end of the same axis
        // rather than a second meaning of order. Before A speaks it is the stale
        // end; after, B is.
        expect(ids(await list('?sort=oldest'))).toEqual([a.chatId, b.chatId]);
        await server.post('/customer/chat/events', { text: 'hello?' }, auth(a.token));
        expect(ids(await list('?sort=oldest'))).toEqual([b.chatId, a.chatId]);
      });

      it('bumps the row for an agent-authored event too, not only an inbound one', async () => {
        const a = await conversationWithVisitor('A');
        const b = await conversationWithVisitor('B');
        expect(ids(await list())).toEqual([b.chatId, a.chatId]);

        // `#appendEvent` is the single place an event is ever written, so every
        // producer — a reply, a close, a transfer, a takeover — moves the row.
        // Asserted through the agent surface because that is the one a
        // regression would most plausibly route around.
        await server.post(
          `/chats/${a.chatId}/events`,
          { type: 'message', text: 'still here' },
          auth(acmeAdminToken),
        );
        expect(ids(await list())).toEqual([a.chatId, b.chatId]);
      });

      it('keeps the page chain whole when a row on a page already read is bumped', async () => {
        const seeded = await seedChats(7);
        const first = await list('?limit=3');
        expect(first.items).toHaveLength(3);
        expect(first.next_page_id).toBeDefined();

        // A chat *on the page already read* is the case the console actually
        // produces: the agent is looking at the top of the list when a message
        // lands on one of the rows in front of them. Its key moves further above
        // a cursor it was already above, so the rest of the chain is untouched.
        const bumped = first.items[1]!.id;
        await server.post(
          `/chats/${bumped}/events`,
          { type: 'message', text: 'bump' },
          auth(acmeAdminToken),
        );

        const seen = [...ids(first)];
        let cursor = first.next_page_id;
        for (let page = 0; page < 5 && cursor; page += 1) {
          const body = await list(`?limit=3&page_id=${encodeURIComponent(cursor)}`);
          seen.push(...ids(body));
          cursor = body.next_page_id;
        }

        expect(new Set(seen).size).toBe(seen.length); // nothing handed out twice
        expect([...seen].sort()).toEqual([...seeded].sort()); // nothing skipped
      });

      it('never repeats a row when one climbs out of a page not yet read', async () => {
        const seeded = await seedChats(7);
        const first = await list('?limit=3');

        // The other direction, stated rather than hidden. A row *below* the
        // cursor that gets an event climbs above it, into the pages already
        // read — no ordering on a key that moves can avoid that. What it must
        // never do is hand the same row out twice: a duplicate is a list that is
        // wrong, while a late arrival is a list that is one beat stale.
        const climber = seeded[1]!; // second-oldest: page 2, newest-first
        await server.post(
          `/chats/${climber}/events`,
          { type: 'message', text: 'climb' },
          auth(acmeAdminToken),
        );

        const seen = [...ids(first)];
        let cursor = first.next_page_id;
        for (let page = 0; page < 5 && cursor; page += 1) {
          const body = await list(`?limit=3&page_id=${encodeURIComponent(cursor)}`);
          seen.push(...ids(body));
          cursor = body.next_page_id;
        }

        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).not.toContain(climber);
        expect(new Set([...seen, climber]).size).toBe(seeded.length);

        // And the repair is not hypothetical: re-reading the first page — what
        // `useInbox.ts`'s `refreshChatHeads` does on every push — finds it, at
        // the top, which is where it now belongs.
        expect(ids(await list('?limit=3'))[0]).toBe(climber);
      });

      it("is not re-ordered by another tenant's traffic", async () => {
        const a = await conversationWithVisitor('A');
        const b = await conversationWithVisitor('B');
        const before = ids(await list());
        expect(before).toEqual([b.chatId, a.chatId]);

        const opened = await server.post(
          '/chats',
          { customer_id: fx.b.customerId, initial_event: { type: 'message', text: 'hi' } },
          auth(northwindToken),
        );
        expect([200, 201]).toContain(opened.statusCode);
        await server.post(
          `/chats/${(opened.json() as { id: string }).id}/events`,
          { type: 'message', text: 'loud neighbour' },
          auth(northwindToken),
        );

        // The newest activity in the database now belongs to the other tenant.
        // Acme's list must not merely hide that row — its *order* must not know
        // the event happened at all.
        expect(ids(await list())).toEqual(before);
      });

      it('serves the order out of an index, inside the NFR-P2 read budget (EXPLAIN ANALYZE)', async () => {
        await seedChats(6);

        // The query `listChatsInTenant` issues, reduced to the part under test:
        // the tenant predicate (what RLS's `license_id = nexa_current_license()`
        // evaluates to), the default view's `active`, the new ordering, and the
        // page's LIMIT.
        const sql = `SELECT id FROM chats WHERE license_id = $1 AND active
                     ORDER BY last_event_at DESC, id DESC LIMIT 51`;

        const explain = async (plannerSetup: string[] = []): Promise<Record<string, unknown>> =>
          owner.$transaction(async (tx) => {
            for (const statement of plannerSetup) await tx.$executeRawUnsafe(statement);
            const [row] = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
              fx.a.licenseId,
            );
            const raw = row?.['QUERY PLAN'];
            const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<
              Record<string, unknown>
            >;
            return parsed[0] ?? {};
          });

        // Two claims, kept separate because they fail for different reasons.
        //
        // (1) Structural: this order is servable *from an index*, with no sort
        //     step. It is the claim that matters at production row counts —
        //     without it every page is a full scan of the workspace's chats plus
        //     a top-N sort — and it is what a change that drops the index, or
        //     orders on an expression, would break. Measured with sorting and
        //     the unordered access paths switched off, because on six rows in
        //     one heap page they are genuinely cheaper and the planner is right
        //     to prefer them (it picks a bitmap scan on `uq_one_active_chat`
        //     plus a quicksort). Switching them off asks the question the probe
        //     is about — "can this order come out of an index at all" — rather
        //     than the one the fixture size answers, "is this table small". The
        //     knobs are hints, not prohibitions: PostgreSQL still emits a sort
        //     if that is the only way to produce the order, so a missing index
        //     fails this assertion rather than silently satisfying it.
        const indexed = await explain([
          'SET LOCAL enable_seqscan = off',
          'SET LOCAL enable_bitmapscan = off',
          'SET LOCAL enable_sort = off',
        ]);
        const indexedPlan = JSON.stringify(indexed['Plan'] ?? {});
        expect(indexedPlan).toContain('chats_license_id_last_event_at_idx');
        expect(indexedPlan).not.toContain('"Node Type":"Sort"');

        // (2) Budgetary: NFR-P2 puts reads at p99 < 150 ms. On this dataset
        //     execution is sub-millisecond either way, so the assertion is a
        //     floor a plan regression would blow through rather than a
        //     production measurement; the figures are recorded in HANDOFF as the
        //     evidence this requirement owes.
        const planned = await explain();
        const plannedMs = planned['Execution Time'];
        const indexedMs = indexed['Execution Time'];
        expect(typeof plannedMs).toBe('number');
        expect(typeof indexedMs).toBe('number');
        console.log(
          'NFR-P2 GET /chats ordering (last_event_at DESC, id DESC, limit 51) — ' +
            `${String(plannedMs)} ms as planned · ${String(indexedMs)} ms forced onto the index`,
        );
        expect(plannedMs as number).toBeLessThan(READ_BUDGET_MS);
        expect(indexedMs as number).toBeLessThan(READ_BUDGET_MS);
      });
    });
  });

  // =========================================================================
  // The Chats group's Supervised bucket: conversations the *caller* is watching
  // without owning. `rapor-1-fonksiyonel.md:339` defines it in one clause —
  // «"Supervised" ajanin izledigi (supervise) sohbetler» — so the thing under
  // test is that the list is keyed by the watcher, not by "somebody is
  // watching", which is the different question the Traffic board asks.
  // =========================================================================

  describe('Supervised view (FR-MOD-02.1.1)', () => {
    /** A chat of its own customer, so `seen` de-duplication cannot merge two. */
    async function chatFor(name: string) {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name },
        select: { id: true },
      });
      return startChat(acmeAdminToken, { customerId: customer.id, text: `hi ${name}` });
    }

    const ids = (response: { json: () => { items: Array<{ id: string }> } }) =>
      response.json().items.map((c) => c.id);

    async function supervised(token: string) {
      const response = await server.get('/chats?view=supervised', auth(token));
      expect(response.statusCode).toBe(200);
      return response;
    }

    it('lists only the conversations the caller is watching', async () => {
      const watched = await chatFor('Watched');
      const ignored = await chatFor('Ignored');

      expect(ids(await supervised(acmeAdminToken))).toHaveLength(0);

      const registered = await server.post(
        `/chats/${watched.id}/supervise`,
        undefined,
        auth(acmeAdminToken),
      );
      expect(registered.statusCode).toBe(200);

      const listed = await supervised(acmeAdminToken);
      expect(ids(listed)).toEqual([watched.id]);
      expect(ids(listed)).not.toContain(ignored.id);
      // The rail counter reads `total`, so it has to describe the same set as
      // the rows beside it rather than the page it happened to fetch.
      expect(listed.json().total).toBe(1);
    });

    it('does not show a chat because somebody else is watching it', async () => {
      // Started by the admin and routed to Support by the fallback rule, so the
      // ordinary agent may see it — which is exactly why "visible" must not be
      // enough to put it in their Supervised list.
      const chat = await chatFor('Watched by the agent');
      await server.post(`/chats/${chat.id}/supervise`, undefined, auth(acmeAgentToken));

      expect(ids(await supervised(acmeAgentToken))).toEqual([chat.id]);
      // The admin can see this conversation and is not watching it.
      expect(ids(await server.get('/chats?view=all', auth(acmeAdminToken)))).toContain(chat.id);
      expect(ids(await supervised(acmeAdminToken))).toHaveLength(0);
    });

    it("never returns a chat another tenant's agent is watching", async () => {
      const acme = await chatFor('Acme');
      await server.post(`/chats/${acme.id}/supervise`, undefined, auth(acmeAdminToken));

      const northwind = await server.post(
        '/chats',
        { customer_id: fx.b.customerId },
        auth(northwindToken),
      );
      expect([200, 201]).toContain(northwind.statusCode);
      const northwindChatId = (northwind.json() as { id: string }).id;
      await server.post(`/chats/${northwindChatId}/supervise`, undefined, auth(northwindToken));

      // Each side sees its own row and nothing of the other's — the rows exist
      // in one table, so a missing tenant predicate would show up right here.
      expect(ids(await supervised(acmeAdminToken))).toEqual([acme.id]);
      expect(ids(await supervised(northwindToken))).toEqual([northwindChatId]);
    });

    it('drops a watched conversation once it is archived', async () => {
      const chat = await chatFor('Closing');
      await server.post(`/chats/${chat.id}/supervise`, undefined, auth(acmeAdminToken));
      expect(ids(await supervised(acmeAdminToken))).toEqual([chat.id]);

      await server.post(`/chats/${chat.id}/deactivate`, undefined, auth(acmeAdminToken));

      // Closing the conversation is what ends the watching: the list is bounded
      // by `active`, not by a heartbeat, and Archive stays the home of closed
      // conversations for this view as for every other.
      expect(ids(await supervised(acmeAdminToken))).toHaveLength(0);
      expect(ids(await server.get('/chats?view=archived', auth(acmeAdminToken)))).toEqual([
        chat.id,
      ]);
    });

    it('still refuses a view it does not know', async () => {
      // The enum grew by one value; it did not become a free-text field.
      const response = await server.get('/chats?view=supervisor', auth(acmeAdminToken));
      expect(response.statusCode).toBe(400);
      expect((response.json() as { error: { type: string } }).error.type).toBe('validation');
    });
  });

  // =========================================================================
  // AI Agents group (PRD 02.1.2): AI-handled chats get their own home, kept
  // out of the human queue, and "Solved" is the AI-resolution set ADR-09 bills
  // for — the same predicate Reports reads as "Automated".
  // =========================================================================

  describe('AI Agents group', () => {
    /**
     * An AI-handled conversation: the bot has replied and no human agent has,
     * with nobody assigned — the state that belongs in the AI group. Built
     * directly (like the billing tests) so no routing or agent write slips an
     * agent event in. The event suffixes are high so the system event a later
     * deactivate appends (sequence 1) cannot collide with them.
     */
    async function aiChat(name: string): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name },
        select: { id: true },
      });
      const chatId = generateShortId();
      const threadId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
      });
      await owner.thread.create({
        data: { id: threadId, chatId, licenseId: fx.a.licenseId, active: true },
      });
      await owner.event.createMany({
        data: [
          {
            id: `${threadId}_50`,
            threadId,
            chatId,
            licenseId: fx.a.licenseId,
            type: 'message',
            text: 'Is my order shipped?',
            authorType: 'customer',
            recipients: 'all',
          },
          {
            id: `${threadId}_99`,
            threadId,
            chatId,
            licenseId: fx.a.licenseId,
            type: 'message',
            text: 'Yes — it left today.',
            authorType: 'bot',
            recipients: 'all',
          },
        ],
      });
      return chatId;
    }

    /**
     * A visitor waiting in the human queue: unassigned, no bot has engaged, no
     * agent yet. Crucially it has no agent event either — so only the AI group's
     * requirement of a bot event keeps it out of that group.
     */
    async function waitingChat(name: string): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name },
        select: { id: true },
      });
      const chatId = generateShortId();
      const threadId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
      });
      await owner.thread.create({
        data: { id: threadId, chatId, licenseId: fx.a.licenseId, active: true },
      });
      await owner.event.create({
        data: {
          id: `${threadId}_50`,
          threadId,
          chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text: 'Anyone there?',
          authorType: 'customer',
          recipients: 'all',
        },
      });
      return chatId;
    }

    const ids = (r: { json(): { items: Array<{ id: string }> } }): string[] =>
      r.json().items.map((c) => c.id);

    it('gives AI-handled chats their own group, distinct from the human queue', async () => {
      const ai = await aiChat('AI Visitor');
      const waiting = await waitingChat('Waiting Visitor');

      // The AI group holds the AI chat and *only* the AI chat: the waiting
      // visitor stays out of it even though it, too, has no agent event. The
      // difference is the bot — that is what "AI konuşmalarını insan
      // kuyruğundan ayırır" means here.
      const aiView = await server.get('/chats?view=ai', auth(acmeAdminToken));
      expect(ids(aiView)).toEqual([ai]);

      // The waiting visitor is still in the human queue where a human can pick
      // it up; the AI chat is in neither the assigned nor the queued human view.
      expect(ids(await server.get('/chats?view=unassigned', auth(acmeAdminToken)))).toContain(
        waiting,
      );
      expect(ids(await server.get('/chats?view=my', auth(acmeAdminToken)))).not.toContain(ai);
      expect(ids(await server.get('/chats?view=queued', auth(acmeAdminToken)))).not.toContain(ai);
    });

    it('drops a conversation out of the AI group once a human agent replies', async () => {
      const chatId = await aiChat('Escalated');
      // One agent-authored event is the line ADR-09 draws: it stops being an AI
      // conversation, in the inbox and on the invoice alike.
      await server.post(
        `/chats/${chatId}/events`,
        { type: 'message', text: 'A human here now — let me look.' },
        auth(acmeAdminToken),
      );

      expect(ids(await server.get('/chats?view=ai', auth(acmeAdminToken)))).not.toContain(chatId);
    });

    it('moves solved AI chats into Solved and counts them exactly as ADR-09 bills', async () => {
      const first = await aiChat('Solved A');
      const second = await aiChat('Solved B');
      // A human-handled conversation, closed too: it must land in neither Solved
      // nor the AI-resolution counter.
      const person = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Human closed' },
        select: { id: true },
      });
      const human = await startChat(acmeAdminToken, {
        customerId: person.id,
        text: 'A person — handled by me.',
      });

      // Close all three through the real endpoint, so ADR-09 accounting runs in
      // the same transaction that closes each one.
      for (const id of [first, second, human.id]) {
        expect(
          (await server.post(`/chats/${id}/deactivate`, undefined, auth(acmeAdminToken)))
            .statusCode,
        ).toBe(200);
      }

      // Solved lists exactly the two AI resolutions; the human chat is excluded
      // because an agent wrote in it.
      const solvedIds = ids(await server.get('/chats?view=ai_solved', auth(acmeAdminToken)));
      expect([...solvedIds].sort()).toEqual([first, second].sort());
      expect(solvedIds).not.toContain(human.id);

      // Closing them empties the active AI group — a resolved chat is no longer
      // one the AI is handling.
      expect(ids(await server.get('/chats?view=ai', auth(acmeAdminToken)))).toHaveLength(0);

      // The whole point of ADR-09: the Solved list and the billing counter read
      // one predicate, so they cannot disagree.
      const usage = await owner.usageRecord.findFirst({
        where: { licenseId: fx.a.licenseId, metric: 'ai_resolutions' },
      });
      expect(Number(usage?.quantity ?? 0n)).toBe(2);
      expect(solvedIds).toHaveLength(Number(usage?.quantity ?? 0n));
    });

    // =======================================================================
    // The counter past one page (audit D3 · M-COUNT-a)
    //
    // Every assertion above holds on a fixture of two or three rows, which is
    // exactly why the defect survived: the console counted the rows it had
    // loaded, and up to the page size that number is right. So this block is
    // deliberately larger than a page — sixty AI resolutions read twenty-five
    // at a time — because that is the only size at which "counted the page"
    // and "counted the view" give different answers.
    // =======================================================================

    describe('the Solved counter past one page', () => {
      /** Ten past the console's own 50-row chat page (`useInbox.ts`). */
      const SOLVED = 60;
      /** Closed by a human: in Archive, never in Solved, never on the invoice. */
      const HUMAN_CLOSED = 3;
      /** Still being handled by the AI: in the `ai` view, not yet in Solved. */
      const STILL_RUNNING = 2;
      /** The task's page size — small enough that Solved spans three pages. */
      const PAGE = 25;

      /**
       * Sixty-five conversations in four `createMany` calls rather than
       * sixty-five round trips through `aiChat`: the rows exist to be counted,
       * not to exercise the write path, and the per-row helper above turns this
       * fixture into some two hundred and sixty statements.
       *
       * They are created *active* and closed through the real endpoint below,
       * because closing is where ADR-09 meters — a chat written straight to
       * `active: false` would appear in Solved with nothing on the invoice, and
       * the agreement between the two is half of what this block claims.
       */
      async function seedForCounting(): Promise<{ ai: string[]; human: string[] }> {
        const specs = Array.from({ length: SOLVED + HUMAN_CLOSED + STILL_RUNNING }, (_, i) => ({
          index: i,
          customerId: randomUUID(),
          chatId: generateShortId(),
          threadId: generateShortId(),
          // The first `HUMAN_CLOSED` get an agent-authored reply; everything
          // else is customer + bot only.
          human: i < HUMAN_CLOSED,
        }));

        await owner.customer.createMany({
          data: specs.map((s) => ({
            id: s.customerId,
            organizationId: fx.a.organizationId,
            name: `Counted Visitor ${String(s.index).padStart(2, '0')}`,
          })),
        });
        await owner.chat.createMany({
          data: specs.map((s) => ({
            id: s.chatId,
            licenseId: fx.a.licenseId,
            customerId: s.customerId,
            active: true,
          })),
        });
        await owner.thread.createMany({
          data: specs.map((s) => ({
            id: s.threadId,
            chatId: s.chatId,
            licenseId: fx.a.licenseId,
            active: true,
          })),
        });
        await owner.event.createMany({
          data: specs.flatMap((s) => [
            {
              id: `${s.threadId}_50`,
              threadId: s.threadId,
              chatId: s.chatId,
              licenseId: fx.a.licenseId,
              type: 'message',
              text: 'Where is my order?',
              authorType: 'customer',
              recipients: 'all',
            },
            {
              id: `${s.threadId}_99`,
              threadId: s.threadId,
              chatId: s.chatId,
              licenseId: fx.a.licenseId,
              type: 'message',
              text: s.human ? 'A person here — looking now.' : 'It shipped this morning.',
              // The one bit that decides the whole classification (ADR-09).
              authorType: s.human ? 'agent' : 'bot',
              authorId: s.human ? fx.a.ownerAccountId : null,
              recipients: 'all',
            },
          ]),
        });

        const closing = specs.filter((s) => s.index < SOLVED + HUMAN_CLOSED);
        for (const spec of closing) {
          const closed = await server.post(
            `/chats/${spec.chatId}/deactivate`,
            undefined,
            auth(acmeAdminToken),
          );
          expect(closed.statusCode).toBe(200);
        }

        return {
          ai: specs.filter((s) => !s.human && s.index < SOLVED + HUMAN_CLOSED).map((s) => s.chatId),
          human: specs.filter((s) => s.human).map((s) => s.chatId),
        };
      }

      interface Page {
        items: Array<{ id: string }>;
        total: number;
        next_page_id?: string;
      }

      const read = async (url: string): Promise<Page> => {
        const response = await server.get(url, auth(acmeAdminToken));
        expect(response.statusCode).toBe(200);
        return response.json() as Page;
      };

      it('reports the whole view, not the page — and the same number the invoice meters', async () => {
        const seeded = await seedForCounting();
        expect(seeded.ai).toHaveLength(SOLVED);

        const first = await read(`/chats?view=ai_solved&limit=${PAGE}`);

        // The defect, stated as an inequality: what a reader can see is a page,
        // what the view holds is sixty. Before this field the console had only
        // the left-hand number and displayed it as the right-hand one.
        expect(first.items).toHaveLength(PAGE);
        expect(first.total).toBe(SOLVED);
        expect(first.total).toBeGreaterThan(first.items.length);

        // And it is the *invoice's* sixty. ADR-09 meters one resolution per
        // thread closed with no agent-authored event; the Solved view selects
        // on that same predicate, so a counter derived from it agrees with the
        // bill by construction. The three human-closed chats are the control:
        // they closed through the same endpoint in the same run and moved
        // neither number.
        const usage = await owner.usageRecord.findFirst({
          where: { licenseId: fx.a.licenseId, metric: 'ai_resolutions' },
        });
        expect(Number(usage?.quantity ?? 0n)).toBe(SOLVED);
        expect(first.total).toBe(Number(usage?.quantity ?? 0n));
      });

      it('holds the total steady across the page chain, and the chain adds up to it', async () => {
        await seedForCounting();

        const seen: string[] = [];
        const totals: number[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page += 1) {
          const url = `/chats?view=ai_solved&limit=${PAGE}${
            cursor ? `&page_id=${encodeURIComponent(cursor)}` : ''
          }`;
          const body = await read(url);
          seen.push(...body.items.map((c) => c.id));
          totals.push(body.total);
          cursor = body.next_page_id;
          if (!cursor) break;
        }

        // Every page says sixty. A total narrowed by the cursor would count
        // down — 60, 35, 10 — which is the same class of wrong as counting the
        // loaded rows, just in the other direction.
        expect(totals).toEqual([SOLVED, SOLVED, SOLVED]);
        // And sixty is what the chain actually yields, so the number beside the
        // list is a promise the list keeps.
        expect(new Set(seen).size).toBe(SOLVED);
        expect(seen).toHaveLength(totals[0]!);
      });

      it('counts the view it was asked for, not every chat the caller can see', async () => {
        await seedForCounting();

        // Four views over one fixture. If `total` ignored `view` — counted the
        // workspace instead of the filter — all four would read 65.
        expect((await read('/chats?view=all&limit=5')).total).toBe(
          SOLVED + HUMAN_CLOSED + STILL_RUNNING,
        );
        expect((await read('/chats?view=archived&limit=5')).total).toBe(SOLVED + HUMAN_CLOSED);
        expect((await read('/chats?view=ai_solved&limit=5')).total).toBe(SOLVED);
        expect((await read('/chats?view=ai&limit=5')).total).toBe(STILL_RUNNING);
      });

      it("counts only what the caller may see, not the workspace's rows", async () => {
        // Two teams, and the regular agent is in Support only (`beforeEach`).
        // A different customer per chat because a license may hold one active
        // chat per person.
        for (const [team, howMany] of [
          [supportGroupId, 2],
          [salesGroupId, 3],
        ] as const) {
          for (let i = 0; i < howMany; i += 1) {
            const customer = await owner.customer.create({
              data: { organizationId: fx.a.organizationId, name: `Scoped ${team}-${i}` },
              select: { id: true },
            });
            await startChat(acmeAdminToken, {
              customerId: customer.id,
              groupIds: [Number(team)],
            });
          }
        }

        // The admin's token carries `chats--all:ro` and sees all five; the
        // agent reaches only the two routed to their team. A count is exactly
        // where a dropped visibility filter hides, because the *rows* stay
        // right — the agent would still be shown two conversations, under a
        // heading claiming five.
        expect((await read('/chats?view=all&limit=50')).total).toBe(5);
        const scoped = await server.get('/chats?view=all&limit=50', auth(acmeAgentToken));
        expect(scoped.statusCode).toBe(200);
        expect(scoped.json().total).toBe(2);
        expect(scoped.json().items).toHaveLength(2);
      });

      it("never counts another tenant's resolutions into this one", async () => {
        await seedForCounting();
        await server.post('/chats', { customer_id: fx.b.customerId }, auth(northwindToken));

        // The count runs under the same tenant transaction and the same RLS as
        // the page, so this is really a statement about the seam: a `count`
        // added beside a list is exactly where a forgotten license filter hides,
        // because the rows still look right.
        expect((await read('/chats?view=ai_solved&limit=5')).total).toBe(SOLVED);
        const northwind = await server.get('/chats?view=all', auth(northwindToken));
        expect(northwind.json().total).toBe(1);
      });

      it('stays inside the NFR-P2 read budget with the count on the page', async () => {
        await seedForCounting();

        const url = `/chats?view=ai_solved&limit=${PAGE}`;
        await read(url); // warm-up: plan cache and connection, not measured
        const samples: number[] = [];
        for (let i = 0; i < 15; i += 1) {
          const started = Date.now();
          await read(url);
          samples.push(Date.now() - started);
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)]!;

        // `ai_solved` is the expensive view — a NOT EXISTS over `events` per
        // candidate thread — so it is the one worth measuring; the cheaper
        // views cannot cost more. The median is asserted and the tail only
        // recorded: this runs against a local Postgres in a container on a
        // shared machine, so the tail describes the harness. NFR-P2's p99 is a
        // production claim this supports rather than establishes.
        console.log(
          `NFR-P2 GET /chats?view=ai_solved (${SOLVED} rows, limit ${PAGE}, with total) — ` +
            `median ${median} ms · max ${sorted.at(-1)} ms over ${samples.length} samples ` +
            `(budget ${READ_BUDGET_MS} ms)`,
        );
        expect(median).toBeLessThan(READ_BUDGET_MS);
      });
    });
  });

  // =========================================================================
  // Visitor context on the Details panel (FR-MOD-02.4)
  // =========================================================================

  describe('visitor context', () => {
    it("surfaces the customer's latest visit on the chat", async () => {
      const chat = await startChat(acmeAdminToken, { customerId: fx.a.customerId });
      await owner.visit.create({
        data: {
          customerId: fx.a.customerId,
          licenseId: fx.a.licenseId,
          cameFrom: 'https://google.com/search?q=brakes',
          pages: [
            { url: 'https://shop.example/bikes', at: '2026-07-20T10:00:00.000Z' },
            { url: 'https://shop.example/bikes/brakes', at: '2026-07-20T10:02:00.000Z' },
          ],
          os: 'macOS',
          browser: 'Chrome',
          ip: '203.0.113.7',
          startedAt: new Date('2026-07-20T10:00:00.000Z'),
          endedAt: new Date('2026-07-20T10:05:00.000Z'),
        },
      });

      const response = await server.get(`/chats/${chat.id}`, auth(acmeAdminToken));
      expect(response.statusCode).toBe(200);

      const visitor = response.json().visitor;
      expect(visitor.visited_pages.map((p: { url: string }) => p.url)).toEqual([
        'https://shop.example/bikes',
        'https://shop.example/bikes/brakes',
      ]);
      expect(visitor.visit_info).toMatchObject({
        device: 'Chrome on macOS',
        referrer: 'https://google.com/search?q=brakes',
        duration_seconds: 300,
        ip: '203.0.113.7',
        // The visit ended, so its length is final: the console must not tick it.
        ongoing: false,
      });
    });

    it('marks a visit still in progress as ongoing (FR-MOD-02.4.1–.6)', async () => {
      // "Süre/ziyaret canlı" needs the console to know which figure it was
      // handed. `duration_seconds` alone cannot say: on an open visit it is a
      // running total measured at response time, on a closed one it is the
      // whole length, and the two are indistinguishable once serialised.
      const chat = await startChat(acmeAdminToken, { customerId: fx.a.customerId });
      await owner.visit.create({
        data: {
          customerId: fx.a.customerId,
          licenseId: fx.a.licenseId,
          pages: [{ url: 'https://shop.example/bikes' }],
          startedAt: new Date(Date.now() - 90_000),
          endedAt: null,
        },
      });

      const response = await server.get(`/chats/${chat.id}`, auth(acmeAdminToken));
      expect(response.statusCode).toBe(200);
      expect(response.json().visitor.visit_info.ongoing).toBe(true);
      expect(response.json().visitor.visit_info.duration_seconds).toBeGreaterThanOrEqual(90);
    });

    it('reports no visitor when nothing was recorded, without failing', async () => {
      const chat = await startChat(acmeAdminToken, { customerId: fx.a.customerId });
      const response = await server.get(`/chats/${chat.id}`, auth(acmeAdminToken));
      expect(response.statusCode).toBe(200);
      // Null-safe: an IP-less, page-less visit or none at all reads as "no visit".
      expect(response.json().visitor).toBeNull();
    });

    it('never exposes visitor context — or the IP — to the customer widget', async () => {
      const { customer_id, token } = await customerTokenFor(fx.a);
      const chat = await startChat(acmeAdminToken, { customerId: customer_id, text: 'Hi' });
      await owner.visit.create({
        data: {
          customerId: customer_id,
          licenseId: fx.a.licenseId,
          pages: [{ url: 'https://shop.example/secret' }],
          ip: '203.0.113.9',
          startedAt: new Date(),
        },
      });

      // The customer may read their own chat, but the visit block — the IP above
      // all (NFR-S9) — must not be part of what the widget receives.
      const response = await server.get(`/chats/${chat.id}`, auth(token));
      expect(response.statusCode).toBe(200);
      expect(response.json().visitor).toBeUndefined();
      expect(response.body).not.toContain('203.0.113.9');
    });

    it("does not surface another license's visit for the same person", async () => {
      // A second workspace of the same company records its own visit for this
      // customer; reading Acme's chat must show only Acme's visit (NFR-S5 IDOR).
      const chat = await startChat(acmeAdminToken, { customerId: fx.a.customerId });
      await owner.visit.create({
        data: {
          customerId: fx.a.customerId,
          licenseId: fx.b.licenseId,
          pages: [{ url: 'https://other-workspace.example/leak' }],
          ip: '198.51.100.5',
          startedAt: new Date(),
        },
      });

      const response = await server.get(`/chats/${chat.id}`, auth(acmeAdminToken));
      expect(response.statusCode).toBe(200);
      // No Acme visit exists; the other license's visit must not stand in for it.
      expect(response.json().visitor).toBeNull();
      expect(response.body).not.toContain('other-workspace.example/leak');
      expect(response.body).not.toContain('198.51.100.5');
    });
  });

  // =========================================================================
  // The customer's side of the same conversation
  // =========================================================================

  describe('customer access', () => {
    it('lets a customer read and reply to their own conversation', async () => {
      const { customer_id, token } = await customerTokenFor(fx.a);
      const chat = await startChat(acmeAdminToken, { customerId: customer_id, text: 'Hello!' });

      const reply = await server.post(
        `/chats/${chat.id}/events`,
        { type: 'message', text: 'Hi, I need help' },
        auth(token),
      );
      expect(reply.statusCode).toBe(201);
      expect(reply.json().author_type).toBe('customer');

      const transcript = await server.get(`/chats/${chat.id}/events`, auth(token));
      expect(transcript.json().items.map((e: { text: string }) => e.text)).toEqual([
        'Hello!',
        'Hi, I need help',
      ]);
    });

    it("does not let a customer read someone else's conversation", async () => {
      const other = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Someone else' },
        select: { id: true },
      });
      const theirChat = await startChat(acmeAdminToken, { customerId: other.id, text: 'private' });

      const { token } = await customerTokenFor(fx.a);
      expect((await server.get(`/chats/${theirChat.id}/events`, auth(token))).statusCode).toBe(404);
    });

    it('does not let a customer list conversations at all', async () => {
      const { token } = await customerTokenFor(fx.a);
      // The inbox is an agent surface; a widget token must not reach it.
      expect((await server.get('/chats', auth(token))).statusCode).toBe(404);
    });
  });
});
