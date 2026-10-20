/**
 * The AI's hand-over target (tm 307.2 · SiyahTuş analysis AI-12 §1–§4;
 * `services/ai/conversation/handoff/target-resolver.ts`), through the real
 * server and the real database:
 *
 *   1. a route names its team by id: renamed, the team still receives it;
 *   2. a team nobody in it is taking chats: no error — the conversation
 *      waits in that team's queue and the player hears the after-hours text,
 *      after the crisis text; a player who left an e-mail gets a ticket, once;
 *   3. self-harm (G3): the crisis text, urgent, the Responsible Gambling team;
 *   4. a route requiring an expertise: never an untrained agent — it waits,
 *      urgent, and the drain gives it to the trained agent when one is free
 *      while the chats behind it go on;
 *   5. urgent waits ahead of normal in the team's queue;
 *   6. a step naming a team that is gone: the fallback team, on the record;
 *   7. a same-day return's agent is tried first.
 */
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_HANDOFF_AFTER_HOURS_TEXT,
  generateShortId,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { botPrincipal } from '../../src/services/ai/handoff-service.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { RoutingService } from '../../src/services/routing/routing-service.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const SELF_HARM = 'artık yaşamak istemiyorum';
const CRISIS = 'Yalnız değilsiniz. 7/24 destek hattı: 182. Şimdi sizi bir yetkiliye aktarıyorum.';
const AFTER_HOURS = DEFAULT_HANDOFF_AFTER_HOURS_TEXT.tr;

