/**
 * ADR-09a — a thread handed off automatically is not an AI resolution
 * (tm 293.4 · owner decision K10 · `docs/adr/ai-resolution-handoff.md`).
 *
 * ADR-09 counted a closed thread as the AI's when no agent-authored event was
 * in it. ADR-09a adds a second condition — no automatic hand-off: no
 * `chat_transferred` system event whose reason is `ai_handoff` or
 * `bot_handoff` — for threads closed at or after `ADR_09A_EFFECTIVE_AT`.
 * What is pinned here:
 *
 *   - one definition: the close-time check, the SQL fragment every report
 *     reads and the Prisma filter the Solved view reads pick the same threads,
 *     on both sides of the effective moment;
 *   - the invoice is the report: the counter, Overview "Automated", Breakdown,
 *     the AI Agent report's `resolutions`, both CSV exports and the Solved view
 *     agree, under ADR-09's reading and under ADR-09a's;
 *   - nothing moves for a thread nobody handed off (ADR-09 regression);
 *   - the hand-off paths themselves — the AI's in an AI-first workspace and a
 *     rule bot's — write the event the predicate reads.
 *
 * Time: the counter is asked as a thread closes, so a test closes through a
 * ChatService given its own moment; the reports and the view read the
 * production constant, so a test moves its threads' `closed_at` to the side
 * of it under test. Nothing here depends on today's date.
 */
import { PrismaClient } from '@prisma/client';
import { AI_BOT_ID, TRANSFER_REASONS } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentPrincipal, BotPrincipal } from '../../src/services/auth/principal.js';
import {
  ADR_09A_EFFECTIVE_AT,
  AUTOMATIC_HANDOFF_REASONS,
  aiResolvedSql,
  aiResolvedThreadWhere,
  threadWasAiResolved,
} from '../../src/services/billing/ai-resolution.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import {
  auditContextFor,
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const HOUR = 3_600_000;

/** Every thread here closed after this: ADR-09a's reading. */
const LONG_AGO = new Date('2000-01-01T00:00:00.000Z');
/** Every thread here closed before this: ADR-09's reading. */
const FAR_AHEAD = new Date('2100-01-01T00:00:00.000Z');

/** The send path's idempotency cache, unused here. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

/**
 * One closed thread of each shape the predicate has to tell apart. Every one
 * of them heard from the AI (a bot event), so only (a) and (b) decide.
 * `forged` — a visitor's message whose properties read like a hand-off — is
 * only in the spellings test: no API lets a visitor set properties, and the AI
 * Agent report's `transfers` (its own, author-blind filter) would count it.
 */
const KINDS = [
  /** The AI answered and the visitor left. */
  'alone',
  /** The AI handed it to a team; nobody wrote before it closed. */
  'aiHandoff',
  /** A rule bot handed it to a team; nobody wrote. */
  'botHandoff',
  /** A person answered. */
  'agentWrote',
  /** Handed off, then a person answered. */
  'handedThenAgent',
  /** Moved between agents (`manual`) — a transfer, not a hand-off. */
  'agentTransfer',
  /** A takeover whose free-text reason reads "ai_handoff" — not a transfer. */
  'takeoverText',
  /** Handed off, then given back to the AI, which closed it (ADR-09a §2.5). */
  'returned',
] as const;
type Kind = (typeof KINDS)[number] | 'forged';

/** Resolved under ADR-09: no agent-authored event. */
const ADR_09: Kind[] = [
  'alone',
  'aiHandoff',
  'botHandoff',
  'agentTransfer',
  'takeoverText',
  'returned',
];
/** Resolved under ADR-09a: no agent-authored event and no automatic hand-off. */
const ADR_09A: Kind[] = ['alone', 'agentTransfer', 'takeoverText'];
/** The ones that carry an `ai_handoff` transfer — what the AI Agent report's `transfers` counts. */
const AI_TRANSFERS = 3; // aiHandoff, handedThenAgent, returned

