/**
 * The root panel's billing and usage (tm 389.12 · FR-ADMIN-12/13 ·
 * docs/platform-admin/design.md §C billing, usage · PLAN §D218).
 *
 * Driven through the platform API and judged from the tenant's side of the
 * same database:
 *
 *   1. Reads — plans, subscriptions, statements, packages, revenue — match the
 *      fixtures exactly, page by keyset without repeats, and carry no
 *      workspace content (no member's address, no reason in the tenant trail).
 *   2. Credits — granted by `billing`, refused to `support`, in USD only; the
 *      period close takes them off the next statement as negative lines, never
 *      below zero (the rest is carried as a remainder), once, even when two
 *      sweeps race on separate connections.
 *   3. A subscription by hand — the licence `active`, the subscription on the
 *      plan until `period_end`, both audit trails.
 *   4. The daily AI allowance from the platform's end, through the real tenant
 *      server: a 500,000 override lets X past 200,000 while Y stops there
 *      (#283's acceptance criterion), the announcement makes it land within a
 *      second, an expired override falls back to the plan's default, and the
 *      plan default set here beats the deployment's.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformRole } from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import { publishAiCapsChanged } from '../../src/services/ai/ai-caps-events.js';
import { utcDayKey } from '../../src/services/ai/ai-daily-budget.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
} from '../../src/services/ai/provider/llm-provider.js';
import { InvoiceCloseSweeper } from '../../src/services/billing/invoice-close-sweep.js';
import { previousPeriod } from '../../src/services/billing/invoice-service.js';
import { currentPeriod } from '../../src/services/billing/metering.js';
import { customerAsks, seedAiWorkspace } from '../helpers/ai-workspace.js';
import {
  ownerClient,
  platformClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { asKnowledgeAnswer } from '../helpers/knowledge-answer.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type ErrorBody = { error: { type: string; details?: Record<string, unknown> } };

const DAY = 86_400_000;
const REASON = 'Goodwill after the outage';
const reason = { reason: REASON };
const APP_URL = process.env['DATABASE_APP_URL'];

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('platform billing and usage (tm 389.12)', () => {
  let platform: PlatformTestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let fx: Fixtures;
  const tokens = new Map<PlatformRole, string>();

  const call = (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    role: PlatformRole = 'superadmin',
  ): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method,
      url: `${PLATFORM_PREFIX}${path}`,
      headers: bearer(tokens.get(role)!),
      ...(body === undefined ? {} : { payload: body as object }),
    });
  const ok = async <T = Record<string, unknown>>(
    response: Promise<LightMyRequestResponse>,
    status = 200,
  ): Promise<T> => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(status);
    return settled.json() as T;
  };
  const refused = async (
    response: Promise<LightMyRequestResponse>,
    status: number,
    type?: string,
    detailsReason?: string,
  ) => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(status);
    const body = settled.json() as ErrorBody;
    if (type !== undefined) expect(body.error.type).toBe(type);
    if (detailsReason !== undefined) expect(body.error.details?.['reason']).toBe(detailsReason);
  };

  /** Both halves of the double entry for one action on one workspace. */
  async function expectDoubleEntry(t: TenantFixture | bigint, action: string) {
    const licenseId = typeof t === 'bigint' ? t : t.licenseId;
    const [platformRows, tenantRows] = await Promise.all([
      owner.platformAuditLog.findMany({ where: { licenseId, action } }),
      owner.auditLogEntry.findMany({
        where: { licenseId, actorType: 'platform', action: `platform.${action.replace('.', '_')}` },
      }),
    ]);
    expect(platformRows, action).toHaveLength(1);
    expect(platformRows[0]!.reason).toBe(REASON);
    expect(tenantRows, action).toHaveLength(1);
    expect(JSON.stringify(tenantRows[0]!.metadata)).not.toContain(REASON);
    return platformRows[0]!;
  }

  async function signInEveryRole() {
    tokens.clear();
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
  }

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    platform = await buildPlatformTestServer(
      { RATE_LIMIT_PLATFORM_PER_MIN: '100000' },
      { now: clock.read },
    );
  });

  afterAll(async () => {
    await platform?.close();
    await db?.$disconnect();
  });

  // ==========================================================================
  // 1–3. Billing
  // ==========================================================================

  describe('billing', () => {
    let appRole: PrismaClient;
    const open = currentPeriod();
    const justClosed = previousPeriod(open);
    const older = previousPeriod(justClosed);

    /** Off the trial, onto a paid subscription of `seats` × $99. */
    async function activate(t: TenantFixture, seats = 2, status = 'active') {
      await owner.license.update({
        where: { id: t.licenseId },
        data: { status, trialEndsAt: null },
      });
      await owner.subscription.create({
        data: { licenseId: t.licenseId, status, seats, unitPriceCents: 9_900 },
      });
    }

    /** Something billable happened in `period`. */
    async function meter(t: TenantFixture, period: string, quantity = 10n) {
      await owner.usageRecord.create({
        data: {
          licenseId: t.licenseId,
          metric: 'ai_resolutions',
          period,
          quantity,
          included: 200n,
          overageUnit: 50,
          overageUnitPriceCents: 50,
        },
      });
    }

    const sweep = (client: PrismaClient = appRole) =>
      new InvoiceCloseSweeper(client, testEnv()).run();

    const statement = (t: TenantFixture, period: string) =>
      owner.invoice.findUnique({
        where: { licenseId_period: { licenseId: t.licenseId, period } },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });

    const grant = (t: TenantFixture, amount: number, role: PlatformRole = 'billing') =>
      call(
        'POST',
        '/billing/credits',
        { license_id: t.licenseId.toString(), amount_minor: amount, currency: 'USD', ...reason },
        role,
      );

    beforeAll(() => {
      if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
      appRole = new PrismaClient({ datasourceUrl: APP_URL });
    });

    afterAll(async () => {
      await appRole?.$disconnect();
    });

    beforeEach(async () => {
      clock.now = Date.now();
      fx = await seedFixtures(owner);
      await signInEveryRole();
    });

    it('lists the plans with their workspaces and AI defaults, every subscription by filter and keyset, and no member address', async () => {
      await activate(fx.a, 3);
      await activate(fx.b, 1, 'past_due');

      const plans = await ok<{ data: Array<Record<string, unknown>> }>(
        call('GET', '/billing/plans', undefined, 'support'),
      );
      expect(plans.data.map((plan) => plan.id)).toEqual(['growth', 'enterprise']);
      expect(plans.data[0]).toMatchObject({
        pricing: 'listed',
        unit_price_cents: 9_900,
        ai_daily_tokens: { llm: null, embedding: null },
      });
      const growthBefore = plans.data[0]!['workspaces'] as number;
      expect(growthBefore).toBeGreaterThanOrEqual(2);

      const all = await ok<{ data: Array<Record<string, unknown>>; next_cursor: null }>(
        call('GET', '/billing/subscriptions', undefined, 'readonly'),
      );
      const ours = all.data.filter((row) =>
        [fx.a.licenseId.toString(), fx.b.licenseId.toString()].includes(row.license_id as string),
      );
      expect(ours).toHaveLength(2);
      expect(ours.find((row) => row.license_id === fx.a.licenseId.toString())).toMatchObject({
        plan: 'growth',
        status: 'active',
        license_status: 'active',
        seats: 3,
        unit_price_cents: 9_900,
        cancel_at_period_end: false,
      });
      expect(JSON.stringify(all)).not.toContain(fx.a.ownerEmail);

      const pastDue = await ok<{ data: Array<{ license_id: string }> }>(
        call('GET', '/billing/subscriptions?past_due=true'),
      );
      expect(pastDue.data.map((row) => row.license_id)).toEqual([fx.b.licenseId.toString()]);
      const enterprise = await ok<{ data: unknown[] }>(
        call('GET', '/billing/subscriptions?plan=enterprise'),
      );
      expect(enterprise.data).toEqual([]);

      // limit=1 walks every row once, in order.
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: { data: Array<{ license_id: string }>; next_cursor: string | null } = await ok(
          call('GET', `/billing/subscriptions?limit=1${cursor ? `&cursor=${cursor}` : ''}`),
        );
        seen.push(...page.data.map((row) => row.license_id));
        cursor = page.next_cursor;
      } while (cursor);
      expect(seen).toEqual(all.data.map((row) => row.license_id));
      const firstPage = await ok<{ next_cursor: string }>(
        call('GET', '/billing/subscriptions?limit=1'),
      );
      await refused(
        call('GET', `/billing/subscriptions?past_due=true&cursor=${firstPage.next_cursor}`),
        400,
        'validation',
      );
      await refused(call('GET', '/billing/subscriptions?cursor=garbage'), 400, 'validation');
    });

    it('lists issued statements and revenue from the closed periods exactly, downloads one as the workspace’s CSV, and counts this period’s packages', async () => {
      await activate(fx.a, 2);
      await meter(fx.a, justClosed);
      await meter(fx.b, justClosed);
      await sweep();
      await owner.apiPackagePurchase.create({
        data: {
          licenseId: fx.a.licenseId,
          packageId: 'essential',
          apiCalls: 100_000n,
          priceCents: 2_999,
          period: open,
        },
      });

      const list = await ok<{ data: Array<Record<string, unknown>> }>(
        call('GET', `/billing/invoices?license_id=${fx.a.licenseId}`, undefined, 'support'),
      );
      expect(list.data).toHaveLength(1);
      expect(list.data[0]).toMatchObject({
        license_id: fx.a.licenseId.toString(),
        period: justClosed,
        origin: 'issued',
        status: 'paid',
        currency: 'usd',
        subtotal_cents: 19_800,
        credit_cents: 0,
        total_cents: 19_800,
      });
      const trials = await ok<{ data: Array<{ license_id: string }> }>(
        call('GET', '/billing/invoices?status=trial'),
      );
      expect(trials.data.map((row) => row.license_id)).toEqual([fx.b.licenseId.toString()]);

      const csv = await platform.app.inject({
        method: 'GET',
        url: `${PLATFORM_PREFIX}/billing/invoices/${list.data[0]!['id']}/download`,
        headers: bearer(tokens.get('readonly')!),
      });
      expect(csv.statusCode).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.body).toContain('Total,19800');
      await refused(call('GET', '/billing/invoices/not-a-uuid/download'), 404);
      await refused(
        call('GET', '/billing/invoices/00000000-0000-4000-8000-000000000000/download'),
        404,
      );

      const revenue = await ok<{
        months: Array<Record<string, unknown>>;
        open_period: Record<string, unknown>;
      }>(call('GET', '/billing/revenue?months=3', undefined, 'billing'));
      // Oldest first, the open period never among them.
      expect(revenue.months.map((month) => month.period)).toEqual([
        previousPeriod(older),
        older,
        justClosed,
      ]);
      const closedMonth = revenue.months.find((month) => month.period === justClosed);
      // Only paid statements count; B's trial month owed nothing.
      expect(closedMonth).toMatchObject({
        currency: 'usd',
        invoices: 1,
        subtotal_cents: 19_800,
        credit_cents: 0,
        total_cents: 19_800,
      });
      expect(revenue.months.every((month) => month.period !== open)).toBe(true);
      expect(revenue.open_period).toEqual({ period: open, package_purchases_cents: 2_999 });
      await refused(call('GET', '/billing/revenue?months=0'), 400, 'validation');
      await refused(call('GET', '/billing/revenue?months=37'), 400, 'validation');

      const packages = await ok<{
        api_packages: Array<{ id: string; sold: { count: number; revenue_cents: number } }>;
      }>(call('GET', '/billing/packages'));
      expect(packages.api_packages.find((entry) => entry.id === 'essential')?.sold).toEqual({
        count: 1,
        revenue_cents: 2_999,
      });
    });

    it('grants a credit as billing, never as support or readonly, in USD only, on both trails', async () => {
      const created = await ok<{ credit: Record<string, unknown> }>(grant(fx.a, 5_000), 201);
      expect(created.credit).toMatchObject({
        license_id: fx.a.licenseId.toString(),
        amount_minor: 5_000,
        currency: 'USD',
        reason: REASON,
        invoice_id: null,
        remainder_of: null,
      });
      const entry = await expectDoubleEntry(fx.a, 'billing.credit_granted');
      expect(entry).toMatchObject({ targetType: 'credit', targetId: created.credit['id'] });

      await refused(grant(fx.a, 5_000, 'support'), 403);
      await refused(grant(fx.a, 5_000, 'readonly'), 403);
      await refused(
        call('POST', '/billing/credits', {
          license_id: fx.a.licenseId.toString(),
          amount_minor: 5_000,
          currency: 'EUR',
          ...reason,
        }),
        400,
        'validation',
        'currency_mismatch',
      );
      await refused(
        call('POST', '/billing/credits', {
          license_id: fx.a.licenseId.toString(),
          amount_minor: 5_000,
          currency: 'USD',
        }),
        400,
      );
      await refused(
        call('POST', '/billing/credits', {
          license_id: '999999',
          amount_minor: 5_000,
          currency: 'USD',
          ...reason,
        }),
        404,
      );
      await refused(grant(fx.a, 0), 400, 'validation');
      expect(await owner.platformCredit.count()).toBe(1);

      const listed = await ok<{ data: Array<{ id: string }> }>(
        call(
          'GET',
          `/billing/credits?license_id=${fx.a.licenseId}&open=true`,
          undefined,
          'support',
        ),
      );
      expect(listed.data.map((row) => row.id)).toEqual([created.credit['id']]);
    });

    it('takes a credit off the next statement as a negative line, never below zero — the rest carries to the next one, once', async () => {
      await activate(fx.a, 2); // $198.00 a month
      await meter(fx.a, older);
      await meter(fx.a, justClosed);
      await meter(fx.b, justClosed); // B is on trial: owes nothing, takes nothing
      await ok(grant(fx.a, 25_000), 201);
      await ok(grant(fx.b, 1_000), 201);

      await sweep();

      const first = await statement(fx.a, older);
      expect(first).toMatchObject({ subtotalCents: 19_800, totalCents: 0, status: 'paid' });
      expect(first!.lineItems.at(-1)).toMatchObject({
        description: 'Account credit',
        amountCents: -19_800,
      });
      const second = await statement(fx.a, justClosed);
      expect(second).toMatchObject({ subtotalCents: 19_800, totalCents: 14_600 });
      expect(second!.lineItems.at(-1)).toMatchObject({
        description: 'Account credit',
        amountCents: -5_200,
      });

      const credits = await owner.platformCredit.findMany({
        where: { licenseId: fx.a.licenseId },
        orderBy: { amountMinor: 'desc' },
      });
      expect(credits.map((c) => [Number(c.amountMinor), c.invoiceId])).toEqual([
        [19_800, first!.id],
        [5_200, second!.id],
      ]);
      expect(credits[1]!.remainderOf).toBe(credits[0]!.id);

      const trial = await statement(fx.b, justClosed);
      expect(trial).toMatchObject({ status: 'trial', totalCents: 0 });
      expect(trial!.lineItems.some((line) => line.platformCreditId !== null)).toBe(false);
      expect(
        await owner.platformCredit.findFirst({ where: { licenseId: fx.b.licenseId } }),
      ).toMatchObject({
        invoiceId: null,
      });

      // Again: nothing more is taken — not by a second pass, not by a direct call.
      await sweep();
      expect(
        await owner.invoiceLineItem.count({ where: { platformCreditId: { not: null } } }),
      ).toBe(2);
      const again = await withTenant(
        appRole,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) =>
          tx.$queryRaw<Array<{ applied: bigint }>>`
            SELECT billing_apply_platform_credits(${second!.id}::uuid) AS applied`,
      );
      expect(Number(again[0]!.applied)).toBe(0);
      // Another workspace's statement is not there at all.
      await expect(
        withTenant(
          appRole,
          { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId },
          (tx) => tx.$queryRaw`SELECT billing_apply_platform_credits(${second!.id}::uuid)`,
        ),
      ).rejects.toThrow(/no such invoice/);

      // The workspace reads its own statement with the credit on it.
      const view = await ok<{ data: Array<Record<string, unknown>> }>(
        call('GET', `/billing/invoices?license_id=${fx.a.licenseId}&period=${justClosed}`),
      );
      expect(view.data[0]).toMatchObject({ credit_cents: 5_200, total_cents: 14_600 });
      const revenue = await ok<{ months: Array<Record<string, unknown>> }>(
        call('GET', '/billing/revenue?months=2'),
      );
      expect(revenue.months.find((m) => m.period === older)).toMatchObject({
        subtotal_cents: 19_800,
        credit_cents: 19_800,
        total_cents: 0,
      });
    });

    it('applies one credit once when two closes race on separate connections', async () => {
      await activate(fx.a, 2);
      await meter(fx.a, older);
      await meter(fx.a, justClosed);
      await ok(grant(fx.a, 30_000), 201);

      const second = new PrismaClient({ datasourceUrl: APP_URL });
      try {
        await Promise.all([appRole.$connect(), second.$connect()]);
        await Promise.all([sweep(appRole), sweep(second)]);
      } finally {
        await second.$disconnect();
      }

      const statements = await owner.invoice.findMany({
        where: { licenseId: fx.a.licenseId },
        include: { lineItems: true },
      });
      expect(statements).toHaveLength(2);
      const creditLines = statements.flatMap((s) =>
        s.lineItems.filter((line) => line.platformCreditId !== null),
      );
      const taken = -creditLines.reduce((sum, line) => sum + line.amountCents, 0);
      expect(taken).toBe(30_000);
      expect(new Set(creditLines.map((line) => line.platformCreditId)).size).toBe(
        creditLines.length,
      );
      const rows = await owner.platformCredit.findMany({ where: { licenseId: fx.a.licenseId } });
      expect(rows.reduce((sum, row) => sum + Number(row.amountMinor), 0)).toBe(30_000);
      expect(rows.filter((row) => row.invoiceId === null)).toEqual([]);
      for (const s of statements) {
        expect(s.totalCents).toBe(
          s.subtotalCents +
            s.lineItems
              .filter((line) => line.platformCreditId !== null)
              .reduce((sum, line) => sum + line.amountCents, 0),
        );
      }
    });

    it('subscribes a workspace by hand: active licence, the plan until period_end, both trails', async () => {
      const periodEnd = new Date(clock.now + 30 * DAY).toISOString();
      const body = {
        license_id: fx.a.licenseId.toString(),
        plan: 'enterprise',
        period_end: periodEnd,
        seats: 5,
        ...reason,
      };
      await refused(call('POST', '/billing/manual-subscription', body, 'support'), 403);
      const result = await ok<{
        unchanged: boolean;
        workspace: { license: Record<string, unknown> };
      }>(call('POST', '/billing/manual-subscription', body, 'billing'));
      expect(result.unchanged).toBe(false);
      expect(result.workspace.license).toMatchObject({ status: 'active', trial_ends_at: null });
      const subscription = await owner.subscription.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
        orderBy: { createdAt: 'desc' },
      });
      expect(subscription).toMatchObject({
        plan: 'enterprise',
        status: 'active',
        seats: 5,
        cancelAtPeriodEnd: false,
      });
      expect(subscription.currentPeriodEnd?.toISOString()).toBe(periodEnd);
      const entry = await expectDoubleEntry(fx.a, 'billing.manual_subscription_created');
      expect(entry.payload).toMatchObject({ plan: 'enterprise', from_status: 'trialing' });

      await refused(
        call('POST', '/billing/manual-subscription', {
          ...body,
          license_id: fx.b.licenseId.toString(),
          period_end: new Date(clock.now - DAY).toISOString(),
        }),
        400,
        'validation',
        'period_end_past',
      );
      await owner.license.update({ where: { id: fx.b.licenseId }, data: { status: 'canceled' } });
      await refused(
        call('POST', '/billing/manual-subscription', {
          ...body,
          license_id: fx.b.licenseId.toString(),
        }),
        409,
        'platform_workspace_state',
        'workspace_closed',
      );
      await refused(
        call('POST', '/billing/manual-subscription', { ...body, license_id: '999999' }),
        404,
      );
    });
  });

  // ==========================================================================
  // 4. Usage and the daily AI allowance
  // ==========================================================================

  describe('usage and the daily AI allowance', () => {
    const DEFAULT_CAP = 200_000;
    const OVERRIDE = 500_000;
    const today = () => utcDayKey(new Date());

    async function seedUsage(licenseId: bigint | null, used: number, meter = 'llm') {
      await owner.aiDailyUsage.create({
        data: { licenseId, day: today(), meter, used: BigInt(used) },
      });
    }

    beforeEach(async () => {
      clock.now = Date.now();
      fx = await seedFixtures(owner);
      await signInEveryRole();
    });

    it('reports each cap layer, writes the override as billing only, refuses a past end, and records nothing for the same values', async () => {
      const path = `/usage/workspaces/${fx.a.licenseId}`;
      const before = await ok<{ caps: Record<string, unknown> }>(
        call('GET', path, undefined, 'support'),
      );
      expect(before.caps).toEqual({
        llm: {
          effective: DEFAULT_CAP,
          source: 'deployment',
          override: null,
          plan: null,
          deployment: DEFAULT_CAP,
        },
        embedding: expect.objectContaining({ source: 'deployment', override: null }),
        expires_at: null,
        in_force: false,
      });

      const expires = new Date(clock.now + 7 * DAY).toISOString();
      const put = (body: Record<string, unknown>, role: PlatformRole = 'billing') =>
        call('PUT', `${path}/ai-caps`, { ...body, ...reason }, role);
      const body = {
        llm_daily_tokens_cap: OVERRIDE,
        embedding_daily_tokens_cap: null,
        expires_at: expires,
      };
      await refused(put(body, 'support'), 403);
      await refused(put(body, 'readonly'), 403);
      const changed = await ok<{ unchanged: boolean; usage: { caps: Record<string, unknown> } }>(
        put(body),
      );
      expect(changed.unchanged).toBe(false);
      expect(changed.usage.caps).toMatchObject({
        llm: { effective: OVERRIDE, source: 'override', override: OVERRIDE },
        embedding: { source: 'deployment', override: null },
        expires_at: expires,
        in_force: true,
      });
      const entry = await expectDoubleEntry(fx.a, 'workspace.ai_caps_changed');
      expect(entry.payload).toMatchObject({
        changed: ['llm', 'expires_at'],
        to: { llm: OVERRIDE, embedding: null, expires_at: expires },
      });
      expect(
        await owner.license.findUniqueOrThrow({
          where: { id: fx.a.licenseId },
          select: { aiDailyLlmTokensCap: true, aiDailyCapsExpiresAt: true },
        }),
      ).toEqual({ aiDailyLlmTokensCap: BigInt(OVERRIDE), aiDailyCapsExpiresAt: new Date(expires) });
      // B is untouched.
      expect(
        (
          await ok<{ caps: { llm: { source: string } } }>(
            call('GET', `/usage/workspaces/${fx.b.licenseId}`),
          )
        ).caps.llm.source,
      ).toBe('deployment');

      const again = await ok<{ unchanged: boolean }>(put(body));
      expect(again.unchanged).toBe(true);
      expect(
        await owner.platformAuditLog.count({ where: { action: 'workspace.ai_caps_changed' } }),
      ).toBe(1);

      await refused(
        put({ ...body, expires_at: new Date(clock.now - DAY).toISOString() }),
        400,
        'validation',
        'expires_at_past',
      );
      await refused(
        put({ llm_daily_tokens_cap: null, embedding_daily_tokens_cap: null, expires_at: expires }),
        400,
        'validation',
        'expires_without_override',
      );
      await refused(put({ ...body, llm_daily_tokens_cap: 0 }), 400, 'validation');
      await refused(put({ llm_daily_tokens_cap: OVERRIDE }), 400, 'validation');
      await refused(call('PUT', `${path}/ai-caps`, body, 'billing'), 400);
      await refused(call('GET', '/usage/workspaces/abc'), 404);
      await refused(call('GET', '/usage/workspaces/999999'), 404);

      // Removing it: both caps null clears the end date too.
      const cleared = await ok<{ usage: { caps: Record<string, unknown> } }>(
        put({ llm_daily_tokens_cap: null, embedding_daily_tokens_cap: null }),
      );
      expect(cleared.usage.caps).toMatchObject({ expires_at: null, in_force: false });
    });

    it('sets the plans’ defaults under ai.caps, keeps the rest of the key, and every workspace without an override takes them', async () => {
      await owner.platformSetting.create({
        data: { key: 'ai.caps', value: { deployment: { llm: 9 }, plans: {} } },
      });
      const put = (plans: Record<string, unknown>, role: PlatformRole = 'billing') =>
        call('PUT', '/settings/ai-caps', { plans, ...reason }, role);
      await refused(put({ growth: { llm: 250_000, embedding: null } }, 'support'), 403);
      await refused(put({ platinum: { llm: 1, embedding: null } }), 400, 'validation');

      const result = await ok<{ unchanged: boolean; caps: Record<string, unknown> }>(
        put({ growth: { llm: 250_000, embedding: null } }),
      );
      expect(result.unchanged).toBe(false);
      expect(result.caps).toMatchObject({
        plans: [
          { plan: 'growth', set: { llm: 250_000, embedding: null } },
          { plan: 'enterprise', set: { llm: null, embedding: null } },
        ],
        deployment: { llm: DEFAULT_CAP },
      });
      const stored = await owner.platformSetting.findUniqueOrThrow({ where: { key: 'ai.caps' } });
      expect(stored.value).toEqual({
        deployment: { llm: 9 },
        plans: { growth: { llm: 250_000, embedding: null } },
      });
      expect(stored.version).toBe(2);
      const entry = await owner.platformAuditLog.findFirstOrThrow({
        where: { action: 'settings.updated' },
      });
      expect(entry).toMatchObject({ targetType: 'settings', targetId: 'ai.caps', licenseId: null });
      expect(entry.payload).toEqual({ key: 'ai.caps', changed: ['growth.llm'] });

      expect(
        (await ok<{ unchanged: boolean }>(put({ growth: { llm: 250_000, embedding: null } })))
          .unchanged,
      ).toBe(true);

      const detail = await ok<{ caps: { llm: Record<string, unknown> } }>(
        call('GET', `/usage/workspaces/${fx.a.licenseId}`),
      );
      expect(detail.caps.llm).toMatchObject({ effective: 250_000, source: 'plan', plan: 250_000 });
      const plans = await ok<{ data: Array<{ id: string; ai_daily_tokens: unknown }> }>(
        call('GET', '/billing/plans'),
      );
      expect(plans.data[0]!.ai_daily_tokens).toEqual({ llm: 250_000, embedding: null });
    });

    it('shows the deployment’s caps the AI settings stored (tm 389.17) as the last layer, over the environment’s', async () => {
      await owner.platformSetting.create({
        data: {
          key: 'ai.caps',
          value: {
            deployment: {
              llm: { workspace: 120_000, global: 3_000_000 },
              embedding: { workspace: 80_000, global: 2_000_000 },
            },
          },
        },
      });
      const planCaps = await ok<{ deployment: unknown }>(call('GET', '/settings/ai-caps'));
      expect(planCaps.deployment).toEqual({ llm: 120_000, embedding: 80_000 });
      const detail = await ok<{ caps: { llm: Record<string, unknown> } }>(
        call('GET', `/usage/workspaces/${fx.a.licenseId}`),
      );
      expect(detail.caps.llm).toMatchObject({
        effective: 120_000,
        source: 'deployment',
        deployment: 120_000,
      });
      const global = await ok<{ today: { llm: { cap: number } } }>(call('GET', '/usage/global'));
      expect(global.today.llm.cap).toBe(3_000_000);
    });

    it('reports the deployment’s own counter apart from the workspaces’, and the heaviest workspaces with their caps — names and numbers only', async () => {
      await seedUsage(null, 900_000);
      await seedUsage(fx.a.licenseId, 150_000);
      await seedUsage(fx.b.licenseId, 50_000);
      await owner.license.update({
        where: { id: fx.b.licenseId },
        data: { aiDailyLlmTokensCap: 100_000n },
      });
      await owner.usageRecord.create({
        data: {
          licenseId: fx.b.licenseId,
          metric: 'ai_resolutions',
          period: currentPeriod(),
          quantity: 300n,
          included: 200n,
        },
      });

      const global = await ok<{
        series: Array<{ date: string; llm: number }>;
        today: { llm: Record<string, number> };
        period: Record<string, unknown>;
      }>(call('GET', '/usage/global?days=7', undefined, 'readonly'));
      expect(global.series).toHaveLength(7);
      expect(global.series.at(-1)!.llm).toBe(900_000);
      expect(global.today.llm).toEqual({ used: 900_000, reserved: 0, cap: 2_000_000 });
      expect(global.period).toMatchObject({ ai_resolutions: 300 });
      await refused(call('GET', '/usage/global?days=91'), 400, 'validation');

      const top = await ok<{ data: Array<Record<string, unknown>> }>(
        call('GET', '/usage/workspaces?meter=llm&top=5', undefined, 'support'),
      );
      expect(top.data.map((row) => row.license_id)).toEqual([
        fx.a.licenseId.toString(),
        fx.b.licenseId.toString(),
      ]);
      expect(top.data[0]).toMatchObject({ used: 150_000, limit: DEFAULT_CAP, percent: 75 });
      expect(top.data[1]).toMatchObject({ used: 50_000, limit: 100_000, percent: 50 });
      for (const row of top.data) {
        expect(Object.keys(row).sort()).toEqual(
          ['license_id', 'limit', 'organization_name', 'percent', 'plan', 'used'].sort(),
        );
      }
      const resolutions = await ok<{ data: Array<Record<string, unknown>> }>(
        call('GET', '/usage/workspaces?meter=ai_resolutions'),
      );
      expect(resolutions.data).toEqual([
        expect.objectContaining({
          license_id: fx.b.licenseId.toString(),
          used: 300,
          limit: 200,
          percent: 150,
        }),
      ]);
      const text = JSON.stringify([global, top, resolutions]);
      for (const address of [fx.a.ownerEmail, fx.a.agentEmail, fx.b.ownerEmail]) {
        expect(text).not.toContain(address);
      }
      await refused(call('GET', '/usage/workspaces?meter=chats'), 400, 'validation');
    });
  });

  // ==========================================================================
  // 4b. Through the real tenant server
  // ==========================================================================

  describe('the allowance as the tenant API applies it', () => {
    const DEFAULT_CAP = 200_000;
    const OVERRIDE = 500_000;
    const REPLY = 'Written by the scripted model.';

    class ScriptedLlm implements LlmProvider {
      readonly id = 'openai' as const;
      readonly calls: LlmCompletionRequest[] = [];
      async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
        this.calls.push(request);
        return {
          text: asKnowledgeAnswer(REPLY, request),
          usage: { inputTokens: 100, outputTokens: 10 },
        };
      }
    }

    const llm = new ScriptedLlm();
    let tenant: TestServer;
    const today = () => utcDayKey(new Date());
    const seedUsage = (licenseId: bigint, used: number) =>
      owner.aiDailyUsage.create({
        data: { licenseId, day: today(), meter: 'llm', used: BigInt(used) },
      });
    const answered = (asked: { events: Array<{ authorType: string; text: string | null }> }) =>
      asked.events.filter((e) => e.authorType === 'bot').map((e) => e.text);

    /** Ask until the workspace is answered or `ms` runs out; the replies of the last ask. */
    async function askUntilAnswered(ws: Awaited<ReturnType<typeof seedAiWorkspace>>, ms: number) {
      const deadline = Date.now() + ms;
      let reply: Array<string | null> = [];
      do {
        await clearRateLimits(tenant.app);
        reply = answered(await customerAsks(owner, tenant, ws));
        if (reply.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      return reply;
    }

    beforeAll(async () => {
      tenant = await startTestServer({ LOG_LEVEL: 'warn' }, { llm });
      // Once, before the tenant server has cached anyone's caps — the reset
      // restarts licence ids (see ai-tenant-caps.test.ts).
      await seedFixtures(owner);
      clock.now = Date.now();
      await signInEveryRole();
    });

    afterAll(async () => {
      await tenant?.close();
    });

    it('lets X past 200,000 on a 500,000 override set here — within a second of the announcement — while Y stops there', async () => {
      const x = await seedAiWorkspace(owner);
      const y = await seedAiWorkspace(owner);
      await seedUsage(x.licenseId, DEFAULT_CAP);
      await seedUsage(y.licenseId, DEFAULT_CAP);

      // Both refused, and the tenant server now holds X's caps for a minute.
      await clearRateLimits(tenant.app);
      expect(answered(await customerAsks(owner, tenant, x))).toEqual([]);
      expect(llm.calls).toHaveLength(0);

      const started = Date.now();
      await ok(
        call(
          'PUT',
          `/usage/workspaces/${x.licenseId}/ai-caps`,
          { llm_daily_tokens_cap: OVERRIDE, embedding_daily_tokens_cap: null, ...reason },
          'billing',
        ),
      );
      expect(await askUntilAnswered(x, 1_000)).toEqual([REPLY]);
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(llm.calls).toHaveLength(1);

      await clearRateLimits(tenant.app);
      expect(answered(await customerAsks(owner, tenant, y))).toEqual([]);
      expect(llm.calls).toHaveLength(1);
    });

    it('falls back to the plan’s default once the override has ended, and the plan default set here beats the deployment’s', async () => {
      const x = await seedAiWorkspace(owner);
      const y = await seedAiWorkspace(owner);
      await seedUsage(x.licenseId, 300_000);
      await seedUsage(y.licenseId, DEFAULT_CAP);

      await ok(
        call(
          'PUT',
          '/settings/ai-caps',
          { plans: { growth: { llm: 250_000, embedding: null } }, ...reason },
          'billing',
        ),
      );
      // Y is past the deployment's 200,000 but under the plan's 250,000.
      expect(await askUntilAnswered(y, 1_000)).toEqual([REPLY]);

      await ok(
        call(
          'PUT',
          `/usage/workspaces/${x.licenseId}/ai-caps`,
          {
            llm_daily_tokens_cap: OVERRIDE,
            embedding_daily_tokens_cap: null,
            expires_at: new Date(Date.now() + DAY).toISOString(),
            ...reason,
          },
          'billing',
        ),
      );
      expect(await askUntilAnswered(x, 1_000)).toEqual([REPLY]);

      // The override's end passes: X is back on the plan's 250,000 — and past it.
      await owner.license.update({
        where: { id: x.licenseId },
        data: { aiDailyCapsExpiresAt: new Date(Date.now() - 1_000) },
      });
      await publishAiCapsChanged(tenant.app.redis, x.licenseId);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await clearRateLimits(tenant.app);
      expect(answered(await customerAsks(owner, tenant, x))).toEqual([]);
      // The platform reads the end against its own clock.
      clock.now = Date.now();
      const detail = await ok<{ caps: { llm: Record<string, unknown>; in_force: boolean } }>(
        call('GET', `/usage/workspaces/${x.licenseId}`),
      );
      expect(detail.caps.in_force).toBe(false);
      expect(detail.caps.llm).toMatchObject({ effective: 250_000, source: 'plan' });
    });
  });
});
