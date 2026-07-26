/**
 * Copilot — agent-assist (FR-MOD-12).
 *
 * The properties that matter and are easy to break silently: the copilot
 * knowledge base is the agent's own (never a customer's, never the AI agent's),
 * a summary lands as an internal note the customer never sees, and using Copilot
 * on a chat moves it into the Reports "assisted" column (07.3.2) — through the
 * very same query Reports runs, not a parallel one.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures, type TenantFixture } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('copilot (agent-assist)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A broad agent token: copilot knowledge, chats, and reports. */
  const agentToken = (tenant: TenantFixture) =>
    grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw', 'reports_read'],
    });

  /** A widget (customer) token, issued the way the widget gets one. */
  async function customerToken(tenant: TenantFixture, customerId?: string): Promise<string> {
    const response = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId, ...(customerId ? { customer_id: customerId } : {}) },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { token: string }).token;
  }

  /** Start a chat and give it one customer message, so an assist has input. */
  async function chatWithMessage(token: string, text: string): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Visitor' },
      select: { id: true },
    });
    const started = await server.post('/chats', { customer_id: customer.id, assign_to_me: true }, auth(token));
    expect([200, 201]).toContain(started.statusCode);
    const chatId = (started.json() as { id: string }).id;

    const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
    await owner.event.create({
      data: {
        id: `${thread.id}_10`,
        threadId: thread.id,
        chatId,
        licenseId: fx.a.licenseId,
        type: 'message',
        text,
        authorType: 'customer',
        recipients: 'all',
      },
    });
    return chatId;
  }

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
  });

  // =========================================================================
  // 12.2 — a separate, agent-only knowledge base
  // =========================================================================

  describe('knowledge base isolation (12.2)', () => {
    it('is closed to a customer token — a 404, not a 403, on every method', async () => {
      const token = await customerToken(fx.a);
      expect((await server.get('/copilot/knowledge', auth(token))).statusCode).toBe(404);
      expect(
        (await server.post('/copilot/knowledge', { name: 'x', content: 'y' }, auth(token))).statusCode,
      ).toBe(404);
      expect(
        (await server.del(`/copilot/knowledge/${randomUUID()}`, auth(token))).statusCode,
      ).toBe(404);
    });

    it('keeps copilot sources out of the AI-agent knowledge list, and vice versa', async () => {
      const token = await agentToken(fx.a);
      const created = await server.post(
        '/copilot/knowledge',
        { name: 'Escalation playbook', content: 'Escalate refunds over five hundred to finance.' },
        auth(token),
      );
      expect(created.statusCode).toBe(201);
      const copilotSourceId = (created.json() as { id: string }).id;

      // The AI-agent KB (12.2 counterpart) must not show the copilot source.
      const aiList = await server.get('/knowledge-sources', auth(token));
      expect((aiList.json() as { items: Array<{ id: string }> }).items.map((s) => s.id)).not.toContain(
        copilotSourceId,
      );

      // And an AI-agent source must not show up in the copilot list.
      const aiAgent = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      });
      const aiSource = await owner.knowledgeSource.create({
        data: {
          aiAgentId: aiAgent.id,
          licenseId: fx.a.licenseId,
          type: 'article',
          name: 'Customer FAQ',
          content: 'Delivery takes 3-5 days.',
          status: 'ready',
        },
        select: { id: true },
      });
      const copilotList = await server.get('/copilot/knowledge', auth(token));
      const copilotIds = (copilotList.json() as { items: Array<{ id: string }> }).items.map((s) => s.id);
      expect(copilotIds).toContain(copilotSourceId);
      expect(copilotIds).not.toContain(aiSource.id);
    });

    it('will not delete an AI-agent source through the copilot route', async () => {
      const token = await agentToken(fx.a);
      const aiAgent = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      });
      const aiSource = await owner.knowledgeSource.create({
        data: {
          aiAgentId: aiAgent.id,
          licenseId: fx.a.licenseId,
          type: 'article',
          name: 'FAQ',
          content: 'Delivery 3-5 days.',
          status: 'ready',
        },
        select: { id: true },
      });

      const deleted = await server.del(`/copilot/knowledge/${aiSource.id}`, auth(token));
      expect(deleted.statusCode).toBe(404);
      // Still there — the copilot route cannot reach an AI-agent source.
      expect(await owner.knowledgeSource.count({ where: { id: aiSource.id } })).toBe(1);
    });

    it("never lists or deletes another tenant's copilot sources", async () => {
      const tokenA = await agentToken(fx.a);
      const created = await server.post(
        '/copilot/knowledge',
        { name: 'A secret', content: 'Tenant A only.' },
        auth(tokenA),
      );
      const sourceId = (created.json() as { id: string }).id;

      const tokenB = await agentToken(fx.b);
      const listB = await server.get('/copilot/knowledge', auth(tokenB));
      expect((listB.json() as { items: unknown[] }).items).toHaveLength(0);

      const deleteB = await server.del(`/copilot/knowledge/${sourceId}`, auth(tokenB));
      expect(deleteB.statusCode).toBe(404);
      expect(await owner.knowledgeSource.count({ where: { id: sourceId } })).toBe(1);
    });

    it('indexes a source on creation so it is searchable at once', async () => {
      const token = await agentToken(fx.a);
      const created = await server.post(
        '/copilot/knowledge',
        { name: 'Playbook', content: 'Refunds over five hundred are escalated to finance.' },
        auth(token),
      );
      expect(created.statusCode).toBe(201);
      const body = created.json() as { status: string; chunk_count: number };
      expect(body.status).toBe('ready');
      expect(body.chunk_count).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 12.3 — in-chat assists
  // =========================================================================

  describe('summary → internal note (12.3 / 02.5)', () => {
    it('writes the summary as an internal note the customer never sees', async () => {
      const token = await agentToken(fx.a);
      const chatId = await chatWithMessage(token, 'My order has not arrived yet.');

      const response = await server.post(`/copilot/chats/${chatId}/summary`, undefined, auth(token));
      expect(response.statusCode).toBe(201);
      const body = response.json() as { summary: string; note_event_id: string };
      expect(body.summary).toContain('order has not arrived');
      expect(body.note_event_id).toBeTruthy();

      // Stored as an agent-only note — `recipients: 'agents'` is the mechanism
      // that keeps it off the customer's transcript (enforced and tested in
      // chat-service; here we assert the note is written that way).
      const note = await owner.event.findFirst({ where: { chatId, recipients: 'agents' } });
      expect(note?.authorType).toBe('agent');
      expect(note?.text).toBe(body.summary);
    });

    it('survives to the archived transcript', async () => {
      const token = await agentToken(fx.a);
      const chatId = await chatWithMessage(token, 'Where is my refund?');
      await server.post(`/copilot/chats/${chatId}/summary`, undefined, auth(token));
      await server.post(`/chats/${chatId}/deactivate`, undefined, auth(token));

      const events = await server.get(`/chats/${chatId}/events?limit=200`, auth(token));
      const notes = (events.json() as { items: Array<{ recipients: string; text: string }> }).items.filter(
        (e) => e.recipients === 'agents',
      );
      expect(notes.length).toBeGreaterThan(0);
    });

    it('refuses to summarise an archived chat (409)', async () => {
      const token = await agentToken(fx.a);
      const chatId = await chatWithMessage(token, 'Hello?');
      await server.post(`/chats/${chatId}/deactivate`, undefined, auth(token));

      const response = await server.post(`/copilot/chats/${chatId}/summary`, undefined, auth(token));
      expect(response.statusCode).toBe(409);
    });

    it("cannot summarise another tenant's chat", async () => {
      const tokenA = await agentToken(fx.a);
      const chatId = await chatWithMessage(tokenA, 'Hi');
      const tokenB = await agentToken(fx.b);
      expect((await server.post(`/copilot/chats/${chatId}/summary`, undefined, auth(tokenB))).statusCode).toBe(
        404,
      );
    });
  });

  describe('reply draft from the copilot base (12.3)', () => {
    it('drafts from the copilot knowledge base using the latest customer message', async () => {
      const token = await agentToken(fx.a);
      await server.post(
        '/copilot/knowledge',
        { name: 'Refund policy', content: 'A refund over five hundred dollars must be escalated to the finance team.' },
        auth(token),
      );
      const chatId = await chatWithMessage(token, 'I want a refund over five hundred dollars please.');

      const response = await server.post(`/copilot/chats/${chatId}/reply`, undefined, auth(token));
      expect(response.statusCode).toBe(200);
      const body = response.json() as { draft: string; sources: Array<{ name: string }> };
      expect(body.draft.toLowerCase()).toContain('finance');
      expect(body.sources[0]?.name).toBe('Refund policy');
    });

    it('returns an empty draft rather than inventing one when nothing matches', async () => {
      const token = await agentToken(fx.a);
      const chatId = await chatWithMessage(token, 'Completely unrelated question about xylophones.');
      const response = await server.post(`/copilot/chats/${chatId}/reply`, undefined, auth(token));
      expect(response.statusCode).toBe(200);
      expect((response.json() as { draft: string }).draft).toBe('');
    });
  });

  describe('enhance a draft (12.3)', () => {
    it('rewrites a draft in the chosen register', async () => {
      const token = await agentToken(fx.a);
      const chatId = await chatWithMessage(token, 'anything');

      const friendly = await server.post(
        `/copilot/chats/${chatId}/enhance`,
        { text: "we can't do that", mode: 'formal' },
        auth(token),
      );
      expect(friendly.statusCode).toBe(200);
      const body = friendly.json() as { text: string; mode: string };
      expect(body.mode).toBe('formal');
      expect(body.text).toContain('cannot');
    });

    it('rejects an empty draft', async () => {
      const token = await agentToken(fx.a);
      const chatId = await chatWithMessage(token, 'anything');
      const response = await server.post(
        `/copilot/chats/${chatId}/enhance`,
        { text: '   ', mode: 'friendly' },
        auth(token),
      );
      expect(response.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // 12.1 — Copilot feeds the "assisted" metric (07.3.2)
  // =========================================================================

  describe('feeds the Assisted metric (12.1 / 07.3.2)', () => {
    it('moves a human-handled chat from "manual" into "assisted"', async () => {
      const token = await agentToken(fx.a);
      const chatId = await chatWithMessage(token, 'My order has not arrived.');

      // The agent replies (human-handled) and uses Copilot to summarise.
      await server.post(`/chats/${chatId}/events`, { type: 'message', text: 'On it — checking now.' }, auth(token));
      const summary = await server.post(`/copilot/chats/${chatId}/summary`, undefined, auth(token));
      expect(summary.statusCode).toBe(201);
      await server.post(`/chats/${chatId}/deactivate`, undefined, auth(token));

      // The very query Reports runs (07.3.2): a copilot assist is a skill_run.
      const totals = (await server.get('/reports/overview', auth(token))).json().totals as {
        assisted: number;
        manual: number;
        closed: number;
      };
      expect(totals.assisted).toBe(1);
      expect(totals.manual).toBe(0);
      expect(totals.closed).toBe(1);
    });

    it('does not record an assist for an empty reply draft', async () => {
      const token = await agentToken(fx.a);
      const chatId = await chatWithMessage(token, 'A question with no matching knowledge at all.');
      await server.post(`/chats/${chatId}/events`, { type: 'message', text: 'Let me look.' }, auth(token));
      await server.post(`/copilot/chats/${chatId}/reply`, undefined, auth(token));
      await server.post(`/chats/${chatId}/deactivate`, undefined, auth(token));

      // No knowledge matched → no assist recorded → still manual, not assisted.
      const totals = (await server.get('/reports/overview', auth(token))).json().totals as {
        assisted: number;
        manual: number;
      };
      expect(totals.assisted).toBe(0);
      expect(totals.manual).toBe(1);
    });
  });
});
