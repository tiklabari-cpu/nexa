/**
 * What leading a team adds (RL-03 · tm 326 · SiyahTuş analysis RL-03,
 * RL-03-S1/S2/S3).
 *
 * An Ekip Lideri is the shift's first escalation point: they watch and take
 * over the conversations of the teams they lead, see those teams' open chats in
 * one place ("My team", the AI's included), and read their own teams' figures
 * in the reports open to them. Taking over is the `chats.takeover` capability
 * (RL-02 matrix): `team` for a lead by default, `all` for the Founder and
 * administrators, `none` — and a floor — for an Ekip Üyesi.
 *
 * The capability's cells are `capabilities.test.ts`; the race, the demotion of
 * the previous holder and the system line are `chats.test.ts` "takeover".
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultScopesForRole, generateShortId } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

const HOUR = 3_600_000;

interface ChatBody {
  id: string;
  thread: { id: string; assignee_id: string | null } | null;
}

describe('Ekip Lideri capabilities (RL-03 · tm 326)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let seq = 0;
  /** The team the lead leads. */
  let sales: bigint;
  /** A team the lead is a member of, and does not lead. */
  let support: bigint;
  /** A team the lead is not in at all. */
  let billing: bigint;
  let lead: { id: string; auth: Headers };
  let ownerAuth: Headers;
  let agentAuth: Headers;

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
    seq = 0;
    // `seedFixtures` hands the next test the same licence ids; the cached
    // matrix of the workspace before must not answer for this one.
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);

    const group = async (name: string): Promise<bigint> =>
      (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name },
          select: { id: true },
        })
      ).id;
    sales = await group('Sales');
    support = await group('Support');
    billing = await group('Billing');

    // The Ekip Üyesi works Sales and Support, so a Sales chat has someone to
    // be taken from.
    for (const groupId of [sales, support]) {
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId, agentId: fx.a.agentAccountId },
      });
    }

    const account = await owner.account.create({
      data: { email: `lead-${fx.a.licenseId}@example.test`, name: 'Ekip Lideri' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: account.id,
        role: 'team_lead',
        routingStatus: 'accepting_chats',
      },
    });
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: sales, agentId: account.id, isLead: true },
    });
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: support, agentId: account.id },
    });
    lead = { id: account.id, auth: await session(fx.a, account.id, 'team_lead') };
    ownerAuth = await session(fx.a, fx.a.ownerAccountId, 'owner');
    agentAuth = await session(fx.a, fx.a.agentAccountId, 'agent');
  });

  afterEach(async () => {
    await server.app.backgroundMail.settled();
  });

  /** A signed-in session's token: the role's own scopes, the matrix resolved per request. */
  async function session(t: TenantFixture, accountId: string, role: string): Promise<Headers> {
    const token = await grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: accountId,
      kind: 'oauth',
      scopes: defaultScopesForRole(role),
    });
    return { authorization: `Bearer ${token}` };
  }

  async function customer(): Promise<string> {
    seq += 1;
    return (
      await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: `Oyuncu ${seq}` },
        select: { id: true },
      })
    ).id;
  }

  /** An open chat routed to `groupIds`, held by the Ekip Üyesi. */
  async function heldChat(groupIds: bigint[]): Promise<string> {
    const started = await server.post(
      '/chats',
      { customer_id: await customer(), group_ids: groupIds.map(Number) },
      ownerAuth,
    );
    expect([200, 201], started.body).toContain(started.statusCode);
    const chatId = (started.json() as ChatBody).id;
    const held = await server.post(
      `/chats/${chatId}/transfer`,
      { agent_id: fx.a.agentAccountId },
      ownerAuth,
    );
    expect(held.statusCode, held.body).toBe(200);
    return chatId;
  }

  /** A chat written straight to the tables: open or closed, held by the AI or nobody. */
  async function storedChat(
    groupId: bigint,
    options: { active?: boolean; aiMode?: 'ai' | null } = {},
  ): Promise<string> {
    const active = options.active ?? true;
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: await customer(), active },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: fx.a.licenseId,
        active,
        aiMode: options.aiMode ?? null,
        ...(active ? {} : { closedAt: new Date() }),
      },
    });
    await owner.chatAccess.create({ data: { chatId, groupId } });
    return chatId;
  }

  const takeover = (chatId: string, auth: Headers) =>
    server.post(`/chats/${chatId}/takeover`, { reason: 'Zor oyuncu' }, auth);

  async function assignee(chatId: string): Promise<string | null> {
    const thread = await owner.thread.findFirstOrThrow({
      where: { chatId, active: true },
      select: { assigneeId: true },
    });
    return thread.assigneeId;
  }

  async function capability(auth: Headers, key: string): Promise<string> {
    const me = await server.get('/auth/me', auth);
    expect(me.statusCode).toBe(200);
    return (me.json() as { capabilities: Record<string, string> }).capabilities[key]!;
  }

  // =========================================================================
  // Watching and taking over
  // =========================================================================

  it('watches and takes over an open chat of the team they lead; the audit trail names them (RL-03)', async () => {
    const chatId = await heldChat([sales]);
    expect(await capability(lead.auth, 'chats.takeover')).toBe('team');

    const watched = await server.post(`/chats/${chatId}/supervise`, {}, lead.auth);
    expect(watched.statusCode, watched.body).toBe(200);

    const taken = await takeover(chatId, lead.auth);
    expect(taken.statusCode, taken.body).toBe(200);
    expect((taken.json() as ChatBody).thread?.assignee_id).toBe(lead.id);
    expect(await assignee(chatId)).toBe(lead.id);

    const entry = await owner.auditLogEntry.findFirst({
      where: { licenseId: fx.a.licenseId, action: 'chat.taken_over', target: `chat:${chatId}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry?.actorId).toBe(lead.id);
    expect(entry?.metadata).toMatchObject({
      previous_assignee_id: fx.a.agentAccountId,
      reason: 'Zor oyuncu',
    });
  });

  it('another team’s chat answers 404 — one they cannot see, and one they read as a member (RL-03-S3)', async () => {
    const memberOnly = await heldChat([support]);
    const elsewhere = await heldChat([billing]);

    // Readable as a member of Support, and still not theirs to seize.
    expect((await server.get(`/chats/${memberOnly}`, lead.auth)).statusCode).toBe(200);
    for (const chatId of [memberOnly, elsewhere]) {
      const refused = await takeover(chatId, lead.auth);
      expect(refused.statusCode, refused.body).toBe(404);
      expect(refused.json().error.type).toBe('not_found');
      expect(await assignee(chatId)).toBe(fx.a.agentAccountId);
    }
    // Nothing was written for either refusal.
    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.a.licenseId, action: 'chat.taken_over' },
      }),
    ).toBe(0);
  });

  it('any one of the chat’s teams is enough', async () => {
    const chatId = await heldChat([support, sales]);
    const taken = await takeover(chatId, lead.auth);
    expect(taken.statusCode, taken.body).toBe(200);
    expect(await assignee(chatId)).toBe(lead.id);
  });

  it('leading is read on every request: a lead no longer leading seizes nothing', async () => {
    const chatId = await heldChat([sales]);
    await owner.groupAgent.updateMany({
      where: { licenseId: fx.a.licenseId, groupId: sales, agentId: lead.id },
      data: { isLead: false },
    });
    expect((await takeover(chatId, lead.auth)).statusCode).toBe(404);
    expect(await assignee(chatId)).toBe(fx.a.agentAccountId);
  });

  it('the Founder opens other teams in the matrix: `all` reaches every chat the lead can see (RL-03-S3)', async () => {
    const memberOnly = await heldChat([support]);
    const elsewhere = await heldChat([billing]);
    const opened = await server.put(
      '/settings/permissions',
      {
        changes: [{ role: 'team_lead', capability: 'chats.takeover', value: 'all' }],
        reason: 'Gece tek lider var',
      },
      ownerAuth,
    );
    expect(opened.statusCode, opened.body).toBe(200);
    expect(await capability(lead.auth, 'chats.takeover')).toBe('all');

    expect((await takeover(memberOnly, lead.auth)).statusCode).toBe(200);
    // Still bounded by what the lead may see: Billing's chat is not visible.
    expect((await takeover(elsewhere, lead.auth)).statusCode).toBe(404);

    // And an Ekip Üyesi's cell cannot be raised at all: the floor.
    const below = await server.put(
      '/settings/permissions',
      {
        changes: [{ role: 'agent', capability: 'chats.takeover', value: 'team' }],
        reason: 'Gece tek lider var',
      },
      ownerAuth,
    );
    expect(below.statusCode).toBe(400);
  });

  it('an Ekip Üyesi is refused with 403 — before the chat is read — and may still hand the chat on (RL-03)', async () => {
    const chatId = await heldChat([sales]);
    expect(await capability(agentAuth, 'chats.takeover')).toBe('none');

    const refused = await takeover(chatId, agentAuth);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({
      type: 'authorization',
      details: { reason: 'capability_required', capability: 'chats.takeover' },
    });
    // The same answer for an id that does not exist: the refusal confirms nothing.
    expect((await takeover(generateShortId(), agentAuth)).statusCode).toBe(403);

    // A broad token does not lift a person's capability.
    const wide = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--all:rw'],
    });
    expect((await takeover(chatId, { authorization: `Bearer ${wide}` })).statusCode).toBe(403);

    // Transfer stays the consented hand-off every member may make.
    const handed = await server.post(`/chats/${chatId}/transfer`, { agent_id: lead.id }, agentAuth);
    expect(handed.statusCode, handed.body).toBe(200);
  });

  it('an administrator takes over any chat; the Founder can switch that off', async () => {
    const chatId = await heldChat([billing]);
    const admin = await owner.account.create({
      data: { email: `admin-${fx.a.licenseId}@example.test`, name: 'Yönetici' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: admin.id, role: 'admin' },
    });
    const adminAuth = await session(fx.a, admin.id, 'admin');

    const closed = await server.put(
      '/settings/permissions',
      {
        changes: [{ role: 'admin', capability: 'chats.takeover', value: 'none' }],
        reason: 'Devralma yalnız liderde',
      },
      ownerAuth,
    );
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await takeover(chatId, adminAuth)).statusCode).toBe(403);

    const reopened = await server.put(
      '/settings/permissions',
      {
        changes: [{ role: 'admin', capability: 'chats.takeover', value: 'all' }],
        reason: 'Devralma yalnız liderde',
      },
      ownerAuth,
    );
    expect(reopened.statusCode).toBe(200);
    expect((await takeover(chatId, adminAuth)).statusCode).toBe(200);
    expect(await assignee(chatId)).toBe(admin.id);
  });

  // =========================================================================
  // "My team"
  // =========================================================================

  it('`view=team` lists the open chats of the teams they lead, the AI’s included', async () => {
    const held = await heldChat([sales]);
    const aiHeld = await storedChat(sales, { aiMode: 'ai' });
    const waiting = await storedChat(sales);
    const closed = await storedChat(sales, { active: false });
    const supportChat = await storedChat(support);

    const res = await server.get('/chats?view=team', lead.auth);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { items: Array<{ id: string }>; total: number };
    expect(body.items.map((c) => c.id).sort()).toEqual([held, aiHeld, waiting].sort());
    expect(body.total).toBe(3);
    expect(body.items.map((c) => c.id)).not.toContain(closed);
    expect(body.items.map((c) => c.id)).not.toContain(supportChat);

    // Someone who leads no team: nothing, not the workspace.
    const none = await server.get('/chats?view=team', ownerAuth);
    expect(none.statusCode).toBe(200);
    expect(none.json()).toMatchObject({ items: [], total: 0 });
  });

  // =========================================================================
  // Their own teams' figures
  // =========================================================================

  it('reports show their own teams’ figures only; naming another team in the URL reaches nothing (RL-03)', async () => {
    const endedAt = new Date(Date.now() - 5 * 24 * HOUR);
    for (const teamId of [sales, support, support]) {
      await owner.aiConversationOutcome.create({
        data: {
          licenseId: fx.a.licenseId,
          chatId: await storedChat(teamId, { active: false }),
          threadId: generateShortId(),
          teamId,
          startedAt: new Date(endedAt.getTime() - 10 * 60_000),
          endedAt,
          aiTurns: 2,
          playerTurns: 2,
          outcome: 'assumed_pending',
        },
      });
    }
    const window = `from=${encodeURIComponent(new Date(endedAt.getTime() - HOUR).toISOString())}&to=${encodeURIComponent(new Date(endedAt.getTime() + HOUR).toISOString())}`;
    const total = async (query: string, auth: Headers): Promise<number> => {
      const res = await server.get(`/reports/ai-agent/breakdown?${window}&by=team${query}`, auth);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { total: { conversations: number } }).total.conversations;
    };

    expect(await total('', ownerAuth)).toBe(3);
    expect(await total('', lead.auth)).toBe(1);
    expect(await total(`&team_id=${sales}`, lead.auth)).toBe(1);
    // Support is a team they are in and do not lead; Billing one they are not in.
    expect(await total(`&team_id=${support}`, lead.auth)).toBe(0);
    expect(await total(`&team_id=${billing}`, lead.auth)).toBe(0);
    // The workspace-wide reports are not theirs; the conversation reports are,
    // bounded to the teams they lead (`reports.view` `team`, tm 368 —
    // `report-filters.test.ts` holds the bound itself).
    expect((await server.get(`/reports/ai-agent?${window}`, lead.auth)).statusCode).toBe(403);
    const overview = await server.get(`/reports/overview?${window}&group_id=${support}`, lead.auth);
    expect(overview.statusCode).toBe(200);
    expect((overview.json() as { filters: unknown }).filters).toEqual({ group_id: [] });
  });
});
