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

  /**
   * Record that a skill ran on a chat — the fact that turns an agent-handled
   * case from "manual" into "assisted" (PRD 07.3.2). Timing is irrelevant: the
   * split keys on the run existing for the chat, so this may be called after the
   * chat has already closed.
   */
  async function runSkillOn(chatId: string): Promise<void> {
    const skill = await owner.skill.create({
      data: { licenseId: fx.a.licenseId, name: 'Auto-tag', kind: 'workspace' },
      select: { id: true },
    });
    await owner.skillRun.create({
      data: { skillId: skill.id, chatId, licenseId: fx.a.licenseId, status: 'succeeded' },
    });
  }

  /**
   * Record an AI→human hand-off on a chat — the transfer system event the AI
   * Agent report counts. Written directly (like {@link runSkillOn}) so the test
   * exercises the aggregation without dragging in the whole transfer flow; the
   * shape matches what `chat-service` emits: `system_event: chat_transferred`.
   */
  async function recordTransfer(chatId: string): Promise<void> {
    const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
    await owner.event.create({
      data: {
        id: `${thread.id}_transfer`,
        threadId: thread.id,
        chatId,
        licenseId: fx.a.licenseId,
        type: 'system_message',
        authorType: 'system',
        recipients: 'all',
        properties: { system_event: 'chat_transferred' },
      },
    });
  }

  /** Move a chat's thread back in time, to land it in an earlier report window. */
  async function backdateChat(chatId: string, createdAt: Date): Promise<void> {
    await owner.thread.updateMany({ where: { chatId }, data: { createdAt } });
    await owner.chat.update({ where: { id: chatId }, data: { createdAt } });
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

    it('quotes the overage pack size and unit price up front', async () => {
      // No usage record yet: the meter still states the extra-usage price, so a
      // workspace sees it before the allowance runs out (FR-MOD-10.1.4).
      const ai = (await server.get('/billing/usage', auth)).json().ai_resolutions;
      expect(ai.overage_unit).toBe(50);
      // The same per-resolution price `overage_cents` is computed from — one
      // number, so the quote and the charge can never disagree.
      expect(ai.overage_unit_price_cents).toBe(50);
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

    it('splits closed cases into manual, assisted and automated (PRD 07.3.2)', async () => {
      await conversation({ agentReplies: false, customerName: 'Bot only' }); // automated
      await conversation({ agentReplies: true, customerName: 'Human only' }); // manual
      const assistedChat = await conversation({ agentReplies: true, customerName: 'Helped' });
      await runSkillOn(assistedChat); // agent + skill → assisted

      const totals = (await server.get('/reports/overview', auth)).json().totals;
      expect(totals.automated).toBe(1);
      expect(totals.assisted).toBe(1);
      expect(totals.manual).toBe(1);
      // The invariant the KPI cards rely on: the three parts are exactly closed.
      expect(totals.manual + totals.assisted + totals.automated).toBe(totals.closed);
      expect(totals.closed).toBe(3);
      // Each is a third of closed; the rates share automated's one definition.
      expect(totals.manual_rate).toBe(0.333);
      expect(totals.assisted_rate).toBe(0.333);
      expect(totals.automated_rate).toBe(0.333);
    });

    it('keeps a skill-run chat with no agent message automated, never assisted (ADR-09)', async () => {
      // A skill ran but no human ever wrote: assisted requires an agent event,
      // and automated is exactly ADR-09 — unchanged by the skill run.
      const chatId = await conversation({ agentReplies: false });
      await runSkillOn(chatId);

      const totals = (await server.get('/reports/overview', auth)).json().totals;
      expect(totals.automated).toBe(1);
      expect(totals.assisted).toBe(0);
      expect(totals.manual).toBe(0);
      // Still the invoice's number.
      expect((await server.get('/billing/usage', auth)).json().ai_resolutions.used).toBe(1);
    });

    it('scopes the manual/assisted/automated split to one tenant', async () => {
      await conversation({ agentReplies: false, customerName: 'A-auto' }); // automated in A
      const assisted = await conversation({ agentReplies: true, customerName: 'A-assisted' });
      await runSkillOn(assisted); // assisted in A, with a skill_run owned by A

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const totals = (
        await server.get('/reports/overview', { authorization: `Bearer ${theirToken}` })
      ).json().totals;
      // B shares none of A's cases — and A's skill_run must not leak across.
      expect(totals.closed).toBe(0);
      expect(totals.manual).toBe(0);
      expect(totals.assisted).toBe(0);
      expect(totals.automated).toBe(0);
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

  describe('period comparison (07.3.1)', () => {
    it('compares against the equal-length window immediately before', async () => {
      // Two chats land in the current 10-day window; one is backdated into the
      // 10 days before it. A "vs previous" delta is only honest if it looks at
      // exactly that preceding, equal-length span.
      await conversation({ agentReplies: true, customerName: 'Now A' });
      await conversation({ agentReplies: true, customerName: 'Now B' });
      const earlier = await conversation({ agentReplies: true, customerName: 'Earlier' });
      await backdateChat(earlier, new Date(Date.now() - 15 * 86_400_000));

      const to = new Date();
      const from = new Date(to.getTime() - 10 * 86_400_000);
      const report = (
        await server.get(
          `/reports/overview?from=${from.toISOString()}&to=${to.toISOString()}`,
          auth,
        )
      ).json();

      expect(report.totals.chats).toBe(2);
      expect(report.previous_period.chats).toBe(1);
      // The previous window ends exactly where the current one begins (one ms
      // short, so no instant is double-counted) — proof it is the preceding span.
      expect(Date.parse(report.previous_period.range.to)).toBe(Date.parse(report.range.from) - 1);
      const currentSpan = Date.parse(report.range.to) - Date.parse(report.range.from);
      const previousSpan =
        Date.parse(report.previous_period.range.to) - Date.parse(report.previous_period.range.from);
      expect(currentSpan - previousSpan).toBe(1);
    });

    it('accepts a year-long custom range and still rejects a backwards one', async () => {
      const to = new Date();
      const yearAgo = new Date(to.getTime() - 365 * 86_400_000);
      const ok = await server.get(
        `/reports/overview?from=${yearAgo.toISOString()}&to=${to.toISOString()}`,
        auth,
      );
      expect(ok.statusCode).toBe(200);

      const backwards = await server.get('/reports/overview?from=2026-08-01&to=2026-07-01', auth);
      expect(backwards.statusCode).toBe(400);
    });

    it('reports the Chats-section operational figures', async () => {
      await conversation({ agentReplies: false }); // automated, some duration
      const report = (await server.get('/reports/overview', auth)).json();
      expect(report.chats.automated_per_hour).toBeGreaterThanOrEqual(0);
      // One chat opened and closed within the run → a positive total duration.
      expect(report.chats.total_duration_seconds).toBeGreaterThanOrEqual(0);
      expect(report.chats).toHaveProperty('automated_avg_duration_seconds');
    });
  });

  // =========================================================================

  describe('breakdown (07.5)', () => {
    it('splits manual / assisted / automated by day and by agent', async () => {
      await conversation({ agentReplies: false, customerName: 'Bot only' }); // automated
      await conversation({ agentReplies: true, customerName: 'Human only' }); // manual
      const assisted = await conversation({ agentReplies: true, customerName: 'Helped' });
      await runSkillOn(assisted); // assisted

      const breakdown = (await server.get('/reports/breakdown', auth)).json();

      // by_day: all three closed within this run, so they collapse into today's
      // UTC bucket. Summed across days, the split is 1/1/1 and sums to closed.
      interface SplitRow {
        chats: number;
        closed: number;
        manual: number;
        assisted: number;
        automated: number;
      }
      const day = (breakdown.by_day as SplitRow[]).reduce(
        (acc: SplitRow, row: SplitRow) => ({
          chats: acc.chats + row.chats,
          closed: acc.closed + row.closed,
          manual: acc.manual + row.manual,
          assisted: acc.assisted + row.assisted,
          automated: acc.automated + row.automated,
        }),
        { chats: 0, closed: 0, manual: 0, assisted: 0, automated: 0 },
      );
      expect(day.manual).toBe(1);
      expect(day.assisted).toBe(1);
      expect(day.automated).toBe(1);
      expect(day.manual + day.assisted + day.automated).toBe(day.closed);
      expect(breakdown.by_day[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // by_agent: all three were assigned to the owner (assign_to_me), so the
      // same invariant holds inside the row — automated included.
      const owner = breakdown.by_agent.find(
        (row: { agent_id: string }) => row.agent_id === fx.a.ownerAccountId,
      );
      expect(owner).toBeTruthy();
      expect(owner.manual + owner.assisted + owner.automated).toBe(owner.closed);
      expect(owner.automated).toBe(1);
    });

    it('never counts another tenant', async () => {
      await conversation({ agentReplies: false });
      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/reports/breakdown', { authorization: `Bearer ${theirToken}` })
      ).json();
      expect(theirs.by_day).toEqual([]);
      expect(theirs.by_agent).toEqual([]);
    });
  });

  // =========================================================================

  describe('AI Agent report (07.4)', () => {
    it('agrees with the overview and the invoice on resolutions', async () => {
      await conversation({ agentReplies: false, customerName: 'A' }); // automated
      await conversation({ agentReplies: false, customerName: 'B' }); // automated
      await conversation({ agentReplies: true, customerName: 'C' }); // manual

      const [ai, overview, usage] = await Promise.all([
        server.get('/reports/ai-agent', auth),
        server.get('/reports/overview', auth),
        server.get('/billing/usage', auth),
      ]);

      // One definition of "the AI resolved it" (ADR-09), everywhere.
      expect(ai.json().resolutions).toBe(2);
      expect(ai.json().resolutions).toBe(overview.json().totals.automated);
      expect(ai.json().resolutions).toBe(usage.json().ai_resolutions.used);
      // Two of three closed cases were automated.
      expect(ai.json().resolution_rate).toBe(0.667);
    });

    it('counts hand-offs and derives the transfer rate', async () => {
      await conversation({ agentReplies: false }); // one AI resolution
      const handedOff = await conversation({ agentReplies: true });
      await recordTransfer(handedOff); // one hand-off

      const ai = (await server.get('/reports/ai-agent', auth)).json();
      expect(ai.transfers).toBe(1);
      // Of the two chats the AI finished (1 resolved + 1 transferred), half were
      // handed off.
      expect(ai.transfer_rate).toBe(0.5);
    });

    it('counts the skills that ran', async () => {
      const chatId = await conversation({ agentReplies: true });
      await runSkillOn(chatId);
      const ai = (await server.get('/reports/ai-agent', auth)).json();
      expect(ai.skill_runs).toBe(1);
    });

    it('never counts another tenant', async () => {
      await conversation({ agentReplies: false });
      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/reports/ai-agent', { authorization: `Bearer ${theirToken}` })
      ).json();
      expect(theirs.resolutions).toBe(0);
      expect(theirs.transfers).toBe(0);
      expect(theirs.skill_runs).toBe(0);
    });
  });

  // =========================================================================

  describe('Reviews report (07.8)', () => {
    /** Attach a rating to a chat, optionally landing it in an earlier day/window. */
    async function rate(chatId: string, value: 'good' | 'bad', createdAt?: Date): Promise<void> {
      await owner.rating.create({
        data: {
          chatId,
          licenseId: fx.a.licenseId,
          value,
          ...(createdAt ? { createdAt } : {}),
        },
      });
    }

    it('reads good/bad ratings back and scores the CSAT donut', async () => {
      const a = await conversation({ agentReplies: true, customerName: 'A' });
      const b = await conversation({ agentReplies: true, customerName: 'B' });
      const c = await conversation({ agentReplies: true, customerName: 'C' });
      await rate(a, 'good');
      await rate(b, 'good');
      await rate(c, 'bad');

      const reviews = (await server.get('/reports/reviews', auth)).json();
      expect(reviews.csat.good).toBe(2);
      expect(reviews.csat.bad).toBe(1);
      expect(reviews.csat.responses).toBe(3);
      // 2 of 3 rated good.
      expect(reviews.csat.score).toBe(0.667);
    });

    it('reports an unrated window as unknown, not zero', async () => {
      await conversation({ agentReplies: true });
      const reviews = (await server.get('/reports/reviews', auth)).json();
      // 0% would read as a catastrophe; nobody rated is simply unknown — the same
      // rule the Overview's satisfaction follows.
      expect(reviews.csat.score).toBeNull();
      expect(reviews.csat.responses).toBe(0);
      expect(reviews.csat.good).toBe(0);
      expect(reviews.csat.bad).toBe(0);
      expect(reviews.by_day).toEqual([]);
    });

    it('compares CSAT against the previous equal-length window', async () => {
      const now = await conversation({ agentReplies: true, customerName: 'Now' });
      const then = await conversation({ agentReplies: true, customerName: 'Then' });
      await rate(now, 'good');
      // 45 days back lands in the previous 30-day window (default range is 30d).
      await rate(then, 'bad', new Date(Date.now() - 45 * 86_400_000));

      const reviews = (await server.get('/reports/reviews', auth)).json();
      expect(reviews.csat.score).toBe(1);
      expect(reviews.csat.responses).toBe(1);
      // The prior window saw one bad rating — a real baseline for the delta.
      expect(reviews.previous_period.responses).toBe(1);
      expect(reviews.previous_period.score).toBe(0);
      expect(reviews.previous_period.range.from).toBeDefined();
    });

    it('buckets ratings by UTC day for the daily bar', async () => {
      const older = await conversation({ agentReplies: true, customerName: 'Older' });
      const newer = await conversation({ agentReplies: true, customerName: 'Newer' });
      const dayA = new Date(Date.now() - 5 * 86_400_000);
      const dayB = new Date(Date.now() - 2 * 86_400_000);
      await rate(older, 'good', dayA);
      await rate(newer, 'bad', dayB);

      const reviews = (await server.get('/reports/reviews', auth)).json();
      expect(reviews.by_day).toHaveLength(2);
      // Ascending by date, each carrying its own good/bad tally and null-safe score.
      expect(reviews.by_day[0].date).toBe(dayA.toISOString().slice(0, 10));
      expect(reviews.by_day[0].good).toBe(1);
      expect(reviews.by_day[0].score).toBe(1);
      expect(reviews.by_day[1].date).toBe(dayB.toISOString().slice(0, 10));
      expect(reviews.by_day[1].bad).toBe(1);
      expect(reviews.by_day[1].score).toBe(0);
    });

    it('exposes the tracked-sales skeleton as not configured (FR-MOD-13.5, v2)', async () => {
      const reviews = (await server.get('/reports/reviews', auth)).json();
      // Sales tracking has no source wired yet: an honest "not set up" shape, not
      // a fabricated zero.
      expect(reviews.ecommerce.configured).toBe(false);
      expect(reviews.ecommerce.tracked_sales).toBeNull();
      expect(reviews.ecommerce.attributed_revenue_cents).toBeNull();
      expect(reviews.ecommerce.currency).toBeNull();
    });

    it('never counts another tenant', async () => {
      const mine = await conversation({ agentReplies: true });
      await rate(mine, 'good');

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/reports/reviews', { authorization: `Bearer ${theirToken}` })
      ).json();
      expect(theirs.csat.responses).toBe(0);
      expect(theirs.csat.score).toBeNull();
      expect(theirs.by_day).toEqual([]);
    });

    it('rejects a backwards date range', async () => {
      const response = await server.get('/reports/reviews?from=2026-08-01&to=2026-07-01', auth);
      expect(response.statusCode).toBe(400);
    });

    it('requires the reports_read scope', async () => {
      const scopeless = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      const response = await server.get('/reports/reviews', {
        authorization: `Bearer ${scopeless}`,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // =========================================================================

  describe('report groups + CSV export (07.7)', () => {
    /** Grant a token with a chosen scope set — for the permission-gating cases. */
    function scopedToken(scopes: string[]): Promise<string> {
      return grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes,
      });
    }

    describe('permission-based visibility', () => {
      it('lists every group a reader can see', async () => {
        const groups = (await server.get('/reports/groups', auth)).json().groups;
        expect(groups.map((g: { id: string }) => g.id)).toEqual([
          'overview',
          'breakdown',
          'ai-agent',
          'reviews',
        ]);
        expect(groups[0]).toEqual({ id: 'overview', label: 'Overview' });
      });

      it('shows an empty catalogue — not a 403 — to a token without reports_read', async () => {
        // "What can you see" answers honestly with nothing; the 403 is the
        // export endpoint's job, not the catalogue's.
        const weak = await scopedToken(['chats--all:ro']);
        const response = await server.get('/reports/groups', {
          authorization: `Bearer ${weak}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().groups).toEqual([]);
      });
    });

    describe('CSV export', () => {
      /** Split a CSV body into its non-empty lines (rows are CRLF-terminated). */
      const lines = (body: string): string[] => body.split('\r\n').filter((line) => line !== '');

      it('exports the breakdown as a dated CSV download', async () => {
        await conversation({ agentReplies: false }); // one automated chat, closed today

        const response = await server.get('/reports/export?group=breakdown', auth);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
        expect(response.headers['content-disposition']).toMatch(
          /^attachment; filename="nexa-breakdown-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/,
        );
        expect(response.headers['cache-control']).toBe('no-store');

        const rows = lines(response.body);
        expect(rows[0]).toBe('date,chats,closed,manual,assisted,automated');
        // The single automated chat: 1 chat, 1 closed, 0/0/1 across the split.
        expect(rows).toHaveLength(2);
        expect(rows[1]).toMatch(/^\d{4}-\d{2}-\d{2},1,1,0,0,1$/);
      });

      it('exports the overview as metric/value pairs, matching the JSON report', async () => {
        await conversation({ agentReplies: false });

        const response = await server.get('/reports/export?group=overview', auth);
        expect(response.statusCode).toBe(200);
        const rows = lines(response.body);
        expect(rows[0]).toBe('metric,value');
        // The export reuses the report's aggregation, so `automated` here is the
        // same figure the JSON overview quotes — ADR-09's number, once.
        expect(rows).toContain('automated,1');
        expect(rows).toContain('closed,1');
        const overview = (await server.get('/reports/overview', auth)).json();
        expect(rows).toContain(`chats,${overview.totals.chats}`);
      });

      it('exports the AI Agent summary', async () => {
        await conversation({ agentReplies: false });
        const response = await server.get('/reports/export?group=ai-agent', auth);
        expect(response.statusCode).toBe(200);
        expect(lines(response.body)).toContain('resolutions,1');
      });

      it('exports reviews CSAT bucketed by day', async () => {
        const chatId = await conversation({ agentReplies: true });
        await owner.rating.create({ data: { chatId, licenseId: fx.a.licenseId, value: 'good' } });

        const response = await server.get('/reports/export?group=reviews', auth);
        expect(response.statusCode).toBe(200);
        const rows = lines(response.body);
        expect(rows[0]).toBe('date,good,bad,responses,score');
        expect(rows[1]).toMatch(/^\d{4}-\d{2}-\d{2},1,0,1,1$/);
      });

      it('exports only the caller’s tenant', async () => {
        await conversation({ agentReplies: false }); // in A

        const theirToken = await grantToken(owner, {
          licenseId: fx.b.licenseId,
          organizationId: fx.b.organizationId,
          ownerId: fx.b.ownerAccountId,
          scopes: ['reports_read'],
        });
        const response = await server.get('/reports/export?group=breakdown', {
          authorization: `Bearer ${theirToken}`,
        });
        expect(response.statusCode).toBe(200);
        // B shares none of A's chats: the header, and not a single data row.
        expect(response.body).toBe('date,chats,closed,manual,assisted,automated\r\n');
      });

      it('rejects an unknown group with 400', async () => {
        const response = await server.get('/reports/export?group=made-up', auth);
        expect(response.statusCode).toBe(400);
      });

      it('rejects a missing group with 400', async () => {
        const response = await server.get('/reports/export', auth);
        expect(response.statusCode).toBe(400);
      });

      it('rejects a backwards date range', async () => {
        const response = await server.get(
          '/reports/export?group=overview&from=2026-08-01&to=2026-07-01',
          auth,
        );
        expect(response.statusCode).toBe(400);
      });

      it('refuses a token without an export scope — permission gating', async () => {
        const weak = await scopedToken(['chats--all:ro']);
        const response = await server.get('/reports/export?group=overview', {
          authorization: `Bearer ${weak}`,
        });
        expect(response.statusCode).toBe(403);
      });
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

  // FR-MOD-10.1.1–.3: the checkout levers. The fixture seeds two unsuspended
  // agents, so the seats floor is 2 throughout.
  describe('checkout — plan, cycle, seats', () => {
    const activate = () =>
      owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'active', trialEndsAt: null },
      });

    it('buys seats, and the new count is what a later GET reads', async () => {
      const patched = await server.patch('/billing/subscription', { seats: 5 }, auth);
      expect(patched.statusCode).toBe(200);
      expect(patched.json().seats).toBe(5);
      expect(patched.json().min_seats).toBe(2);

      // Persisted, not just echoed: an independent GET agrees.
      expect((await server.get('/billing/subscription', auth)).json().seats).toBe(5);
      const row = await owner.subscription.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(row.seats).toBe(5);
    });

    it('prices annual as ten months and reports the saving', async () => {
      await activate();
      const response = await server.patch(
        '/billing/subscription',
        { billing_cycle: 'annual', seats: 3 },
        auth,
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().billing_cycle).toBe('annual');
      expect(response.json().seats).toBe(3);
      // Ten months charged, two saved (~16.7%, the PRD's %15–17).
      expect(response.json().estimated_total_cents).toBe(3 * 9900 * 10);
      expect(response.json().annual_savings_cents).toBe(3 * 9900 * 2);
    });

    it('switching back to monthly drops the saving to zero', async () => {
      await activate();
      await server.patch('/billing/subscription', { billing_cycle: 'annual', seats: 2 }, auth);
      const monthly = await server.patch(
        '/billing/subscription',
        { billing_cycle: 'monthly' },
        auth,
      );
      expect(monthly.json().estimated_total_cents).toBe(2 * 9900);
      expect(monthly.json().annual_savings_cents).toBe(0);
    });

    it('floors the seats stepper at the active headcount', async () => {
      const response = await server.patch('/billing/subscription', { seats: 1 }, auth);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.type).toBe('validation');
      // Nothing was written on the way to the rejection.
      expect(await owner.subscription.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('rejects an unknown plan', async () => {
      const response = await server.patch('/billing/subscription', { plan: 'enterprise' }, auth);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.type).toBe('validation');
    });

    it('rejects an unknown billing cycle', async () => {
      const response = await server.patch(
        '/billing/subscription',
        { billing_cycle: 'weekly' },
        auth,
      );
      expect(response.statusCode).toBe(400);
    });

    it('rejects an empty change', async () => {
      const response = await server.patch('/billing/subscription', {}, auth);
      expect(response.statusCode).toBe(400);
    });

    it('needs a billing scope, not merely reports_read', async () => {
      const readOnly = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['reports_read'],
      });
      const response = await server.patch(
        '/billing/subscription',
        { seats: 3 },
        { authorization: `Bearer ${readOnly}` },
      );
      expect(response.statusCode).toBe(403);
    });

    it('never changes another licence subscription', async () => {
      await owner.subscription.create({
        data: { licenseId: fx.a.licenseId, status: 'active', seats: 2, unitPriceCents: 9900 },
      });
      const tokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['billing_manage'],
      });

      const response = await server.patch(
        '/billing/subscription',
        { seats: 7 },
        { authorization: `Bearer ${tokenB}` },
      );
      expect(response.statusCode).toBe(200);

      // A untouched; B got its own row.
      expect(
        (await owner.subscription.findFirstOrThrow({ where: { licenseId: fx.a.licenseId } })).seats,
      ).toBe(2);
      expect(
        (await owner.subscription.findFirstOrThrow({ where: { licenseId: fx.b.licenseId } })).seats,
      ).toBe(7);
    });

    it('stays writable while the trial is read-only — subscribing is the way back', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
      });
      // A normal write is refused (402) here; the billing change is not.
      const response = await server.patch('/billing/subscription', { seats: 3 }, auth);
      expect(response.statusCode).toBe(200);
      expect(response.json().seats).toBe(3);
    });
  });
});
