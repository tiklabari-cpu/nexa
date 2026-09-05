/**
 * The Team profile panel's two server-side facts (FR-MOD-04.3.4).
 *
 * The audit found the panel missing altogether, and behind it two things that
 * had to be true before a panel could honestly show them:
 *
 *   1. **`accounts.last_seen_at` is written.** It had been in the schema since
 *      the first migration with nothing writing it — `services/reports/
 *      access-review.ts` says so in as many words — so any surface reading it
 *      would have told an admin that every teammate had never been seen.
 *   2. **The concurrent chats limit is editable, and editing it feeds routing.**
 *      That is the acceptance criterion's one measurable sentence, so it is
 *      asserted end to end here: the number is changed through the endpoint the
 *      panel calls, and `RoutingService` is then asked who gets the next chat.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import { RoutingService } from '../../src/services/routing/routing-service.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('teammate profile panel (FR-MOD-04.3.4)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let routing: RoutingService;
  /** Owner-rank caller — enough for everything the individual guards allow. */
  let ownerToken: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
    routing = new RoutingService();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    // `seedFixtures` truncates and re-creates the accounts, so every test gets
    // account ids the `LastSeenRecorder`'s per-process throttle has never seen.
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--all:rw', 'agents--all:ro'],
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const lastSeenOf = async (accountId: string): Promise<Date | null> =>
    (await owner.account.findUnique({ where: { id: accountId }, select: { lastSeenAt: true } }))
      ?.lastSeenAt ?? null;

  // ==========================================================================
  // `last_seen_at` — written, coarsened, and on the roster
  // ==========================================================================

  describe('last seen', () => {
    it('stamps the account after an authenticated request', async () => {
      expect(await lastSeenOf(fx.a.ownerAccountId)).toBeNull();

      const before = Date.now();
      const res = await server.get('/agents', auth(ownerToken));
      expect(res.statusCode).toBe(200);

      const stamped = await lastSeenOf(fx.a.ownerAccountId);
      expect(stamped).not.toBeNull();
      // Within a generous window of the request, not of some later job.
      expect(stamped!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
      expect(stamped!.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    });

    it('two requests in the same second produce one write, not two', async () => {
      // The coarsening decision, asserted where it matters: the stamp is worth
      // a minute of precision, not an UPDATE on every request of a console that
      // polls several times a second.
      await server.get('/agents', auth(ownerToken));
      const first = await lastSeenOf(fx.a.ownerAccountId);

      await server.get('/agents', auth(ownerToken));
      const second = await lastSeenOf(fx.a.ownerAccountId);

      expect(second).toEqual(first);
    });

    it('rewrites the stamp once it is older than the coarsening window', async () => {
      await server.get('/agents', auth(ownerToken));

      // Age the row past the window *and* clear the in-process mark by using a
      // credential the recorder has not seen for this account in this window —
      // there is none, so the row is aged and a second server is used instead.
      const stale = new Date(Date.now() - 10 * 60_000);
      await owner.account.update({
        where: { id: fx.a.ownerAccountId },
        data: { lastSeenAt: stale },
      });

      const second = await startTestServer();
      try {
        await second.get('/agents', auth(ownerToken));
      } finally {
        await second.close();
      }

      const refreshed = await lastSeenOf(fx.a.ownerAccountId);
      expect(refreshed!.getTime()).toBeGreaterThan(stale.getTime());
    });

    it('does not stamp anybody for a bot credential', async () => {
      // A bot token belongs to no person, so there is no honest account to
      // stamp — "last seen" on a roster is a claim about a human being there.
      const bot = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Bot', kind: 'ai_agent', active: true },
        select: { id: true },
      });
      const botToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: bot.id,
        kind: 'bot',
        scopes: ['agents--all:ro'],
      });
      const res = await server.get('/agents', auth(botToken));
      expect(res.statusCode).toBe(200);
      expect(await owner.account.count({ where: { lastSeenAt: { not: null } } })).toBe(0);
    });

    it('carries the stamp on the roster the panel reads', async () => {
      await server.get('/agents', auth(ownerToken));
      const res = await server.get('/agents', auth(ownerToken));

      const body = res.json() as { items: Array<{ id: string; last_seen_at: string | null }> };
      const me = body.items.find((item) => item.id === fx.a.ownerAccountId);
      expect(me?.last_seen_at).toEqual(expect.any(String));
      // Someone who has never made a request reads as `null`, never as a date
      // nobody can account for.
      const other = body.items.find((item) => item.id === fx.a.agentAccountId);
      expect(other?.last_seen_at).toBeNull();
    });
  });

  // ==========================================================================
  // The chat limit — the guards, the write, and the audit entry
  // ==========================================================================

  describe('chat limit', () => {
    const setLimit = (agentId: string, value: unknown, token = ownerToken) =>
      server.put(`/agents/${agentId}/chat-limit`, { concurrent_chats_limit: value }, auth(token));

    const limitOf = async (agentId: string, licenseId = fx.a.licenseId) =>
      (await owner.agentMembership.findFirst({ where: { licenseId, agentId } }))
        ?.concurrentChatsLimit;

    const limitChanges = (agentId: string, licenseId = fx.a.licenseId) =>
      owner.auditLogEntry.count({
        where: { licenseId, action: 'member.chat_limit_changed', target: `account:${agentId}` },
      });

    let seq = 0;
    async function seedTeammate(role: 'admin' | 'agent' | 'viceowner') {
      const account = await owner.account.create({
        data: { email: `${role}-${(seq += 1)}-${Date.now()}@example.test`, name: role },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: fx.a.licenseId, agentId: account.id, role },
      });
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: account.id,
        scopes: ['agents--all:rw'],
      });
      return { accountId: account.id, token };
    }

    it('refuses an agent-role token even with the scope', async () => {
      // Capacity is a staffing decision the workspace makes about a person, not
      // a switch they own — `routing_status` is the one they own.
      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['agents--all:rw'],
      });
      const res = await setLimit(fx.a.agentAccountId, 3, agentToken);
      expect(res.statusCode).toBe(403);
      expect(await limitOf(fx.a.agentAccountId)).toBe(6);
      expect(await limitChanges(fx.a.agentAccountId)).toBe(0);
    });

    it('does not let an admin restaff someone above their own rank', async () => {
      const admin = await seedTeammate('admin');
      const vice = await seedTeammate('viceowner');
      const res = await setLimit(vice.accountId, 1, admin.token);
      expect(res.statusCode).toBe(403);
      expect(await limitOf(vice.accountId)).toBe(6);
      expect(await limitChanges(vice.accountId)).toBe(0);
    });

    it('lets an admin change their own capacity — that is staffing, not escalation', async () => {
      const admin = await seedTeammate('admin');
      const res = await setLimit(admin.accountId, 2, admin.token);
      expect(res.statusCode).toBe(200);
      expect(await limitOf(admin.accountId)).toBe(2);
    });

    it('cannot reach an agent in another workspace', async () => {
      const res = await setLimit(fx.b.agentAccountId, 1);
      expect(res.statusCode).toBe(404);
      expect(await limitOf(fx.b.agentAccountId, fx.b.licenseId)).toBe(6);
    });

    it.each([[0], [51], [2.5], ['six']])('rejects %p with a 400', async (value) => {
      const res = await setLimit(fx.a.agentAccountId, value);
      expect(res.statusCode).toBe(400);
      expect(await limitOf(fx.a.agentAccountId)).toBe(6);
    });

    it('treats setting the limit it already holds as a no-op — 200 and no entry', async () => {
      const res = await setLimit(fx.a.agentAccountId, 6);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: fx.a.agentAccountId, concurrent_chats_limit: 6 });
      expect(await limitChanges(fx.a.agentAccountId)).toBe(0);
    });

    it('writes the new limit and exactly one audit entry', async () => {
      const res = await setLimit(fx.a.agentAccountId, 3);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: fx.a.agentAccountId, concurrent_chats_limit: 3 });
      expect(await limitOf(fx.a.agentAccountId)).toBe(3);
      expect(await limitChanges(fx.a.agentAccountId)).toBe(1);

      const entry = await owner.auditLogEntry.findFirst({
        where: {
          licenseId: fx.a.licenseId,
          action: 'member.chat_limit_changed',
          target: `account:${fx.a.agentAccountId}`,
        },
      });
      expect(entry?.metadata).toMatchObject({ from: 6, to: 3 });
    });
  });

  // ==========================================================================
  // The acceptance criterion itself: "limit yönlendirmeyi besler"
  // ==========================================================================

  describe('the limit feeds routing', () => {
    /** Put an agent in a team so routing can reach them at all. */
    async function staff(agentId: string): Promise<bigint> {
      const group = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      });
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: group.id, agentId, priority: 'normal' },
      });
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId } },
        data: { routingStatus: 'accepting_chats' },
      });
      return group.id;
    }

    /** Give an agent `count` open conversations, exactly as routing counts them. */
    async function loadAgent(agentId: string, count: number): Promise<void> {
      for (let i = 0; i < count; i++) {
        const customer = await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: `Load ${i}` },
          select: { id: true },
        });
        const chatId = generateShortId();
        await owner.chat.create({
          data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
        });
        await owner.thread.create({
          data: {
            id: generateShortId(),
            chatId,
            licenseId: fx.a.licenseId,
            active: true,
            assigneeId: agentId,
          },
        });
      }
    }

    const route = () =>
      withTenant(owner, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
        routing.route(tx, fx.a.licenseId, {}),
      );

    it('a limit lowered through the panel stops the next assignment; raising it resumes', async () => {
      const agentId = fx.a.agentAccountId;
      await staff(agentId);
      await loadAgent(agentId, 2);

      // Only member of the only team, holding two chats. At the schema default
      // of six they are still the answer.
      expect((await route()).assigneeId).toBe(agentId);

      // Lower the ceiling under their current load through the very endpoint the
      // profile panel calls. Nothing else changes.
      const lowered = await server.put(
        `/agents/${agentId}/chat-limit`,
        { concurrent_chats_limit: 2 },
        auth(ownerToken),
      );
      expect(lowered.statusCode).toBe(200);

      const queued = await route();
      expect(queued.assigneeId).toBeNull();
      expect(queued.reason).toBe('queued');

      // And raising it makes them eligible again on the next chat — the same
      // write path, read the same way.
      const raised = await server.put(
        `/agents/${agentId}/chat-limit`,
        { concurrent_chats_limit: 5 },
        auth(ownerToken),
      );
      expect(raised.statusCode).toBe(200);
      expect((await route()).assigneeId).toBe(agentId);
    });
  });
});
