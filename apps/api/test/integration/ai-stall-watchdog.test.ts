/**
 * The stalled-AI watchdog (tm 293.6 · SiyahTuş analysis AI-11 §5; owner
 * decision K9), on real visitor messages through the real server and the AI
 * job worker.
 *
 * "Önce AI" opens a visitor's connection with nobody assigned, so when the AI
 * does not answer, nobody does. The `ai_stall` job sends a person: a
 * connection in `ai` mode, unassigned and not queued, whose oldest visitor
 * message the AI has not followed is older than the agent's
 * `ai_stall_timeout_seconds`, goes `human` with reason `ai_failure` and is
 * routed. What is pinned here:
 *
 *   - the setting: default 60, its bounds and the CHECK one list, a write of
 *     one field keeps the other;
 *   - the hand-over: on time and not before, routed to a person, the
 *     agents-only line, pushed to the inbox, the AI silent after it, and a
 *     second pass finds nothing;
 *   - what it leaves alone: a connection the AI answered, one somebody holds
 *     (`parallel`), one a supervisor paused;
 *   - the race with a late answer: an answer that commits while the hand-over
 *     waits for the thread's lock spares the connection;
 *   - ADR-09a: a conversation the watchdog handed over and nobody then wrote
 *     in is no AI resolution, in all three spellings.
 *
 * Time: the watchdog takes its own `now`, so a test puts it past (or short of)
 * the window instead of waiting a minute.
 */
import { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  AI_STALL_TIMEOUT_SECONDS_MAX,
  AI_STALL_TIMEOUT_SECONDS_MIN,
  licenseChannel,
} from '@siyahtus/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  aiResolvedSql,
  aiResolvedThreadWhere,
  threadWasAiResolved,
} from '../../src/services/billing/ai-resolution.js';
import { AiStallWatchdog } from '../../src/services/chat/ai-stall.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { RealtimePublisher } from '../../src/services/realtime/publisher.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { silentLogger } from '../helpers/scheduler.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const AI_ANSWER = 'The AI answered.';
const SECOND = 1_000;
/** Every thread here closed after this: ADR-09a's reading. */
const LONG_AGO = new Date('2000-01-01T00:00:00.000Z');
/** Every thread here closed before this: ADR-09's reading. */
const FAR_AHEAD = new Date('2100-01-01T00:00:00.000Z');

