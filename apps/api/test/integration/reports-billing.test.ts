/**
 * Reports, metering and the trial gate.
 *
 * The property that matters most: the "Automated" figure in Reports and the
 * AI-resolution counter on the invoice come from the same definition. Two
 * counters meant to agree will not, and the first anyone notices is a customer
 * disputing a bill.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('reports and billing', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;

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
        agentId: fx.a.ownerAccountId,
        priority: 'normal',
      },
    });

    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw', 'reports_read', 'billing_manage'],
    });
  });

  const auth = {
    get authorization() {
      return `Bearer ${token}`;
    },
  };

  /** Run a conversation to completion, optionally with an agent replying. */
  async function conversation(options: { agentReplies: boolean; customerName?: string }) {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: options.customerName ?? 'Visitor' },
      select: { id: true },
    });

    // Opened without an agent-authored message, so the "no human touched it"
    // case is actually reachable — an agent's opening line is still an agent
    // event and would (correctly) disqualify the thread.
    const chat = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: true },
      auth,
    );
    const chatId = chat.json().id as string;

    const openingThread = await owner.thread.findFirstOrThrow({ where: { chatId } });
    await owner.event.create({
      data: {
        id: `${openingThread.id}_50`,
        threadId: openingThread.id,
        chatId,
        licenseId: fx.a.licenseId,
        type: 'message',
        text: 'Hello?',
        authorType: 'customer',
        recipients: 'all',
      },
    });

    if (options.agentReplies) {
      await server.post(
        `/chats/${chatId}/events`,
        { type: 'message', text: 'A human here — let me check.' },
        auth,
      );
    } else {
      // A bot answered and nobody from the team joined.
      const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
      await owner.event.create({
        data: {
          id: `${thread.id}_99`,
          threadId: thread.id,
          chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text: 'The AI answered this.',
          authorType: 'bot',
          recipients: 'all',
        },
      });
    }

    await server.post(`/chats/${chatId}/deactivate`, undefined, auth);
    return chatId;
  }

  // =========================================================================

  describe('AI resolutions', () => {
    it('counts a thread closed with no agent message', async () => {
      await conversation({ agentReplies: false });

      const usage = await server.get('/billing/usage', auth);
      expect(usage.json().ai_resolutions.used).toBe(1);
    });

    it('does not count one an agent replied to', async () => {
      await conversation({ agentReplies: true });

      const usage = await server.get('/billing/usage', auth);
      expect(usage.json().ai_resolutions.used).toBe(0);
    });

    it('reports the same number to Reports and to billing', async () => {
      // This is the whole point of one shared definition (ADR-09).
      await conversation({ agentReplies: false, customerName: 'A' });
      await conversation({ agentReplies: false, customerName: 'B' });
      await conversation({ agentReplies: true, customerName: 'C' });

      const [report, usage] = await Promise.all([
        server.get('/reports/overview', auth),
        server.get('/billing/usage', auth),
      ]);

      expect(report.json().totals.automated).toBe(2);
      expect(usage.json().ai_resolutions.used).toBe(2);
      expect(report.json().totals.automated).toBe(usage.json().ai_resolutions.used);
    });

    it('does not double-count when a chat is closed twice', async () => {
      const chatId = await conversation({ agentReplies: false });
      // The second close is refused, so the counter must not move.
      await server.post(`/chats/${chatId}/deactivate`, undefined, auth);

      const usage = await server.get('/billing/usage', auth);
      expect(usage.json().ai_resolutions.used).toBe(1);
    });

    it('warns once usage passes 80% of the allowance', async () => {
      await owner.usageRecord.create({
        data: {
          licenseId: fx.a.licenseId,
          metric: 'ai_resolutions',
          period: new Date().toISOString().slice(0, 7).replace('-', ''),
          quantity: 161n,
          included: 200n,
          overageUnit: 50,
          overageUnitPriceCents: 50,
        },
      });

      const usage = await server.get('/billing/usage', auth);
      // A quota that surprises you at 100% is a support ticket.
      expect(usage.json().quota_warning).toBe(true);
    });

    it('prices the overage rather than hiding it', async () => {
      await owner.usageRecord.create({
        data: {
          licenseId: fx.a.licenseId,
          metric: 'ai_resolutions',
          period: new Date().toISOString().slice(0, 7).replace('-', ''),
          quantity: 210n,
          included: 200n,
          overageUnit: 50,
          overageUnitPriceCents: 50,
        },
      });

      const usage = await server.get('/billing/usage', auth);
      expect(usage.json().ai_resolutions.overage).toBe(10);
      expect(usage.json().ai_resolutions.overage_cents).toBe(500);
    });
  });

  // =========================================================================

  describe('overview report', () => {
    it('summarises volume, response time and satisfaction', async () => {
      const chatId = await conversation({ agentReplies: true });
      await owner.rating.create({
        data: { chatId, licenseId: fx.a.licenseId, value: 'good' },
      });

      const report = await server.get('/reports/overview', auth);
      expect(report.statusCode).toBe(200);
      expect(report.json().totals.chats).toBeGreaterThanOrEqual(1);
      expect(report.json().satisfaction.good).toBe(1);
      expect(report.json().satisfaction.score).toBe(1);
      expect(report.json().response_times.avg_first_response_seconds).not.toBeNull();
    });

    it('reports an unrated period as unknown, not zero', async () => {
      await conversation({ agentReplies: true });
      const report = await server.get('/reports/overview', auth);
      // 0% would read as a catastrophe; nobody rated is simply unknown.
      expect(report.json().satisfaction.score).toBeNull();
      expect(report.json().satisfaction.responses).toBe(0);
    });

    it('measures the automated rate against closed chats only', async () => {
      await conversation({ agentReplies: false });
      // An open chat has not resolved either way.
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Still talking' },
        select: { id: true },
      });
      await server.post(
        '/chats',
        { customer_id: customer.id, initial_event: { type: 'message', text: 'hi' } },
        auth,
      );

      const report = await server.get('/reports/overview', auth);
      expect(report.json().totals.closed).toBe(1);
      expect(report.json().totals.automated_rate).toBe(1);
    });

    it('breaks down by agent and by tag', async () => {
      const chatId = await conversation({ agentReplies: true });
      await server.post(`/chats/${chatId}/tags`, { tag: 'billing' }, auth);

      const report = await server.get('/reports/overview', auth);
      expect(report.json().by_agent[0].agent_id).toBe(fx.a.ownerAccountId);
      expect(report.json().top_tags.map((t: { name: string }) => t.name)).toContain('billing');
    });

    it('never counts another tenant', async () => {
      await conversation({ agentReplies: false });

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = await server.get('/reports/overview', {
        authorization: `Bearer ${theirToken}`,
      });
      expect(theirs.json().totals.chats).toBe(0);
    });

    it('rejects a backwards date range', async () => {
      const response = await server.get('/reports/overview?from=2026-08-01&to=2026-07-01', auth);
      expect(response.statusCode).toBe(400);
    });

    it('requires the reports scope', async () => {
      const weak = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      const response = await server.get('/reports/overview', {
        authorization: `Bearer ${weak}`,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // =========================================================================

  describe('subscription and the trial gate', () => {
    it('bills nothing during the trial', async () => {
      const response = await server.get('/billing/subscription', auth);
      expect(response.statusCode).toBe(200);
      expect(response.json().access).toBe('trialing');
      expect(response.json().estimated_total_cents).toBe(0);
      expect(response.json().trial.days_remaining).toBeGreaterThan(0);
    });

    it('prices seats plus overage once active', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'active', trialEndsAt: null },
      });
      await owner.subscription.create({
        data: {
          licenseId: fx.a.licenseId,
          status: 'active',
          seats: 2,
          unitPriceCents: 9900,
          aiResolutionsIncluded: 200,
        },
      });

      const response = await server.get('/billing/subscription', auth);
      // Two seats seeded, both unsuspended.
      expect(response.json().seats).toBe(2);
      expect(response.json().estimated_total_cents).toBe(2 * 9900);
    });

    it('turns read-only when the trial expires, without deleting anything', async () => {
      const chatId = await conversation({ agentReplies: true });
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
      });

      const subscription = await server.get('/billing/subscription', auth);
      expect(subscription.json().access).toBe('read_only');

      // Reads still work — the workspace can still get its data out.
      const chats = await server.get('/chats', auth);
      expect(chats.statusCode).toBe(200);
      expect(chats.json().items.length).toBeGreaterThan(0);

      const transcript = await server.get(`/chats/${chatId}/events`, auth);
      expect(transcript.statusCode).toBe(200);

      // Nothing was deleted.
      expect(await owner.chat.count({ where: { licenseId: fx.a.licenseId } })).toBeGreaterThan(0);
    });

    it('refuses writes once read-only', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
      });

      const response = await server.post('/chats', { customer_id: fx.a.customerId }, auth);
      expect(response.statusCode).toBe(402);
      expect(response.json().error.type).toBe('license_expired');
      expect(response.json().error.details.access).toBe('read_only');
    });

    it('still lets the caller sign out and revoke tokens', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
      });

      // Blocking these turns "please pay" into "you are trapped".
      const revoked = await server.post('/auth/revoke', { token: 'anything' });
      expect(revoked.statusCode).toBe(200);
      expect((await server.get('/auth/me', auth)).statusCode).toBe(200);
    });

    it('keeps a live trial writable', async () => {
      const response = await server.post('/chats', { customer_id: fx.a.customerId }, auth);
      expect([200, 201]).toContain(response.statusCode);
    });
  });
});
