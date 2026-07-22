/**
 * Agent Chat API.
 *
 * Attacks and edge cases first. The failures that matter here are not "the
 * endpoint returned 500" but the quiet ones: an internal note reaching a
 * customer, a retry posting a message twice, an agent reading a team's
 * conversations they were never given.
 */
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
    it('replays an idempotent send instead of duplicating it', async () => {
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

    it('refuses to transfer to an offline agent', async () => {
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
