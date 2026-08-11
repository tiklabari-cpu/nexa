/**
 * Presence event log and the schedule-vs-status priority rule
 * (PRD §5.3-Vardiya, WORKSCHED-d).
 *
 * Two claims are under test, and both are the kind that fail silently.
 *
 *   - **A manual routing status always beats the rostered plan.** A work
 *     schedule says when an agent is *expected*; `routing_status` says whether
 *     they are actually taking chats. Nothing in routing reads the schedule,
 *     and this file is where that stays true: the day someone "helpfully" makes
 *     the roster drive assignment, a rostered agent who deliberately went
 *     offline starts receiving customers, and no type or query fails.
 *   - **Every real change of availability leaves exactly one row, and only if
 *     the change survived.** The log is append-only and nothing reconciles it
 *     afterwards, so a duplicate row, a missing row or a row that outlived a
 *     rolled-back request is permanent — and every one of them still produces a
 *     forecast that looks perfectly reasonable.
 *
 * The negative that matters most comes first, before anything proves the
 * feature works at all.
 */
import { PrismaClient } from '@prisma/client';
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORK_SCHEDULE_DAYS, generateShortId } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import { RoutingService } from '../../src/services/routing/routing-service.js';
import { presenceCoverage } from '../../src/services/staffing/presence-coverage.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** Every day, around the clock — whenever the suite runs, it is "in shift". */
const ALWAYS_ON_SHIFT = WORK_SCHEDULE_DAYS.map((day) => ({
  day,
  start: '00:00',
  end: '23:59',
  enabled: true,
}));