describe('a thread handed off automatically is not an AI resolution (ADR-09a · K10)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;
  let supportId: bigint;
  let seq = 0;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const tenant = () => ({ licenseId: fx.a.licenseId, organizationId: fx.a.organizationId });
  const ownerPrincipal = (): AgentPrincipal => ({
    kind: 'agent',
    accountId: fx.a.ownerAccountId,
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
    role: 'owner',
    scopes: ['chats--all:rw', 'chats--all:ro'],
    tokenId: 'test-token',
    tokenKind: 'pat',
  });
  /** The AI's own principal, as `ai-responder.ts` builds it. */
  const aiPrincipal = (): BotPrincipal => ({
    kind: 'bot',
    botId: AI_BOT_ID,
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
    scopes: ['chats--all:rw', 'tags--all:rw'],
    tokenId: AI_BOT_ID,
    tokenKind: 'bot',
  });

  /** A ChatService whose counter reads the hand-off rule from `effectiveAt`. */
  const chatsAt = (effectiveAt: Date) =>
    new ChatService(appRole, NO_REDIS, undefined, undefined, {
      aiOverageCents: 50,
      aiIncluded: 200,
      adr09aEffectiveAt: effectiveAt,
    });

  /** Write an event straight into a chat's open thread, as the reports fixtures do. */
  async function write(
    chatId: string,
    event: { authorType: string; type?: string; text?: string; properties?: object },
  ): Promise<void> {
    const thread = await owner.thread.findFirstOrThrow({ where: { chatId, active: true } });
    seq += 1;
    await owner.event.create({
      data: {
        id: `${thread.id}_x${seq}`,
        threadId: thread.id,
        chatId,
        licenseId: fx.a.licenseId,
        type: event.type ?? 'message',
        text: event.text ?? null,
        authorType: event.authorType,
        recipients: 'all',
        properties: (event.properties ?? {}) as object,
      },
    });
  }

  async function agentSays(chatId: string): Promise<void> {
    const sent = await server.post(
      `/chats/${chatId}/events`,
      { type: 'message', text: 'A person here.' },
      auth(),
    );
    expect(sent.statusCode).toBe(201);
  }

  /** The AI's or a rule bot's hand-off, through the real transfer. */
  async function handOff(chatId: string, reason: 'ai_handoff' | 'bot_handoff'): Promise<void> {
    await chatsAt(FAR_AHEAD).transfer(tenant(), aiPrincipal(), chatId, {
      groupId: supportId,
      reason,
    });
  }

  /** Open a chat the AI answered, shape it as `kind`, and close it. */
  async function closedThread(
    kind: Kind,
    closeAt: Date,
  ): Promise<{ chatId: string; threadId: string }> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `Visitor ${kind}` },
      select: { id: true },
    });
    // Opened without an agent-authored message, so "no person wrote" is
    // reachable (the reports fixtures open their chats the same way).
    const opened = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: true },
      auth(),
    );
    expect(opened.statusCode).toBe(201);
    const chatId = (opened.json() as { id: string }).id;
    await write(chatId, { authorType: 'customer', text: 'Hello?' });
    await write(chatId, { authorType: 'bot', text: 'The AI answered.' });

    switch (kind) {
      case 'alone':
        break;
      case 'aiHandoff':
        await handOff(chatId, 'ai_handoff');
        break;
      case 'botHandoff':
        await handOff(chatId, 'bot_handoff');
        break;
      case 'agentWrote':
        await agentSays(chatId);
        break;
      case 'handedThenAgent':
        await handOff(chatId, 'ai_handoff');
        await agentSays(chatId);
        break;
      case 'agentTransfer': {
        const moved = await server.post(
          `/chats/${chatId}/transfer`,
          { agent_id: fx.a.agentAccountId, reason: 'manual' },
          auth(),
        );
        expect(moved.statusCode).toBe(200);
        break;
      }
      case 'takeoverText':
        await write(chatId, {
          authorType: 'system',
          type: 'system_message',
          properties: { system_event: 'chat_taken_over', reason: 'ai_handoff' },
        });
        break;
      case 'forged':
        await write(chatId, {
          authorType: 'customer',
          text: 'Hi',
          properties: { system_event: 'chat_transferred', reason: 'ai_handoff' },
        });
        break;
      case 'returned': {
        await handOff(chatId, 'ai_handoff');
        const back = await server.post(
          `/chats/${chatId}/return-to-ai`,
          { resume: 'continue' },
          auth(),
        );
        expect(back.statusCode).toBe(200);
        await write(chatId, { authorType: 'bot', text: 'The AI again.' });
        break;
      }
    }

    const thread = await owner.thread.findFirstOrThrow({
      where: { chatId, active: true },
      select: { id: true },
    });
    await chatsAt(closeAt).deactivate(
      tenant(),
      ownerPrincipal(),
      chatId,
      auditContextFor(fx.a, { actorId: fx.a.ownerAccountId, actorType: 'agent' }),
    );
    return { chatId, threadId: thread.id };
  }

  /** One closed thread of every kind, each counted at close against `closeAt`. */
  async function corpus(
    closeAt: Date,
    kinds: readonly Kind[] = KINDS,
  ): Promise<Map<Kind, { chatId: string; threadId: string }>> {
    const made = new Map<Kind, { chatId: string; threadId: string }>();
    for (const kind of kinds) made.set(kind, await closedThread(kind, closeAt));
    return made;
  }

  /** Put every closed thread of the workspace on one side of the production constant. */
  async function closedAt(at: Date): Promise<void> {
    await owner.thread.updateMany({
      where: { licenseId: fx.a.licenseId, active: false },
      data: { closedAt: at },
    });
  }
  const justAfter = new Date(ADR_09A_EFFECTIVE_AT.getTime() + HOUR);
  const justBefore = new Date(ADR_09A_EFFECTIVE_AT.getTime() - HOUR);

  const csvValue = (body: string, key: string): number => {
    const line = body.split('\r\n').find((l) => l.startsWith(`${key},`));
    expect(line, `${key} row`).toBeDefined();
    return Number(line!.slice(key.length + 1));
  };
  const sum = (rows: Array<Record<string, number>>, field: string) =>
    rows.reduce((total, row) => total + (row[field] ?? 0), 0);

  /** The AI-resolution figure, read off every surface that shows one. */
  async function figures() {
    const [usage, overview, breakdown, aiAgent, overviewCsv, aiAgentCsv, solved] =
      await Promise.all([
        server.get('/billing/usage', auth()),
        server.get('/reports/overview', auth()),
        server.get('/reports/breakdown', auth()),
        server.get('/reports/ai-agent', auth()),
        server.get('/reports/export?group=overview', auth()),
        server.get('/reports/export?group=ai-agent', auth()),
        server.get('/chats?view=ai_solved&limit=50', auth()),
      ]);
    for (const response of [usage, overview, breakdown, aiAgent, overviewCsv, aiAgentCsv, solved]) {
      expect(response.statusCode).toBe(200);
    }
    const totals = overview.json().totals as Record<string, number>;
    return {
      surfaces: {
        invoice: usage.json().ai_resolutions.used as number,
        overview: totals['automated'],
        breakdownByDay: sum(breakdown.json().by_day, 'automated'),
        breakdownByChannel: sum(breakdown.json().by_channel, 'automated'),
        aiAgent: aiAgent.json().resolutions as number,
        overviewCsv: csvValue(overviewCsv.body, 'automated'),
        aiAgentCsv: csvValue(aiAgentCsv.body, 'resolutions'),
        solved: solved.json().total as number,
      },
      totals,
      aiAgent: aiAgent.json() as { transfers: number; transfer_rate: number | null },
      solvedIds: (solved.json().items as Array<{ id: string }>).map((c) => c.id).sort(),
    };
  }

  const every = (n: number) => ({
    invoice: n,
    overview: n,
    breakdownByDay: n,
    breakdownByChannel: n,
    aiAgent: n,
    overviewCsv: n,
    aiAgentCsv: n,
    solved: n,
  });
  const chatsOf = (made: Map<Kind, { chatId: string }>, kinds: Kind[]) =>
    kinds.map((k) => made.get(k)!.chatId).sort();

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
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    supportId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: supportId, agentId: fx.a.agentAccountId },
    });
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw', 'reports_read', 'billing_manage'],
    });
  });

  // --- The constant -----------------------------------------------------------

  it('takes effect at the start of a billing period, never inside one', () => {
    // A period is a UTC month (`currentPeriod`); midnight on the first is the
    // only instant at which one ends and the next begins.
    expect(ADR_09A_EFFECTIVE_AT.toISOString()).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    // And only hand-offs: every reason in the list is a transfer reason, and
    // none of the agent-to-agent ones is in it.
    expect(TRANSFER_REASONS).toEqual(expect.arrayContaining([...AUTOMATIC_HANDOFF_REASONS]));
    expect(AUTOMATIC_HANDOFF_REASONS).not.toContain('manual');
    expect(AUTOMATIC_HANDOFF_REASONS).not.toContain('routing');
    expect(AUTOMATIC_HANDOFF_REASONS).not.toContain('agent_disconnected');
  });

  // --- One definition ---------------------------------------------------------

  it('picks the same threads in all three spellings, on both sides of the effective moment', async () => {
    const made = await corpus(FAR_AHEAD, [...KINDS, 'forged']);
    const kindOf = new Map([...made].map(([kind, ref]) => [ref.threadId, kind]));

    const spellings = async (effectiveAt: Date) => {
      const close: Kind[] = [];
      for (const [kind, ref] of made) {
        if (await threadWasAiResolved(owner, ref.threadId, effectiveAt)) close.push(kind);
      }
      const sql = await owner.$queryRaw<Array<{ id: string }>>`
        SELECT t.id FROM threads t
        WHERE t.license_id = ${fx.a.licenseId} AND ${aiResolvedSql(effectiveAt)}`;
      const prisma = await owner.thread.findMany({
        where: { licenseId: fx.a.licenseId, ...aiResolvedThreadWhere(effectiveAt) },
        select: { id: true },
      });
      const kinds = (rows: Array<{ id: string }>) => rows.map((r) => kindOf.get(r.id)!).sort();
      return { close: close.sort(), sql: kinds(sql), prisma: kinds(prisma) };
    };

    const before = await spellings(FAR_AHEAD);
    expect(before.close).toEqual([...ADR_09, 'forged'].sort());
    expect(before.sql).toEqual(before.close);
    expect(before.prisma).toEqual(before.close);

    const after = await spellings(LONG_AGO);
    expect(after.close).toEqual([...ADR_09A, 'forged'].sort());
    expect(after.sql).toEqual(after.close);
    expect(after.prisma).toEqual(after.close);

    // The moment is inclusive: a thread that closed exactly at it is counted
    // under ADR-09a, one a millisecond earlier under ADR-09.
    const handed = made.get('aiHandoff')!.threadId;
    const at = (await owner.thread.findUniqueOrThrow({ where: { id: handed } })).closedAt!;
    expect(await threadWasAiResolved(owner, handed, at)).toBe(false);
    expect(await threadWasAiResolved(owner, handed, new Date(at.getTime() + 1))).toBe(true);
    expect(await owner.thread.count({ where: { id: handed, ...aiResolvedThreadWhere(at) } })).toBe(
      0,
    );
    expect(
      await owner.thread.count({
        where: { id: handed, ...aiResolvedThreadWhere(new Date(at.getTime() + 1)) },
      }),
    ).toBe(1);
  });

  // --- The invoice is the report ----------------------------------------------

  it('leaves a handed-off thread out of the invoice, every report and the Solved view (FR-MOD-10.1.4 · FR-MOD-07.3.2 · FR-MOD-02.1.2)', async () => {
    const made = await corpus(LONG_AGO);
    await closedAt(justAfter);

    const read = await figures();
    expect(read.surfaces).toEqual(every(ADR_09A.length));
    expect(read.solvedIds).toEqual(chatsOf(made, ADR_09A));
    // Still a complete split of closed: the handed-off threads nobody wrote in
    // are handled cases now, not missing ones.
    const { closed, manual, assisted, automated } = read.totals;
    expect(closed).toBe(KINDS.length);
    expect(manual! + assisted! + automated!).toBe(closed);
    // And the AI Agent report counts each such thread once — as a transfer —
    // rather than as a resolution and a transfer both.
    expect(read.aiAgent.transfers).toBe(AI_TRANSFERS);
    expect(read.aiAgent.transfer_rate).toBe(
      Math.round((AI_TRANSFERS / (ADR_09A.length + AI_TRANSFERS)) * 1000) / 1000,
    );
  });

  it('counts a thread closed before the effective moment as ADR-09 did, on every surface (FR-MOD-10.1.4 · FR-MOD-07.3.2 · FR-MOD-02.1.2)', async () => {
    const made = await corpus(FAR_AHEAD);
    await closedAt(justBefore);

    const read = await figures();
    expect(read.surfaces).toEqual(every(ADR_09.length));
    expect(read.solvedIds).toEqual(chatsOf(made, ADR_09));
    const { closed, manual, assisted, automated } = read.totals;
    expect(manual! + assisted! + automated!).toBe(closed);
  });

  it('moves nothing for threads nobody handed off (ADR-09 regression · FR-MOD-07.3.2)', async () => {
    const unhanded: Kind[] = ['alone', 'agentWrote', 'agentTransfer', 'takeoverText'];
    await corpus(LONG_AGO, unhanded);

    await closedAt(justBefore);
    const before = await figures();
    await closedAt(justAfter);
    const after = await figures();

    expect(after.surfaces).toEqual(before.surfaces);
    expect(after.solvedIds).toEqual(before.solvedIds);
    for (const field of ['chats', 'closed', 'manual', 'assisted', 'automated']) {
      expect(after.totals[field], field).toBe(before.totals[field]);
    }
    // Three of the four had no person in them — counted at close under the
    // new reading, the same three the old one counts.
    expect(before.surfaces).toEqual(every(3));
  });

  it('meters a handed-off thread at close only when it closed before the effective moment (FR-MOD-10.1.4)', async () => {
    const usage = async () =>
      Number(
        (
          await owner.usageRecord.findFirst({
            where: { licenseId: fx.a.licenseId, metric: 'ai_resolutions' },
          })
        )?.quantity ?? 0,
      );

    await closedThread('aiHandoff', LONG_AGO);
    await closedThread('botHandoff', LONG_AGO);
    await closedThread('returned', LONG_AGO);
    expect(await usage()).toBe(0);

    await closedThread('alone', LONG_AGO);
    expect(await usage()).toBe(1);

    await closedThread('aiHandoff', FAR_AHEAD);
    expect(await usage()).toBe(2);
  });

  // --- The hand-off paths write what the predicate reads ----------------------

  describe('the hand-off paths', () => {
    let aiAgentId: string;
    /** The owner, with the bot and AI-agent settings besides the chats. */
    let adminToken: string;
    const admin = () => ({ authorization: `Bearer ${adminToken}` });

    async function visitor(): Promise<Record<string, string>> {
      const response = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      expect(response.statusCode).toBe(200);
      return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
    }

    async function send(headers: Record<string, string>, text: string) {
      const response = await server.post('/customer/chat/events', { text }, headers);
      expect(response.statusCode).toBe(201);
      const sent = response.json() as { chat_id: string; event: { thread_id: string } };
      return { chatId: sent.chat_id, threadId: sent.event.thread_id };
    }

    /** What the predicate reads off the closed thread, under each reading. */
    async function verdicts(threadId: string) {
      const handoffs = await owner.event.findMany({
        where: {
          threadId,
          authorType: 'system',
          properties: { path: ['system_event'], equals: 'chat_transferred' },
        },
        select: { properties: true },
      });
      return {
        reasons: handoffs.map((e) => (e.properties as { reason: string }).reason),
        adr09: await threadWasAiResolved(owner, threadId, FAR_AHEAD),
        adr09a: await threadWasAiResolved(owner, threadId, LONG_AGO),
      };
    }

    beforeEach(async () => {
      adminToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw', 'agents-bot--all:rw'],
      });
      aiAgentId = (
        await owner.aiAgent.create({
          data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
          select: { id: true },
        })
      ).id;
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          name: 'Hand over',
          kind: 'ai_agent',
          steps: [
            { type: 'detect_intent', intent: 'human', phrases: ['human'] },
            { type: 'transfer_to_team', group: 'Support' },
          ] as object,
          active: true,
          updatedAt: new Date(),
        },
      });
    });

    it("records the AI's own hand-off in an AI-first workspace, so the thread it then closes on is no AI resolution", async () => {
      const mode = await server.app.inject({
        method: 'PUT',
        url: server.url(`/ai-agents/${aiAgentId}/handoff-settings`),
        payload: { assignment_mode: 'ai_first' },
        headers: admin(),
      });
      expect(mode.statusCode).toBe(200);

      const headers = await visitor();
      const { threadId } = await send(headers, 'I want a human please');
      // Routed at the hand-over, as AI-first does it — the transfer is the
      // route, not a separate path around it.
      expect(
        await owner.thread.findUniqueOrThrow({
          where: { id: threadId },
          select: { aiMode: true, assigneeId: true },
        }),
      ).toEqual({ aiMode: 'human', assigneeId: fx.a.agentAccountId });

      // The visitor leaves before anyone writes.
      expect((await server.post('/customer/chat/close', undefined, headers)).statusCode).toBe(204);

      expect(await verdicts(threadId)).toEqual({
        reasons: ['ai_handoff'],
        adr09: true,
        adr09a: false,
      });
    });

    it("records a rule bot's hand-off, so the thread it then closes on is no AI resolution", async () => {
      const bot = await server.post(
        '/settings/bots',
        { name: 'Router', groups: [{ group_id: Number(supportId), priority: 'normal' }] },
        admin(),
      );
      expect(bot.statusCode).toBe(201);
      const rule = await server.post(
        `/settings/bots/${(bot.json() as { id: string }).id}/rules`,
        {
          name: 'Billing',
          conditions: { message_word: 'invoice' },
          actions: { transfer_to_group_id: Number(supportId) },
        },
        admin(),
      );
      expect(rule.statusCode).toBe(201);

      const headers = await visitor();
      const { threadId } = await send(headers, 'a question about my invoice');
      expect((await server.post('/customer/chat/close', undefined, headers)).statusCode).toBe(204);

      expect(await verdicts(threadId)).toEqual({
        reasons: ['bot_handoff'],
        adr09: true,
        adr09a: false,
      });
    });
  });
});
