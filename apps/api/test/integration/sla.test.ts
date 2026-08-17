/**
 * SLA targets, measurement and breach marking (FR-MOD-11.5 · 11.5-d).
 *
 * The requirement is "hedef tanımı + ölçüm + ihlal işareti", and each third has
 * a way of failing that looks fine from the outside:
 *
 *   1. **The target.** Enterprise-only to write, readable on every plan so a
 *      screen can show the upsell — and, the half `11.5-b` proved matters,
 *      *kept but not honoured* after a downgrade. A gate on the write alone
 *      would leave a downgraded workspace measured against targets it stopped
 *      paying for.
 *   2. **The measurement.** A number is plausible whatever it says. The case
 *      that catches a wrong one is `business_hours_only`: an overnight wait that
 *      breaches by the calendar and does not by the rota. Both directions are
 *      asserted, because a clock that never marks passes a one-sided test.
 *   3. **The mark.** Idempotent, since two writers mark — the clock stopping,
 *      and the sweep for a clock still running. And tenant-bound: another
 *      workspace's cases must not appear in this one's misses, which would
 *      manufacture a problem out of nothing.
 *
 * It measures and marks; it does not enforce (§C-A27). Nothing here asserts a
 * re-route or a billing consequence, because there is none.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId, WORK_SCHEDULE_DAYS } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { FileMailer } from '../../src/services/mail/mailer.js';
import type { AgentPrincipal } from '../../src/services/auth/principal.js';
import { SlaSweeper } from '../../src/services/sla/sla-sweep.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  seedSubscription,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Close and send need no cache; the send path's idempotency check is the only user. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface SlaPolicyView {
  first_response_minutes: number | null;
  resolution_minutes: number | null;
  business_hours_only: boolean;
  active: boolean;
  updated_at: string | null;
}

interface ErrorBody {
  error: { type: string; message: string; details?: { entitlement?: string; plan?: string } };
}

describe('SLA targets (FR-MOD-11.5 · 11.5-d)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let mailDir: string;
  let seq = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ctx = (t: TenantFixture) => ({ licenseId: t.licenseId, organizationId: t.organizationId });
  const chats = (): ChatService => new ChatService(appRole, NO_REDIS);

  const adminToken = (t: TenantFixture): Promise<string> =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes: ['access_rules:ro', 'access_rules:rw'],
    });

  /** An agent principal with unrestricted chat write — what a reply arrives as. */
  const agentPrincipal = (t: TenantFixture): AgentPrincipal => ({
    kind: 'agent',
    accountId: t.ownerAccountId,
    licenseId: t.licenseId,
    organizationId: t.organizationId,
    role: 'owner',
    scopes: ['chats--all:rw'],
    tokenId: 'test-token',
    tokenKind: 'pat',
  });

  const breaches = (t: TenantFixture) =>
    owner.slaBreach.findMany({
      where: { licenseId: t.licenseId },
      orderBy: [{ subjectId: 'asc' }, { target: 'asc' }],
    });

  /** Write the policy straight in — the CRUD surface is asserted separately. */
  async function setPolicy(
    t: TenantFixture,
    policy: {
      firstResponseMinutes?: number | null;
      resolutionMinutes?: number | null;
      businessHoursOnly?: boolean;
    },
  ): Promise<void> {
    const data = {
      firstResponseMinutes: policy.firstResponseMinutes ?? null,
      resolutionMinutes: policy.resolutionMinutes ?? null,
      businessHoursOnly: policy.businessHoursOnly ?? false,
    };
    await owner.slaPolicy.upsert({
      where: { licenseId: t.licenseId },
      create: { licenseId: t.licenseId, ...data },
      update: data,
    });
  }

  /**
   * A round-the-clock rota for the tenant's owner: every day, 00:00-23:59 UTC.
   *
   * Used where a suite needs `business_hours_only` on without the calendar being
   * the thing under test — the workspace is open, so open minutes and calendar
   * minutes agree except for the one closed minute a day.
   */
  async function seedSchedule(
    t: TenantFixture,
    slot: { start: string; end: string; days?: readonly string[]; timezone?: string },
  ): Promise<void> {
    const days = slot.days ?? WORK_SCHEDULE_DAYS;
    await owner.workSchedule.upsert({
      where: { licenseId_agentId: { licenseId: t.licenseId, agentId: t.ownerAccountId } },
      create: {
        licenseId: t.licenseId,
        agentId: t.ownerAccountId,
        timezone: slot.timezone ?? 'UTC',
        schedule: WORK_SCHEDULE_DAYS.map((day) => ({
          day,
          start: slot.start,
          end: slot.end,
          enabled: days.includes(day),
        })),
      },
      update: {
        timezone: slot.timezone ?? 'UTC',
        schedule: WORK_SCHEDULE_DAYS.map((day) => ({
          day,
          start: slot.start,
          end: slot.end,
          enabled: days.includes(day),
        })),
      },
    });
  }

  /**
   * An active chat that started at a chosen instant.
   *
   * Seeded as the owner (RLS-exempt) so a scenario can place the clock's start
   * exactly where it wants to probe a boundary — the same reason the chat
   * timeout suite seeds rather than drives.
   */
  async function seedChat(
    t: TenantFixture,
    createdAt: Date,
  ): Promise<{ chatId: string; threadId: string }> {
    seq += 1;
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: `sla-customer-${seq}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: customer.id,
        active: true,
        createdAt,
      },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, active: true, createdAt },
    });
    // The agent has to be able to see the chat to reply to it; unrestricted
    // scopes make the access row unnecessary, but the customer row is what
    // `serialiseChat` and the transcript mail read.
    await owner.chatUser.create({
      data: { chatId, userId: customer.id, userType: 'customer', present: true },
    });
    return { chatId, threadId };
  }

  async function seedTicket(t: TenantFixture, createdAt: Date): Promise<string> {
    seq += 1;
    const id = generateShortId();
    await owner.ticket.create({
      data: {
        id,
        licenseId: t.licenseId,
        subject: `sla-ticket-${seq}`,
        status: 'open',
        createdAt,
      },
    });
    return id;
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    await clearRateLimits(server.app);
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-sla-mail-'));
    seq = 0;
  });

  afterEach(async () => {
    await rm(mailDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // 1. The target: who may set it, and what a downgrade does to it
  // ==========================================================================

  it('reads as no targets, and inactive, for a workspace that never saved any', async () => {
    const token = await adminToken(fx.a);
    const response = await server.get('/settings/sla', auth(token));

    expect(response.statusCode).toBe(200);
    expect(response.json() as SlaPolicyView).toEqual({
      first_response_minutes: null,
      resolution_minutes: null,
      business_hours_only: false,
      active: false,
      updated_at: null,
    });
    // Reading creates nothing — the same "no side effect" shape the rest of
    // /settings uses for a setting nobody has touched.
    expect(await owner.slaPolicy.findUnique({ where: { licenseId: fx.a.licenseId } })).toBeNull();
  });

  it('saves targets on Enterprise and reports them as active', async () => {
    const token = await adminToken(fx.a);
    const response = await server.put(
      '/settings/sla',
      { first_response_minutes: 30, resolution_minutes: 480, business_hours_only: true },
      auth(token),
    );

    expect(response.statusCode).toBe(200);
    const body = response.json() as SlaPolicyView;
    expect(body.first_response_minutes).toBe(30);
    expect(body.resolution_minutes).toBe(480);
    expect(body.business_hours_only).toBe(true);
    expect(body.active).toBe(true);
    expect(body.updated_at).not.toBeNull();

    // The values, not just the field names: "what were we promising, and since
    // when" is the question a month of unexpected breaches raises.
    const entry = await owner.auditLogEntry.findFirst({
      where: { licenseId: fx.a.licenseId, action: 'settings.sla_updated' },
    });
    expect(entry?.metadata).toMatchObject({
      first_response_minutes: 30,
      resolution_minutes: 480,
      business_hours_only: true,
    });
  });

  it('refuses the write on a plan without the sla entitlement, but not the read', async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const token = await adminToken(fx.a);

    const write = await server.put(
      '/settings/sla',
      { first_response_minutes: 30, resolution_minutes: null, business_hours_only: false },
      auth(token),
    );
    expect(write.statusCode).toBe(403);
    expect((write.json() as ErrorBody).error.details).toMatchObject({
      entitlement: 'sla',
      plan: 'growth',
    });

    // The read stays open: a settings page that 403s where the upsell belongs is
    // a worse product and no more secure.
    const read = await server.get('/settings/sla', auth(token));
    expect(read.statusCode).toBe(200);
    expect((read.json() as SlaPolicyView).active).toBe(false);
  });

  it('rejects a target of zero rather than reading it as "off"', async () => {
    // Null means "do not measure this clock". A client that conflated the two
    // would mark every conversation in the workspace as breached on arrival.
    const token = await adminToken(fx.a);
    const response = await server.put(
      '/settings/sla',
      { first_response_minutes: 0, resolution_minutes: null, business_hours_only: false },
      auth(token),
    );
    expect(response.statusCode).toBe(400);
  });

  it('keeps the saved targets after a downgrade but stops honouring them', async () => {
    // §C-A26 both ways: the row survives so a re-upgrade finds the workspace's
    // configuration, and `active` is how the screen says it is not in force.
    const token = await adminToken(fx.a);
    await server.put(
      '/settings/sla',
      { first_response_minutes: 30, resolution_minutes: null, business_hours_only: false },
      auth(token),
    );

    await owner.subscription.deleteMany({ where: { licenseId: fx.a.licenseId } });
    await seedSubscription(owner, fx.a.licenseId, 'growth');

    const read = await server.get('/settings/sla', auth(token));
    const body = read.json() as SlaPolicyView;
    expect(body.first_response_minutes).toBe(30);
    expect(body.active).toBe(false);

    // And nothing is measured: an unanswered chat well past the target marks
    // nothing at all.
    const now = new Date();
    await seedChat(fx.a, new Date(now.getTime() - 5 * HOUR));
    const report = await new SlaSweeper(appRole, new FileMailer(mailDir)).run({ now });
    expect(report.tenants.find((r) => r.licenseId === fx.a.licenseId.toString())?.measured).toBe(
      false,
    );
    expect(await breaches(fx.a)).toHaveLength(0);
  });

  // ==========================================================================
  // 2. Measurement — the first-response clock
  // ==========================================================================

  it('marks a breach when the first reply lands past the target', async () => {
    const now = new Date();
    await setPolicy(fx.a, { firstResponseMinutes: 30 });
    const { chatId, threadId } = await seedChat(fx.a, new Date(now.getTime() - 2 * HOUR));

    await chats().sendEvent(ctx(fx.a), agentPrincipal(fx.a), chatId, {
      type: 'message',
      text: 'sorry for the wait',
      recipients: 'all',
    });

    const rows = await breaches(fx.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectType: 'thread',
      subjectId: threadId,
      target: 'first_response',
      targetMinutes: 30,
      businessHoursOnly: false,
    });
    expect(rows[0]?.elapsedMinutes).toBeGreaterThanOrEqual(120);
    // Marked, not enforced: the conversation is untouched.
    expect((await owner.thread.findUnique({ where: { id: threadId } }))?.active).toBe(true);
  });

  it('marks nothing when the first reply lands inside the target', async () => {
    const now = new Date();
    await setPolicy(fx.a, { firstResponseMinutes: 30 });
    const { chatId } = await seedChat(fx.a, new Date(now.getTime() - 5 * MINUTE));

    await chats().sendEvent(ctx(fx.a), agentPrincipal(fx.a), chatId, {
      type: 'message',
      text: 'right away',
      recipients: 'all',
    });

    expect(await breaches(fx.a)).toHaveLength(0);
  });

  it('does not count time outside business hours when the policy says so', async () => {
    // The case the flag exists for. The wait is real by the calendar and mostly
    // outside the rota; asserting only the negative would pass on a clock that
    // never marks, so the same wait is measured with the flag off as well.
    const now = new Date();
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    // A window that opened ten minutes ago, in UTC, enabled on **today's weekday
    // only** — so "now" is inside business hours and everything before it is not.
    //
    // Enabling every day read as equivalent and was not. A work schedule is a
    // standing week (`business-hours.ts`), so yesterday carried the same window,
    // and a run started in the small hours of a UTC day measured a six-hour wait
    // that had spent most of itself inside yesterday's copy of it. Before 00:10
    // UTC it was worse: `openedAt` clamped to 0, opening the calendar outright.
    // Either way the assertion was a function of the wall clock rather than of
    // the code under test — it failed at 00:04 UTC on 2026-08-17 (tm 126 · §D106).
    const openedAt = Math.max(0, nowMinutes - 10);
    const pad = (value: number): string => String(value).padStart(2, '0');
    const start = `${pad(Math.floor(openedAt / 60))}:${pad(openedAt % 60)}`;
    const today = WORK_SCHEDULE_DAYS[(now.getUTCDay() + 6) % 7] as string;
    await seedSchedule(fx.a, { start, end: '23:59', days: [today] });
    await setPolicy(fx.a, { firstResponseMinutes: 30, businessHoursOnly: true });

    const { chatId } = await seedChat(fx.a, new Date(now.getTime() - 6 * HOUR));
    await chats().sendEvent(ctx(fx.a), agentPrincipal(fx.a), chatId, {
      type: 'message',
      text: 'first thing this morning',
      recipients: 'all',
    });
    expect(await breaches(fx.a)).toHaveLength(0);

    // Same six-hour wait, business hours off: now it is a breach.
    await setPolicy(fx.a, { firstResponseMinutes: 30, businessHoursOnly: false });
    const second = await seedChat(fx.a, new Date(now.getTime() - 6 * HOUR));
    await chats().sendEvent(ctx(fx.a), agentPrincipal(fx.a), second.chatId, {
      type: 'message',
      text: 'first thing this morning',
      recipients: 'all',
    });
    const rows = await breaches(fx.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectId).toBe(second.threadId);
  });

  it('marks a missed first response when the chat is archived with no reply at all', async () => {
    // The clock stops without ever being answered. Nothing else in the request
    // lifecycle would notice this one.
    const now = new Date();
    await setPolicy(fx.a, { firstResponseMinutes: 30 });
    const { chatId, threadId } = await seedChat(fx.a, new Date(now.getTime() - 3 * HOUR));

    await chats().deactivateByTimeout(ctx(fx.a), chatId, now);

    const rows = await breaches(fx.a);
    expect(rows.map((row) => row.target)).toEqual(['first_response']);
    expect(rows[0]?.subjectId).toBe(threadId);
  });

  // ==========================================================================
  // 3. Measurement — the resolution clock
  // ==========================================================================

  it('marks a resolution breach when a chat closes past its target', async () => {
    const now = new Date();
    await setPolicy(fx.a, { resolutionMinutes: 60 });
    const { chatId, threadId } = await seedChat(fx.a, new Date(now.getTime() - 3 * HOUR));

    await chats().deactivateByTimeout(ctx(fx.a), chatId, now);

    const rows = await breaches(fx.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectType: 'thread',
      subjectId: threadId,
      target: 'resolution',
      targetMinutes: 60,
    });
  });

  it('marks a resolution breach when a ticket is solved past its target', async () => {
    const now = new Date();
    await setPolicy(fx.a, { resolutionMinutes: 60 });
    const ticketId = await seedTicket(fx.a, new Date(now.getTime() - 5 * HOUR));
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:rw'],
    });

    const solved = await server.patch(`/tickets/${ticketId}`, { status: 'solved' }, auth(token));
    expect(solved.statusCode).toBe(200);

    const rows = await breaches(fx.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectType: 'ticket',
      subjectId: ticketId,
      target: 'resolution',
    });

    // Editing an already-resolved ticket does not resolve it again, and the
    // unique key would drop the row even if it tried.
    const edited = await server.patch(`/tickets/${ticketId}`, { status: 'closed' }, auth(token));
    expect(edited.statusCode).toBe(200);
    expect(await breaches(fx.a)).toHaveLength(1);
  });

  it('does not run a first-response clock on a ticket', async () => {
    // Deliberate: nothing in this repo records an agent *replying* to a ticket,
    // so reporting an assignment or a status change as a "first response" would
    // be a wrong number that looks right.
    const now = new Date();
    await setPolicy(fx.a, { firstResponseMinutes: 5, resolutionMinutes: 60 });
    await seedTicket(fx.a, new Date(now.getTime() - 5 * HOUR));

    const report = await new SlaSweeper(appRole, new FileMailer(mailDir)).run({ now });
    expect(report.totals.marked).toBe(1);
    expect((await breaches(fx.a)).map((row) => row.target)).toEqual(['resolution']);
  });

  // ==========================================================================
  // 4. The sweep: clocks that are still running
  // ==========================================================================

  it('marks a chat that is still waiting past its first-response target, and announces it', async () => {
    const now = new Date();
    await setPolicy(fx.a, { firstResponseMinutes: 30 });
    const { threadId } = await seedChat(fx.a, new Date(now.getTime() - 2 * HOUR));

    const mailer = new FileMailer(mailDir);
    const report = await new SlaSweeper(appRole, mailer).run({ now });

    const result = report.tenants.find((r) => r.licenseId === fx.a.licenseId.toString());
    expect(result).toMatchObject({ measured: true, marked: 1, notified: 1 });

    const rows = await breaches(fx.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectId).toBe(threadId);
    expect(rows[0]?.notifiedAt).not.toBeNull();

    const outbox = await mailer.outbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe(fx.a.ownerEmail);
    expect(outbox[0]?.body).toContain(threadId);
    // The alert says what the feature does, so nobody reads it as "we rerouted".
    expect(outbox[0]?.body).toContain('does not re-route');
  });

  it('is idempotent: a second sweep marks nothing and sends nothing', async () => {
    const now = new Date();
    await setPolicy(fx.a, { firstResponseMinutes: 30 });
    await seedChat(fx.a, new Date(now.getTime() - 2 * HOUR));

    const mailer = new FileMailer(mailDir);
    await new SlaSweeper(appRole, mailer).run({ now });
    const second = await new SlaSweeper(appRole, mailer).run({ now });

    expect(second.totals.marked).toBe(0);
    expect(second.totals.notified).toBe(0);
    expect(await breaches(fx.a)).toHaveLength(1);
    expect(await mailer.outbox()).toHaveLength(1);
  });

  it('marks a breach once, whichever writer gets there first', async () => {
    // The sweep marks the waiting chat; the agent then replies, and the clock
    // stopping would mark the same miss again without the unique key.
    const now = new Date();
    await setPolicy(fx.a, { firstResponseMinutes: 30 });
    const { chatId } = await seedChat(fx.a, new Date(now.getTime() - 2 * HOUR));

    await new SlaSweeper(appRole, new FileMailer(mailDir)).run({ now });
    await chats().sendEvent(ctx(fx.a), agentPrincipal(fx.a), chatId, {
      type: 'message',
      text: 'finally',
      recipients: 'all',
    });

    expect(await breaches(fx.a)).toHaveLength(1);
  });

  // ==========================================================================
  // 5. Tenant isolation
  // ==========================================================================

  it("never marks another workspace against this one's targets", async () => {
    // A promises a 30-minute first response; B promises nothing. B's overdue
    // conversations are not A's misses, and are not B's either.
    const now = new Date();
    await setPolicy(fx.a, { firstResponseMinutes: 30 });
    await seedChat(fx.a, new Date(now.getTime() - 2 * HOUR));
    await seedChat(fx.b, new Date(now.getTime() - 9 * HOUR));

    const report = await new SlaSweeper(appRole, new FileMailer(mailDir)).run({ now });

    expect(report.tenants.find((r) => r.licenseId === fx.b.licenseId.toString())?.measured).toBe(
      false,
    );
    expect(await breaches(fx.a)).toHaveLength(1);
    expect(await breaches(fx.b)).toHaveLength(0);
  });

  it("hides one workspace's breaches from another under RLS", async () => {
    const now = new Date();
    await setPolicy(fx.a, { firstResponseMinutes: 30 });
    await seedChat(fx.a, new Date(now.getTime() - 2 * HOUR));
    await new SlaSweeper(appRole, new FileMailer(mailDir)).run({ now });

    // Not "filtered by a WHERE the service remembered" — B's own tenant context,
    // against the app role, sees nothing at all.
    const seenByB = await withTenant(appRole, ctx(fx.b), (tx) => tx.slaBreach.findMany());
    expect(seenByB).toHaveLength(0);

    const seenByA = await withTenant(appRole, ctx(fx.a), (tx) => tx.slaBreach.findMany());
    expect(seenByA).toHaveLength(1);
  });
});