/** The send path's idempotency cache, unused here. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Envelope {
  action: string;
  audience: { groupIds?: number[]; agentIds?: string[] };
  payload: Record<string, unknown>;
}

describe('the stalled-AI watchdog sends a person to a visitor the AI left unanswered (AI-11 · K9)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let chats: ChatService;
  let aiAgentId: string;
  let supportId: bigint;
  let adminToken: string;
  let listener: Redis;
  let pushes: Envelope[];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  /** One visitor message; returns once the AI job it set off has run. */
  async function send(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: sent.chat_id, threadId: sent.event.thread_id };
  }

  /**
   * A skill that answers everything. (A skill that matches nothing no longer
   * leaves the visitor unanswered on an AI-first connection — the AI says it
   * cannot answer, tm 298 · AI-06 §9 — so a stall is a worker that died:
   * `silenceAi`.)
   */
  async function skill(): Promise<void> {
    const steps = [{ type: 'send_message', source: 'text', text: AI_ANSWER }];
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Skill',
        kind: 'ai_agent',
        steps: steps as object,
        active: true,
        updatedAt: new Date(),
      },
    });
  }

  /** The AI keeps its conversations but stops answering — a worker that died, as the visitor sees it. */
  const silenceAi = () => owner.skill.updateMany({ where: { aiAgentId }, data: { active: false } });

  const putSettings = (payload: object) =>
    server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${aiAgentId}/handoff-settings`),
      payload,
      headers: auth(adminToken),
    });

  async function aiFirst(): Promise<void> {
    expect((await putSettings({ assignment_mode: 'ai_first' })).statusCode).toBe(200);
  }

  /** One watchdog pass, `seconds` after now. */
  const watch = (seconds: number) =>
    new AiStallWatchdog(app, chats).run({ now: new Date(Date.now() + seconds * SECOND) });

  const thread = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: { assigneeId: true, queuePosition: true, aiMode: true },
    });
  const botCount = (threadId: string) =>
    owner.event.count({ where: { threadId, authorType: 'bot' } });
  const modeLines = (threadId: string) =>
    owner.event.findMany({
      where: { threadId, properties: { path: ['system_event'], equals: 'ai_mode_changed' } },
      orderBy: { createdAt: 'asc' },
      select: { text: true, authorId: true, authorType: true, recipients: true, properties: true },
    });

  /** The pushes so far, after the bus has had a moment to deliver them. */
  async function pushed(action: string): Promise<Envelope[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return pushes.filter((p) => p.action === action);
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL is not set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    aiAgentId = agent.id;
    // One team, the agent its one member: `route()` seats a hand-over there.
    supportId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: supportId, agentId: fx.a.agentAccountId },
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents-bot--all:rw'],
    });
    chats = new ChatService(app, NO_REDIS, new RealtimePublisher(server.app.redis, silentLogger()));
    pushes = [];
    listener = server.app.redis.duplicate();
    listener.on('message', (_channel: string, message: string) => {
      pushes.push(JSON.parse(message) as Envelope);
    });
    await listener.subscribe(licenseChannel(fx.a.licenseId));
  });

  afterEach(async () => {
    await listener.quit();
  });

  // --- The setting ------------------------------------------------------------

  describe('the stall timeout setting', () => {
    it('keeps the CHECK and the bounds one pair', async () => {
      const [row] = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname = 'ai_handoff_settings_ai_stall_timeout_seconds_check'`;
      const bounds = [...row!.def.matchAll(/\b(\d+)\b/g)].map((m) => Number(m[1]));
      expect(bounds).toEqual([AI_STALL_TIMEOUT_SECONDS_MIN, AI_STALL_TIMEOUT_SECONDS_MAX]);
    });

    it('reads 60 for an agent nobody configured; a write of one field keeps the other', async () => {
      const read = async () =>
        (await server.get(`/ai-agents/${aiAgentId}/handoff-settings`, auth(adminToken))).json();
      expect(await read()).toMatchObject({
        ai_agent_id: aiAgentId,
        assignment_mode: 'parallel',
        ai_stall_timeout_seconds: 60,
      });

      const timeout = await putSettings({ ai_stall_timeout_seconds: 90 });
      expect(timeout.statusCode).toBe(200);
      expect(timeout.json()).toMatchObject({
        assignment_mode: 'parallel',
        ai_stall_timeout_seconds: 90,
      });
      await aiFirst();
      expect(await read()).toMatchObject({
        assignment_mode: 'ai_first',
        ai_stall_timeout_seconds: 90,
      });
    });

    it('refuses a timeout out of bounds, a fraction and an empty body', async () => {
      for (const payload of [
        { ai_stall_timeout_seconds: AI_STALL_TIMEOUT_SECONDS_MIN - 1 },
        { ai_stall_timeout_seconds: AI_STALL_TIMEOUT_SECONDS_MAX + 1 },
        { ai_stall_timeout_seconds: 30.5 },
        {},
      ]) {
        expect((await putSettings(payload)).statusCode, JSON.stringify(payload)).toBe(400);
      }
      expect(await owner.aiHandoffSettings.count()).toBe(0);
    });
  });

  // --- The hand-over ----------------------------------------------------------

  it('sends a person to an AI-first conversation the AI left unanswered past its window, and not before (AI-11 · FR-MOD-08.6.1)', async () => {
    await skill();
    await aiFirst();
    const headers = await visitor();
    const { chatId, threadId } = await send(headers, 'Hello there');
    expect(await botCount(threadId)).toBe(1);
    // Then the AI stops answering, and the visitor writes again.
    await silenceAi();
    await send(headers, 'Are you there?');
    expect(await botCount(threadId)).toBe(1);
    expect(await thread(threadId)).toEqual({ assigneeId: null, queuePosition: null, aiMode: 'ai' });

    // Inside the window: nothing.
    expect((await watch(30)).totals).toEqual({
      tenants: expect.any(Number),
      stalled: 0,
      handedOver: 0,
    });
    expect(await thread(threadId)).toMatchObject({ aiMode: 'ai', assigneeId: null });

    // Past it: a person, by today's routing in the connection's team. What
    // the open itself pushed is not the hand-over's.
    await pushed('settle');
    pushes = [];
    const report = await watch(61);
    expect(report.totals).toMatchObject({ stalled: 1, handedOver: 1 });
    expect(report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString())).toMatchObject({
      timeoutSeconds: 60,
      stalled: 1,
      handedOver: 1,
    });
    expect(await thread(threadId)).toEqual({
      assigneeId: fx.a.agentAccountId,
      queuePosition: null,
      aiMode: 'human',
    });
    // The line only the agents see, authored by nobody.
    expect(await modeLines(threadId)).toEqual([
      {
        text: 'AI stopped: no answer in time',
        authorId: null,
        authorType: 'system',
        recipients: 'agents',
        properties: expect.objectContaining({
          system_event: 'ai_mode_changed',
          ai_mode: 'human',
          previous_ai_mode: 'ai',
          reason: 'ai_failure',
        }),
      },
    ]);
    // The inbox hears both: the badge, and the agent it went to.
    const [mode] = await pushed('chat_ai_mode_changed');
    expect(mode?.payload).toEqual({
      chat_id: chatId,
      thread_id: threadId,
      ai_mode: 'human',
      previous_ai_mode: 'ai',
      by: 'system',
      reason: 'ai_failure',
    });
    expect(mode?.audience.agentIds).toContain(fx.a.agentAccountId);
    const incoming = await pushed('incoming_chat');
    expect(incoming.map((p) => p.audience.agentIds)).toEqual([[fx.a.agentAccountId]]);
    expect(
      await server.get(`/chats?view=my`, auth(await agentToken())).then((r) => r.json()),
    ).toMatchObject({ items: [expect.objectContaining({ id: chatId })] });

    // Idempotent: a second pass finds nothing — the connection is a person's.
    expect((await watch(120)).totals).toMatchObject({ stalled: 0, handedOver: 0 });
    expect(await modeLines(threadId)).toHaveLength(1);
  });

  it('keeps the AI silent after the hand-over, when it could answer again (AI-11)', async () => {
    await skill();
    await aiFirst();
    const headers = await visitor();
    const { threadId } = await send(headers, 'Hello there');
    expect(await botCount(threadId)).toBe(1);

    await silenceAi();
    await send(headers, 'Are you there?');
    expect((await watch(61)).totals).toMatchObject({ handedOver: 1 });

    // The AI is back — and the connection is a person's: no answer, no record.
    await owner.skill.updateMany({ where: { aiAgentId }, data: { active: true } });
    const decisions = () => owner.aiDecisionLog.count({ where: { threadId } });
    const before = await decisions();
    await send(headers, 'Hello?');
    expect(await botCount(threadId)).toBe(1);
    expect(await decisions()).toBe(before);
    expect(await thread(threadId)).toMatchObject({
      aiMode: 'human',
      assigneeId: fx.a.agentAccountId,
    });
  });

  it('counts from the oldest message the AI has not followed, at the agent’s own window', async () => {
    expect((await putSettings({ ai_stall_timeout_seconds: 120 })).statusCode).toBe(200);
    await skill();
    await aiFirst();
    const headers = await visitor();
    const { threadId } = await send(headers, 'Hello there');
    // Answered: however long ago, nothing is waiting.
    expect((await watch(600)).totals).toMatchObject({ stalled: 0 });

    await silenceAi();
    await send(headers, 'My deposit');
    await send(headers, 'has not arrived');
    expect((await watch(61)).totals).toMatchObject({ stalled: 0 });
    expect((await watch(121)).totals).toMatchObject({ stalled: 1, handedOver: 1 });
    expect(await thread(threadId)).toMatchObject({ aiMode: 'human' });
  });

  // --- What it leaves alone ---------------------------------------------------

  it('leaves a conversation somebody holds: `parallel` assigns on open, and that person is its safety net', async () => {
    await skill();
    const headers = await visitor();
    const { threadId } = await send(headers, 'Hello there');
    expect(await thread(threadId)).toMatchObject({
      assigneeId: fx.a.agentAccountId,
      aiMode: 'ai',
    });

    await silenceAi();
    await send(headers, 'Are you there?');
    expect((await watch(600)).totals).toMatchObject({ stalled: 0, handedOver: 0 });
    expect(await thread(threadId)).toMatchObject({ aiMode: 'ai' });
    expect(await modeLines(threadId)).toEqual([]);
  });

  it('leaves a conversation a supervisor paused: sending a person is their call', async () => {
    await skill();
    await aiFirst();
    const headers = await visitor();
    const { chatId, threadId } = await send(headers, 'Hello there');
    const paused = await server.post(`/chats/${chatId}/pause-ai`, {}, auth(adminToken));
    expect(paused.statusCode).toBe(200);

    await send(headers, 'Are you there?');
    expect((await watch(600)).totals).toMatchObject({ stalled: 0, handedOver: 0 });
    expect(await thread(threadId)).toEqual({
      assigneeId: null,
      queuePosition: null,
      aiMode: 'paused',
    });
  });

  // --- The race with a late answer ------------------------------------------

  it('spares a conversation whose answer commits while the hand-over waits for the lock', async () => {
    await skill();
    await aiFirst();
    const headers = await visitor();
    const { chatId, threadId } = await send(headers, 'Hello there');
    await silenceAi();
    await send(headers, 'Are you there?');
    const cutoff = new Date(Date.now() + 61 * SECOND);

    // The AI's commit, by hand: the thread's lock, then its reply.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const reply = owner.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM threads WHERE id = ${threadId} FOR UPDATE`;
        locked();
        await held;
        const [row] = await tx.$queryRaw<Array<{ event_sequence: number }>>`
          UPDATE threads SET event_sequence = event_sequence + 1 WHERE id = ${threadId}
          RETURNING event_sequence`;
        await tx.$executeRaw`
          INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_id, author_type, recipients)
          VALUES (${`${threadId}_${row!.event_sequence}`}, ${threadId}, ${chatId}, ${fx.a.licenseId},
                  'message', ${AI_ANSWER}, 'ai-agent', 'bot', 'all')`;
      },
      { timeout: 30_000 },
    );
    try {
      await lockTaken;
      const handOver = chats.handOverStalledAi(
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        { chatId, threadId },
        cutoff,
      );
      // Waiting on the reply's lock, not past it.
      for (let i = 0; i < 100; i += 1) {
        const [waiting] = await owner.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`;
        if ((waiting?.n ?? 0) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      release();
      await reply;
      expect(await handOver).toBe(false);
    } finally {
      release();
      await reply.catch(() => undefined);
    }
    expect(await thread(threadId)).toMatchObject({ aiMode: 'ai', assigneeId: null });
    expect(await modeLines(threadId)).toEqual([]);
  });

  // --- ADR-09a ----------------------------------------------------------------

  it('is a hand-off: a conversation it handed over and nobody wrote in is no AI resolution (ADR-09a · FR-MOD-10.1.4)', async () => {
    await skill();
    await aiFirst();
    const headers = await visitor();
    const { chatId, threadId } = await send(headers, 'Hello there');
    await silenceAi();
    await send(headers, 'Are you there?');
    expect((await watch(61)).totals).toMatchObject({ handedOver: 1 });
    const closed = await server.post(`/chats/${chatId}/deactivate`, {}, auth(adminToken));
    expect(closed.statusCode).toBe(200);

    const spellings = async (effectiveAt: Date) => ({
      close: await threadWasAiResolved(owner, threadId, effectiveAt),
      sql:
        (
          await owner.$queryRaw<Array<{ id: string }>>`
            SELECT t.id FROM threads t WHERE t.id = ${threadId} AND ${aiResolvedSql(effectiveAt)}`
        ).length === 1,
      prisma:
        (await owner.thread.count({
          where: { id: threadId, ...aiResolvedThreadWhere(effectiveAt) },
        })) === 1,
    });
    // ADR-09a: handed off, so not the AI's.
    expect(await spellings(LONG_AGO)).toEqual({ close: false, sql: false, prisma: false });
    // ADR-09 (closed before the effective moment): no agent wrote, so the AI's.
    expect(await spellings(FAR_AHEAD)).toEqual({ close: true, sql: true, prisma: true });
  });

  async function agentToken(): Promise<string> {
    return grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--access:rw'],
    });
  }
});
