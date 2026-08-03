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
import { generateShortId } from '@nexa/types';
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

  /**
   * Record an inbound adapter message on a chat — what pins the chat to a
   * channel in the breakdown (the oldest inbound row's `channel_type` wins,
   * 'website' when a chat has none). Written directly (like {@link runSkillOn}),
   * so the test exercises the aggregation without standing up a provider webhook.
   * `licenseId` is a parameter so a test can plant *another* tenant's row — same
   * chat id, different license — and prove the join lock keeps it out.
   */
  async function recordInbound(
    chatId: string | null,
    channelType: string,
    options: { licenseId?: bigint; createdAt?: Date } = {},
  ): Promise<void> {
    await owner.channelMessage.create({
      data: {
        licenseId: options.licenseId ?? fx.a.licenseId,
        channelType,
        direction: 'inbound',
        externalId: `ext-${chatId ?? 'orphan'}-${channelType}-${Date.now()}`,
        chatId,
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      },
    });
  }

  /** Move a chat's thread back in time, to land it in an earlier report window. */
  async function backdateChat(chatId: string, createdAt: Date): Promise<void> {
    await owner.thread.updateMany({ where: { chatId }, data: { createdAt } });
    await owner.chat.update({ where: { id: chatId }, data: { createdAt } });
  }

  /**
   * Set exactly which teams (groups) a chat is shared with, replacing whatever
   * access the routing engine handed it at creation. Written directly, like the
   * other fixtures here, so a team-dimension test controls the `chat_access`
   * fan-out precisely rather than depending on the default routing decision — an
   * empty list makes a chat genuinely unassigned.
   */
  async function setChatTeams(chatId: string, groupIds: bigint[]): Promise<void> {
    await owner.chatAccess.deleteMany({ where: { chatId } });
    if (groupIds.length > 0) {
      await owner.chatAccess.createMany({
        data: groupIds.map((groupId) => ({ chatId, groupId })),
      });
    }
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

  describe('API calls (10.1.5)', () => {
    /** `yyyymm` for the current UTC month — the period the meter writes to. */
    const period = new Date().toISOString().slice(0, 7).replace('-', '');

    it('meters one usage record per PAT-authenticated call (the sayaç)', async () => {
      // Each PAT API call is a billed API call (FR-MOD-08.8.2). Three calls, so
      // the counter should read exactly three — the row's quantity *is* the
      // counter. Metering is awaited on the way out, so the count is settled by
      // the time the response lands.
      const calls = 3;
      for (let i = 0; i < calls; i++) {
        const res = await server.get('/auth/me', auth);
        expect(res.statusCode).toBe(200);
      }

      const record = await owner.usageRecord.findFirst({
        where: { licenseId: fx.a.licenseId, metric: 'api_calls', period },
      });
      expect(record).not.toBeNull();
      expect(Number(record!.quantity)).toBe(calls);
      // Stamped with the block conventions the meter, the invoice and the seed
      // all share, so a period's record carries the pricing that produced it.
      expect(record!.overageUnit).toBe(100_000);
      expect(record!.overageUnitPriceCents).toBe(2_950);
    });

    it('does not meter a failed authentication as a call', async () => {
      const before = await owner.usageRecord.count({
        where: { licenseId: fx.a.licenseId, metric: 'api_calls' },
      });
      // No principal is resolved, so there is nothing to bill — a rejected call
      // is not a served one.
      const res = await server.get('/auth/me', { authorization: 'Bearer not-a-real-token' });
      expect(res.statusCode).toBe(401);

      const after = await owner.usageRecord.count({
        where: { licenseId: fx.a.licenseId, metric: 'api_calls' },
      });
      expect(after).toBe(before);
    });

    it('scopes the API-call counter to one tenant', async () => {
      await server.get('/auth/me', auth); // one call as tenant A

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/billing/usage', { authorization: `Bearer ${theirToken}` })
      ).json();
      // B made no metered call of its own before reading — A's usage must not
      // leak across the tenant boundary.
      expect(theirs.api_calls.used).toBe(0);
    });

    it('prices the overage by the block and lands it on the invoice (aşım faturaya)', async () => {
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
      // 250,000 calls against the 100,000 allowance → 150,000 over. Billed by the
      // block: any part of a 100,000 block over the allowance costs one $29.50
      // block, so 150,000 over is two blocks — not one and a half.
      await owner.usageRecord.create({
        data: {
          licenseId: fx.a.licenseId,
          metric: 'api_calls',
          period,
          quantity: 250_000n,
          included: 100_000n,
          overageUnit: 100_000,
          overageUnitPriceCents: 2_950,
        },
      });

      const usage = (await server.get('/billing/usage', auth)).json();
      expect(usage.api_calls.used).toBe(250_000);
      expect(usage.api_calls.included).toBe(100_000);
      expect(usage.api_calls.overage).toBe(150_000);
      // Two blocks × $29.50.
      expect(usage.api_calls.overage_cents).toBe(2 * 2_950);
      expect(usage.api_calls.overage_unit).toBe(100_000);

      const sub = (await server.get('/billing/subscription', auth)).json();
      // Seats ($99 × 2) plus the two API-call blocks ($59.00) — the metered
      // overage reaches the invoice, exactly as the KK asks.
      expect(sub.estimated_total_cents).toBe(2 * 9900 + 2 * 2_950);
    });

    it('quotes the block price up front, before any overage is spent', async () => {
      // No API-call record yet: the meter still states the extra-usage price, so
      // an integration sees it before the allowance runs out.
      const api = (await server.get('/billing/usage', auth)).json().api_calls;
      expect(api.overage).toBe(0);
      expect(api.overage_cents).toBe(0);
      expect(api.overage_unit).toBe(100_000);
      expect(api.overage_unit_price_cents).toBe(2_950);
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

    it('buckets by UTC hour of day, dense across all 24 hours', async () => {
      const chatId = await conversation({ agentReplies: false }); // automated
      // Land it in a known hour, clear of "now" (backdated three days), so the
      // bucket it lands in is unambiguous — every other hour must read zero.
      const knownHour = 3;
      const openedAt = new Date();
      openedAt.setUTCDate(openedAt.getUTCDate() - 3);
      openedAt.setUTCHours(knownHour, 15, 0, 0);
      await backdateChat(chatId, openedAt);

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      interface HourRow {
        hour: number;
        chats: number;
        closed: number;
        manual: number;
        assisted: number;
        automated: number;
      }
      const byHour = breakdown.by_hour as HourRow[];

      // The hour axis is fixed (a day has 24 hours) regardless of the data —
      // unlike by_day, all 0-23 are present, in ascending order.
      expect(byHour).toHaveLength(24);
      byHour.forEach((row, index) => expect(row.hour).toBe(index));

      byHour.forEach((row) => {
        if (row.hour === knownHour) {
          expect(row.chats).toBe(1);
          expect(row.automated).toBe(1);
        } else {
          expect(row.chats).toBe(0);
        }
        // The split invariant holds in every row, populated or zero-filled.
        expect(row.manual + row.assisted + row.automated).toBe(row.closed);
      });
    });

    // --- by channel (07.5-d): isolation & negatives first, then the happy path ---

    interface ChannelRow {
      channel: string;
      chats: number;
      closed: number;
      manual: number;
      assisted: number;
      automated: number;
    }

    it('locks the channel join to the license — a foreign row cannot reclassify a chat', async () => {
      // A chat in license A with no inbound adapter message: it is a plain web
      // widget chat and must read as 'website'.
      const mine = await conversation({ agentReplies: true, customerName: 'Web visitor' });

      // Plant, in license B, a channel message carrying the SAME chat id and a
      // real adapter channel. A join keyed on chat_id alone would pull this row
      // in and show A's chat as 'messenger'; the `cm.license_id = t.license_id`
      // lock (and RLS behind it) must keep the foreign row out.
      await recordInbound(mine, 'messenger', { licenseId: fx.b.licenseId });

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      const channels = breakdown.by_channel as ChannelRow[];
      // One bucket only — 'website', holding the one chat. The foreign row leaked
      // into no bucket at all.
      expect(channels).toEqual([expect.objectContaining({ channel: 'website', chats: 1 })]);
      expect(channels.some((row) => row.channel === 'messenger')).toBe(false);
    });

    it('requires the reports_read scope', async () => {
      const noReports = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      const response = await server.get('/reports/breakdown', {
        authorization: `Bearer ${noReports}`,
      });
      expect(response.statusCode).toBe(403);
    });

    it('ignores inbound rows with no chat id', async () => {
      const mine = await conversation({ agentReplies: true });
      await recordInbound(mine, 'messenger');
      // An inbound row tied to no chat (chat_id null) must not create a phantom
      // bucket or steal a chat — the join predicate `cm.chat_id = t.chat_id`
      // never matches a null.
      await recordInbound(null, 'whatsapp');

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      expect(breakdown.by_channel as ChannelRow[]).toEqual([
        expect.objectContaining({ channel: 'messenger', chats: 1 }),
      ]);
    });

    it('buckets chats by their oldest inbound channel, website as the fallback', async () => {
      const onMessenger = await conversation({ agentReplies: true, customerName: 'FB' });
      await recordInbound(onMessenger, 'messenger');
      const onWhatsapp = await conversation({ agentReplies: false, customerName: 'WA' });
      await recordInbound(onWhatsapp, 'whatsapp');
      const onTwilio = await conversation({ agentReplies: true, customerName: 'SMS' });
      await recordInbound(onTwilio, 'twilio');
      // No inbound message at all → website.
      await conversation({ agentReplies: true, customerName: 'Web' });

      // A later whatsapp row on the messenger chat must NOT change its channel:
      // the *oldest* inbound decides, and messenger came first.
      await recordInbound(onMessenger, 'whatsapp', { createdAt: new Date(Date.now() + 60_000) });

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      const byChannel = Object.fromEntries(
        (breakdown.by_channel as ChannelRow[]).map((row) => [row.channel, row.chats]),
      );
      expect(byChannel).toEqual({ messenger: 1, whatsapp: 1, twilio: 1, website: 1 });
    });

    it('partitions the window: channel chats sum to the day total, split holds per row', async () => {
      const automated = await conversation({ agentReplies: false }); // automated
      await recordInbound(automated, 'messenger');
      await conversation({ agentReplies: true }); // manual, website
      const assisted = await conversation({ agentReplies: true });
      await runSkillOn(assisted); // assisted, website

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      const byChannel = breakdown.by_channel as ChannelRow[];

      // Every chat lands in exactly one channel bucket, so the buckets partition
      // the window — their chats sum to the by_day total (no chat lost or double
      // counted).
      const dayChats = (breakdown.by_day as Array<{ chats: number }>).reduce(
        (sum, row) => sum + row.chats,
        0,
      );
      const channelChats = byChannel.reduce((sum, row) => sum + row.chats, 0);
      expect(channelChats).toBe(dayChats);

      // ADR-09: the manual/assisted/automated split holds inside every channel
      // row too — the same fragment feeds every dimension.
      byChannel.forEach((row) => {
        expect(row.manual + row.assisted + row.automated).toBe(row.closed);
      });
      const messenger = byChannel.find((row) => row.channel === 'messenger');
      expect(messenger?.automated).toBe(1);
    });

    // --- by team (07.5-e): isolation & negatives first, then the happy path ---

    interface TeamRow {
      team_id: number | null;
      name: string | null;
      chats: number;
      closed: number;
      manual: number;
      assisted: number;
      automated: number;
    }

    it('locks the team join to the license — a foreign team with the same id cannot leak', async () => {
      // A group in license A and a group in license B that DELIBERATELY share the
      // same group_id — legal, since `groups` is keyed `(license_id, id)`. RLS is
      // the primary guard, and the query locks the groups join on
      // `g.license_id = c.license_id` as defence in depth: were RLS ever weakened,
      // a join on `g.id = ca.group_id` alone would resolve A's assignment against
      // B's team too, double-counting the chat and leaking B's name. Either way A
      // must see exactly its own 'Sales A', never 'Sales B'.
      const sharedId = 90001n;
      await owner.group.create({
        data: { id: sharedId, licenseId: fx.a.licenseId, name: 'Sales A' },
      });
      await owner.group.create({
        data: { id: sharedId, licenseId: fx.b.licenseId, name: 'Sales B' },
      });

      const mine = await conversation({ agentReplies: true, customerName: 'Shared-id' });
      await setChatTeams(mine, [sharedId]);

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      const teams = breakdown.by_team as TeamRow[];

      // Exactly one team row, resolved within license A. B's same-id team appears
      // nowhere, and the chat is counted once — no fan-out across the licence line.
      expect(teams).toEqual([
        expect.objectContaining({ team_id: Number(sharedId), name: 'Sales A', chats: 1 }),
      ]);
      expect(teams.some((row) => row.name === 'Sales B')).toBe(false);
      expect(breakdown.overlapping).toBe(false);
    });

    it('buckets chats by team and drops unassigned chats into their own row', async () => {
      const team = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Billing' },
        select: { id: true },
      });
      const assigned = await conversation({ agentReplies: true, customerName: 'Has team' }); // manual
      await setChatTeams(assigned, [team.id]);
      const noTeam = await conversation({ agentReplies: false, customerName: 'No team' }); // automated
      await setChatTeams(noTeam, []); // clear the routing default → genuinely unassigned

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      const teams = breakdown.by_team as TeamRow[];

      const billing = teams.find((row) => row.team_id === Number(team.id));
      expect(billing).toMatchObject({ name: 'Billing', chats: 1, manual: 1 });

      // The chat shared with no group is not lost — it lands in the null bucket
      // the UI renders as 'Unassigned'.
      const unassigned = teams.find((row) => row.team_id === null);
      expect(unassigned).toMatchObject({ name: null, chats: 1, automated: 1 });
      expect(breakdown.overlapping).toBe(false);
    });

    it('counts a chat under every team it is shared with and flags the overlap', async () => {
      const first = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Team One' },
        select: { id: true },
      });
      const second = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Team Two' },
        select: { id: true },
      });
      const shared = await conversation({ agentReplies: true, customerName: 'Two teams' }); // manual
      await setChatTeams(shared, [first.id, second.id]);

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      const teams = breakdown.by_team as TeamRow[];

      // The one chat is counted once under each of its two teams — M:N fan-out,
      // not a silent pick of a 'primary' team the schema does not record.
      expect(teams.find((row) => row.team_id === Number(first.id))?.chats).toBe(1);
      expect(teams.find((row) => row.team_id === Number(second.id))?.chats).toBe(1);
      // And the response declares it, so the client knows the rows can sum past
      // the window total.
      expect(breakdown.overlapping).toBe(true);
      const teamChats = teams.reduce((sum, row) => sum + row.chats, 0);
      const dayChats = (breakdown.by_day as Array<{ chats: number }>).reduce(
        (sum, row) => sum + row.chats,
        0,
      );
      expect(teamChats).toBeGreaterThan(dayChats);
    });

    it('partitions the window when no chat overlaps: team chats sum to the day total', async () => {
      const team = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Solo' },
        select: { id: true },
      });
      const automated = await conversation({ agentReplies: false }); // automated
      await setChatTeams(automated, [team.id]);
      const manualChat = await conversation({ agentReplies: true }); // manual
      await setChatTeams(manualChat, []); // unassigned
      const assisted = await conversation({ agentReplies: true });
      await runSkillOn(assisted); // assisted
      await setChatTeams(assisted, []); // unassigned

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      const teams = breakdown.by_team as TeamRow[];

      // No chat is shared with two teams, so the buckets partition the window:
      // their chats sum to the by_day total exactly, and the flag stays down.
      expect(breakdown.overlapping).toBe(false);
      const dayChats = (breakdown.by_day as Array<{ chats: number }>).reduce(
        (sum, row) => sum + row.chats,
        0,
      );
      const teamChats = teams.reduce((sum, row) => sum + row.chats, 0);
      expect(teamChats).toBe(dayChats);

      // ADR-09: the manual/assisted/automated split holds inside every team row.
      teams.forEach((row) => {
        expect(row.manual + row.assisted + row.automated).toBe(row.closed);
      });
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
      // by_channel is sparse like by_day: a tenant with nothing in the window
      // gets an empty array, not a stray 'website' row.
      expect(theirs.by_channel).toEqual([]);
      // by_hour stays dense even for a tenant with nothing in the window — 24
      // zero-filled rows, not an empty array.
      expect(theirs.by_hour).toHaveLength(24);
      expect(theirs.by_hour.every((row: { chats: number }) => row.chats === 0)).toBe(true);
      // by_team is sparse like by_day: nothing in the window means no rows at all
      // (not even an empty 'Unassigned' bucket), and no chat means no fan-out.
      expect(theirs.by_team).toEqual([]);
      expect(theirs.overlapping).toBe(false);
    });
  });

  // =========================================================================
  // 07.5-i — the four dimensions cross-checked against one another, the
  // Overview KPI and the ADR-09 invoice counter, plus the NFR-P2 read budget.
  // The per-dimension suites above prove each axis in isolation; this proves
  // they cannot drift *apart* — the property a five-section screen actually
  // depends on.
  // =========================================================================

  describe('breakdown cross-consistency (07.5-i)', () => {
    /** Sum one split field across every row of a dimension. */
    const sum = (rows: Array<{ [field: string]: number }>, field: string): number =>
      rows.reduce((total, row) => total + (row[field] ?? 0), 0);

    it('makes day, hour and channel partition the window to the same Overview total and split', async () => {
      // A mix that exercises all three resolution classes across two channels, so
      // no dimension can pass by collapsing everything into one bucket.
      const onMessenger = await conversation({ agentReplies: false, customerName: 'Bot/FB' }); // automated
      await recordInbound(onMessenger, 'messenger');
      await conversation({ agentReplies: true, customerName: 'Human' }); // manual, website
      const assisted = await conversation({ agentReplies: true, customerName: 'Helped' });
      await runSkillOn(assisted); // assisted, website
      const onWhatsapp = await conversation({ agentReplies: false, customerName: 'Bot/WA' }); // automated
      await recordInbound(onWhatsapp, 'whatsapp');

      const totals = (await server.get('/reports/overview', auth)).json().totals;
      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      const usage = (await server.get('/billing/usage', auth)).json();

      // Every chat lands in exactly one bucket of each of these three axes, so
      // their chat totals all equal the Overview `chats` KPI — no axis loses or
      // invents a chat.
      expect(sum(breakdown.by_day, 'chats')).toBe(totals.chats);
      expect(sum(breakdown.by_hour, 'chats')).toBe(totals.chats);
      expect(sum(breakdown.by_channel, 'chats')).toBe(totals.chats);

      // The resolution split agrees across all three axes and with the KPI cards —
      // the same SPLIT_COUNTS fragment feeds every dimension, so they cannot
      // classify the same chat two different ways (ADR-09).
      for (const field of ['closed', 'manual', 'assisted', 'automated'] as const) {
        expect(sum(breakdown.by_day, field)).toBe(totals[field]);
        expect(sum(breakdown.by_hour, field)).toBe(totals[field]);
        expect(sum(breakdown.by_channel, field)).toBe(totals[field]);
      }

      // And 'automated' is exactly the invoice's AI-resolution counter — the one
      // number Reports and billing must never disagree on (ADR-09) — reached
      // through the breakdown as well as the Overview.
      expect(usage.ai_resolutions.used).toBe(totals.automated);
      expect(sum(breakdown.by_channel, 'automated')).toBe(usage.ai_resolutions.used);
    });

    it('keeps manual + assisted + automated === closed in every row of every dimension', async () => {
      const onMessenger = await conversation({ agentReplies: false });
      await recordInbound(onMessenger, 'messenger');
      await conversation({ agentReplies: true });
      const assisted = await conversation({ agentReplies: true });
      await runSkillOn(assisted);

      const breakdown = (await server.get('/reports/breakdown', auth)).json();
      const everyRow = [
        ...breakdown.by_day,
        ...breakdown.by_hour,
        ...breakdown.by_channel,
        ...breakdown.by_team,
      ] as Array<{ manual: number; assisted: number; automated: number; closed: number }>;
      // Populated or zero-filled, the split is a true partition of closed in every
      // bucket — the invariant the KPI cards and the invoice both lean on.
      for (const row of everyRow) {
        expect(row.manual + row.assisted + row.automated).toBe(row.closed);
      }
    });

    it('lets only the team dimension exceed the window total, and only when it declares the overlap', async () => {
      // Baseline: no chat shared with two teams — every dimension, team included,
      // sums to the same Overview total and the flag stays down.
      const soloChannel = await conversation({ agentReplies: false });
      await recordInbound(soloChannel, 'twilio');
      await conversation({ agentReplies: true });

      const before = (await server.get('/reports/breakdown', auth)).json();
      const chatsBefore = (await server.get('/reports/overview', auth)).json().totals.chats;
      expect(before.overlapping).toBe(false);
      expect(sum(before.by_team, 'chats')).toBe(chatsBefore);

      // Open one chat to a second team. It is counted under both, so the team rows
      // sum to one past the window total — and `overlapping` says so. That flag is
      // the only sanctioned way any dimension may read higher than the KPI.
      const teamOne = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Alpha' },
        select: { id: true },
      });
      const teamTwo = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Beta' },
        select: { id: true },
      });
      const shared = await conversation({ agentReplies: true, customerName: 'Two teams' });
      await setChatTeams(shared, [teamOne.id, teamTwo.id]);

      const after = (await server.get('/reports/breakdown', auth)).json();
      const chatsAfter = (await server.get('/reports/overview', auth)).json().totals.chats;
      // The non-fan-out axes still partition the window exactly.
      expect(sum(after.by_day, 'chats')).toBe(chatsAfter);
      expect(sum(after.by_hour, 'chats')).toBe(chatsAfter);
      expect(sum(after.by_channel, 'chats')).toBe(chatsAfter);
      // Team overshoots by exactly the one extra membership, and declares it.
      expect(after.overlapping).toBe(true);
      expect(sum(after.by_team, 'chats')).toBe(chatsAfter + 1);
    });

    it('keeps the three new dimension queries within the NFR-P2 read budget (EXPLAIN ANALYZE)', async () => {
      // Real rows across channels and teams so the planner has joins to cost, not
      // an empty table.
      for (const channel of ['messenger', 'whatsapp', 'twilio']) {
        const chat = await conversation({ agentReplies: false, customerName: channel });
        await recordInbound(chat, channel);
      }
      const assisted = await conversation({ agentReplies: true });
      await runSkillOn(assisted);
      await conversation({ agentReplies: true }); // manual, website

      // SPLIT_COUNTS reproduced from reports.ts so the plan measures the real query
      // shape — the correlated EXISTS filters dominate the cost, so a probe over a
      // bare count(*) would understate it. Kept in sync deliberately: this is a
      // performance probe, and the cross-consistency tests above are what guard the
      // functional behaviour.
      const SPLIT = `
        count(*) AS chats,
        count(*) FILTER (WHERE NOT t.active) AS closed,
        count(*) FILTER (WHERE NOT t.active AND NOT EXISTS (
          SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'agent')) AS automated,
        count(*) FILTER (WHERE NOT t.active AND EXISTS (
          SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'agent')
          AND EXISTS (SELECT 1 FROM skill_runs sr WHERE sr.chat_id = t.chat_id AND sr.license_id = t.license_id)) AS assisted,
        count(*) FILTER (WHERE NOT t.active AND EXISTS (
          SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'agent')
          AND NOT EXISTS (SELECT 1 FROM skill_runs sr WHERE sr.chat_id = t.chat_id AND sr.license_id = t.license_id)) AS manual`;
      const WINDOW = `t.license_id = $1
        AND t.created_at >= now() - interval '30 days' AND t.created_at <= now()`;
      const queries: Record<string, string> = {
        by_hour: `SELECT EXTRACT(HOUR FROM t.created_at AT TIME ZONE 'UTC')::int AS hour, ${SPLIT}
          FROM threads t WHERE ${WINDOW} GROUP BY 1 ORDER BY 1`,
        by_channel: `SELECT first_inbound.channel_type, ${SPLIT}
          FROM threads t
          LEFT JOIN LATERAL (
            SELECT cm.channel_type FROM channel_messages cm
            WHERE cm.license_id = t.license_id AND cm.chat_id = t.chat_id AND cm.direction = 'inbound'
            ORDER BY cm.created_at, cm.id LIMIT 1) first_inbound ON TRUE
          WHERE ${WINDOW} GROUP BY first_inbound.channel_type`,
        by_team: `SELECT ca.group_id AS team_id, g.name, ${SPLIT}
          FROM threads t
          JOIN chats c ON c.id = t.chat_id AND c.license_id = t.license_id
          LEFT JOIN chat_access ca ON ca.chat_id = c.id
          LEFT JOIN groups g ON g.license_id = c.license_id AND g.id = ca.group_id
          WHERE ${WINDOW} GROUP BY ca.group_id, g.name`,
      };

      // NFR-P2: reads p99 < 150ms. On the seeded dataset execution is sub-millisecond;
      // the assertion is a floor a plan regression (a dropped index, a bad join order)
      // would blow through. The concrete numbers are the budget evidence 07.5-i owes —
      // recorded in HANDOFF.
      const NFR_P2_READ_BUDGET_MS = 150;
      const timings: Record<string, number> = {};
      for (const [name, sql] of Object.entries(queries)) {
        const [row] = await owner.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
          fx.a.licenseId,
        );
        const raw = row?.['QUERY PLAN'];
        const plan = (typeof raw === 'string' ? JSON.parse(raw) : raw) as
          | Array<{ 'Execution Time': number }>
          | undefined;
        const executionMs = plan?.[0]?.['Execution Time'];
        expect(executionMs).toBeDefined();
        timings[name] = executionMs ?? Number.NaN;
        expect(timings[name]).toBeLessThan(NFR_P2_READ_BUDGET_MS);
      }
      // All three measured — a silently-skipped query would leave the budget unproven.
      expect(Object.keys(timings)).toEqual(['by_hour', 'by_channel', 'by_team']);
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

  describe('Cases report (07.7-a)', () => {
    /** Create a ticket directly, with full control over the fields the report buckets on. */
    async function createTicket(
      options: {
        status?: string;
        priority?: number;
        createdAt?: Date;
        mergedIntoId?: string;
      } = {},
    ): Promise<string> {
      const id = generateShortId();
      await owner.ticket.create({
        data: {
          id,
          licenseId: fx.a.licenseId,
          subject: 'Test ticket',
          status: options.status ?? 'open',
          priority: options.priority ?? 0,
          ...(options.createdAt ? { createdAt: options.createdAt } : {}),
          ...(options.mergedIntoId ? { mergedIntoId: options.mergedIntoId } : {}),
        },
        select: { id: true },
      });
      return id;
    }

    it('buckets tickets by UTC day into open vs closed by current status', async () => {
      const dayA = new Date(Date.now() - 5 * 86_400_000);
      const dayB = new Date(Date.now() - 2 * 86_400_000);
      await createTicket({ status: 'open', createdAt: dayA });
      await createTicket({ status: 'solved', createdAt: dayA });
      await createTicket({ status: 'closed', createdAt: dayB });

      const cases = (await server.get('/reports/cases', auth)).json();
      expect(cases.by_day).toHaveLength(2);
      expect(cases.by_day[0]).toEqual({
        date: dayA.toISOString().slice(0, 10),
        open: 1,
        closed: 1,
        total: 2,
      });
      expect(cases.by_day[1]).toEqual({
        date: dayB.toISOString().slice(0, 10),
        open: 0,
        closed: 1,
        total: 1,
      });
    });

    it('groups tickets by current status', async () => {
      await createTicket({ status: 'open' });
      await createTicket({ status: 'open' });
      await createTicket({ status: 'pending' });
      await createTicket({ status: 'solved' });

      const cases = (await server.get('/reports/cases', auth)).json();
      const byStatus = Object.fromEntries(
        (cases.by_status as Array<{ status: string; count: number }>).map((row) => [
          row.status,
          row.count,
        ]),
      );
      expect(byStatus).toEqual({ open: 2, pending: 1, solved: 1 });
    });

    it('groups tickets by stored queue priority', async () => {
      await createTicket({ priority: 100 });
      await createTicket({ priority: 100 });
      await createTicket({ priority: 0 });

      const cases = (await server.get('/reports/cases', auth)).json();
      expect(cases.by_priority).toEqual(
        expect.arrayContaining([
          { priority: 100, count: 2 },
          { priority: 0, count: 1 },
        ]),
      );
    });

    it('excludes a merged ticket from every bucket, so a merge never double-counts', async () => {
      const primary = await createTicket({ status: 'open' });
      await createTicket({ status: 'open', mergedIntoId: primary });

      const cases = (await server.get('/reports/cases', auth)).json();
      const total = (cases.by_status as Array<{ count: number }>).reduce(
        (sum, row) => sum + row.count,
        0,
      );
      expect(total).toBe(1);
    });

    it('reports an empty window as empty arrays, not an error', async () => {
      const cases = (await server.get('/reports/cases', auth)).json();
      expect(cases.by_day).toEqual([]);
      expect(cases.by_status).toEqual([]);
      expect(cases.by_priority).toEqual([]);
    });

    it('never counts another tenant', async () => {
      await createTicket({ status: 'open' });

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/reports/cases', { authorization: `Bearer ${theirToken}` })
      ).json();
      expect(theirs.by_day).toEqual([]);
      expect(theirs.by_status).toEqual([]);
      expect(theirs.by_priority).toEqual([]);
    });

    it('rejects a backwards date range', async () => {
      const response = await server.get('/reports/cases?from=2026-08-01&to=2026-07-01', auth);
      expect(response.statusCode).toBe(400);
    });

    it('requires the reports_read scope', async () => {
      const scopeless = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      const response = await server.get('/reports/cases', {
        authorization: `Bearer ${scopeless}`,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // =========================================================================

  describe('Leads report (07.7-b)', () => {
    /**
     * Create a lead (an `is_lead` customer) that has touched this license, with
     * control over the touch type and its date. `touch: 'none'` makes an
     * organization lead that never reached this license — the case the report
     * must *not* count, and the whole reason the count is a chat/ticket join
     * rather than a bare `customers.is_lead` tally.
     */
    async function createLead(
      options: { touch?: 'chat' | 'ticket' | 'none'; isLead?: boolean; createdAt?: Date } = {},
    ): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Lead', isLead: options.isLead ?? true },
        select: { id: true },
      });
      const at = options.createdAt;
      const touch = options.touch ?? 'chat';
      if (touch === 'chat') {
        await owner.chat.create({
          data: {
            id: generateShortId(),
            licenseId: fx.a.licenseId,
            customerId: customer.id,
            ...(at ? { createdAt: at } : {}),
          },
        });
      } else if (touch === 'ticket') {
        await owner.ticket.create({
          data: {
            id: generateShortId(),
            licenseId: fx.a.licenseId,
            customerId: customer.id,
            subject: 'Lead ticket',
            status: 'open',
            ...(at ? { createdAt: at } : {}),
          },
        });
      }
      return customer.id;
    }

    it('counts new leads by the UTC day of their first touch on this license', async () => {
      const dayA = new Date(Date.now() - 5 * 86_400_000);
      const dayB = new Date(Date.now() - 2 * 86_400_000);
      // A lead whose first touch is a ticket on dayA and who also has a later
      // chat on dayB — counted once, on dayA (first touch), never moved to dayB
      // nor doubled. (A customer may hold only one chat per license, so the
      // second touch has to come through a different table.)
      const early = await createLead({ touch: 'ticket', createdAt: dayA });
      await owner.chat.create({
        data: { id: generateShortId(), licenseId: fx.a.licenseId, customerId: early, createdAt: dayB },
      });
      // A second lead first seen on dayB.
      await createLead({ createdAt: dayB });

      const leads = (await server.get('/reports/leads', auth)).json();
      expect(leads.by_day).toEqual([
        { date: dayA.toISOString().slice(0, 10), count: 1 },
        { date: dayB.toISOString().slice(0, 10), count: 1 },
      ]);
      expect(leads.totals).toEqual({ leads: 2 });
    });

    it('counts a lead reached through a ticket, not only a chat', async () => {
      await createLead({ touch: 'ticket' });
      const leads = (await server.get('/reports/leads', auth)).json();
      expect(leads.totals).toEqual({ leads: 1 });
    });

    it('does not count a non-lead customer with a chat', async () => {
      await createLead({ isLead: false }); // touched the license, but is_lead is false
      await createLead(); // a real lead, for contrast
      const leads = (await server.get('/reports/leads', auth)).json();
      expect(leads.totals).toEqual({ leads: 1 });
    });

    it('does not count an organization lead that never touched this license', async () => {
      // An `is_lead` customer in the org with no chat or ticket on this license
      // — exactly what a bare `customers.is_lead` count would wrongly include.
      await createLead({ touch: 'none' });
      const leads = (await server.get('/reports/leads', auth)).json();
      expect(leads.by_day).toEqual([]);
      expect(leads.totals).toEqual({ leads: 0 });
    });

    it('reports an empty window as zero, not an error', async () => {
      const leads = (await server.get('/reports/leads', auth)).json();
      expect(leads.by_day).toEqual([]);
      expect(leads.totals).toEqual({ leads: 0 });
    });

    it('never counts another tenant', async () => {
      await createLead(); // a lead in A

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/reports/leads', { authorization: `Bearer ${theirToken}` })
      ).json();
      expect(theirs.by_day).toEqual([]);
      expect(theirs.totals).toEqual({ leads: 0 });
    });

    it('rejects a backwards date range', async () => {
      const response = await server.get('/reports/leads?from=2026-08-01&to=2026-07-01', auth);
      expect(response.statusCode).toBe(400);
    });

    it('requires the reports_read scope', async () => {
      const scopeless = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      const response = await server.get('/reports/leads', {
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
          'topics',
          'cases',
          'leads',
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

      /** Parse a `dimension,key,chats,closed,manual,assisted,automated` data row. */
      interface BreakdownCsvRow {
        dimension: string;
        key: string;
        chats: number;
        closed: number;
        manual: number;
        assisted: number;
        automated: number;
      }
      const parseBreakdownRow = (line: string): BreakdownCsvRow => {
        const [dimension, key, chats, closed, manual, assisted, automated] = line.split(',');
        return {
          dimension: dimension!,
          key: key!,
          chats: Number(chats),
          closed: Number(closed),
          manual: Number(manual),
          assisted: Number(assisted),
          automated: Number(automated),
        };
      };

      it('exports the breakdown as one long-format CSV — four dimensions, never disagreeing with the screen', async () => {
        await conversation({ agentReplies: false }); // one automated chat, closed today

        const [breakdown, response] = await Promise.all([
          server.get('/reports/breakdown', auth),
          server.get('/reports/export?group=breakdown', auth),
        ]);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
        expect(response.headers['content-disposition']).toMatch(
          /^attachment; filename="nexa-breakdown-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/,
        );
        expect(response.headers['cache-control']).toBe('no-store');

        const rows = lines(response.body);
        expect(rows[0]).toBe('dimension,key,chats,closed,manual,assisted,automated');

        interface SplitFields {
          chats: number;
          closed: number;
          manual: number;
          assisted: number;
          automated: number;
        }
        interface CsvDayRow extends SplitFields {
          date: string;
        }
        interface CsvHourRow extends SplitFields {
          hour: number;
        }
        interface CsvTeamRow extends SplitFields {
          name: string | null;
        }
        interface CsvChannelRow extends SplitFields {
          channel: string;
        }
        const splitOf = (row: SplitFields) => ({
          chats: row.chats,
          closed: row.closed,
          manual: row.manual,
          assisted: row.assisted,
          automated: row.automated,
        });

        const data = breakdown.json();
        const dataRows = rows.slice(1).map(parseBreakdownRow);

        // Same row count as the four screen dimensions combined — the download
        // can never drop or invent a bucket the tab does not show.
        expect(dataRows).toHaveLength(
          data.by_day.length + data.by_hour.length + data.by_team.length + data.by_channel.length,
        );

        const byDimension = (name: string) => dataRows.filter((row) => row.dimension === name);

        expect(byDimension('day')).toEqual(
          (data.by_day as CsvDayRow[]).map((row) => ({
            dimension: 'day',
            key: row.date,
            ...splitOf(row),
          })),
        );
        expect(byDimension('hour')).toEqual(
          (data.by_hour as CsvHourRow[]).map((row) => ({
            dimension: 'hour',
            key: String(row.hour),
            ...splitOf(row),
          })),
        );
        expect(byDimension('team')).toEqual(
          (data.by_team as CsvTeamRow[]).map((row) => ({
            dimension: 'team',
            key: row.name ?? 'Unassigned',
            ...splitOf(row),
          })),
        );
        expect(byDimension('channel')).toEqual(
          (data.by_channel as CsvChannelRow[]).map((row) => ({
            dimension: 'channel',
            key: row.channel,
            ...splitOf(row),
          })),
        );

        // The single automated chat lands as the 'Support' team (the default
        // group — see beforeEach) and the 'website' channel (no inbound
        // adapter message recorded).
        expect(byDimension('team')).toEqual([
          { dimension: 'team', key: 'Support', chats: 1, closed: 1, manual: 0, assisted: 0, automated: 1 },
        ]);
        expect(byDimension('channel')).toEqual([
          {
            dimension: 'channel',
            key: 'website',
            chats: 1,
            closed: 1,
            manual: 0,
            assisted: 0,
            automated: 1,
          },
        ]);
      });

      it('neutralises formula injection in a team name key, same as any other field', async () => {
        // Starts with a formula-lead char (`-`) *and* carries a comma, so both
        // guards in `csvField` fire on the same key: the leading `'` defuses
        // the formula, then the comma forces RFC 4180 quoting.
        const dangerous = await owner.group.create({
          data: { licenseId: fx.a.licenseId, name: '-Acme,Inc' },
          select: { id: true },
        });
        const chatId = await conversation({ agentReplies: false });
        await setChatTeams(chatId, [dangerous.id]);

        const response = await server.get('/reports/export?group=breakdown', auth);
        const rows = lines(response.body);
        const teamRow = rows.find((line) => line.startsWith('team,'));

        expect(teamRow).toBe('team,"\'-Acme,Inc",1,1,0,0,1');
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

      it('exports cases bucketed by day, matching the JSON report', async () => {
        await owner.ticket.create({
          data: {
            id: generateShortId(),
            licenseId: fx.a.licenseId,
            subject: 'Test ticket',
            status: 'solved',
          },
        });

        const [cases, response] = await Promise.all([
          server.get('/reports/cases', auth),
          server.get('/reports/export?group=cases', auth),
        ]);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
        expect(response.headers['content-disposition']).toMatch(
          /^attachment; filename="nexa-cases-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/,
        );

        const rows = lines(response.body);
        expect(rows[0]).toBe('date,open,closed,total');
        const data = cases.json();
        expect(rows.slice(1)).toEqual(
          (data.by_day as Array<{ date: string; open: number; closed: number; total: number }>).map(
            (row) => `${row.date},${row.open},${row.closed},${row.total}`,
          ),
        );
        expect(rows[1]).toMatch(/^\d{4}-\d{2}-\d{2},0,1,1$/);
      });

      it('exports leads bucketed by day, matching the JSON report', async () => {
        const lead = await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: 'Lead', isLead: true },
          select: { id: true },
        });
        await owner.chat.create({
          data: { id: generateShortId(), licenseId: fx.a.licenseId, customerId: lead.id },
        });

        const [leads, response] = await Promise.all([
          server.get('/reports/leads', auth),
          server.get('/reports/export?group=leads', auth),
        ]);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
        expect(response.headers['content-disposition']).toMatch(
          /^attachment; filename="nexa-leads-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/,
        );

        const rows = lines(response.body);
        expect(rows[0]).toBe('date,count');
        const data = leads.json();
        expect(rows.slice(1)).toEqual(
          (data.by_day as Array<{ date: string; count: number }>).map(
            (row) => `${row.date},${row.count}`,
          ),
        );
        expect(rows[1]).toMatch(/^\d{4}-\d{2}-\d{2},1$/);
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
        // B shares none of A's chats: day/team/channel contribute no rows, but
        // the hour axis stays dense (see breakdownByHour) — 24 zero-filled rows,
        // same as the JSON breakdown's `by_hour`.
        const rows = lines(response.body);
        expect(rows[0]).toBe('dimension,key,chats,closed,manual,assisted,automated');
        expect(rows).toHaveLength(1 + 24);
        rows.slice(1).forEach((line, hour) => {
          expect(line).toBe(`hour,${hour},0,0,0,0,0`);
        });
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

  // =========================================================================
  // FR-MOD-10.3: invoices (list + download) and the payment method. Billing is
  // mocked (ADR-13); real card entry is out of scope (PRD §11.1/1).
  describe('invoices (10.3)', () => {
    const period = new Date().toISOString().slice(0, 7).replace('-', '');

    /** Take the trial off and put an active subscription on file. */
    async function activate(seats = 2): Promise<void> {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'active', trialEndsAt: null },
      });
      await owner.subscription.create({
        data: {
          licenseId: fx.a.licenseId,
          status: 'active',
          seats,
          unitPriceCents: 9900,
          aiResolutionsIncluded: 200,
        },
      });
    }

    it('always lists the current period as an open invoice', async () => {
      await activate();
      const invoices = (await server.get('/billing/invoices', auth)).json().invoices;

      const open = invoices.find((i: { period: string }) => i.period === period);
      expect(open).toBeTruthy();
      expect(open.number).toBe(`NEXA-${period}`);
      expect(open.status).toBe('open');
      // The standing seat charge, visible before the period closes.
      expect(open.total_cents).toBe(2 * 9900);
    });

    it('matches the current invoice total to estimated_total_cents (one arithmetic)', async () => {
      await activate();
      // 210 AI resolutions against 200 included → 10 over at $0.50 = $5.00.
      await owner.usageRecord.create({
        data: {
          licenseId: fx.a.licenseId,
          metric: 'ai_resolutions',
          period,
          quantity: 210n,
          included: 200n,
          overageUnit: 50,
          overageUnitPriceCents: 50,
        },
      });

      const [invoices, sub] = await Promise.all([
        server.get('/billing/invoices', auth),
        server.get('/billing/subscription', auth),
      ]);
      const open = invoices.json().invoices.find((i: { period: string }) => i.period === period);
      // Seats ($198) + the AI overage ($5) — the same figure the subscription
      // view quotes, so the invoice and the estimate can never disagree.
      expect(open.total_cents).toBe(2 * 9900 + 500);
      expect(open.total_cents).toBe(sub.json().estimated_total_cents);
      // The overage is an itemised line, not folded silently into the total.
      const items = open.line_items.map((l: { description: string }) => l.description);
      expect(items.some((d: string) => /overage/i.test(d))).toBe(true);
    });

    it('bills nothing on the invoice during the trial', async () => {
      // The fixture license is trialing; the statement owes nothing.
      const open = (await server.get('/billing/invoices', auth)).json().invoices[0];
      expect(open.status).toBe('trial');
      expect(open.total_cents).toBe(0);
    });

    it('lists a past period with usage as a settled invoice', async () => {
      await activate();
      await owner.usageRecord.create({
        data: {
          licenseId: fx.a.licenseId,
          metric: 'ai_resolutions',
          period: '202601',
          quantity: 260n,
          included: 200n,
          overageUnit: 50,
          overageUnitPriceCents: 50,
        },
      });

      const invoices = (await server.get('/billing/invoices', auth)).json().invoices;
      const past = invoices.find((i: { period: string }) => i.period === '202601');
      expect(past).toBeTruthy();
      expect(past.status).toBe('paid');
      // Seats ($198) + 60 over at $0.50 ($30) = $228.
      expect(past.total_cents).toBe(2 * 9900 + 60 * 50);
      // Newest first: the current period sorts ahead of an old one.
      expect(invoices[0].period.localeCompare('202601')).toBeGreaterThan(0);
    });

    it('downloads one invoice as an injection-safe CSV', async () => {
      await activate();
      const response = await server.get(`/billing/invoices/${period}/download`, auth);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="nexa-invoice-${period}.csv"`,
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');

      const rows = response.body.split('\r\n').filter((l: string) => l !== '');
      expect(rows[0]).toBe('item,amount_cents');
      // The subscription line and a total row summing to the seat charge.
      expect(rows).toContain('Total,19800');
    });

    it('404s a period with no invoice', async () => {
      const response = await server.get('/billing/invoices/209912/download', auth);
      expect(response.statusCode).toBe(404);
    });

    it('400s a malformed period', async () => {
      const response = await server.get('/billing/invoices/not-a-period/download', auth);
      expect(response.statusCode).toBe(400);
    });

    it('needs a reading scope', async () => {
      const weak = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      const response = await server.get('/billing/invoices', {
        authorization: `Bearer ${weak}`,
      });
      expect(response.statusCode).toBe(403);
    });

    it('never shows another tenant an invoice', async () => {
      await activate();
      await owner.usageRecord.create({
        data: {
          licenseId: fx.a.licenseId,
          metric: 'ai_resolutions',
          period: '202601',
          quantity: 260n,
          included: 200n,
          overageUnit: 50,
          overageUnitPriceCents: 50,
        },
      });

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/billing/invoices', { authorization: `Bearer ${theirToken}` })
      ).json().invoices;
      // B sees only its own open invoice — none of A's past periods.
      expect(theirs.every((i: { period: string }) => i.period === period)).toBe(true);
    });
  });

  // =========================================================================
  describe('payment method (10.3)', () => {
    const validCard = {
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2030,
      holder_name: 'Jane Doe',
    };

    it('is empty until one is set', async () => {
      const response = await server.get('/billing/payment-method', auth);
      expect(response.statusCode).toBe(200);
      expect(response.json().payment_method).toBeNull();
    });

    it('stores the masked method and reads it back — never a full card number', async () => {
      const put = await server.put('/billing/payment-method', validCard, auth);
      expect(put.statusCode).toBe(200);
      expect(put.json()).toMatchObject({
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2030,
        holder_name: 'Jane Doe',
      });
      // Only the last four is kept — there is no field for a full PAN.
      expect(put.json()).not.toHaveProperty('card_number');

      const get = (await server.get('/billing/payment-method', auth)).json().payment_method;
      expect(get.last4).toBe('4242');
      // Persisted in the row, masked.
      const row = await owner.paymentMethod.findUniqueOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(row.last4).toBe('4242');
    });

    it('replaces the method on a second save', async () => {
      await server.put('/billing/payment-method', validCard, auth);
      await server.put(
        '/billing/payment-method',
        { ...validCard, brand: 'mastercard', last4: '1111' },
        auth,
      );
      const get = (await server.get('/billing/payment-method', auth)).json().payment_method;
      expect(get.brand).toBe('mastercard');
      expect(get.last4).toBe('1111');
      // One row, not two — the singleton was updated, not appended to.
      expect(await owner.paymentMethod.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    });

    it('rejects an expired card', async () => {
      const response = await server.put(
        '/billing/payment-method',
        { ...validCard, exp_month: 1, exp_year: 2020 },
        auth,
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().error.type).toBe('validation');
    });

    it('rejects a bad last four', async () => {
      const response = await server.put(
        '/billing/payment-method',
        { ...validCard, last4: '12' },
        auth,
      );
      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown card brand', async () => {
      const response = await server.put(
        '/billing/payment-method',
        { ...validCard, brand: 'sofort' },
        auth,
      );
      expect(response.statusCode).toBe(400);
    });

    it('needs a billing scope, not merely reports_read', async () => {
      const readOnly = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['reports_read'],
      });
      const response = await server.put('/billing/payment-method', validCard, {
        authorization: `Bearer ${readOnly}`,
      });
      expect(response.statusCode).toBe(403);
    });

    it('stays writable while the trial is read-only — a card is the way back', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
      });
      const response = await server.put('/billing/payment-method', validCard, auth);
      expect(response.statusCode).toBe(200);
    });

    it('writes an audit entry recording who set the card', async () => {
      await server.put('/billing/payment-method', validCard, auth);
      const entry = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'billing.payment_method_updated' },
      });
      expect(entry).not.toBeNull();
      // Brand and last four only — never the expiry or holder.
      expect(entry!.metadata).toMatchObject({ brand: 'visa', last4: '4242' });
    });

    it('never leaks a card across tenants', async () => {
      await server.put('/billing/payment-method', validCard, auth);
      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/billing/payment-method', { authorization: `Bearer ${theirToken}` })
      ).json();
      expect(theirs.payment_method).toBeNull();
    });
  });
});
