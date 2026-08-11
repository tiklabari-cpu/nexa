/**
 * Home dashboard (FR-MOD-13.1).
 *
 * The screen has three parts and this guards all three, but the one the KK
 * calls out — "canlı gerçek-zaman kartları" — is the live counter, so it gets
 * the most attention: distinct visitors on the site now (an open chat OR a
 * recent visit, unioned so neither double-counts nor misses), conversations
 * open right now, and teammates accepting chats. The counter must be tenant-
 * isolated (another workspace's activity never inflates yours) and must track
 * agent availability, not mere membership.
 *
 * The activation checklist is asserted to be *derived*, not stored — a step is
 * done because the thing it asks for exists — and the weekly summary to count
 * conversations started/resolved this week against last, the same created-in-
 * window basis the Reports overview uses.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HomeDashboard } from '@nexa/types';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('home dashboard', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let readToken: string;
  let seq = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const nextId = (prefix: string, width: number): string => {
    seq += 1;
    return prefix + String(seq).padStart(width - 1, '0');
  };
  const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);
  const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

  async function seedCustomer(t: TenantFixture, name: string): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name },
      select: { id: true },
    });
    return customer.id;
  }

  async function seedVisit(t: TenantFixture, customerId: string, startedAt: Date): Promise<void> {
    await owner.visit.create({
      data: {
        customerId,
        licenseId: t.licenseId,
        pages: [{ url: 'https://shop.example/pricing', at: startedAt.toISOString() }],
        startedAt,
      },
    });
  }

  /** A chat with one thread. `active`/`createdAt` drive the ongoing + weekly counts. */
  async function seedChat(
    t: TenantFixture,
    customerId: string,
    opts: { active?: boolean; createdAt?: Date } = {},
  ): Promise<string> {
    const active = opts.active ?? true;
    const createdAt = opts.createdAt ?? minutesAgo(2);
    const chatId = nextId('c', 12);
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId, active, createdAt },
    });
    await owner.thread.create({
      data: {
        id: nextId('t', 12),
        chatId,
        licenseId: t.licenseId,
        active,
        createdAt,
        // The DB requires a closed thread to carry a closedAt (an active one must
        // not). The count only cares that it is inactive; the timestamp just
        // satisfies threads_closed_consistency_check.
        ...(active ? {} : { closedAt: createdAt }),
      },
    });
    return chatId;
  }

  async function seedRating(
    t: TenantFixture,
    chatId: string,
    value: 'good' | 'bad',
    createdAt: Date,
  ): Promise<void> {
    await owner.rating.create({
      data: { chatId, licenseId: t.licenseId, value, createdAt },
    });
  }

  const getHome = async (
    token = readToken,
  ): Promise<{ statusCode: number; body: HomeDashboard }> => {
    const response = await server.get('/home', auth(token));
    return { statusCode: response.statusCode, body: response.json() as HomeDashboard };
  };

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
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read'],
    });
  });

  // --- Scope -----------------------------------------------------------------

  describe('scope', () => {
    it('serves a caller holding reports_read', async () => {
      const { statusCode } = await getHome();
      expect(statusCode).toBe(200);
    });

    it('rejects a caller without reports_read', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        // A plain agent's read scopes — enough to work the inbox, not the dashboard.
        scopes: ['customers:ro', 'chats--access:rw'],
      });
      const response = await server.get('/home', auth(token));
      expect(response.statusCode).toBe(403);
    });
  });

  // --- Live counters ("canlı gerçek-zaman kartları") -------------------------

  describe('live counters', () => {
    it('counts distinct visitors, ongoing chats and agents online', async () => {
      // One person mid-conversation (open chat), one just browsing (recent
      // visit, no chat). Distinct people = 2; open conversations = 1.
      const chatting = await seedCustomer(fx.a, 'Chatting');
      await seedChat(fx.a, chatting, { active: true, createdAt: minutesAgo(2) });
      const browsing = await seedCustomer(fx.a, 'Browsing');
      await seedVisit(fx.a, browsing, minutesAgo(3));

      const { body } = await getHome();
      expect(body.live).toEqual({
        visitors_online: 2,
        ongoing_chats: 1,
        // The seed makes two memberships, both accepting_chats.
        agents_online: 2,
      });
    });

    it('does not double-count a chatting visitor who also has a recent visit', async () => {
      const person = await seedCustomer(fx.a, 'Both');
      await seedChat(fx.a, person, { active: true, createdAt: minutesAgo(5) });
      await seedVisit(fx.a, person, minutesAgo(1));

      const { body } = await getHome();
      expect(body.live.visitors_online).toBe(1);
      expect(body.live.ongoing_chats).toBe(1);
    });

    it('drops a visit older than the live window', async () => {
      const stale = await seedCustomer(fx.a, 'Left An Hour Ago');
      await seedVisit(fx.a, stale, minutesAgo(45));

      const { body } = await getHome();
      expect(body.live.visitors_online).toBe(0);
    });

    it('excludes a closed chat from ongoing chats', async () => {
      const person = await seedCustomer(fx.a, 'Done');
      await seedChat(fx.a, person, { active: false, createdAt: minutesAgo(10) });

      const { body } = await getHome();
      expect(body.live.ongoing_chats).toBe(0);
    });

    it('counts only teammates accepting chats, not the merely present', async () => {
      // Suspend the agent: they are still a member but cannot take work.
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { suspended: true },
      });
      const suspended = await getHome();
      expect(suspended.body.live.agents_online).toBe(1);

      // Reinstate but go offline: available drops the same way.
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { suspended: false, routingStatus: 'offline' },
      });
      const offline = await getHome();
      expect(offline.body.live.agents_online).toBe(1);
    });

    it("never counts another tenant's live activity", async () => {
      // Tenant A: one live visitor.
      const mine = await seedCustomer(fx.a, 'Mine');
      await seedVisit(fx.a, mine, minutesAgo(1));

      // Tenant B: an open chat and a recent visit, both of which must be invisible
      // to A — and B's two accepting-chats agents must not inflate A's count.
      const theirsChatting = await seedCustomer(fx.b, 'Theirs Chatting');
      await seedChat(fx.b, theirsChatting, { active: true, createdAt: minutesAgo(1) });
      const theirsBrowsing = await seedCustomer(fx.b, 'Theirs Browsing');
      await seedVisit(fx.b, theirsBrowsing, minutesAgo(1));

      const { body } = await getHome();
      expect(body.live).toEqual({ visitors_online: 1, ongoing_chats: 0, agents_online: 2 });
    });
  });

  // --- Activation checklist --------------------------------------------------

  describe('activation checklist', () => {
    it('is derived from real state: the seed has a teammate and nothing else', async () => {
      const { body } = await getHome();
      const done = Object.fromEntries(body.activation.steps.map((s) => [s.key, s.done]));
      expect(done).toEqual({
        install_widget: false,
        // Two memberships in the seed → a teammate has been invited.
        invite_teammate: true,
        customize_widget: false,
        add_canned_response: false,
        set_up_ai_agent: false,
      });
      expect(body.activation).toMatchObject({ completed: 1, total: 5 });
    });

    it('flips each step done when its thing exists', async () => {
      const brandId = await seedDefaultBrand(owner, fx.a.licenseId);
      await owner.website.create({
        data: { licenseId: fx.a.licenseId, brandId, domain: 'shop.example' },
      });
      await owner.widgetSettings.create({ data: { licenseId: fx.a.licenseId, brandId } });
      await owner.cannedResponse.create({
        data: { licenseId: fx.a.licenseId, scope: 'chat', shortcut: 'hi', text: 'Hello!' },
      });
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Hazal' },
      });

      const { body } = await getHome();
      expect(body.activation.steps.every((s) => s.done)).toBe(true);
      expect(body.activation.completed).toBe(5);
    });

    it('a pending invitation alone satisfies the teammate step', async () => {
      // A workspace with only the owner but an outstanding invite still counts as
      // having invited someone. Isolate the signal by starting from a lone owner.
      await owner.agentMembership.deleteMany({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      });
      const soloOwner = await getHome();
      expect(soloOwner.body.activation.steps.find((s) => s.key === 'invite_teammate')?.done).toBe(
        false,
      );

      await owner.invitation.create({
        data: {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          email: 'newbie@example.test',
          role: 'agent',
          tokenHash: `hash-${nextId('i', 8)}`,
          invitedById: fx.a.ownerAccountId,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const invited = await getHome();
      expect(invited.body.activation.steps.find((s) => s.key === 'invite_teammate')?.done).toBe(
        true,
      );
    });
  });

  // --- Weekly performance ----------------------------------------------------

  describe('weekly performance', () => {
    it('counts conversations started and resolved this week versus last', async () => {
      const person = await seedCustomer(fx.a, 'Regular');

      // This week: three started, two of them resolved.
      await seedChat(fx.a, person, { active: false, createdAt: daysAgo(1) });
      await seedChat(fx.a, person, { active: false, createdAt: daysAgo(3) });
      await seedChat(fx.a, person, { active: true, createdAt: daysAgo(2) });

      // Last week: one started (resolved).
      await seedChat(fx.a, person, { active: false, createdAt: daysAgo(9) });

      // Two ratings this week (one good, one bad), one good last week.
      const rated = await seedChat(fx.a, person, { active: false, createdAt: daysAgo(2) });
      await seedRating(fx.a, rated, 'good', daysAgo(2));
      await seedRating(fx.a, rated, 'bad', daysAgo(1));
      await seedRating(fx.a, rated, 'good', daysAgo(10));

      const { body } = await getHome();
      // Four chats started this week (three above + the rated one), three resolved.
      expect(body.weekly.chats).toBe(4);
      expect(body.weekly.resolved).toBe(3);
      expect(body.weekly.satisfaction).toEqual({ good: 1, bad: 1, responses: 2, score: 0.5 });
      expect(body.weekly.previous.chats).toBe(1);
      expect(body.weekly.previous.resolved).toBe(1);
      expect(body.weekly.previous.satisfaction_score).toBe(1);
    });

    it('reports a null satisfaction score when nobody rated', async () => {
      const { body } = await getHome();
      expect(body.weekly.satisfaction).toEqual({ good: 0, bad: 0, responses: 0, score: null });
      expect(body.weekly.previous.satisfaction_score).toBeNull();
    });
  });
});
