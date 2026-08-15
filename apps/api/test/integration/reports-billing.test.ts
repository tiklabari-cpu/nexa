/**
 * Reports, metering and the trial gate.
 *
 * The property that matters most: the "Automated" figure in Reports and the
 * AI-resolution counter on the invoice come from the same definition. Two
 * counters meant to agree will not, and the first anyone notices is a customer
 * disputing a bill.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PACKAGE_CATALOG, generateShortId } from '@nexa/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  seedSubscription,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { REPORT_GROUPS } from '../../src/routes/reports-export.js';
import { REPORT_MAX_RANGE_DAYS } from '../../src/routes/reports.js';
import { withTenant } from '../../src/lib/tenant.js';
import { currentPeriod, recordApiCall } from '../../src/services/billing/metering.js';
import { purchaseApiPackage } from '../../src/services/billing/api-package-service.js';

describe('reports and billing', () => {
  let owner: PrismaClient;
  /** The `nexa_app` role the API itself connects as — RLS applies to it. */
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;

  beforeAll(async () => {
    const appUrl = process.env['DATABASE_APP_URL'];
    if (!appUrl) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: appUrl });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
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

  /**
   * An instant that is unambiguously *inside* a report window anchored on "now".
   *
   * Every fixture below that has to be counted by a report stamps its timestamp
   * with this rather than leaving the column default, and that is not cosmetic.
   * The default is Postgres' clock; a report's `to` is the API process' own
   * `new Date()`. The two are different clocks — the database runs in a
   * container and was measured up to ~10ms ahead of the host (probe: a row
   * written at `…37.140Z` against a request whose `to` came out `…37.139Z`). A
   * row inserted microseconds before the request therefore lands *after* the
   * window closes and disappears from a report that should show it.
   *
   * The signature was unmistakable once looked for: tests that set a date
   * explicitly (5 days back, 45 days back) never failed, while every test that
   * wrote "now" and read it straight back failed together in the same run —
   * roughly one run in four. It is an environment artifact, not a product bug:
   * `created_at <= to` is the correct predicate and stays as it is.
   *
   * A minute of slack is orders of magnitude past any skew ever measured and
   * still deep inside every window these tests ask for — the narrowest is ten
   * days.
   */
  const justNow = (): Date => new Date(Date.now() - 60_000);

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
   *
   * Both hand-off counters window on the event's own `created_at`, so the row is
   * stamped {@link justNow} rather than left to the column default.
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
        createdAt: justNow(),
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

  /**
   * Record that a visitor reached a goal — the funnel's converted stage
   * (FR-MOD-13.3). Written directly (like {@link runSkillOn}), so a report
   * test controls `achieved_at` and the tenant precisely rather than driving
   * the whole page-view → match → achievement flow (13.3-d already covers
   * that end to end).
   */
  async function recordGoalAchievement(
    options: { licenseId?: bigint; achievedAt?: Date } = {},
  ): Promise<void> {
    const licenseId = options.licenseId ?? fx.a.licenseId;
    const organizationId = licenseId === fx.a.licenseId ? fx.a.organizationId : fx.b.organizationId;
    const goal = await owner.goal.create({
      data: { licenseId, name: 'Signed up' },
      select: { id: true },
    });
    const customer = await owner.customer.create({
      data: { organizationId, name: 'Converted visitor' },
      select: { id: true },
    });
    await owner.goalAchievement.create({
      data: {
        licenseId,
        goalId: goal.id,
        customerId: customer.id,
        achievedAt: options.achievedAt ?? justNow(),
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
        data: { chatId, licenseId: fx.a.licenseId, value: 'good', createdAt: justNow() },
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

    it('counts goals reached in the range (FR-MOD-13.3)', async () => {
      await recordGoalAchievement();
      await recordGoalAchievement();

      const report = await server.get('/reports/overview', auth);
      expect(report.json().totals.achieved_goals).toBe(2);
    });

    it("never counts another tenant's achieved goals", async () => {
      await recordGoalAchievement();
      await recordGoalAchievement({ licenseId: fx.b.licenseId });

      const report = await server.get('/reports/overview', auth);
      expect(report.json().totals.achieved_goals).toBe(1);
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

    it('drops a goal reached before the window into the previous period, not the current one', async () => {
      await recordGoalAchievement(); // inside the current window (now)
      await recordGoalAchievement({ achievedAt: new Date(Date.now() - 15 * 86_400_000) }); // earlier

      const to = new Date();
      const from = new Date(to.getTime() - 10 * 86_400_000);
      const report = (
        await server.get(
          `/reports/overview?from=${from.toISOString()}&to=${to.toISOString()}`,
          auth,
        )
      ).json();

      expect(report.totals.achieved_goals).toBe(1);
      expect(report.previous_period.achieved_goals).toBe(1);
    });
  });

  // =========================================================================

  describe('SLA breaches (FR-MOD-11.5 · 11.5-e)', () => {
    /** A miss row, written straight in — the marking path is `sla.test.ts`'s. */
    async function recordSlaBreach(
      options: { licenseId?: bigint; detectedAt?: Date } = {},
    ): Promise<void> {
      await owner.slaBreach.create({
        data: {
          licenseId: options.licenseId ?? fx.a.licenseId,
          subjectType: 'thread',
          subjectId: generateShortId(),
          target: 'first_response',
          targetMinutes: 30,
          elapsedMinutes: 90,
          businessHoursOnly: false,
          detectedAt: options.detectedAt ?? justNow(),
        },
      });
    }

    it('counts breaches in the range and reports SLA active once targets are configured on an Enterprise plan', async () => {
      await seedSubscription(owner, fx.a.licenseId, 'enterprise');
      await owner.slaPolicy.create({
        data: { licenseId: fx.a.licenseId, firstResponseMinutes: 30 },
      });
      await recordSlaBreach();
      await recordSlaBreach();

      const report = (await server.get('/reports/overview', auth)).json();
      expect(report.sla).toEqual({ active: true, breaches: 2, low_confidence: true });
    });

    it('reads a never-configured workspace as inactive, not as a clean record of zero', async () => {
      const report = (await server.get('/reports/overview', auth)).json();
      expect(report.sla.active).toBe(false);
      expect(report.sla.breaches).toBe(0);
    });

    it('reads SLA as inactive on a plan without the entitlement, even with saved targets', async () => {
      // The subscription stays on the default trial plan (growth) — no `sla`
      // entitlement — while a policy is on file from an earlier Enterprise
      // period (§C-A26: a downgrade keeps the row, stops honouring it).
      await owner.slaPolicy.create({
        data: { licenseId: fx.a.licenseId, firstResponseMinutes: 30 },
      });

      const report = (await server.get('/reports/overview', auth)).json();
      expect(report.sla.active).toBe(false);
    });

    it("never counts another tenant's breaches", async () => {
      await recordSlaBreach();
      await recordSlaBreach({ licenseId: fx.b.licenseId });

      const report = (await server.get('/reports/overview', auth)).json();
      expect(report.sla.breaches).toBe(1);
    });

    it('drops a breach detected before the window into the previous period, not the current one', async () => {
      await recordSlaBreach(); // inside the current window (now)
      await recordSlaBreach({ detectedAt: new Date(Date.now() - 15 * 86_400_000) }); // earlier

      const to = new Date();
      const from = new Date(to.getTime() - 10 * 86_400_000);
      const report = (
        await server.get(
          `/reports/overview?from=${from.toISOString()}&to=${to.toISOString()}`,
          auth,
        )
      ).json();

      expect(report.sla.breaches).toBe(1);
      expect(report.previous_period.sla_breaches).toBe(1);
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
          Array<{ 'Execution Time': number }> | undefined;
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
    /**
     * Attach a rating to a chat, optionally landing it in an earlier day/window.
     * Defaults to {@link justNow} rather than the column default: the CSAT
     * figures window on `ratings.created_at`, and a rating written a moment
     * before the request is exactly the row the clock skew swallows.
     */
    async function rate(chatId: string, value: 'good' | 'bad', createdAt?: Date): Promise<void> {
      await owner.rating.create({
        data: {
          chatId,
          licenseId: fx.a.licenseId,
          value,
          createdAt: createdAt ?? justNow(),
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

    // --- Ecommerce / tracked sales (FR-MOD-13.5, 13.5-d) --------------------

    /** Switch sales tracking on (or off) for a license, as the settings screen would. */
    async function configureTracking(options: {
      licenseId: bigint;
      enabled: boolean;
      currency?: string;
    }): Promise<void> {
      await owner.salesTrackerSettings.create({
        data: {
          licenseId: options.licenseId,
          enabled: options.enabled,
          currency: options.currency ?? 'USD',
          attributionWindowDays: 7,
        },
      });
    }

    let orderSeq = 0;

    /**
     * Record one order the way the ingest endpoint (13.5-c) would have left it.
     * `created_at` is stamped {@link justNow} rather than left to the column
     * default — this was the first fixture here immunised against the clock
     * skew, and the reasoning is written out at that helper.
     */
    async function sale(options: {
      licenseId: bigint;
      amountCents: number;
      chatId?: string;
      attributed?: boolean;
      currency?: string;
      createdAt?: Date;
    }): Promise<void> {
      orderSeq += 1;
      await owner.trackedSale.create({
        data: {
          licenseId: options.licenseId,
          chatId: options.chatId ?? null,
          externalOrderId: `order-${orderSeq}`,
          amountCents: options.amountCents,
          currency: options.currency ?? 'USD',
          attributed: options.attributed ?? true,
          createdAt: options.createdAt ?? justNow(),
        },
      });
    }

    it('keeps the not-set-up skeleton when tracking was never configured', async () => {
      const reviews = (await server.get('/reports/reviews', auth)).json();
      // A workspace that never opened the screen has no settings row at all, and
      // reads as an honest "not set up" shape rather than a fabricated zero —
      // byte for byte what every pre-13.5 consumer was written against.
      expect(reviews.ecommerce).toEqual({
        configured: false,
        tracked_sales: null,
        attributed_revenue_cents: null,
        currency: null,
      });
    });

    it('keeps the not-set-up skeleton while tracking is switched off', async () => {
      const chat = await conversation({ agentReplies: true });
      await configureTracking({ licenseId: fx.a.licenseId, enabled: false });
      // Orders from an earlier, enabled spell are still on the table.
      await sale({ licenseId: fx.a.licenseId, chatId: chat, amountCents: 9_900 });

      const reviews = (await server.get('/reports/reviews', auth)).json();
      // Switching tracking off is one switch: the intake stops and the report
      // goes back to "not set up", rather than leaving a screen quoting figures
      // nothing is feeding any more.
      expect(reviews.ecommerce).toEqual({
        configured: false,
        tracked_sales: null,
        attributed_revenue_cents: null,
        currency: null,
      });
    });

    it('reports the attributed orders and their revenue once tracking is on', async () => {
      const chat = await conversation({ agentReplies: true });
      await configureTracking({ licenseId: fx.a.licenseId, enabled: true, currency: 'EUR' });
      await sale({ licenseId: fx.a.licenseId, chatId: chat, amountCents: 12_500, currency: 'EUR' });
      await sale({ licenseId: fx.a.licenseId, chatId: chat, amountCents: 7_499, currency: 'EUR' });

      const reviews = (await server.get('/reports/reviews', auth)).json();
      expect(reviews.ecommerce.configured).toBe(true);
      expect(reviews.ecommerce.tracked_sales).toBe(2);
      expect(reviews.ecommerce.attributed_revenue_cents).toBe(19_999);
      // The code comes from the configuration, not from the orders: the cents
      // are only summable under one currency.
      expect(reviews.ecommerce.currency).toBe('EUR');
    });

    it('reports a configured window with no sale as zero, not unknown', async () => {
      await configureTracking({ licenseId: fx.a.licenseId, enabled: true });

      const reviews = (await server.get('/reports/reviews', auth)).json();
      // Unlike CSAT — where nobody rating leaves the score genuinely unknown —
      // "tracking is on and no order landed" is a known answer, and it is zero.
      // Null here would send the screen back to "not set up" for a workspace
      // that plainly did set it up.
      expect(reviews.ecommerce.configured).toBe(true);
      expect(reviews.ecommerce.tracked_sales).toBe(0);
      expect(reviews.ecommerce.attributed_revenue_cents).toBe(0);
      expect(reviews.ecommerce.currency).toBe('USD');
    });

    it('leaves unattributed orders out of the revenue it claims', async () => {
      const chat = await conversation({ agentReplies: true });
      await configureTracking({ licenseId: fx.a.licenseId, enabled: true });
      await sale({ licenseId: fx.a.licenseId, chatId: chat, amountCents: 5_000 });
      // No chat inside the attribution window, so 13.5-c wrote the row with
      // `attributed: false`: real revenue, but not revenue live chat may take
      // credit for. Summing it would turn this block into total turnover.
      await sale({ licenseId: fx.a.licenseId, amountCents: 90_000, attributed: false });

      const reviews = (await server.get('/reports/reviews', auth)).json();
      expect(reviews.ecommerce.tracked_sales).toBe(1);
      expect(reviews.ecommerce.attributed_revenue_cents).toBe(5_000);
    });

    it('counts only the orders inside the requested window', async () => {
      const chat = await conversation({ agentReplies: true });
      await configureTracking({ licenseId: fx.a.licenseId, enabled: true });
      await sale({ licenseId: fx.a.licenseId, chatId: chat, amountCents: 2_500 });
      // 45 days back falls outside the default 30-day window.
      await sale({
        licenseId: fx.a.licenseId,
        chatId: chat,
        amountCents: 80_000,
        createdAt: new Date(Date.now() - 45 * 86_400_000),
      });

      const reviews = (await server.get('/reports/reviews', auth)).json();
      expect(reviews.ecommerce.tracked_sales).toBe(1);
      expect(reviews.ecommerce.attributed_revenue_cents).toBe(2_500);
    });

    it('never counts sales from another tenant', async () => {
      const chat = await conversation({ agentReplies: true });
      await configureTracking({ licenseId: fx.a.licenseId, enabled: true });
      await configureTracking({ licenseId: fx.b.licenseId, enabled: true, currency: 'GBP' });
      await sale({ licenseId: fx.a.licenseId, chatId: chat, amountCents: 1_000 });
      await sale({ licenseId: fx.b.licenseId, amountCents: 4_000, currency: 'GBP' });

      const mine = (await server.get('/reports/reviews', auth)).json();
      expect(mine.ecommerce.tracked_sales).toBe(1);
      expect(mine.ecommerce.attributed_revenue_cents).toBe(1_000);
      expect(mine.ecommerce.currency).toBe('USD');

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/reports/reviews', { authorization: `Bearer ${theirToken}` })
      ).json();
      // Both the configuration and the figures are read under RLS, so neither
      // the currency nor the revenue crosses the tenant boundary.
      expect(theirs.ecommerce.tracked_sales).toBe(1);
      expect(theirs.ecommerce.attributed_revenue_cents).toBe(4_000);
      expect(theirs.ecommerce.currency).toBe('GBP');
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
    /**
     * Create a ticket directly, with full control over the fields the report
     * buckets on. `created_at` defaults to {@link justNow}: every Cases figure
     * windows on it, so the column default would leave the row at the mercy of
     * the database/host clock skew.
     */
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
          createdAt: options.createdAt ?? justNow(),
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
     *
     * The touch row's `created_at` *is* the first touch the report windows and
     * buckets on, so it defaults to {@link justNow} rather than to the column
     * default.
     */
    async function createLead(
      options: { touch?: 'chat' | 'ticket' | 'none'; isLead?: boolean; createdAt?: Date } = {},
    ): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Lead', isLead: options.isLead ?? true },
        select: { id: true },
      });
      const at = options.createdAt ?? justNow();
      const touch = options.touch ?? 'chat';
      if (touch === 'chat') {
        await owner.chat.create({
          data: {
            id: generateShortId(),
            licenseId: fx.a.licenseId,
            customerId: customer.id,
            createdAt: at,
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
            createdAt: at,
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
        data: {
          id: generateShortId(),
          licenseId: fx.a.licenseId,
          customerId: early,
          createdAt: dayB,
        },
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

  describe('Team performance report (07.7-c)', () => {
    it('returns the chat split, response time and CSAT for the assigned agent', async () => {
      const chatId = await conversation({ agentReplies: true });
      const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
      await owner.rating.create({
        data: {
          chatId,
          licenseId: fx.a.licenseId,
          threadId: thread.id,
          value: 'good',
          createdAt: justNow(),
        },
      });

      const report = (await server.get('/reports/team-performance', auth)).json();
      expect(report.agents).toHaveLength(1);
      const agent = report.agents[0];
      expect(agent.agent_id).toBe(fx.a.ownerAccountId);
      expect(agent.chats).toBe(1);
      expect(agent.closed).toBe(1);
      expect(agent.automated).toBe(0);
      expect(agent.manual).toBe(1);
      expect(agent.assisted).toBe(0);
      expect(agent.avg_first_response_seconds).not.toBeNull();
      expect(agent.csat).toEqual({ good: 1, bad: 0, responses: 1, score: 1 });
      expect(agent.transfers).toBe(0);
    });

    it('reports CSAT as null — not zero — for an agent nobody rated', async () => {
      await conversation({ agentReplies: true });
      const report = (await server.get('/reports/team-performance', auth)).json();
      expect(report.agents[0].csat).toEqual({ good: 0, bad: 0, responses: 0, score: null });
    });

    it('counts an AI→human transfer against the agent currently holding the thread', async () => {
      const chatId = await conversation({ agentReplies: true });
      await recordTransfer(chatId);
      const report = (await server.get('/reports/team-performance', auth)).json();
      expect(report.agents[0].transfers).toBe(1);
    });

    it('never writes an unassigned chat to any agent row', async () => {
      const chatId = await conversation({ agentReplies: false });
      await owner.thread.updateMany({ where: { chatId }, data: { assigneeId: null } });

      const report = (await server.get('/reports/team-performance', auth)).json();
      expect(report.agents).toEqual([]);
    });

    it('reports an empty window as an empty list, not an error', async () => {
      const report = (await server.get('/reports/team-performance', auth)).json();
      expect(report.agents).toEqual([]);
    });

    it('never counts another tenant’s agent', async () => {
      await conversation({ agentReplies: false });

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/reports/team-performance', { authorization: `Bearer ${theirToken}` })
      ).json();
      expect(theirs.agents).toEqual([]);
    });

    it('rejects a backwards date range', async () => {
      const response = await server.get(
        '/reports/team-performance?from=2026-08-01&to=2026-07-01',
        auth,
      );
      expect(response.statusCode).toBe(400);
    });

    it('requires the reports_read scope', async () => {
      const scopeless = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      const response = await server.get('/reports/team-performance', {
        authorization: `Bearer ${scopeless}`,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('Sales report (07.7-d)', () => {
    it('returns the honest not-configured skeleton — every figure null, not zero', async () => {
      const report = (await server.get('/reports/sales', auth)).json();
      expect(report.configured).toBe(false);
      expect(report.tracked_sales).toBeNull();
      expect(report.attributed_revenue_cents).toBeNull();
      expect(report.currency).toBeNull();
      expect(report.conversions).toBeNull();
    });

    it('stays configured:false for another tenant too — nothing to leak', async () => {
      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/reports/sales', { authorization: `Bearer ${theirToken}` })
      ).json();
      expect(theirs.configured).toBe(false);
      expect(theirs.tracked_sales).toBeNull();
    });

    it('rejects a backwards date range', async () => {
      const response = await server.get('/reports/sales?from=2026-08-01&to=2026-07-01', auth);
      expect(response.statusCode).toBe(400);
    });

    it('requires the reports_read scope', async () => {
      const scopeless = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      const response = await server.get('/reports/sales', {
        authorization: `Bearer ${scopeless}`,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // =========================================================================

  /**
   * The Goals funnel (FR-MOD-13.3, 13.3-f).
   *
   * The property under test is that the three stages are a *funnel*: each one
   * counts a subset of the stage before it, so `visitors >= chats >=
   * conversions` holds by construction rather than by luck of the fixture.
   * Three unrelated totals sitting next to each other would pass a happy-path
   * assertion and then report a 300% conversion rate the first time a chat
   * arrived by email or a visitor tripped two goals.
   */
  describe('Goals report (13.3-f)', () => {
    /** Define a conversion target in a license. */
    async function defineGoal(name: string, licenseId = fx.a.licenseId): Promise<string> {
      const goal = await owner.goal.create({
        data: { licenseId, name },
        select: { id: true },
      });
      return goal.id;
    }

    /**
     * A visitor at whichever funnel stage the options ask for — seen (always: a
     * visit), chatted (a chat and its thread), converted (an achievement).
     * Written directly, like the other report fixtures here, so a stage can be
     * reached without driving the widget's whole page-view flow (13.3-d proves
     * that end to end).
     */
    async function visitor(
      options: {
        chatted?: boolean;
        goalId?: string;
        licenseId?: bigint;
        when?: Date;
        name?: string;
      } = {},
    ): Promise<string> {
      const when = options.when ?? new Date();
      const licenseId = options.licenseId ?? fx.a.licenseId;
      const organizationId =
        licenseId === fx.a.licenseId ? fx.a.organizationId : fx.b.organizationId;

      const customer = await owner.customer.create({
        data: { organizationId, name: options.name ?? 'Funnel visitor' },
        select: { id: true },
      });
      await owner.visit.create({
        data: { licenseId, customerId: customer.id, startedAt: when },
      });

      if (options.chatted) {
        const chatId = generateShortId();
        await owner.chat.create({
          data: { id: chatId, licenseId, customerId: customer.id, createdAt: when },
        });
        await owner.thread.create({
          data: {
            id: generateShortId(),
            chatId,
            licenseId,
            active: false,
            createdAt: when,
            closedAt: when,
          },
        });
      }

      if (options.goalId) {
        await owner.goalAchievement.create({
          data: { licenseId, goalId: options.goalId, customerId: customer.id, achievedAt: when },
        });
      }
      return customer.id;
    }

    it('reports three nested stages — visitors ⊇ chats ⊇ conversions', async () => {
      const goalId = await defineGoal('Signed up');
      await visitor({ name: 'Only browsed' });
      await visitor({ chatted: true, name: 'Talked to us' });
      await visitor({ chatted: true, goalId, name: 'Converted' });

      const report = (await server.get('/reports/goals', auth)).json();

      expect(report.funnel).toEqual({
        visitors: 3,
        chats: 2,
        conversions: 1,
        conversion_rate: 0.5,
      });
      // The invariant, stated as such: this is what makes the answer a funnel.
      expect(report.funnel.visitors).toBeGreaterThanOrEqual(report.funnel.chats);
      expect(report.funnel.chats).toBeGreaterThanOrEqual(report.funnel.conversions);
    });

    it('keeps a chat with no visit behind it from overtaking the visitor stage', async () => {
      // A chat that arrived by email or a channel adapter has no `visits` row.
      // If `chats` were counted independently it would exceed `visitors` here —
      // a funnel that widens as it descends.
      await visitor({ name: 'Browsed only' });
      await conversation({ agentReplies: true, customerName: 'Wrote in by email' });

      const funnel = (await server.get('/reports/goals', auth)).json().funnel;
      expect(funnel.visitors).toBe(1);
      expect(funnel.chats).toBe(0);
      expect(funnel.conversion_rate).toBeNull();
    });

    it('counts a visitor once however many goals they reach', async () => {
      const first = await defineGoal('Signed up');
      const second = await defineGoal('Booked a demo');
      const customerId = await visitor({ chatted: true, goalId: first, name: 'Reached two' });
      await owner.goalAchievement.create({
        data: { licenseId: fx.a.licenseId, goalId: second, customerId, achievedAt: justNow() },
      });

      const report = (await server.get('/reports/goals', auth)).json();
      // The funnel counts people through it; `by_goal` counts hits. Both are
      // right, and the response says so rather than quietly picking one.
      expect(report.funnel.conversions).toBe(1);
      expect(
        report.by_goal.reduce(
          (sum: number, row: { conversions: number }) => sum + row.conversions,
          0,
        ),
      ).toBe(2);
    });

    it('lists every goal of this license — including one nobody reached', async () => {
      const reached = await defineGoal('Signed up');
      await defineGoal('Never reached');
      await visitor({ chatted: true, goalId: reached });

      const byGoal = (await server.get('/reports/goals', auth)).json().by_goal;
      expect(byGoal).toEqual([
        { goal_id: reached, name: 'Signed up', conversions: 1 },
        { goal_id: expect.any(String), name: 'Never reached', conversions: 0 },
      ]);
    });

    it("never shows another license's goal, achievement or visitor", async () => {
      const mine = await defineGoal('Signed up');
      await visitor({ chatted: true, goalId: mine, name: 'Mine' });

      const theirs = await defineGoal('Their goal', fx.b.licenseId);
      await visitor({
        chatted: true,
        goalId: theirs,
        licenseId: fx.b.licenseId,
        name: 'Theirs',
      });

      const report = (await server.get('/reports/goals', auth)).json();
      expect(report.by_goal).toEqual([{ goal_id: mine, name: 'Signed up', conversions: 1 }]);
      // B's visitor, chat and conversion are all absent from A's funnel — the
      // stages are license-scoped at every level, not only the goal list.
      expect(report.funnel).toMatchObject({ visitors: 1, chats: 1, conversions: 1 });

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirReport = (
        await server.get('/reports/goals', { authorization: `Bearer ${theirToken}` })
      ).json();
      expect(theirReport.by_goal).toEqual([
        { goal_id: theirs, name: 'Their goal', conversions: 1 },
      ]);
    });

    it('agrees with the Overview on how many goals were reached', async () => {
      // `by_goal` is unconditioned by the funnel, so it sums to the number the
      // Overview KPI shows (13.3-e) — the two surfaces cannot drift.
      const goalId = await defineGoal('Signed up');
      await visitor({ chatted: true, goalId, name: 'Chatted then converted' });
      await visitor({ goalId, name: 'Converted without chatting' });

      const [goals, overview] = await Promise.all([
        server.get('/reports/goals', auth),
        server.get('/reports/overview', auth),
      ]);
      const total = goals
        .json()
        .by_goal.reduce((sum: number, row: { conversions: number }) => sum + row.conversions, 0);

      expect(total).toBe(2);
      expect(overview.json().totals.achieved_goals).toBe(total);
      // And the funnel still counts only the one who came through it.
      expect(goals.json().funnel.conversions).toBe(1);
    });

    it('drops a conversion before the window into the previous period, not the current one', async () => {
      const goalId = await defineGoal('Signed up');
      await visitor({ chatted: true, goalId, name: 'Now' });
      const earlier = new Date(Date.now() - 15 * 86_400_000);
      await visitor({ chatted: true, goalId, when: earlier, name: 'Earlier' });

      const to = new Date();
      const from = new Date(to.getTime() - 10 * 86_400_000);
      const report = (
        await server.get(
          `/reports/goals?from=${from.toISOString()}&to=${to.toISOString()}&baseline=previous_period`,
          auth,
        )
      ).json();

      expect(report.funnel).toMatchObject({ visitors: 1, chats: 1, conversions: 1 });
      expect(report.previous_period).toMatchObject({
        baseline: 'previous_period',
        visitors: 1,
        chats: 1,
        conversions: 1,
        conversion_rate: 1,
      });
    });

    it('exports the same funnel as CSV, with the goal name injection-guarded', async () => {
      // A goal name is user-written free text and lands in a spreadsheet cell.
      const goalId = await defineGoal('=1+1,Signed up');
      await visitor({ chatted: true, goalId });

      const [report, csv] = await Promise.all([
        server.get('/reports/goals', auth),
        server.get('/reports/export?group=goals', auth),
      ]);
      expect(csv.statusCode).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');

      const rows = csv.body.split('\r\n').filter((line: string) => line !== '');
      expect(rows[0]).toBe('section,key,name,value');
      // Every figure is the one the JSON report quotes — ADR-09's rule for this
      // surface: a download never disagrees with the screen it came from.
      const funnel = report.json().funnel;
      expect(rows).toContain(`funnel,visitors,Visitors,${funnel.visitors}`);
      expect(rows).toContain(`funnel,chats,Chats,${funnel.chats}`);
      expect(rows).toContain(`funnel,conversions,Conversions,${funnel.conversions}`);
      // The formula lead is neutralised with a leading quote, and the cell is
      // then quoted because it also carries a comma.
      expect(rows).toContain(`goal,${goalId},"'=1+1,Signed up",1`);
    });

    it('rejects a backwards date range', async () => {
      const response = await server.get('/reports/goals?from=2026-08-01&to=2026-07-01', auth);
      expect(response.statusCode).toBe(400);
    });

    it('requires the reports_read scope', async () => {
      const scopeless = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['customers:rw'],
      });
      // Defining goals is `customers:rw`; *reading the funnel* is not — a token
      // that can create a goal still cannot read the workspace's conversions.
      const response = await server.get('/reports/goals', {
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
          'team-performance',
          'sales',
          'goals',
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
          {
            dimension: 'team',
            key: 'Support',
            chats: 1,
            closed: 1,
            manual: 0,
            assisted: 0,
            automated: 1,
          },
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
        await owner.rating.create({
          data: { chatId, licenseId: fx.a.licenseId, value: 'good', createdAt: justNow() },
        });

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
            createdAt: justNow(),
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
          data: {
            id: generateShortId(),
            licenseId: fx.a.licenseId,
            customerId: lead.id,
            createdAt: justNow(),
          },
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

      it('exports team performance one row per agent, matching the JSON report', async () => {
        const chatId = await conversation({ agentReplies: true });
        const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
        await owner.rating.create({
          data: {
            chatId,
            licenseId: fx.a.licenseId,
            threadId: thread.id,
            value: 'good',
            createdAt: justNow(),
          },
        });

        const [report, response] = await Promise.all([
          server.get('/reports/team-performance', auth),
          server.get('/reports/export?group=team-performance', auth),
        ]);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
        expect(response.headers['content-disposition']).toMatch(
          /^attachment; filename="nexa-team-performance-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/,
        );

        const rows = lines(response.body);
        expect(rows[0]).toBe(
          'agent_id,name,chats,closed,manual,assisted,automated,avg_first_response_seconds,avg_duration_seconds,csat_good,csat_bad,csat_responses,csat_score,transfers',
        );
        // Same figures the JSON report exposes — the export reuses
        // teamPerformanceByAgent rather than recomputing, so a download can
        // never disagree with the tab.
        const agent = report.json().agents[0];
        expect(rows[1]).toBe(
          [
            agent.agent_id,
            agent.name,
            agent.chats,
            agent.closed,
            agent.manual,
            agent.assisted,
            agent.automated,
            agent.avg_first_response_seconds,
            agent.avg_duration_seconds,
            agent.csat.good,
            agent.csat.bad,
            agent.csat.responses,
            agent.csat.score,
            agent.transfers,
          ].join(','),
        );
      });

      it('neutralises formula injection in an agent name, same as any other field', async () => {
        // Starts with a formula-lead char (`=`) *and* carries a comma, so both
        // guards in `csvField` fire on the same field: the leading `'` defuses
        // the formula, then the comma forces RFC 4180 quoting — same as the
        // breakdown team-name case above.
        const dangerous = await owner.account.create({
          data: { email: `agent-${generateShortId()}@example.test`, name: '=Acme,Inc' },
          select: { id: true },
        });
        // `accounts` is a global table whose visibility comes from shared
        // membership, not a column (policy `accounts_tenant`). Without this row
        // the report's `LEFT JOIN accounts` resolves no name under RLS and the
        // cell would be empty — the fixture has to be a real agent of the
        // licence, which is the only way a thread gets assigned in production.
        await owner.agentMembership.create({
          data: { licenseId: fx.a.licenseId, agentId: dangerous.id, role: 'agent' },
        });
        const chatId = await conversation({ agentReplies: false });
        await owner.thread.updateMany({ where: { chatId }, data: { assigneeId: dangerous.id } });

        const response = await server.get('/reports/export?group=team-performance', auth);
        const rows = lines(response.body);
        const agentRow = rows.find((line) => line.startsWith(dangerous.id));

        expect(agentRow).toMatch(/^[0-9a-f-]+,"'=Acme,Inc",1,1,0,0,1,/);
      });

      it('exports sales as the same not-configured skeleton — metric/value pairs, null cells empty', async () => {
        const response = await server.get('/reports/export?group=sales', auth);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
        expect(response.headers['content-disposition']).toMatch(
          /^attachment; filename="nexa-sales-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/,
        );

        const rows = lines(response.body);
        expect(rows[0]).toBe('metric,value');
        expect(rows.slice(1)).toEqual([
          'configured,false',
          'tracked_sales,',
          'attributed_revenue_cents,',
          'currency,',
          'conversions,',
        ]);
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

    /**
     * PDF export (FR-MOD-07.7, 07.7-g). Adds `?format=pdf` to the same,
     * already-authorised export endpoint — `format` picks a serialiser for
     * the table CSV already renders, it grants nothing on its own. Negative
     * cases first: the boundary is the point.
     */
    describe('PDF export', () => {
      /** Every report group the export endpoint serves, in `/reports/groups` order. */
      const GROUPS = [
        'overview',
        'breakdown',
        'ai-agent',
        'reviews',
        'topics',
        'cases',
        'leads',
        'team-performance',
        'sales',
        'goals',
      ] as const;

      it.each(['exe', 'html', 'pdfx'])(
        'rejects `format=%s` with 400 — only csv/pdf are real formats',
        async (format) => {
          const response = await server.get(
            `/reports/export?group=overview&format=${format}`,
            auth,
          );
          expect(response.statusCode).toBe(400);
        },
      );

      it('refuses a token without an export scope for a PDF request too — format grants nothing', async () => {
        const weak = await scopedToken(['chats--all:ro']);
        const response = await server.get('/reports/export?group=overview&format=pdf', {
          authorization: `Bearer ${weak}`,
        });
        expect(response.statusCode).toBe(403);
      });

      it.each(GROUPS)('renders the %s group as a well-formed PDF', async (group) => {
        const response = await server.get(`/reports/export?group=${group}&format=pdf`, auth);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.headers['content-disposition']).toMatch(
          new RegExp(
            `^attachment; filename="nexa-${group}-\\d{4}-\\d{2}-\\d{2}-\\d{4}-\\d{2}-\\d{2}\\.pdf"$`,
          ),
        );
        // Same caching/sniffing contract as CSV — the format changes the body,
        // not the headers a report download always carries.
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['cache-control']).toBe('no-store');

        const bytes = Buffer.from(response.rawPayload);
        expect(bytes.toString('latin1').startsWith('%PDF-1.7\n')).toBe(true);
      });

      it('leaks no row from another license into a PDF either — same isolation as CSV', async () => {
        const theirToken = await grantToken(owner, {
          licenseId: fx.b.licenseId,
          organizationId: fx.b.organizationId,
          ownerId: fx.b.ownerAccountId,
          scopes: ['reports_read'],
        });
        const authB = { authorization: `Bearer ${theirToken}` };
        // Fixed window: a wall-clock default (`to=now`) could tick over a UTC
        // day between the two requests below and make the subtitle differ for
        // a reason that has nothing to do with tenant isolation.
        const window = 'from=2026-01-01&to=2026-12-31';

        const before = await server.get(
          `/reports/export?group=breakdown&format=pdf&${window}`,
          authB,
        );
        expect(before.statusCode).toBe(200);

        await conversation({ agentReplies: false }); // one automated chat, closed today, in A

        const after = await server.get(
          `/reports/export?group=breakdown&format=pdf&${window}`,
          authB,
        );
        expect(after.statusCode).toBe(200);

        // B's export is a pure function of B's own data (RLS-scoped). A gaining
        // a chat must not change a single byte of what B downloads — the same
        // guarantee the CSV cross-tenant test above proves by row count, here
        // proved by exact byte equality instead of parsing PDF text operators.
        expect(Buffer.from(after.rawPayload).equals(Buffer.from(before.rawPayload))).toBe(true);
      });

      it('is byte-for-byte the same CSV whether `format` is omitted or `csv` — the v1 default never changed', async () => {
        await conversation({ agentReplies: false });

        const [omitted, explicit] = await Promise.all([
          server.get('/reports/export?group=overview', auth),
          server.get('/reports/export?group=overview&format=csv', auth),
        ]);
        expect(omitted.statusCode).toBe(200);
        expect(omitted.headers['content-type']).toContain('text/csv');
        expect(omitted.body).toBe(explicit.body);
        expect(omitted.headers['content-disposition']).toBe(
          explicit.headers['content-disposition'],
        );
        expect(omitted.headers['x-content-type-options']).toBe('nosniff');
        expect(omitted.headers['cache-control']).toBe('no-store');
      });
    });
  });

  // =========================================================================

  /**
   * The 07.7 surface swept end to end (07.7-l).
   *
   * Every earlier sub-task proved its own group. What none of them could prove
   * is the property that only exists *across* them: that each group is gated on
   * all four of its surfaces — the catalogue, its JSON endpoint, its CSV export
   * and its PDF export — and that the "empty list, not a 403" decision (NFR-S3,
   * `GET /reports/groups`) still holds now that four more groups sit behind it.
   * A group whose route lost its `config.scopes` would keep every one of its own
   * tests green: nothing there asks an unauthorised caller anything.
   *
   * Driven from `REPORT_GROUPS` rather than a written-out list, so the matrix
   * cannot fall behind the catalogue. A tenth group added with a missing scope
   * check fails here on the day it is added, which is the only way a permission
   * sweep stays true after the sweep is written.
   */
  describe('permission matrix — every group × every surface (07.7-l)', () => {
    const GROUP_IDS = REPORT_GROUPS.map((group) => group.id);

    /** The JSON endpoint a group answers on — the catalogue id *is* the path segment. */
    const pathOf = (id: string): string => `/reports/${id}`;

    /** Grant a token with a chosen scope set — for the permission-gating cases. */
    function scopedToken(scopes: string[]): Promise<string> {
      return grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes,
      });
    }

    it('serves exactly the compiled catalogue — the matrix cannot sweep a stale list', async () => {
      const groups = (await server.get('/reports/groups', auth)).json().groups;
      expect(groups.map((group: { id: string }) => group.id)).toEqual(GROUP_IDS);
      // Guards the guard: a matrix over an empty catalogue would pass vacuously.
      expect(GROUP_IDS.length).toBe(10);
    });

    it.each(GROUP_IDS)(
      '%s answers on every granted surface — JSON, CSV, PDF and a benchmark block',
      async (id) => {
        const [json, csv, pdf, benchmarked] = await Promise.all([
          server.get(pathOf(id), auth),
          server.get(`/reports/export?group=${id}`, auth),
          server.get(`/reports/export?group=${id}&format=pdf`, auth),
          server.get(`${pathOf(id)}?baseline=previous_period`, auth),
        ]);

        expect(json.statusCode, pathOf(id)).toBe(200);

        expect(csv.statusCode, `csv ${id}`).toBe(200);
        expect(csv.headers['content-type']).toContain('text/csv');
        expect(csv.headers['content-disposition']).toContain(`filename="nexa-${id}-`);

        expect(pdf.statusCode, `pdf ${id}`).toBe(200);
        expect(pdf.headers['content-type']).toBe('application/pdf');
        expect(Buffer.from(pdf.rawPayload).toString('latin1').startsWith('%PDF-1.7\n')).toBe(true);

        // "benchmark karşılaştırma" holds for every group, not only the ones
        // that happen to carry a comparable figure of their own.
        expect(benchmarked.json().previous_period?.baseline, `benchmark ${id}`).toBe(
          'previous_period',
        );
      },
    );

    it('refuses every group on every surface to a token without reports_read, and still answers the catalogue', async () => {
      const weak = await scopedToken(['chats--all:ro']);
      const weakAuth = { authorization: `Bearer ${weak}` };

      // The catalogue answers 200 with nothing — the decision the code committed
      // to at `GET /reports/groups`: "here is what you can see" replies honestly
      // rather than refusing to reply. Re-proved now that nine groups sit behind
      // it, because the failure mode is one group leaking into the empty answer.
      const catalogue = await server.get('/reports/groups', weakAuth);
      expect(catalogue.statusCode).toBe(200);
      expect(catalogue.json().groups).toEqual([]);

      for (const id of GROUP_IDS) {
        const [json, csv, pdf] = await Promise.all([
          server.get(pathOf(id), weakAuth),
          server.get(`/reports/export?group=${id}`, weakAuth),
          server.get(`/reports/export?group=${id}&format=pdf`, weakAuth),
        ]);
        expect(json.statusCode, `json ${id}`).toBe(403);
        expect(csv.statusCode, `csv ${id}`).toBe(403);
        // `format` grants nothing: a caller refused the CSV is refused the PDF
        // of the same table too.
        expect(pdf.statusCode, `pdf ${id}`).toBe(403);
      }
    });

    it('hands a token no group data through a neighbouring scope either', async () => {
      // `reports_read` does not follow the `--all/--my` implication pattern, so
      // no chats/agents grant can widen into it. Asserted against the live
      // routes rather than only `visibleReportGroups`, because the implication
      // that matters is the one the auth plugin applies.
      const sideways = await scopedToken(['chats--all:rw', 'agents--all:rw', 'billing_manage']);
      const sidewaysAuth = { authorization: `Bearer ${sideways}` };

      expect((await server.get('/reports/groups', sidewaysAuth)).json().groups).toEqual([]);
      for (const id of GROUP_IDS) {
        expect((await server.get(pathOf(id), sidewaysAuth)).statusCode, `json ${id}`).toBe(403);
        expect(
          (await server.get(`/reports/export?group=${id}`, sidewaysAuth)).statusCode,
          `csv ${id}`,
        ).toBe(403);
      }
    });
  });

  // =========================================================================

  /**
   * NFR-P7 — how much history one report request may ask for (07.7-l).
   *
   * NFR-P7's own answer to "heavy reports" is a read replica or a column-store
   * analytics store (PRD:748). Neither exists here and neither can: they are
   * infrastructure, outside this repo (PLAN §9). What is available is to bound
   * the work a single request can order, so the measurement below is half the
   * evidence and the cap is the other half.
   */
  describe('NFR-P7 — the window a report may scan (07.7-l)', () => {
    const GROUP_IDS = REPORT_GROUPS.map((group) => group.id);
    const pathOf = (id: string): string => `/reports/${id}`;
    const DAY = 86_400_000;
    /** A fixed end, so the boundary arithmetic below does not race the clock. */
    const END = new Date('2026-07-01T00:00:00.000Z');
    const window = (days: number): string => {
      const from = new Date(END.getTime() - days * DAY);
      return `from=${from.toISOString()}&to=${END.toISOString()}`;
    };

    it('refuses a window past the cap on every group, in JSON and in both export formats', async () => {
      const range = window(REPORT_MAX_RANGE_DAYS + 1);

      for (const id of GROUP_IDS) {
        for (const url of [
          `${pathOf(id)}?${range}`,
          `/reports/export?group=${id}&${range}`,
          `/reports/export?group=${id}&format=pdf&${range}`,
        ]) {
          const response = await server.get(url, auth);
          expect(response.statusCode, url).toBe(400);
          // Proof the *range* guard fired and not some unrelated 400: the caller
          // is told the span is the problem and how wide it may be.
          expect(JSON.stringify(response.json()), url).toContain(String(REPORT_MAX_RANGE_DAYS));
        }
      }
    });

    it('still serves a window exactly at the cap — the boundary is inclusive, not off by a day', async () => {
      const range = window(REPORT_MAX_RANGE_DAYS);
      for (const id of GROUP_IDS) {
        expect((await server.get(`${pathOf(id)}?${range}`, auth)).statusCode, `json ${id}`).toBe(
          200,
        );
        expect(
          (await server.get(`/reports/export?group=${id}&${range}`, auth)).statusCode,
          `csv ${id}`,
        ).toBe(200);
      }
    });

    it("keeps the UI's widest preset working — the 365-day range the Reports page ships", async () => {
      // `PRESETS` in ReportsPage.tsx offers 7/30/90/365 days. A cap set at 365
      // would refuse the product's own widest button, which is why it is 366.
      const range = window(365);
      expect((await server.get(`/reports/overview?${range}`, auth)).statusCode).toBe(200);
      expect((await server.get(`/reports/export?group=leads&${range}`, auth)).statusCode).toBe(200);
    });

    it('keeps the staffing forecast on its own bound, which the shared cap did not replace', async () => {
      // The forecast parses the range itself (it takes no `baseline`), so it
      // never reaches `assertReportRange`. Its own guard has to still be there.
      const response = await server.get(
        `/reports/staffing-forecast?${window(REPORT_MAX_RANGE_DAYS + 1)}`,
        auth,
      );
      expect(response.statusCode).toBe(400);
      expect(JSON.stringify(response.json())).toContain('staffing forecast');
    });

    it('keeps the Leads and Team performance queries within the NFR-P2 read budget (EXPLAIN ANALYZE)', async () => {
      // Real rows, so the planner has joins to cost rather than empty tables:
      // agents with assigned closed threads, a rating and a transfer each, plus
      // leads reached through both touch tables.
      const assisted = await conversation({ agentReplies: true, customerName: 'Perf assisted' });
      await runSkillOn(assisted);
      const rated = await conversation({ agentReplies: true, customerName: 'Perf rated' });
      const ratedThread = await owner.thread.findFirstOrThrow({ where: { chatId: rated } });
      await owner.rating.create({
        data: {
          chatId: rated,
          licenseId: fx.a.licenseId,
          threadId: ratedThread.id,
          value: 'good',
          createdAt: justNow(),
        },
      });
      await recordTransfer(rated);
      await conversation({ agentReplies: false, customerName: 'Perf automated' });

      const chatLead = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Perf lead chat', isLead: true },
        select: { id: true },
      });
      await owner.chat.create({
        data: {
          id: generateShortId(),
          licenseId: fx.a.licenseId,
          customerId: chatLead.id,
          createdAt: justNow(),
        },
      });
      const ticketLead = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Perf lead ticket', isLead: true },
        select: { id: true },
      });
      await owner.ticket.create({
        data: {
          id: generateShortId(),
          licenseId: fx.a.licenseId,
          customerId: ticketLead.id,
          subject: 'Perf lead ticket',
          status: 'open',
          createdAt: justNow(),
        },
      });

      // Reproduced from reports.ts (`leadFirstTouch`/`leadsByDay`,
      // `teamPerformanceByAgent`) so the plan measures the real query shape —
      // the leads CTE's UNION ALL and the split's correlated EXISTS filters are
      // what dominate the cost, and a probe over a bare count(*) would
      // understate both. Kept in sync deliberately, exactly as the 07.5-i probe
      // above is: this is a performance measurement, and the functional
      // behaviour is guarded by the report suites.
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
      const SINCE = `now() - interval '30 days'`;
      const LEAD_FIRST_TOUCH = `
        WITH lead_first_touch AS (
          SELECT c.id AS customer_id, min(touch.touched_at) AS first_touch
          FROM customers c
          JOIN (
            SELECT customer_id, created_at AS touched_at FROM chats WHERE license_id = $1
            UNION ALL
            SELECT customer_id, created_at AS touched_at FROM tickets
              WHERE license_id = $1 AND customer_id IS NOT NULL
          ) touch ON touch.customer_id = c.id
          WHERE c.is_lead = TRUE
          GROUP BY c.id
        )`;

      const queries: Record<string, string> = {
        leads_by_day: `${LEAD_FIRST_TOUCH}
          SELECT to_char((first_touch AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date, count(*) AS count
          FROM lead_first_touch
          WHERE first_touch >= ${SINCE} AND first_touch <= now()
          GROUP BY 1 ORDER BY 1`,
        leads_total: `${LEAD_FIRST_TOUCH}
          SELECT count(*) AS leads FROM lead_first_touch
          WHERE first_touch >= ${SINCE} AND first_touch <= now()`,
        team_split: `SELECT t.assignee_id::text AS agent_id, a.name, ${SPLIT},
            avg(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)))
              FILTER (WHERE t.first_response_at IS NOT NULL) AS avg_first_response_seconds,
            avg(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)))
              FILTER (WHERE t.closed_at IS NOT NULL) AS avg_duration_seconds
          FROM threads t
          LEFT JOIN accounts a ON a.id = t.assignee_id
          WHERE t.license_id = $1 AND t.assignee_id IS NOT NULL
            AND t.created_at >= ${SINCE} AND t.created_at <= now()
          GROUP BY t.assignee_id, a.name ORDER BY chats DESC LIMIT 20`,
        team_ratings: `SELECT t.assignee_id::text AS agent_id,
            count(*) FILTER (WHERE r.value = 'good') AS good,
            count(*) FILTER (WHERE r.value = 'bad')  AS bad
          FROM ratings r JOIN threads t ON t.id = r.thread_id
          WHERE r.license_id = $1 AND t.assignee_id IS NOT NULL
            AND r.created_at >= ${SINCE} AND r.created_at <= now()
          GROUP BY t.assignee_id`,
        team_transfers: `SELECT t.assignee_id::text AS agent_id, count(*) AS transfers
          FROM events e JOIN threads t ON t.id = e.thread_id
          WHERE e.license_id = $1
            AND e.properties @> '{"system_event": "chat_transferred"}'::jsonb
            AND e.created_at >= ${SINCE} AND e.created_at <= now()
            AND t.assignee_id IS NOT NULL
          GROUP BY t.assignee_id`,
      };

      // NFR-P7 names no number of its own — it names an architecture. The
      // applicable budget is therefore NFR-P2's read figure (p99 < 150ms), the
      // same floor the 07.5-i probe uses. On the seeded dataset execution is
      // sub-millisecond; the assertion is a floor a plan regression (a dropped
      // index, a bad join order) would blow through. The concrete numbers are
      // the evidence 07.7-l owes — recorded in HANDOFF.
      const NFR_P2_READ_BUDGET_MS = 150;
      const timings: Record<string, number> = {};
      for (const [name, sql] of Object.entries(queries)) {
        const [row] = await owner.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
          fx.a.licenseId,
        );
        const raw = row?.['QUERY PLAN'];
        const plan = (typeof raw === 'string' ? JSON.parse(raw) : raw) as
          Array<{ 'Execution Time': number }> | undefined;
        const executionMs = plan?.[0]?.['Execution Time'];
        expect(executionMs, name).toBeDefined();
        timings[name] = executionMs ?? Number.NaN;
        expect(timings[name], name).toBeLessThan(NFR_P2_READ_BUDGET_MS);
      }
      // All five measured — a silently-skipped query leaves the budget unproven.
      expect(Object.keys(timings)).toEqual([
        'leads_by_day',
        'leads_total',
        'team_split',
        'team_ratings',
        'team_transfers',
      ]);
    });
  });

  // =========================================================================

  /**
   * Benchmark comparison (FR-MOD-07.7, 07.7-e).
   *
   * The PRD says "benchmark comparison" without saying against what. This suite
   * pins the answer the code committed to: a license is compared with its own
   * past, never with another license. The negative cases come first, because the
   * boundary is the point — `baseline=industry` failing is not a gap, it is the
   * feature.
   */
  describe('benchmark comparison (07.7-e)', () => {
    /** Every report group that answers on its own endpoint. */
    const GROUP_PATHS = [
      '/reports/overview',
      '/reports/breakdown',
      '/reports/ai-agent',
      '/reports/reviews',
      '/reports/topics',
      '/reports/cases',
      '/reports/leads',
      '/reports/team-performance',
      '/reports/sales',
      '/reports/goals',
    ] as const;

    const CSV_GROUPS = [
      'overview',
      'breakdown',
      'ai-agent',
      'reviews',
      'topics',
      'cases',
      'leads',
      'team-performance',
      'sales',
      'goals',
    ] as const;

    /** Split a CSV body into its non-empty lines (rows are CRLF-terminated). */
    const csvLines = (body: string): string[] => body.split('\r\n').filter((line) => line !== '');

    describe('the license boundary', () => {
      it.each(['industry', 'other_license', 'peer_cohort', 'PREVIOUS_PERIOD', ''])(
        'rejects `baseline=%s` with 400 on every report group',
        async (baseline) => {
          for (const path of GROUP_PATHS) {
            const response = await server.get(`${path}?baseline=${baseline}`, auth);
            expect(response.statusCode, `${path}?baseline=${baseline}`).toBe(400);
          }
        },
      );

      it('rejects a cross-license baseline on the export endpoint too', async () => {
        const response = await server.get('/reports/export?group=overview&baseline=industry', auth);
        expect(response.statusCode).toBe(400);
      });

      it('names `baseline` in the error rather than blaming the date range', async () => {
        // A caller who tried `baseline=industry` must learn which parameter was
        // refused; "Invalid date range." would send them to the wrong place.
        const rejected = (await server.get('/reports/overview?baseline=industry', auth)).json();
        expect(JSON.stringify(rejected)).toContain('baseline');

        // The date-range message is unchanged for an actual date-range mistake.
        const backwards = (
          await server.get('/reports/overview?from=2026-08-01&to=2026-07-01', auth)
        ).json();
        expect(JSON.stringify(backwards)).not.toContain('baseline');
      });

      it("never lets another license's data reach this license's benchmark", async () => {
        // Two licenses, different volumes, overlapping windows. B runs three
        // conversations in the baseline window; A runs one. A's benchmark must
        // see its own single chat, not B's three, whichever way it is asked.
        const theirToken = await grantToken(owner, {
          licenseId: fx.b.licenseId,
          organizationId: fx.b.organizationId,
          ownerId: fx.b.ownerAccountId,
          scopes: ['reports_read'],
        });

        const mine = await conversation({ agentReplies: true, customerName: 'A earlier' });
        await backdateChat(mine, new Date(Date.now() - 15 * 86_400_000));

        // B's chats, written straight to the database under B's license. One
        // customer each: a license holds at most one chat per customer.
        const earlier = new Date(Date.now() - 15 * 86_400_000);
        for (let index = 0; index < 3; index += 1) {
          const theirCustomer = await owner.customer.create({
            data: { organizationId: fx.b.organizationId, name: `B visitor ${index}` },
            select: { id: true },
          });
          const chatId = generateShortId();
          await owner.chat.create({
            data: {
              id: chatId,
              licenseId: fx.b.licenseId,
              customerId: theirCustomer.id,
              createdAt: earlier,
            },
          });
          await owner.thread.create({
            data: {
              id: generateShortId(),
              chatId,
              licenseId: fx.b.licenseId,
              active: false,
              createdAt: earlier,
              closedAt: earlier,
            },
          });
        }

        const to = new Date();
        const from = new Date(to.getTime() - 10 * 86_400_000);
        const query = `from=${from.toISOString()}&to=${to.toISOString()}&baseline=previous_period`;

        const ours = (await server.get(`/reports/overview?${query}`, auth)).json();
        const theirs = (
          await server.get(`/reports/overview?${query}`, {
            authorization: `Bearer ${theirToken}`,
          })
        ).json();

        expect(ours.previous_period.chats).toBe(1);
        expect(theirs.previous_period.chats).toBe(3);

        // Same window, same baseline, different answers — the benchmark is a
        // per-license figure, not a pooled one. (If it ever became pooled both
        // would read 4, which is what this assertion exists to catch.)
        expect(ours.previous_period.chats).not.toBe(theirs.previous_period.chats);
      });
    });

    describe('every group carries a benchmark', () => {
      it.each(GROUP_PATHS)('%s returns a previous_period block', async (path) => {
        const body = (await server.get(`${path}?baseline=previous_period`, auth)).json();
        expect(body.previous_period).toBeDefined();
        expect(body.previous_period.baseline).toBe('previous_period');
        // The block always states its own window, so a client never has to
        // recompute what it is looking at.
        expect(Date.parse(body.previous_period.range.to)).toBe(Date.parse(body.range.from) - 1);
        expect(Date.parse(body.previous_period.range.from)).toBeLessThan(
          Date.parse(body.previous_period.range.to),
        );
      });

      it.each(GROUP_PATHS)(
        '%s defaults to previous_period when none is asked for',
        async (path) => {
          const [implicit, explicit] = await Promise.all([
            server.get(path, auth),
            server.get(`${path}?baseline=previous_period`, auth),
          ]);
          expect(implicit.json().previous_period.baseline).toBe('previous_period');
          // Windows resolve to "now" per request, so the ranges differ by
          // milliseconds; the shape and the baseline are what must match.
          expect(Object.keys(implicit.json().previous_period).sort()).toEqual(
            Object.keys(explicit.json().previous_period).sort(),
          );
        },
      );

      it('leaves the Overview and Reviews figures exactly as they were', async () => {
        // The regression this task most had to avoid: the two reports that
        // already compared periods must report the same numbers after the
        // arithmetic moved into `benchmarkWindow`.
        await conversation({ agentReplies: true, customerName: 'Now' });
        const earlier = await conversation({ agentReplies: true, customerName: 'Earlier' });
        await backdateChat(earlier, new Date(Date.now() - 15 * 86_400_000));

        const to = new Date();
        const from = new Date(to.getTime() - 10 * 86_400_000);
        const range = `from=${from.toISOString()}&to=${to.toISOString()}`;

        const [implicit, explicit] = await Promise.all([
          server.get(`/reports/overview?${range}`, auth),
          server.get(`/reports/overview?${range}&baseline=previous_period`, auth),
        ]);
        const withoutBaseline = implicit.json().previous_period;
        const withBaseline = explicit.json().previous_period;

        expect(withoutBaseline.chats).toBe(1);
        expect(withoutBaseline).toEqual(withBaseline);
        expect(withoutBaseline.range.to).toBe(new Date(from.getTime() - 1).toISOString());
      });

      it('reports the Sales benchmark as null, not zero', async () => {
        // The skeleton stays honest on both sides: with no sales source there is
        // nothing to have been better or worse than.
        const sales = (await server.get('/reports/sales?baseline=previous_period', auth)).json();
        expect(sales.previous_period.configured).toBe(false);
        expect(sales.previous_period.tracked_sales).toBeNull();
        expect(sales.previous_period.attributed_revenue_cents).toBeNull();
        expect(sales.previous_period.currency).toBeNull();
        expect(sales.previous_period.conversions).toBeNull();
      });
    });

    describe('previous_year', () => {
      it('moves the baseline window back 365 days on every group', async () => {
        const to = new Date('2026-07-31T00:00:00.000Z');
        const from = new Date('2026-07-01T00:00:00.000Z');
        const range = `from=${from.toISOString()}&to=${to.toISOString()}`;

        for (const path of GROUP_PATHS) {
          const body = (await server.get(`${path}?${range}&baseline=previous_year`, auth)).json();
          expect(body.previous_period.baseline, path).toBe('previous_year');
          expect(body.previous_period.range.from, path).toBe('2025-07-01T00:00:00.000Z');
          expect(body.previous_period.range.to, path).toBe('2025-07-31T00:00:00.000Z');
        }
      });

      it('counts a chat that falls in the year-ago window and not in the period before', async () => {
        const yearAgo = await conversation({ agentReplies: true, customerName: 'Year ago' });
        await backdateChat(yearAgo, new Date(Date.now() - 365 * 86_400_000 - 3 * 86_400_000));

        const to = new Date();
        const from = new Date(to.getTime() - 10 * 86_400_000);
        const range = `from=${from.toISOString()}&to=${to.toISOString()}`;

        const lastYear = (
          await server.get(`/reports/overview?${range}&baseline=previous_year`, auth)
        ).json();
        const lastPeriod = (
          await server.get(`/reports/overview?${range}&baseline=previous_period`, auth)
        ).json();

        expect(lastYear.previous_period.chats).toBe(1);
        expect(lastPeriod.previous_period.chats).toBe(0);
      });
    });

    describe('per-group figures', () => {
      it('benchmarks Cases against tickets counted the same way the day split counts them', async () => {
        const to = new Date();
        const from = new Date(to.getTime() - 10 * 86_400_000);
        const inBaseline = new Date(to.getTime() - 15 * 86_400_000);

        const ticket = async (status: string, createdAt: Date, mergedIntoId?: string) => {
          const id = generateShortId();
          await owner.ticket.create({
            data: {
              id,
              licenseId: fx.a.licenseId,
              subject: 'Benchmark ticket',
              status,
              priority: 0,
              createdAt,
              ...(mergedIntoId ? { mergedIntoId } : {}),
            },
          });
          return id;
        };

        const primary = await ticket('open', inBaseline);
        await ticket('solved', inBaseline);
        // A merged ticket is excluded from the day split, so it must be excluded
        // from the benchmark too — otherwise the two disagree by one.
        await ticket('open', inBaseline, primary);
        await ticket('open', to);

        const cases = (
          await server.get(
            `/reports/cases?from=${from.toISOString()}&to=${to.toISOString()}&baseline=previous_period`,
            auth,
          )
        ).json();

        expect(cases.previous_period).toMatchObject({ open: 1, closed: 1, total: 2 });
      });

      it('benchmarks Leads through the same license-bound first touch', async () => {
        const to = new Date();
        const from = new Date(to.getTime() - 10 * 86_400_000);
        const inBaseline = new Date(to.getTime() - 15 * 86_400_000);

        const lead = await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: 'Baseline lead', isLead: true },
          select: { id: true },
        });
        // A sibling lead of the same organization that never touched this
        // license: visible in `customers` under RLS, and still not ours to count.
        await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: 'Untouched lead', isLead: true },
        });
        await owner.chat.create({
          data: {
            id: generateShortId(),
            licenseId: fx.a.licenseId,
            customerId: lead.id,
            createdAt: inBaseline,
          },
        });

        const leads = (
          await server.get(
            `/reports/leads?from=${from.toISOString()}&to=${to.toISOString()}&baseline=previous_period`,
            auth,
          )
        ).json();

        expect(leads.previous_period.leads).toBe(1);
      });

      it('benchmarks Team performance on the license split, not on a baseline agent table', async () => {
        // Deliberate: the agent table is derived from the window, so the two
        // windows would list different people. The comparable quantity is the
        // license's own split.
        const earlier = await conversation({ agentReplies: true, customerName: 'Earlier' });
        await backdateChat(earlier, new Date(Date.now() - 15 * 86_400_000));

        const to = new Date();
        const from = new Date(to.getTime() - 10 * 86_400_000);
        const team = (
          await server.get(
            `/reports/team-performance?from=${from.toISOString()}&to=${to.toISOString()}&baseline=previous_period`,
            auth,
          )
        ).json();

        expect(team.previous_period).toMatchObject({ chats: 1, closed: 1, manual: 1 });
        expect(team.previous_period).not.toHaveProperty('agents');
      });

      it('moves the Chat topics trend window, not just the label', async () => {
        // Topics is the one group whose baseline is part of the data: each
        // topic's `previous_volume` is read in the benchmark window, so
        // `baseline` has to reach the clustering call, not only the block.
        const to = new Date('2026-07-31T00:00:00.000Z');
        const from = new Date('2026-07-01T00:00:00.000Z');
        const range = `from=${from.toISOString()}&to=${to.toISOString()}`;

        const body = (
          await server.get(`/reports/topics?${range}&baseline=previous_year`, auth)
        ).json();
        expect(body.previous_period.range.from).toBe('2025-07-01T00:00:00.000Z');
        // No window-level figure — a topic's baseline volume rides on its row.
        expect(body.previous_period).toEqual({
          baseline: 'previous_year',
          range: { from: '2025-07-01T00:00:00.000Z', to: '2025-07-31T00:00:00.000Z' },
        });
      });
    });

    describe('CSV export', () => {
      it.each(CSV_GROUPS)(
        'leaves the %s export byte-identical when no baseline is asked for',
        async (group) => {
          await conversation({ agentReplies: false });
          const to = new Date();
          const from = new Date(to.getTime() - 10 * 86_400_000);
          const range = `from=${from.toISOString()}&to=${to.toISOString()}`;

          const response = await server.get(`/reports/export?group=${group}&${range}`, auth);
          expect(response.statusCode).toBe(200);
          // The opt-in is the whole point: a script that parses column 1 as a
          // date must never be handed a `benchmark_` row it did not request.
          expect(response.body).not.toContain('benchmark_');
        },
      );

      it.each(CSV_GROUPS)('appends the benchmark block to %s on request', async (group) => {
        const to = new Date();
        const from = new Date(to.getTime() - 10 * 86_400_000);
        const range = `from=${from.toISOString()}&to=${to.toISOString()}`;

        const [plain, benchmarked] = await Promise.all([
          server.get(`/reports/export?group=${group}&${range}`, auth),
          server.get(`/reports/export?group=${group}&${range}&baseline=previous_period`, auth),
        ]);

        const plainRows = csvLines(plain.body);
        const rows = csvLines(benchmarked.body);
        // Same header, same data rows, benchmark rows appended after them.
        expect(rows.slice(0, plainRows.length)).toEqual(plainRows);

        const block = rows.slice(plainRows.length);
        expect(block.length).toBeGreaterThanOrEqual(3);
        for (const line of block) expect(line.startsWith('benchmark_')).toBe(true);
        expect(block[0]).toMatch(/^benchmark_baseline,previous_period(,)*$/);
        expect(block[1]).toMatch(/^benchmark_range_from,/);
        expect(block[2]).toMatch(/^benchmark_range_to,/);

        // Every line keeps the table's field count, so a strict parser does not
        // choke on a ragged row.
        const width = (line: string): number => line.split(',').length;
        for (const line of block) expect(width(line)).toBe(width(rows[0]!));
      });

      it('quotes the same benchmark figure the JSON report does', async () => {
        await conversation({ agentReplies: true, customerName: 'Now' });
        const earlier = await conversation({ agentReplies: true, customerName: 'Earlier' });
        await backdateChat(earlier, new Date(Date.now() - 15 * 86_400_000));

        const to = new Date();
        const from = new Date(to.getTime() - 10 * 86_400_000);
        const query = `from=${from.toISOString()}&to=${to.toISOString()}&baseline=previous_period`;

        const [report, csv] = await Promise.all([
          server.get(`/reports/overview?${query}`, auth),
          server.get(`/reports/export?group=overview&${query}`, auth),
        ]);

        const chats = report.json().previous_period.chats;
        expect(chats).toBe(1);
        expect(csvLines(csv.body)).toContain(`benchmark_chats,${chats}`);
      });

      it('moves the CSV benchmark with the baseline', async () => {
        const yearAgo = await conversation({ agentReplies: true, customerName: 'Year ago' });
        await backdateChat(yearAgo, new Date(Date.now() - 368 * 86_400_000));

        const to = new Date();
        const from = new Date(to.getTime() - 10 * 86_400_000);
        const range = `from=${from.toISOString()}&to=${to.toISOString()}`;

        const lastYear = csvLines(
          (await server.get(`/reports/export?group=overview&${range}&baseline=previous_year`, auth))
            .body,
        );
        const lastPeriod = csvLines(
          (
            await server.get(
              `/reports/export?group=overview&${range}&baseline=previous_period`,
              auth,
            )
          ).body,
        );

        expect(lastYear).toContain('benchmark_baseline,previous_year');
        expect(lastYear).toContain('benchmark_chats,1');
        expect(lastPeriod).toContain('benchmark_chats,0');
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
      // `enterprise` used to belong here; it is a real tier since 11.5-a, so
      // the case needs a plan the catalogue genuinely does not know.
      const response = await server.patch('/billing/subscription', { plan: 'platinum' }, auth);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.type).toBe('validation');
    });

    it('accepts the enterprise tier and keeps the amounts already on file', async () => {
      await activate();
      await server.patch('/billing/subscription', { seats: 2 }, auth);

      const response = await server.patch('/billing/subscription', { plan: 'enterprise' }, auth);
      expect(response.statusCode).toBe(200);
      expect(response.json().plan).toBe('enterprise');
      // Quoted, so a client shows "contact sales" rather than the figure — but
      // the figure is unchanged, because the catalogue prices nothing for
      // Enterprise and this deployment may not invent a price.
      expect(response.json().pricing).toBe('quoted');
      expect(response.json().unit_price_cents).toBe(9900);

      const row = await owner.subscription.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(row.plan).toBe('enterprise');
      expect(row.unitPriceCents).toBe(9900);
    });

    it('reports the self-serve tier as listed', async () => {
      expect((await server.get('/billing/subscription', auth)).json().pricing).toBe('listed');
    });

    it('never refuses the move up to Enterprise over usage already spent', async () => {
      await activate();
      await server.patch('/billing/subscription', { seats: 2 }, auth);
      // Well past growth's 200 included resolutions. Enterprise has no
      // catalogue allowance, so it can never be the smaller side of a move —
      // refusing an upgrade because the workspace uses the product a lot would
      // be exactly backwards.
      await owner.usageRecord.create({
        data: {
          licenseId: fx.a.licenseId,
          metric: 'ai_resolutions',
          period: currentPeriod(),
          quantity: 250n,
          included: 200n,
          overageUnit: 50,
          overageUnitPriceCents: 50,
        },
      });

      const response = await server.patch('/billing/subscription', { plan: 'enterprise' }, auth);
      expect(response.statusCode).toBe(200);
      expect(response.json().plan).toBe('enterprise');
    });

    it('still refuses the move down from Enterprise once the quota is spent', async () => {
      await activate();
      await server.patch('/billing/subscription', { plan: 'enterprise', seats: 2 }, auth);
      await owner.usageRecord.create({
        data: {
          licenseId: fx.a.licenseId,
          metric: 'ai_resolutions',
          period: currentPeriod(),
          quantity: 250n,
          included: 200n,
          overageUnit: 50,
          overageUnitPriceCents: 50,
        },
      });

      // The downgrade guard (FR-MOD-10.1.1) fires in the direction it was
      // written for: growth includes 200, and 250 are already spent.
      const response = await server.patch('/billing/subscription', { plan: 'growth' }, auth);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.type).toBe('validation');
      expect(
        (await owner.subscription.findFirstOrThrow({ where: { licenseId: fx.a.licenseId } })).plan,
      ).toBe('enterprise');
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
  // FR-MOD-11.5 · 11.5-a: what a workspace's tier unlocks. This endpoint
  // reports; the gate that refuses a write is 11.5-b's.
  describe('entitlements (11.5)', () => {
    const ALL_KEYS = ['white_label', 'sandbox', 'sla', 'sso', 'hipaa', 'siem_export'];

    it('denies every Enterprise capability on a trial', async () => {
      // Fixtures ship a trial with no subscription row: it has bought nothing.
      const response = await server.get('/billing/entitlements', auth);
      expect(response.statusCode).toBe(200);
      expect(response.json().plan).toBe('growth');
      expect(response.json().entitlements).toEqual({
        white_label: false,
        sandbox: false,
        sla: false,
        sso: false,
        hipaa: false,
        siem_export: false,
      });
    });

    it('answers every key, so a client can never read a missing one as yes', async () => {
      const entitlements = (await server.get('/billing/entitlements', auth)).json().entitlements;
      expect(Object.keys(entitlements).sort()).toEqual([...ALL_KEYS].sort());
    });

    it('grants them all once the workspace is on Enterprise', async () => {
      await server.patch('/billing/subscription', { plan: 'enterprise', seats: 2 }, auth);

      const response = await server.get('/billing/entitlements', auth);
      expect(response.json().plan).toBe('enterprise');
      expect(response.json().entitlements).toEqual({
        white_label: true,
        sandbox: true,
        sla: true,
        sso: true,
        hipaa: true,
        siem_export: true,
      });
    });

    it('takes them away again on the way back down', async () => {
      await server.patch('/billing/subscription', { plan: 'enterprise', seats: 2 }, auth);
      expect(
        (await server.get('/billing/entitlements', auth)).json().entitlements.white_label,
      ).toBe(true);

      // Derived from the plan on every read (§C-A25) — no second store to
      // forget to clear, which is how a downgraded workspace keeps a capability.
      await server.patch('/billing/subscription', { plan: 'growth' }, auth);
      const after = (await server.get('/billing/entitlements', auth)).json();
      expect(after.plan).toBe('growth');
      expect(Object.values(after.entitlements)).toEqual(ALL_KEYS.map(() => false));
    });

    it('grants nothing for a plan the catalogue does not know', async () => {
      // `plan` is a free-form column; a row written outside the checkout must
      // fail closed rather than fall through to allow.
      await owner.subscription.create({
        data: { licenseId: fx.a.licenseId, plan: 'platinum', status: 'active', seats: 2 },
      });

      const response = await server.get('/billing/entitlements', auth);
      expect(response.json().plan).toBe('platinum');
      expect(Object.values(response.json().entitlements)).toEqual(ALL_KEYS.map(() => false));
    });

    it('publishes the catalogue, so a screen can name the tier that unlocks a control', async () => {
      const plans = (await server.get('/billing/entitlements', auth)).json().plans;
      expect(plans.map((plan: { id: string }) => plan.id).sort()).toEqual(['enterprise', 'growth']);

      const growth = plans.find((plan: { id: string }) => plan.id === 'growth');
      expect(growth).toMatchObject({
        pricing: 'listed',
        unit_price_cents: 9900,
        ai_resolutions_included: 200,
        entitlements: [],
      });

      const enterprise = plans.find((plan: { id: string }) => plan.id === 'enterprise');
      // No invented Enterprise price — the PRD names its capabilities and no
      // figure, so the catalogue states the first and nothing for the second.
      expect(enterprise.pricing).toBe('quoted');
      expect(enterprise.unit_price_cents).toBeNull();
      expect(enterprise.ai_resolutions_included).toBeNull();
      expect([...enterprise.entitlements].sort()).toEqual([...ALL_KEYS].sort());
    });

    it('answers a session with no billing scope at all', async () => {
      // The settings screens that own these controls ask this question; making
      // them hold `billing_manage` first would over-scope every console token.
      const plain = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      const response = await server.get('/billing/entitlements', {
        authorization: `Bearer ${plain}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().plan).toBe('growth');
    });

    it('refuses an unauthenticated caller', async () => {
      expect((await server.get('/billing/entitlements')).statusCode).toBe(401);
    });

    it("never reports another licence's plan", async () => {
      // A goes Enterprise; B must still answer for itself.
      await server.patch('/billing/subscription', { plan: 'enterprise', seats: 2 }, auth);
      const tokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['billing_manage'],
      });

      const response = await server.get('/billing/entitlements', {
        authorization: `Bearer ${tokenB}`,
      });
      expect(response.json().plan).toBe('growth');
      expect(Object.values(response.json().entitlements)).toEqual(ALL_KEYS.map(() => false));
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

    describe('a bought API package, as its own line item (09.3-e)', () => {
      const ESSENTIAL = API_PACKAGE_CATALOG.find((p) => p.id === 'essential')!;

      /** The invoice for the current, still-open period. */
      const openInvoice = async (): Promise<{
        status: string;
        total_cents: number;
        subtotal_cents: number;
        line_items: { description: string; amount_cents: number }[];
      }> => {
        const invoices = (await server.get('/billing/invoices', auth)).json().invoices;
        return invoices.find((i: { period: string }) => i.period === period);
      };

      it('lists the purchase priced from the receipt, summed into the total', async () => {
        await activate();
        const bought = await server.post(
          '/billing/api-packages',
          { package_id: 'essential' },
          auth,
        );
        expect(bought.statusCode).toBe(200);

        const open = await openInvoice();
        const line = open.line_items.find((l) => l.description.includes('API package'));
        expect(line).toEqual({
          description: `API package — Essential (${ESSENTIAL.api_calls} calls)`,
          amount_cents: ESSENTIAL.price_cents,
        });
        // Seats ($198) + the package price — itemised, and the total agrees
        // with subtotal and with summing the lines by hand.
        expect(open.total_cents).toBe(2 * 9900 + ESSENTIAL.price_cents);
        expect(open.subtotal_cents).toBe(open.total_cents);
        expect(open.line_items.reduce((sum, l) => sum + l.amount_cents, 0)).toBe(open.total_cents);
      });

      it('leaves the invoice exactly as before when nothing was bought (regression)', async () => {
        await activate();
        const open = await openInvoice();
        expect(open.line_items).toHaveLength(1);
        expect(open.line_items.some((l) => l.description.includes('API package'))).toBe(false);
        expect(open.total_cents).toBe(2 * 9900);
      });

      it('carries the line onto the injection-safe CSV download', async () => {
        await activate();
        await server.post('/billing/api-packages', { package_id: 'essential' }, auth);

        const response = await server.get(`/billing/invoices/${period}/download`, auth);
        const rows = response.body.split('\r\n').filter((l: string) => l !== '');
        expect(rows).toContain(
          `API package — Essential (${ESSENTIAL.api_calls} calls),${ESSENTIAL.price_cents}`,
        );
      });

      it('is a real charge even while the plan itself is free during the trial', async () => {
        // The fixture license is trialing — the trial gate never blocks
        // buying a package (api-package-service.ts), so the purchase still
        // happens and is a deliberate spend the plan-free line does not cover.
        const bought = await server.post(
          '/billing/api-packages',
          { package_id: 'essential' },
          auth,
        );
        expect(bought.statusCode).toBe(200);

        const open = await openInvoice();
        expect(open.status).toBe('trial');
        const line = open.line_items.find((l) => l.description.includes('API package'));
        expect(line?.amount_cents).toBe(ESSENTIAL.price_cents);
        expect(open.total_cents).toBe(ESSENTIAL.price_cents);
      });

      it('never puts another tenant’s purchase on this invoice', async () => {
        await activate();
        const theirToken = await grantToken(owner, {
          licenseId: fx.b.licenseId,
          organizationId: fx.b.organizationId,
          ownerId: fx.b.ownerAccountId,
          scopes: ['billing_manage'],
        });
        const bought = await server.post(
          '/billing/api-packages',
          { package_id: 'essential' },
          { authorization: `Bearer ${theirToken}` },
        );
        expect(bought.statusCode).toBe(200);

        const open = await openInvoice();
        expect(open.line_items.some((l) => l.description.includes('API package'))).toBe(false);
        expect(open.total_cents).toBe(2 * 9900);
      });
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

  // =========================================================================
  describe('API packages — the catalogue and the receipts (09.3)', () => {
    /** An Essential purchase, as 09.3-d's core will write it. */
    const purchase = (overrides: Record<string, unknown> = {}) => ({
      licenseId: fx.a.licenseId,
      packageId: 'essential',
      apiCalls: 100_000n,
      priceCents: 2999,
      period: '202608',
      ...overrides,
    });

    /** A token that can read nothing billing-shaped. */
    const weakToken = () =>
      grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });

    it('refuses the catalogue to a token with neither a billing nor a reports scope', async () => {
      const response = await server.get('/billing/api-packages', {
        authorization: `Bearer ${await weakToken()}`,
      });
      expect(response.statusCode).toBe(403);
    });

    it('refuses the purchase history to that same token', async () => {
      const response = await server.get('/billing/api-packages/purchases', {
        authorization: `Bearer ${await weakToken()}`,
      });
      expect(response.statusCode).toBe(403);
    });

    it('never shows another tenant a purchase — what it spends on capacity is its own', async () => {
      const mine = await owner.apiPackagePurchase.create({
        data: purchase(),
        select: { id: true },
      });
      await owner.apiPackagePurchase.create({
        data: purchase({ licenseId: fx.b.licenseId, packageId: 'pro', apiCalls: 500_000n }),
      });

      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
      const theirs = (
        await server.get('/billing/api-packages/purchases', {
          authorization: `Bearer ${theirToken}`,
        })
      ).json().items;

      // B sees its own single purchase and nothing of A's.
      expect(theirs).toHaveLength(1);
      expect(theirs[0].package_id).toBe('pro');
      expect(theirs.map((p: { id: string }) => p.id)).not.toContain(mine.id);
    });

    it('serves the catalogue verbatim — the ids, quotas and prices @nexa/types compiles', async () => {
      const response = await server.get('/billing/api-packages', auth);
      expect(response.statusCode).toBe(200);
      // Not a hand-written second copy: a repriced package shows up here without
      // anyone remembering to edit the numbers twice.
      expect(response.json().items).toEqual(API_PACKAGE_CATALOG.map((entry) => ({ ...entry })));
      expect(response.json().items).toHaveLength(3);
    });

    it('is readable with reports_read alone, not only with a billing scope', async () => {
      const reader = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['reports_read'],
      });
      const response = await server.get('/billing/api-packages', {
        authorization: `Bearer ${reader}`,
      });
      expect(response.statusCode).toBe(200);
    });

    it('answers an empty history with an empty list, not a 404', async () => {
      const response = await server.get('/billing/api-packages/purchases', auth);
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual([]);
    });

    it('reports each purchase with the quota and price it was sold at', async () => {
      await owner.apiPackagePurchase.create({ data: purchase() });

      const items = (await server.get('/billing/api-packages/purchases', auth)).json().items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        package_id: 'essential',
        name: 'Essential',
        api_calls: 100_000,
        price_cents: 2999,
        period: '202608',
      });
      expect(typeof items[0].id).toBe('string');
      expect(Date.parse(items[0].purchased_at)).not.toBeNaN();
    });

    it('keeps the sold price even after the catalogue moves on', async () => {
      // The row is the receipt. Re-deriving the price from today's catalogue
      // would silently restate an old bill the next time pricing changes.
      await owner.apiPackagePurchase.create({
        data: purchase({ priceCents: 999, apiCalls: 1_000n }),
      });

      const items = (await server.get('/billing/api-packages/purchases', auth)).json().items;
      expect(items[0]).toMatchObject({ price_cents: 999, api_calls: 1_000, name: 'Essential' });
    });

    it('still reports a purchase of a package that has left the catalogue', async () => {
      await owner.apiPackagePurchase.create({ data: purchase({ packageId: 'legacy-mega' }) });

      const items = (await server.get('/billing/api-packages/purchases', auth)).json().items;
      // The id survives; only the display name is unknown. Dropping the row
      // instead would lose money the workspace actually spent.
      expect(items[0]).toMatchObject({ package_id: 'legacy-mega', name: null });
    });

    it('lists purchases newest first', async () => {
      const day = 86_400_000;
      await owner.apiPackagePurchase.createMany({
        data: [
          purchase({ packageId: 'essential', purchasedAt: new Date(Date.now() - 2 * day) }),
          purchase({ packageId: 'pro-plus', purchasedAt: new Date(Date.now() - day) }),
          purchase({ packageId: 'pro', purchasedAt: new Date() }),
        ],
      });

      const items = (await server.get('/billing/api-packages/purchases', auth)).json().items;
      expect(items.map((p: { package_id: string }) => p.package_id)).toEqual([
        'pro',
        'pro-plus',
        'essential',
      ]);
    });
  });

  // =========================================================================
  // 09.3-d. Buying is where the money and the quota meet: the sale is recorded,
  // and the same transaction raises `usage_records.included` for the period.
  // That row is shared with the meter — `recordApiCall` upserts it on every
  // billed call — so most of what is tested here is what happens when the two
  // arrive together.
  describe('API packages — buying one (09.3-d)', () => {
    const env = testEnv();
    const meterConfig = {
      apiIncluded: env.API_CALLS_INCLUDED,
      apiOverageCents: env.API_CALL_OVERAGE_CENTS,
    };
    const ESSENTIAL = API_PACKAGE_CATALOG.find((p) => p.id === 'essential')!;

    const context = () => ({ licenseId: fx.a.licenseId, organizationId: fx.a.organizationId });

    /** This period's api_calls row, read past RLS so the assertions are exact. */
    const apiUsageRow = (licenseId = fx.a.licenseId) =>
      owner.usageRecord.findFirst({
        where: { licenseId, metric: 'api_calls', period: currentPeriod() },
      });

    /**
     * The allowance as the meter would report it. Not "is there a row": every
     * request made with a PAT — including a rejected one — is itself a billed
     * API call, so the row exists after any HTTP call. What a refusal must
     * leave alone is `included`.
     */
    const includedNow = async (licenseId = fx.a.licenseId): Promise<number> => {
      const row = await apiUsageRow(licenseId);
      return row === null ? env.API_CALLS_INCLUDED : Number(row.included);
    };

    /** A token with a read scope only — it may see prices, not spend money. */
    const readerToken = () =>
      grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['reports_read'],
      });

    // --- Negatives first -----------------------------------------------------

    it('refuses a token with no billing scope at all', async () => {
      const weak = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      const response = await server.post(
        '/billing/api-packages',
        { package_id: 'essential' },
        { authorization: `Bearer ${weak}` },
      );
      expect(response.statusCode).toBe(403);
      expect(await includedNow()).toBe(env.API_CALLS_INCLUDED);
    });

    it('refuses reports_read — reading the price list is not permission to spend', async () => {
      const response = await server.post(
        '/billing/api-packages',
        { package_id: 'essential' },
        { authorization: `Bearer ${await readerToken()}` },
      );
      expect(response.statusCode).toBe(403);
      // Nothing sold, and no quota handed out on the way to the refusal.
      expect(await owner.apiPackagePurchase.count()).toBe(0);
      expect(await includedNow()).toBe(env.API_CALLS_INCLUDED);
    });

    it('answers an unknown package with 404, having sold nothing', async () => {
      const response = await server.post(
        '/billing/api-packages',
        { package_id: 'enterprise-unlimited' },
        auth,
      );
      expect(response.statusCode).toBe(404);
      expect(response.json().error.type).toBe('not_found');
      expect(await owner.apiPackagePurchase.count()).toBe(0);
      // The rollback matters: the receipt and the credit are one transaction, so
      // a rejected id must leave the allowance exactly as it was.
      expect(await includedNow()).toBe(env.API_CALLS_INCLUDED);
    });

    it('rejects a malformed body as validation, not as an unknown package', async () => {
      expect((await server.post('/billing/api-packages', {}, auth)).statusCode).toBe(400);
      expect(
        (await server.post('/billing/api-packages', { package_id: '' }, auth)).statusCode,
      ).toBe(400);
      expect(
        (await server.post('/billing/api-packages', { package_id: 42 }, auth)).statusCode,
      ).toBe(400);
    });

    // --- Cross-tenant --------------------------------------------------------

    it('credits the quota to the buyer alone — nobody else’s allowance moves', async () => {
      const theirToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['billing_manage'],
      });
      const theirUsageBefore = (
        await server.get('/billing/usage', { authorization: `Bearer ${theirToken}` })
      ).json();

      const bought = await server.post('/billing/api-packages', { package_id: 'pro' }, auth);
      expect(bought.statusCode).toBe(200);

      const theirUsageAfter = (
        await server.get('/billing/usage', { authorization: `Bearer ${theirToken}` })
      ).json();
      // B's included allowance is untouched: buying capacity for one workspace
      // must never be readable — or spendable — as capacity for another.
      expect(theirUsageAfter.api_calls.included).toBe(theirUsageBefore.api_calls.included);
      expect(theirUsageAfter.api_calls.included).toBe(env.API_CALLS_INCLUDED);
      expect(await owner.apiPackagePurchase.count({ where: { licenseId: fx.b.licenseId } })).toBe(
        0,
      );
      // And A really did get it.
      expect(Number((await apiUsageRow())!.included)).toBe(env.API_CALLS_INCLUDED + 500_000);
    });

    // --- The race the whole design turns on ---------------------------------
    //
    // `recordApiCall` owns `quantity` and never touches `included`; the purchase
    // owns `included` and never touches `quantity`. These three tests are the
    // proof, in the three orders the two writes can reach the shared row.

    const buy = (packageId = 'essential') =>
      withTenant(appRole, context(), (tx) =>
        purchaseApiPackage(tx, context(), packageId, meterConfig),
      );

    const meter = () =>
      withTenant(appRole, context(), (tx) =>
        recordApiCall(tx, context(), meterConfig.apiOverageCents, meterConfig.apiIncluded),
      );

    /** Both writes landed, neither lost: full allowance + quota, all calls counted. */
    async function expectSettled(calls: number, quota = ESSENTIAL.api_calls): Promise<void> {
      const row = await apiUsageRow();
      expect(Number(row!.included)).toBe(env.API_CALLS_INCLUDED + quota);
      expect(Number(row!.quantity)).toBe(calls);
    }

    it('keeps the plan allowance when the purchase lands before the period’s first call', async () => {
      // No row exists yet, so the purchase inserts it. Seeding `included` with
      // the quota alone would silently take the plan's own 100,000 calls away
      // from anyone who buys early.
      await buy();
      for (let i = 0; i < 5; i += 1) await meter();
      await expectSettled(5);
    });

    it('adds to the allowance the meter already stamped', async () => {
      for (let i = 0; i < 5; i += 1) await meter();
      await buy();
      await expectSettled(5);
    });

    it('loses nothing when the purchase and a burst of calls overlap', async () => {
      const calls = 12;
      // Issued together against the real database: the upsert's row lock is what
      // has to serialise them, not the order they were started in.
      await Promise.all([buy(), ...Array.from({ length: calls }, meter)]);
      await expectSettled(calls);
    });

    it('stacks two purchases instead of overwriting the first', async () => {
      // The `EXCLUDED.included` trap: `included = usage_records.included + quota`
      // composes, `included = EXCLUDED.included` would set both purchases to
      // "allowance + this one" and quietly refund the earlier sale.
      await buy('essential');
      await buy('pro');
      const row = await apiUsageRow();
      expect(Number(row!.included)).toBe(env.API_CALLS_INCLUDED + 100_000 + 500_000);
      expect(await owner.apiPackagePurchase.count({ where: { licenseId: fx.a.licenseId } })).toBe(
        2,
      );
    });

    // --- Positives -----------------------------------------------------------

    it('raises the quota and shrinks the overage the usage endpoint reports', async () => {
      // Start the period over its allowance, so there is a real overage charge
      // for the purchase to reduce.
      await owner.usageRecord.create({
        data: {
          licenseId: fx.a.licenseId,
          metric: 'api_calls',
          period: currentPeriod(),
          quantity: BigInt(env.API_CALLS_INCLUDED + 1),
          included: BigInt(env.API_CALLS_INCLUDED),
          overageUnit: 100_000,
          overageUnitPriceCents: env.API_CALL_OVERAGE_CENTS,
        },
      });
      const before = (await server.get('/billing/usage', auth)).json();
      expect(before.api_calls.overage_cents).toBe(env.API_CALL_OVERAGE_CENTS);

      const response = await server.post(
        '/billing/api-packages',
        { package_id: 'essential' },
        auth,
      );
      expect(response.statusCode).toBe(200);

      const after = (await server.get('/billing/usage', auth)).json();
      expect(after.api_calls.included).toBe(before.api_calls.included + 100_000);
      // One call over the plan cost a whole $29.50 block; 100,000 more included
      // calls put the workspace back inside its allowance.
      expect(after.api_calls.overage).toBe(0);
      expect(after.api_calls.overage_cents).toBe(0);
    });

    it('answers with the receipt and the usage the purchase produced', async () => {
      const response = await server.post('/billing/api-packages', { package_id: 'pro-plus' }, auth);
      expect(response.statusCode).toBe(200);

      const { purchase: receipt, usage } = response.json();
      expect(receipt).toMatchObject({
        package_id: 'pro-plus',
        name: 'Pro+',
        api_calls: 1_000_000,
        price_cents: 24999,
        period: currentPeriod(),
      });
      expect(typeof receipt.id).toBe('string');
      expect(Date.parse(receipt.purchased_at)).not.toBeNaN();
      // The usage in the reply is the post-purchase one — a client that renders
      // it does not have to ask again and cannot show the stale number.
      expect(usage.api_calls.included).toBe(env.API_CALLS_INCLUDED + 1_000_000);
      expect(usage.period).toBe(currentPeriod());
    });

    it('shows the purchase in the history it just made', async () => {
      await server.post('/billing/api-packages', { package_id: 'essential' }, auth);
      const items = (await server.get('/billing/api-packages/purchases', auth)).json().items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        package_id: 'essential',
        api_calls: 100_000,
        price_cents: 2999,
      });
    });

    it('records the sale immutably — quota and price as the catalogue priced them', async () => {
      await server.post('/billing/api-packages', { package_id: 'pro' }, auth);
      const row = await owner.apiPackagePurchase.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(row.packageId).toBe('pro');
      expect(row.apiCalls).toBe(500_000n);
      expect(row.priceCents).toBe(14999);
      expect(row.period).toBe(currentPeriod());
    });

    it('writes an audit entry saying who bought what, and for how much', async () => {
      await server.post('/billing/api-packages', { package_id: 'essential' }, auth);
      const entry = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'billing.api_package_purchased' },
      });
      expect(entry).not.toBeNull();
      expect(entry!.metadata).toMatchObject({
        package_id: 'essential',
        api_calls: 100_000,
        price_cents: 2999,
        period: currentPeriod(),
      });
      // The purchase row carries no actor; this entry is the only record of who.
      expect(entry!.actorId).toBe(fx.a.ownerAccountId);
    });

    it('stays buyable once the trial is read-only — running out is why you buy', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
      });
      const response = await server.post(
        '/billing/api-packages',
        { package_id: 'essential' },
        auth,
      );
      expect(response.statusCode).toBe(200);
      expect(Number((await apiUsageRow())!.included)).toBe(env.API_CALLS_INCLUDED + 100_000);
    });

    it('charges no card and requires none on file (ADR-13)', async () => {
      expect(await owner.paymentMethod.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
      const response = await server.post(
        '/billing/api-packages',
        { package_id: 'essential' },
        auth,
      );
      // Mock billing: a purchase must not depend on a card, and must not create
      // or touch one on its way through.
      expect(response.statusCode).toBe(200);
      expect(await owner.paymentMethod.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });
  });
});