describe('agent presence log (PRD §5.3-Vardiya)', () => {
  let owner: PrismaClient;
  /**
   * The runtime role, `nexa_app`. Isolation has to be attacked from the layer
   * the API actually uses: the owner connection owns these tables and Postgres
   * exempts owners from RLS, so a cross-tenant read through `owner` proves
   * nothing at all.
   */
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let routing: RoutingService;

  let supportId: bigint;
  let adminToken: string;
  /** The ordinary agent of tenant A, holding `agents--my:rw`. */
  let agentToken: string;

  beforeAll(async () => {
    const appUrl = process.env['DATABASE_APP_URL'];
    if (!appUrl) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: appUrl });
    server = await startTestServer();
    routing = new RoutingService();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    supportId = support.id;

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--all:rw', 'agents--all:ro', 'chats--all:rw'],
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents--my:rw'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setStatus = (status: string, token = agentToken) =>
    server.put(
      '/agents/me/routing-status',
      { routing_status: status },
      {
        authorization: `Bearer ${token}`,
      },
    );

  /** Put the agent in the Support team so routing can see them at all. */
  async function joinSupport(agentId: string): Promise<void> {
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: supportId, agentId, priority: 'normal' },
    });
  }

  /** Roster an agent for the given week (defaults to always on shift). */
  async function roster(agentId: string, schedule = ALWAYS_ON_SHIFT): Promise<void> {
    await owner.workSchedule.create({
      data: { licenseId: fx.a.licenseId, agentId, timezone: 'UTC', schedule },
    });
  }

  /** A chat waiting in the Support queue, unassigned. */
  async function queueChat(): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Waiting' },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
    });
    await owner.chatAccess.create({ data: { chatId, groupId: supportId } });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: fx.a.licenseId,
        active: true,
        assigneeId: null,
        queuePosition: 1,
        queuedAt: new Date(),
      },
    });
    return chatId;
  }

  const drain = () =>
    withTenant(owner, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
      routing.drainQueue(tx, fx.a.licenseId),
    );

  const eventsOf = (agentId: string) =>
    owner.agentPresenceEvent.findMany({
      where: { licenseId: fx.a.licenseId, agentId },
      orderBy: { changedAt: 'asc' },
      select: { status: true, changedAt: true },
    });

  // ==========================================================================
  // The priority rule — manual status wins (negative first)
  // ==========================================================================

  describe('scheduled shift vs manual routing status', () => {
    it('does not drain the queue to a rostered agent who is manually offline', async () => {
      // The agent is on shift by every reading of the roster and is the only
      // member of the team with capacity — and still takes nothing, because
      // they said they are not available. If the roster ever starts driving
      // assignment, this is the test that goes red.
      await joinSupport(fx.a.agentAccountId);
      await roster(fx.a.agentAccountId);
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { routingStatus: 'offline' },
      });

      const chatId = await queueChat();
      const assigned = await drain();

      expect(assigned).toEqual([]);
      const thread = await owner.thread.findFirst({
        where: { chatId },
        select: { assigneeId: true },
      });
      expect(thread?.assigneeId).toBeNull();
    });

    it('drains to an accepting agent whose roster marks every day off', async () => {
      // The mirror image, and the half that keeps the rule honest: the schedule
      // does not gate assignment in *either* direction. An agent who logs in on
      // their day off is available, because availability is something they
      // declare, not something the roster grants.
      await joinSupport(fx.a.agentAccountId);
      await roster(
        fx.a.agentAccountId,
        ALWAYS_ON_SHIFT.map((slot) => ({ ...slot, enabled: false })),
      );

      const chatId = await queueChat();
      const assigned = await drain();

      expect(assigned.map((a) => a.chatId)).toEqual([chatId]);
    });
  });

  // ==========================================================================
  // Nothing is written when nothing survived
  // ==========================================================================

  describe('atomicity', () => {
    it('rolls the event back with the status when the drain fails', async () => {
      // The event and the assignment share one transaction precisely so this
      // cannot happen: a log saying "came online at 10:04" for a request that
      // never took effect is indistinguishable, later, from a true one.
      await joinSupport(fx.a.agentAccountId);
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { routingStatus: 'offline' },
      });
      await queueChat();

      vi.spyOn(RoutingService.prototype, 'drainQueue').mockRejectedValueOnce(
        new Error('assignment blew up'),
      );

      const response = await setStatus('accepting_chats');
      expect(response.statusCode).toBeGreaterThanOrEqual(500);

      // Neither half of the write survived.
      expect(await eventsOf(fx.a.agentAccountId)).toEqual([]);
      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        select: { routingStatus: true },
      });
      expect(membership?.routingStatus).toBe('offline');
    });
  });

  // ==========================================================================
  // Cross-tenant (NFR-S4)
  // ==========================================================================

  describe('isolation', () => {
    it('keeps one licence’s presence history out of another’s', async () => {
      const response = await setStatus('not_accepting_chats');
      expect(response.statusCode).toBe(200);
      expect(await eventsOf(fx.a.agentAccountId)).toHaveLength(1);

      // Read back as the runtime role under tenant B's context, asking for
      // *everything*: RLS, not a WHERE clause the caller could forget, is what
      // makes this empty.
      const seenByB = await withTenant(
        app,
        { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId },
        (tx) => tx.agentPresenceEvent.findMany(),
      );
      expect(seenByB).toEqual([]);

      // Tenant A's own context does see it, so the empty result above is
      // isolation and not a broken query.
      const seenByA = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => tx.agentPresenceEvent.findMany(),
      );
      expect(seenByA).toHaveLength(1);

      // …and so the coverage B could derive is `null` — unknown — rather than a
      // grid built from someone else's staffing.
      const coverage = presenceCoverage(
        seenByB.map((e) => ({ agentId: e.agentId, status: e.status, changedAt: e.changedAt })),
        new Date(Date.now() - 86_400_000),
        new Date(Date.now() + 60_000),
      );
      expect(coverage).toBeNull();
    });
  });

  // ==========================================================================
  // One row per real change
  // ==========================================================================

  describe('writing', () => {
    it('writes exactly one event per transition and none for a repeat', async () => {
      // The fixture agent starts `accepting_chats`, so this is a real change.
      expect((await setStatus('offline')).statusCode).toBe(200);
      expect((await eventsOf(fx.a.agentAccountId)).map((e) => e.status)).toEqual(['offline']);

      // Same status again: the UI can send it as often as it likes.
      expect((await setStatus('offline')).statusCode).toBe(200);
      expect(await eventsOf(fx.a.agentAccountId)).toHaveLength(1);

      expect((await setStatus('accepting_chats')).statusCode).toBe(200);
      expect((await setStatus('not_accepting_chats')).statusCode).toBe(200);
      expect((await eventsOf(fx.a.agentAccountId)).map((e) => e.status)).toEqual([
        'offline',
        'accepting_chats',
        'not_accepting_chats',
      ]);
    });

    it('stamps each event with the moment it happened', async () => {
      const before = new Date(Date.now() - 1000);
      expect((await setStatus('offline')).statusCode).toBe(200);
      const after = new Date(Date.now() + 1000);

      const [entry] = await eventsOf(fx.a.agentAccountId);
      expect(entry?.changedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entry?.changedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('records suspension as going offline and reinstatement as coming back', async () => {
      // Routing skips a suspended agent whatever their status says, so the
      // suspension is the moment their coverage stops — and their own setting
      // is untouched, so lifting it returns them to it.
      const suspend = (suspended: boolean) =>
        server.put(
          `/agents/${fx.a.agentAccountId}/suspension`,
          { suspended },
          {
            authorization: `Bearer ${adminToken}`,
          },
        );

      expect((await suspend(true)).statusCode).toBe(200);
      expect((await suspend(false)).statusCode).toBe(200);

      expect((await eventsOf(fx.a.agentAccountId)).map((e) => e.status)).toEqual([
        'offline',
        'accepting_chats',
      ]);
      const membership = await owner.agentMembership.findUnique({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        select: { routingStatus: true, suspended: true },
      });
      expect(membership).toMatchObject({ routingStatus: 'accepting_chats', suspended: false });
    });

    it('writes nothing when suspending an agent who was already offline', async () => {
      expect((await setStatus('offline')).statusCode).toBe(200);

      expect(
        (
          await server.put(
            `/agents/${fx.a.agentAccountId}/suspension`,
            { suspended: true },
            {
              authorization: `Bearer ${adminToken}`,
            },
          )
        ).statusCode,
      ).toBe(200);

      // Their availability did not change — they were already covering nothing.
      expect((await eventsOf(fx.a.agentAccountId)).map((e) => e.status)).toEqual(['offline']);
    });
  });

  // ==========================================================================
  // The log as the forecast will read it
  // ==========================================================================

  describe('coverage', () => {
    it('derives online minutes from the rows the API actually wrote', async () => {
      // End to end on the shape rather than on the numbers: the module is unit
      // tested against known timestamps, so what this proves is that the
      // columns the route writes are the columns it consumes.
      expect((await setStatus('offline')).statusCode).toBe(200);
      expect((await setStatus('accepting_chats')).statusCode).toBe(200);

      const rows = await owner.agentPresenceEvent.findMany({
        where: { licenseId: fx.a.licenseId },
        orderBy: { changedAt: 'asc' },
        select: { agentId: true, status: true, changedAt: true },
      });
      const windowFrom = new Date(Date.now() - 3_600_000);
      const windowTo = new Date(Date.now() + 3_600_000);
      const coverage = presenceCoverage(rows, windowFrom, windowTo);

      expect(coverage).not.toBeNull();
      expect(coverage?.map((c) => c.agentId)).toEqual([fx.a.agentAccountId]);
      expect(coverage?.[0]?.onlineMinutes).toHaveLength(24);
      // They went offline, came back, and are still online — so the window
      // holds real online time, bounded by the window itself and, crucially,
      // not zero.
      const total = (coverage?.[0]?.onlineMinutes ?? []).reduce((sum, m) => sum + m, 0);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual((windowTo.getTime() - windowFrom.getTime()) / 60_000);
    });
  });
});