/** The send path's idempotency cache is the only Redis user here. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

describe('the hand-over target (AI-12 · tm 307.2)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let routing: RoutingService;
  let aiAgentId: string;
  let routesToken: string;
  let botToken: string;
  let rgId: bigint;
  let supportId: bigint;
  let financeId: bigint;
  let trainingId: bigint;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ctx = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
    routing = new RoutingService();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const licenseId = fx.a.licenseId;
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    const { procedure: body, ...own } = splitSkillProcedure(
      build({
        when_to_use: 'Oyuncu bonus nedir diyor.',
        examples: ['bonus nedir'],
        steps: [
          { id: 'anlat', type: 'say', instruction: 'Bonus kurallarını kısaca anlat.' },
          { id: 'bitti', type: 'resolve', outcome: 'resolved' },
        ],
      }),
    );
    await owner.skill.create({
      data: {
        licenseId,
        aiAgentId,
        name: 'bonus nedir',
        kind: 'ai_agent',
        mode: 'procedure',
        whenToUse: own.when_to_use,
        examples: own.examples,
        priority: own.priority,
        slots: own.slots as object,
        procedure: body as object,
        active: true,
        updatedAt: new Date(),
      },
    });

    // Responsible Gambling first: the drain goes team by team in id order.
    rgId = (
      await owner.group.create({
        data: { licenseId, name: 'Sorumlu Oyun', topicRole: 'responsible_gambling' },
        select: { id: true },
      })
    ).id;
    supportId = (
      await owner.group.create({ data: { licenseId, name: 'Destek' }, select: { id: true } })
    ).id;
    financeId = (
      await owner.group.create({
        data: { licenseId, name: 'Finans', topicRole: 'finance' },
        select: { id: true },
      })
    ).id;
    trainingId = (
      await owner.expertise.create({
        data: {
          licenseId,
          name: 'Sorumlu oyun eğitimi',
          slug: `rg-${generateShortId()}`.toLowerCase(),
        },
        select: { id: true },
      })
    ).id;
    await owner.groupExpertise.create({
      data: { licenseId, groupId: rgId, expertiseId: trainingId },
    });
    // The fixture's own two members take nothing here: every hand-over meets
    // only the members a test seats.
    await owner.agentMembership.updateMany({
      where: { licenseId },
      data: { routingStatus: 'not_accepting_chats' },
    });

    routesToken = await grantToken(owner, {
      licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
    botToken = await grantToken(owner, {
      licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    const settings = await server.put(
      '/ai-guardrails/settings',
      { ai_agent_id: aiAgentId, crisis_text: CRISIS, approve_crisis_text: true },
      auth(botToken),
    );
    expect(settings.statusCode, settings.body).toBe(200);
  });

  // -------------------------------------------------------------------------

  /** A member of `groupIds`, accepting chats unless `status` says otherwise. */
  async function addAgent(options: {
    groupIds: bigint[];
    status?: string;
    trained?: boolean;
    role?: string;
  }): Promise<string> {
    const licenseId = fx.a.licenseId;
    const account = await owner.account.create({
      data: { email: `${generateShortId()}@handoff-target.test`.toLowerCase(), name: 'Agent' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId,
        agentId: account.id,
        role: options.role ?? 'agent',
        routingStatus: options.status ?? 'accepting_chats',
        concurrentChatsLimit: 6,
      },
    });
    for (const groupId of options.groupIds) {
      await owner.groupAgent.create({
        data: { licenseId, groupId, agentId: account.id, priority: 'normal' },
      });
    }
    if (options.trained) {
      await owner.agentExpertise.create({
        data: { licenseId, agentId: account.id, expertiseId: trainingId },
      });
    }
    return account.id;
  }

  async function addRoute(payload: Record<string, unknown>): Promise<{ id: string }> {
    const response = await server.post('/handoff-routes', payload, auth(routesToken));
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string };
  }

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return auth((response.json() as { token: string }).token);
  }

  /** One visitor message, answered: the connection as it stands, what the bot said, the record. */
  async function say(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    const bot = await owner.event.findMany({
      where: { chatId: sent.chat_id, authorType: 'bot' },
      orderBy: { createdAt: 'asc' },
      select: { text: true },
    });
    const thread = await owner.thread.findUniqueOrThrow({
      where: { id: sent.event.thread_id },
      select: {
        aiMode: true,
        assigneeId: true,
        groupId: true,
        queueGroupId: true,
        queuePosition: true,
        priority: true,
        priorityReason: true,
        requiredExpertiseId: true,
      },
    });
    const records = await owner.aiDecisionLog.findMany({
      where: { chatId: sent.chat_id },
      orderBy: { createdAt: 'asc' },
      select: { decision: true, details: true },
    });
    return {
      chatId: sent.chat_id,
      threadId: sent.event.thread_id,
      said: bot.map((event) => event.text),
      thread,
      record: records.at(-1)?.details as Record<string, unknown> | undefined,
    };
  }

  /** A connection already waiting in `groupId`'s queue, at `priority`. */
  async function waiting(groupId: bigint, priority = 0): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `w-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
    });
    await owner.chatAccess.create({ data: { chatId, groupId } });
    const threadId = generateShortId();
    const queued = await owner.thread.count({
      where: { licenseId: fx.a.licenseId, queueGroupId: groupId, queuePosition: { not: null } },
    });
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: true,
        groupId,
        queueGroupId: groupId,
        queuePosition: queued + 1,
        queuedAt: new Date(Date.now() - 60_000 + queued),
        priority,
      },
    });
    return threadId;
  }

  const queueOf = async (groupId: bigint) =>
    (
      await owner.thread.findMany({
        where: {
          licenseId: fx.a.licenseId,
          active: true,
          assigneeId: null,
          queuePosition: { not: null },
          queueGroupId: groupId,
        },
        orderBy: { queuePosition: 'asc' },
        select: { id: true },
      })
    ).map((t) => t.id);

  // -------------------------------------------------------------------------

  it('a reason route names its team by id: renamed, the team still receives the hand-over (AI-12 acceptance)', async () => {
    const member = await addAgent({ groupIds: [supportId] });
    const route = await addRoute({
      match_type: 'reason',
      match_key: 'guardrail_self_harm',
      group_id: Number(supportId),
    });
    await owner.group.update({
      where: { licenseId_id: { licenseId: fx.a.licenseId, id: supportId } },
      data: { name: 'Destek (yeni ad)' },
    });

    const turn = await say(await visitor(), SELF_HARM);
    expect(turn.said).toEqual([CRISIS]);
    expect(turn.thread).toMatchObject({
      aiMode: 'human',
      assigneeId: member,
      groupId: supportId,
      priority: 2,
      priorityReason: 'guardrail_self_harm',
    });
    expect(turn.record).toMatchObject({
      handoff_target: { group_id: Number(supportId), source: 'reason_route', route_id: route.id },
    });
    expect(turn.record?.['handoff_target_fallback']).toBeUndefined();
  });

  it('nobody in the team takes chats: no error — it waits in that team, the after-hours text follows the crisis text, and a known e-mail gets one ticket (AI-12 acceptance)', async () => {
    await addAgent({ groupIds: [supportId], status: 'offline' });
    // Someone in the workspace does: the engine's own after-hours check passes.
    await addAgent({ groupIds: [financeId] });
    await addRoute({
      match_type: 'reason',
      match_key: 'guardrail_self_harm',
      group_id: Number(supportId),
    });

    const headers = await visitor();
    const first = await say(headers, 'bonus nedir');
    expect(first.thread.aiMode).not.toBe('human');
    const { customerId } = await owner.chat.findUniqueOrThrow({
      where: { id: first.chatId },
      select: { customerId: true },
    });
    await owner.customer.update({
      where: { id: customerId },
      data: { email: `${generateShortId()}@player.test`.toLowerCase() },
    });

    const turn = await say(headers, SELF_HARM);
    expect(turn.said.at(-1)).toBe(`${CRISIS}\n${AFTER_HOURS}`);
    expect(turn.thread).toMatchObject({
      aiMode: 'human',
      assigneeId: null,
      queueGroupId: supportId,
      queuePosition: 1,
      priority: 2,
    });
    const tickets = await owner.ticket.findMany({
      where: { sourceChatId: turn.chatId },
      select: { status: true, customerId: true },
    });
    expect(tickets).toEqual([{ status: 'open', customerId }]);
  });

  it('nobody in the team takes chats and no e-mail is known: the text, no ticket', async () => {
    await addAgent({ groupIds: [supportId], status: 'not_accepting_chats' });
    await addAgent({ groupIds: [financeId] });
    await addRoute({
      match_type: 'reason',
      match_key: 'guardrail_self_harm',
      group_id: Number(supportId),
    });

    const turn = await say(await visitor(), SELF_HARM);
    expect(turn.said).toEqual([`${CRISIS}\n${AFTER_HOURS}`]);
    expect(turn.thread).toMatchObject({ assigneeId: null, queueGroupId: supportId });
    expect(await owner.ticket.count({ where: { sourceChatId: turn.chatId } })).toBe(0);
  });

  it('G3: the crisis text, urgent, and the Responsible Gambling team — its role, no route needed (AI-12 acceptance)', async () => {
    const trained = await addAgent({ groupIds: [rgId], trained: true });
    await addAgent({ groupIds: [supportId] });

    const turn = await say(await visitor(), SELF_HARM);
    expect(turn.said).toEqual([CRISIS]);
    expect(turn.thread).toMatchObject({
      aiMode: 'human',
      assigneeId: trained,
      groupId: rgId,
      priority: 2,
      priorityReason: 'guardrail_self_harm',
    });
    expect(turn.record).toMatchObject({
      handoff_target: { group_id: Number(rgId), source: 'topic_team' },
    });
    const card = await owner.aiHandoff.findFirstOrThrow({
      where: { chatId: turn.chatId },
      select: { targetGroupId: true, priority: true },
    });
    expect(card).toEqual({ targetGroupId: rgId, priority: 'urgent' });
  });

  it('a route requiring an expertise: never the untrained agent — it waits urgent, the drain passes it over for the chats behind, then gives it to the trained agent (AI-12 acceptance)', async () => {
    const untrained = await addAgent({ groupIds: [supportId] });
    const trained = await addAgent({ groupIds: [supportId], trained: true, status: 'offline' });
    await addRoute({
      match_type: 'topic',
      match_key: 'responsible_gambling',
      group_id: Number(supportId),
      required_expertise_id: Number(trainingId),
    });
    // Waiting behind it once it is queued: asks only the team's pool.
    const behind = await waiting(supportId);

    const turn = await say(await visitor(), SELF_HARM);
    expect(turn.said).toEqual([`${CRISIS}\n${AFTER_HOURS}`]);
    expect(turn.thread).toMatchObject({
      assigneeId: null,
      queueGroupId: supportId,
      queuePosition: 1,
      priority: 2,
      requiredExpertiseId: trainingId,
    });
    // The transfer line says it waits (the push tells the supervisors, AI-12-S3).
    const line = await owner.event.findFirstOrThrow({
      where: { chatId: turn.chatId, type: 'system_message', text: 'Chat transferred' },
      select: { properties: true },
    });
    expect(line.properties).toMatchObject({ outcome: 'queued', group_id: Number(supportId) });

    // The untrained agent is free: the chat behind goes to them, this one waits.
    const first = await withTenant(owner, ctx(), (tx) => routing.drainQueue(tx, fx.a.licenseId));
    expect(first.map((a) => [a.threadId, a.assigneeId])).toEqual([[behind, untrained]]);
    expect(await queueOf(supportId)).toEqual([turn.threadId]);

    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: trained } },
      data: { routingStatus: 'accepting_chats' },
    });
    const second = await withTenant(owner, ctx(), (tx) => routing.drainQueue(tx, fx.a.licenseId));
    expect(second.map((a) => [a.threadId, a.assigneeId])).toEqual([[turn.threadId, trained]]);
  });

  it("the AI's transfer with a route's expertise: urgent only when it has to wait, and the requirement stays on the connection", async () => {
    await addAgent({ groupIds: [supportId] });
    const chats = new ChatService(appRole, NO_REDIS);
    const transfer = async () => {
      const threadId = await waiting(financeId);
      const { chatId } = await owner.thread.findUniqueOrThrow({
        where: { id: threadId },
        select: { chatId: true },
      });
      const result = await chats.transfer(
        ctx(),
        botPrincipal(ctx()),
        chatId,
        { groupId: supportId, reason: 'ai_handoff', requiredExpertiseId: trainingId },
        { priority: 'normal', priorityReason: 'guardrail_rg', queuedPriority: 'urgent' },
      );
      const thread = await owner.thread.findUniqueOrThrow({
        where: { id: threadId },
        select: { assigneeId: true, priority: true, requiredExpertiseId: true },
      });
      return { outcome: result.outcome, ...thread };
    };

    // Only an untrained member: it waits, urgent.
    expect(await transfer()).toEqual({
      outcome: 'queued',
      assigneeId: null,
      priority: 2,
      requiredExpertiseId: trainingId,
    });
    // A trained one: taken at once, and nothing raised.
    const trained = await addAgent({ groupIds: [supportId], trained: true });
    expect(await transfer()).toEqual({
      outcome: 'assigned',
      assigneeId: trained,
      priority: 0,
      requiredExpertiseId: trainingId,
    });
  });

  it('a deleted expertise is held by nobody: the conversation waits rather than reach anyone', async () => {
    await addAgent({ groupIds: [supportId], trained: true });
    await addRoute({
      match_type: 'reason',
      match_key: 'guardrail_self_harm',
      group_id: Number(supportId),
      required_expertise_id: Number(trainingId),
    });
    await owner.groupExpertise.deleteMany({ where: { expertiseId: trainingId } });
    await owner.expertise.delete({
      where: { licenseId_id: { licenseId: fx.a.licenseId, id: trainingId } },
    });

    const turn = await say(await visitor(), SELF_HARM);
    expect(turn.thread).toMatchObject({ assigneeId: null, queueGroupId: supportId });
    expect(await withTenant(owner, ctx(), (tx) => routing.drainQueue(tx, fx.a.licenseId))).toEqual(
      [],
    );
  });

  it('urgent waits ahead of the normal conversations already in the team queue (AI-12 acceptance)', async () => {
    await addAgent({ groupIds: [supportId], status: 'offline' });
    await addAgent({ groupIds: [financeId] });
    await addRoute({
      match_type: 'reason',
      match_key: 'guardrail_self_harm',
      group_id: Number(supportId),
    });
    const earlier = [await waiting(supportId), await waiting(supportId)];

    const turn = await say(await visitor(), SELF_HARM);
    expect(await queueOf(supportId)).toEqual([turn.threadId, ...earlier]);
    const positions = await owner.thread.findMany({
      where: { id: { in: [turn.threadId, ...earlier] } },
      select: { id: true, queuePosition: true },
    });
    expect(new Map(positions.map((t) => [t.id, t.queuePosition]))).toEqual(
      new Map([
        [turn.threadId, 1],
        [earlier[0]!, 2],
        [earlier[1]!, 3],
      ]),
    );
  });

  it('a step naming a team that is gone: the fallback team takes it, and the record says what was gone (AI-12 acceptance)', async () => {
    const member = await addAgent({ groupIds: [financeId] });
    await owner.routingRule.create({
      data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: financeId },
    });
    const gone = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Kapanan masa' },
        select: { id: true },
      })
    ).id;
    await owner.skill.updateMany({ where: { aiAgentId }, data: { active: false } });
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Aktar',
        kind: 'ai_agent',
        steps: [{ type: 'transfer_to_team', group_id: Number(gone), group: 'Kapanan masa' }],
        active: true,
        updatedAt: new Date(),
      },
    });
    await owner.group.delete({ where: { licenseId_id: { licenseId: fx.a.licenseId, id: gone } } });

    const turn = await say(await visitor(), 'yardım lazım');
    expect(turn.thread).toMatchObject({ aiMode: 'human', assigneeId: member, groupId: financeId });
    expect(turn.record).toMatchObject({
      handoff_target: { group_id: Number(financeId), source: 'fallback' },
      handoff_target_fallback: [{ source: 'step', group_id: Number(gone) }],
    });
  });

  it("a team hand-off tries a same-day return's agent first, and nobody untrained when the route's expertise is missing", async () => {
    const first = await addAgent({ groupIds: [supportId] });
    const second = await addAgent({ groupIds: [supportId] });
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: second } },
      data: { lastAssignedAt: new Date() },
    });

    const handOff = async (options: { prefer?: string; requiredExpertiseId?: bigint }) => {
      const threadId = await waiting(financeId);
      return withTenant(owner, ctx(), (tx) =>
        routing.assignWithinGroup(tx, fx.a.licenseId, supportId, threadId, options),
      );
    };
    // ADR-08's order: both idle, `first` never assigned.
    expect(await handOff({})).toEqual({ outcome: 'assigned', assigneeId: first });
    // Now `first` holds one and `second` none — still `first` when preferred.
    expect(await handOff({ prefer: first })).toEqual({ outcome: 'assigned', assigneeId: first });
    expect(await handOff({})).toEqual({ outcome: 'assigned', assigneeId: second });
    expect(await handOff({ prefer: first, requiredExpertiseId: trainingId })).toEqual({
      outcome: 'queued',
      assigneeId: null,
    });
  });
});
