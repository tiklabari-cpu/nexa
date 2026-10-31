/**
 * Missed conversations and who started them (RP-02 · tm 369.1), on real
 * visitor messages through the real server and the AI job worker.
 *
 * What is pinned here:
 *
 *   - the close writes `missed_reason` once, from what happened — an AI-first
 *     connection the AI kept is not missed; the AI's hand-over nobody answered
 *     is `unanswered_after_ai`; an assigned agent who never wrote is
 *     `unanswered_assigned`; a wait the player gave up is `queue_abandoned`;
 *     an answered connection, a `parallel` AI's own conversation and an
 *     agent's own start are not missed;
 *   - `needs_human_since` is the moment a person was first needed — at open
 *     when routed, at the hand-over when the AI answered first;
 *   - `initiated_by` names the opener: the widget's player, an agent, a
 *     campaign card, a channel;
 *   - the two reports count those values — totals by reason, per day and the
 *     hour × weekday heat map in the workspace's zone, per team and agent,
 *     every opener as its own row — and the export is the same figures;
 *   - the backfill infers the reason of an old closed connection by the
 *     close's own rule, and the report marks those as estimates.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import {
  ENGAGEMENT_INITIATORS,
  MISSED_REASONS,
  THREAD_INITIATED_BY,
  generateShortId,
} from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MISSED_REASON_SQL,
  MISSED_SQL,
  recordMissedReason,
} from '../../src/services/reports/missed-engagement.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const AI_ANSWER = 'The AI answered.';
const BACKFILL = fileURLToPath(
  new URL(
    '../../prisma/migrations/20261210090100_threads_missed_backfill/migration.sql',
    import.meta.url,
  ),
);
const DAY = 86_400_000;

type Json = Record<string, unknown>;

describe('missed conversations and who started them (RP-02 · tm 369.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let supportId: bigint;
  let logisticsId: bigint;
  /** The workspace owner: every chat, bots, channels, reports. In Logistics. */
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    // No routing rules: `route()` takes the first team by id, Support, whose
    // one member is the fixture's agent; the owner is Logistics'.
    supportId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    logisticsId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Logistics' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.createMany({
      data: [
        { licenseId: fx.a.licenseId, groupId: supportId, agentId: fx.a.agentAccountId },
        { licenseId: fx.a.licenseId, groupId: logisticsId, agentId: fx.a.ownerAccountId },
      ],
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [
        'chats--all:rw',
        'agents-bot--all:rw',
        'channels--all:rw',
        'customers:rw',
        'reports_read',
      ],
    });
  });

  async function visitor(): Promise<{ headers: Record<string, string>; customerId: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as { token: string; customer_id: string };
    return { headers: auth(body.token), customerId: body.customer_id };
  }

  /** One visitor message; returns once the AI job it set off has run. */
  async function send(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode, response.body).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: sent.chat_id, threadId: sent.event.thread_id };
  }

  async function skill(
    steps: object[] = [{ type: 'send_message', source: 'text', text: AI_ANSWER }],
  ): Promise<void> {
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

  async function aiFirst(): Promise<void> {
    const response = await server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${aiAgentId}/handoff-settings`),
      payload: { assignment_mode: 'ai_first' },
      headers: auth(adminToken),
    });
    expect(response.statusCode).toBe(200);
  }

  async function deactivate(chatId: string): Promise<void> {
    const response = await server.post(`/chats/${chatId}/deactivate`, undefined, auth(adminToken));
    expect(response.statusCode, response.body).toBe(200);
  }

  const row = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: {
        active: true,
        initiatedBy: true,
        needsHumanSince: true,
        missedReason: true,
        firstResponseAt: true,
        assigneeId: true,
      },
    });

  async function report(path: string): Promise<Json> {
    const response = await server.get(path, auth(adminToken));
    expect(response.statusCode, `${path}: ${response.body}`).toBe(200);
    return response.json() as Json;
  }

  // --- The vocabulary --------------------------------------------------------

  it('keeps the CHECKs and the closed lists one list each', async () => {
    const listed = async (name: string) => {
      const [constraint] = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
      return [...constraint!.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    };
    expect(await listed('threads_initiated_by_check')).toEqual([...THREAD_INITIATED_BY].sort());
    expect(await listed('threads_missed_reason_check')).toEqual([...MISSED_REASONS].sort());
    expect(ENGAGEMENT_INITIATORS).toEqual([...THREAD_INITIATED_BY, 'unknown']);
  });

  // --- The close -------------------------------------------------------------

  describe('the close decides once whether a player was missed (05 RP-02 decision 1)', () => {
    it('does not count a connection the AI started and closed (RP-02 KK1)', async () => {
      await skill();
      await aiFirst();
      const { headers } = await visitor();
      const { chatId, threadId } = await send(headers, 'Hello there');
      await deactivate(chatId);

      expect(await row(threadId)).toMatchObject({
        active: false,
        initiatedBy: 'customer',
        needsHumanSince: null,
        missedReason: null,
      });
    });

    it('counts the AI’s hand-over nobody answered as missed after the AI, the wait starting at the hand-over (RP-02 KK2)', async () => {
      await skill([
        { type: 'detect_intent', intent: 'human', phrases: ['human'] },
        { type: 'transfer_to_team', group: 'Logistics' },
        { type: 'send_message', source: 'text', text: AI_ANSWER },
      ]);
      await aiFirst();
      const { headers } = await visitor();
      const { chatId, threadId } = await send(headers, 'Hello there');
      expect((await row(threadId)).needsHumanSince).toBeNull();

      const beforeHandOver = new Date();
      await send(headers, 'A human please');
      const handedOver = await row(threadId);
      expect(handedOver.assigneeId).toBe(fx.a.ownerAccountId);
      expect(handedOver.needsHumanSince!.getTime()).toBeGreaterThanOrEqual(
        beforeHandOver.getTime() - 1000,
      );

      await deactivate(chatId);
      expect(await row(threadId)).toMatchObject({
        missedReason: 'unanswered_after_ai',
        firstResponseAt: null,
      });
    });

    it('counts an assigned agent who never wrote as unanswered, and an answered one as not missed', async () => {
      // No AI answers: the connection is routed to Support's agent on open.
      const unanswered = await send((await visitor()).headers, 'Is anyone there?');
      const opened = await row(unanswered.threadId);
      expect(opened.assigneeId).toBe(fx.a.agentAccountId);
      expect(opened.needsHumanSince).not.toBeNull();

      // An internal note is not an answer to the player.
      const note = await server.post(
        `/chats/${unanswered.chatId}/events`,
        { type: 'message', text: 'Looking', recipients: 'agents' },
        auth(adminToken),
      );
      expect(note.statusCode).toBe(201);
      await deactivate(unanswered.chatId);
      expect((await row(unanswered.threadId)).missedReason).toBe('unanswered_assigned');

      const answered = await send((await visitor()).headers, 'Hello');
      const reply = await server.post(
        `/chats/${answered.chatId}/events`,
        { type: 'message', text: 'Hi, how can I help?', recipients: 'all' },
        auth(adminToken),
      );
      expect(reply.statusCode).toBe(201);
      await deactivate(answered.chatId);
      expect(await row(answered.threadId)).toMatchObject({
        missedReason: null,
        initiatedBy: 'customer',
      });
    });

    it('counts the player giving up in the queue as abandoned', async () => {
      await owner.agentMembership.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { routingStatus: 'not_accepting_chats' },
      });
      const { headers } = await visitor();
      const { threadId } = await send(headers, 'Hello?');
      const waiting = await row(threadId);
      expect(waiting.assigneeId).toBeNull();
      expect(waiting.needsHumanSince).not.toBeNull();

      const closed = await server.post('/customer/chat/close', undefined, headers);
      expect(closed.statusCode).toBe(204);
      expect((await row(threadId)).missedReason).toBe('queue_abandoned');
    });

    it('leaves a `parallel` AI’s own conversation and an agent’s own start unmissed', async () => {
      // `parallel` (the default): an agent is assigned on open while the AI
      // answers; the AI never hands over, so it handled the conversation.
      await skill();
      const parallel = await send((await visitor()).headers, 'Hello there');
      expect((await row(parallel.threadId)).assigneeId).toBe(fx.a.agentAccountId);
      await deactivate(parallel.chatId);
      expect((await row(parallel.threadId)).missedReason).toBeNull();

      const started = await server.post(
        '/chats',
        { customer_id: fx.a.customerId, assign_to_me: true },
        auth(adminToken),
      );
      expect(started.statusCode, started.body).toBe(201);
      const body = started.json() as { id: string; thread: { id: string } };
      expect(await row(body.thread.id)).toMatchObject({
        initiatedBy: 'agent',
        needsHumanSince: null,
      });
      await deactivate(body.id);
      expect((await row(body.thread.id)).missedReason).toBeNull();
    });

    it('writes the reason once: a later edit of the transcript does not change it', async () => {
      const { chatId, threadId } = await send((await visitor()).headers, 'Hello?');
      await deactivate(chatId);
      expect((await row(threadId)).missedReason).toBe('unanswered_assigned');
      await owner.thread.update({
        where: { id: threadId },
        data: { firstResponseAt: new Date() },
      });
      await owner.$transaction(async (tx) => {
        expect(await recordMissedReason(tx as never, threadId)).toBeNull();
      });
      expect((await row(threadId)).missedReason).toBe('unanswered_assigned');
    });
  });

  // --- The opener ------------------------------------------------------------

  describe('who started the connection', () => {
    it('names a campaign card the player opened from (RP-02 KK4)', async () => {
      const { headers, customerId } = await visitor();
      const campaign = await owner.campaign.create({
        data: { licenseId: fx.a.licenseId, name: 'Hoş geldin bonusu' },
        select: { id: true },
      });
      await owner.campaignSend.create({
        data: {
          licenseId: fx.a.licenseId,
          campaignId: campaign.id,
          customerId,
          deliveredAt: new Date(),
        },
      });
      const { threadId } = await send(headers, 'Tell me about the bonus');
      expect((await row(threadId)).initiatedBy).toBe('campaign');

      // A second visitor with no campaign behind them is the player's own.
      const plain = await send((await visitor()).headers, 'Hello');
      expect((await row(plain.threadId)).initiatedBy).toBe('customer');
    });

    it('names a channel adapter for a message that came through one', async () => {
      await seedDefaultBrand(owner, fx.a.licenseId);
      const connected = await server.post(
        '/channels/messenger/connect',
        { code: 'AQD_mock_oauth_code', page_id: '100000000000369', page_name: 'Acme' },
        auth(adminToken),
      );
      expect(connected.statusCode, connected.body).toBeLessThan(300);
      const inbound = await server.post('/channels/messenger/webhook', {
        recipient: { id: '100000000000369' },
        sender: { id: 'psid_missed_report', name: 'Dana' },
        message: { text: 'my withdrawal is late' },
      });
      expect(inbound.statusCode, inbound.body).toBeLessThan(300);
      const chatId = (inbound.json() as { chat_id: string }).chat_id;
      const thread = await owner.thread.findFirstOrThrow({
        where: { chatId },
        select: { initiatedBy: true },
      });
      expect(thread.initiatedBy).toBe('channel');
    });
  });

  // --- The reports -----------------------------------------------------------

  describe('the reports read what the close wrote', () => {
    it('totals the close scenarios by reason, and every opener has its own row', async () => {
      await skill([
        { type: 'detect_intent', intent: 'human', phrases: ['human'] },
        { type: 'transfer_to_team', group: 'Logistics' },
        { type: 'send_message', source: 'text', text: AI_ANSWER },
      ]);
      await aiFirst();
      // One the AI kept, one it handed over and nobody answered.
      const kept = await send((await visitor()).headers, 'Hello there');
      await deactivate(kept.chatId);
      const handed = await visitor();
      const after = await send(handed.headers, 'Hello there');
      await send(handed.headers, 'A human please');
      await deactivate(after.chatId);

      const missed = await report('/reports/missed');
      expect(missed.totals).toEqual({
        closed: 2,
        missed: 1,
        missed_rate: 0.5,
        estimated: 0,
        queue_abandoned: 0,
        unanswered_assigned: 0,
        unanswered_after_ai: 1,
      });
      expect(missed.timezone).toBe('Europe/Istanbul');
      expect(missed.by_team).toEqual([
        {
          team_id: Number(logisticsId),
          name: 'Logistics',
          missed: 1,
          queue_abandoned: 0,
          unanswered_assigned: 0,
          unanswered_after_ai: 1,
        },
      ]);
      expect((missed.by_agent as Json[]).map((r) => [r.agent_id, r.missed])).toEqual([
        [fx.a.ownerAccountId, 1],
      ]);
      expect(missed.heatmap as Json[]).toHaveLength(168);
      expect((missed.previous_period as Json).missed).toBe(0);

      const engagement = await report('/reports/engagement');
      expect((engagement.by_initiator as Json[]).map((r) => r.initiated_by)).toEqual([
        ...ENGAGEMENT_INITIATORS,
      ]);
      expect(engagement.by_initiator as Json[]).toContainEqual({
        initiated_by: 'customer',
        chats: 2,
        closed: 2,
        answered: 0,
        missed: 1,
      });
      expect(engagement.by_initiator as Json[]).toContainEqual({
        initiated_by: 'campaign',
        chats: 0,
        closed: 0,
        answered: 0,
        missed: 0,
      });
      expect(engagement.totals).toEqual({ chats: 2 });
    });

    /** A closed connection written straight in, for the aggregation's own checks. */
    async function seeded(input: {
      at: Date;
      reason?: string | null;
      needsHuman?: boolean;
      initiatedBy?: string | null;
      team?: bigint;
      agent?: string | null;
    }): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Oyuncu' },
        select: { id: true },
      });
      const chatId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: false },
      });
      if (input.team !== undefined) {
        await owner.chatAccess.create({ data: { chatId, groupId: input.team } });
      }
      const threadId = generateShortId();
      await owner.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: fx.a.licenseId,
          active: false,
          createdAt: input.at,
          closedAt: new Date(input.at.getTime() + 600_000),
          assigneeId: input.agent === undefined ? fx.a.agentAccountId : input.agent,
          groupId: input.team ?? null,
          initiatedBy: input.initiatedBy === undefined ? 'customer' : input.initiatedBy,
          missedReason: input.reason ?? null,
          needsHumanSince: input.reason && input.needsHuman !== false ? input.at : null,
        },
      });
      return threadId;
    }

    it('lays the heat map and the days out in the workspace’s zone, not UTC, RP-02 KK3 (FR-MOD-07.5)', async () => {
      // Monday 2026-10-26 22:30 UTC is Tuesday 01:30 in Istanbul (UTC+3) and
      // Tuesday 07:30 in Tokyo (UTC+9).
      const at = new Date('2026-10-26T22:30:00.000Z');
      await seeded({ at, reason: 'queue_abandoned', agent: null });
      const q = `from=2026-10-20T00:00:00.000Z&to=2026-10-31T00:00:00.000Z`;

      const cellsWith = (body: Json) =>
        (body.heatmap as Array<{ weekday: number; hour: number; missed: number }>)
          .filter((cell) => cell.missed > 0)
          .map((cell) => [cell.weekday, cell.hour]);
      const istanbul = await report(`/reports/missed?${q}`);
      expect(cellsWith(istanbul)).toEqual([[2, 1]]);
      expect((istanbul.by_day as Json[]).map((d) => d.date)).toEqual(['2026-10-27']);

      await owner.inboxSettings.create({
        data: {
          licenseId: fx.a.licenseId,
          brandId: await seedDefaultBrand(owner, fx.a.licenseId),
          dayBoundaryTz: 'Asia/Tokyo',
        },
      });
      const tokyo = await report(`/reports/missed?${q}`);
      expect(tokyo.timezone).toBe('Asia/Tokyo');
      expect(cellsWith(tokyo)).toEqual([[2, 7]]);

      // The export is the same reading.
      const csv = await server.get(`/reports/export?group=missed&${q}`, auth(adminToken));
      expect(csv.statusCode).toBe(200);
      const lines = csv.body.trim().split(/\r?\n/);
      expect(lines[0]).toBe(
        'dimension,key,name,missed,queue_abandoned,unanswered_assigned,unanswered_after_ai',
      );
      expect(lines).toContain('hour_of_week,2T07,,1,1,0,0');
      expect(lines).toContain('day,2026-10-27,,1,1,0,0');
      expect(lines).toContain('total,all,,1,1,0,0');
    });

    it('takes the report filter, splits by team and agent, and marks the backfill’s estimates (FR-MOD-07.5)', async () => {
      const at = new Date(Date.now() - DAY);
      await seeded({ at, reason: 'unanswered_assigned', team: supportId });
      await seeded({
        at,
        reason: 'unanswered_after_ai',
        team: logisticsId,
        agent: fx.a.ownerAccountId,
      });
      // Inferred by the backfill: a reason but no `needs_human_since`.
      await seeded({
        at,
        reason: 'queue_abandoned',
        needsHuman: false,
        team: supportId,
        agent: null,
        initiatedBy: null,
      });
      await seeded({ at, team: supportId, initiatedBy: 'agent' });

      const all = await report('/reports/missed');
      expect(all.totals).toMatchObject({ closed: 4, missed: 3, estimated: 1 });
      expect((all.by_team as Json[]).map((r) => [r.name, r.missed])).toEqual([
        ['Support', 2],
        ['Logistics', 1],
      ]);
      expect((all.by_agent as Json[]).map((r) => [r.agent_id, r.missed]).sort()).toEqual(
        [
          [fx.a.agentAccountId, 1],
          [fx.a.ownerAccountId, 1],
        ].sort(),
      );

      const support = await report(`/reports/missed?group_id=${supportId}`);
      expect(support.filters).toEqual({ group_id: [String(supportId)] });
      expect(support.totals).toMatchObject({ closed: 3, missed: 2, unanswered_after_ai: 0 });
      const byAgent = await report(`/reports/missed?agent_id=${fx.a.ownerAccountId}`);
      expect(byAgent.totals).toMatchObject({ missed: 1, unanswered_after_ai: 1 });

      const engagement = await report('/reports/engagement');
      const chatsOf = (body: Json) =>
        Object.fromEntries(
          (body.by_initiator as Array<{ initiated_by: string; chats: number }>).map((r) => [
            r.initiated_by,
            r.chats,
          ]),
        );
      expect(chatsOf(engagement)).toEqual({
        customer: 2,
        agent: 1,
        campaign: 0,
        ai: 0,
        channel: 0,
        unknown: 1,
      });
      expect(chatsOf(await report(`/reports/engagement?group_id=${logisticsId}`))).toMatchObject({
        customer: 1,
        agent: 0,
        unknown: 0,
      });

      const csv = await server.get('/reports/export?group=engagement', auth(adminToken));
      expect(csv.statusCode).toBe(200);
      expect(csv.body).toContain('total,all,unknown,1,1,0,1');
    });
  });

  // --- The backfill ----------------------------------------------------------

  describe('the partial backfill (20261210090100)', () => {
    type Line =
      | { author: 'customer' | 'bot' | 'agent' }
      | { system: 'chat_transferred' | 'ai_mode_changed'; reason: string };

    /** A connection closed before the close wrote the reason: no `needs_human_since`. */
    async function old(input: {
      assignee?: string | null;
      queued?: boolean;
      openedVia?: string;
      answered?: boolean;
      lines?: Line[];
    }): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId },
        select: { id: true },
      });
      const chatId = generateShortId();
      const startedAt = new Date(Date.now() - 2 * DAY);
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: false },
      });
      const threadId = generateShortId();
      await owner.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: fx.a.licenseId,
          active: false,
          createdAt: startedAt,
          closedAt: new Date(startedAt.getTime() + 3_600_000),
          assigneeId: input.assignee ?? null,
          openedVia: input.openedVia ?? 'first_of_day',
          firstResponseAt: input.answered ? new Date(startedAt.getTime() + 60_000) : null,
        },
      });
      if (input.queued) {
        await owner.queueEntry.create({
          data: {
            licenseId: fx.a.licenseId,
            threadId,
            enteredAt: startedAt,
            leftAt: new Date(startedAt.getTime() + 3_600_000),
            outcome: 'abandoned',
          },
        });
      }
      let n = 0;
      for (const line of input.lines ?? [{ author: 'customer' }]) {
        n += 1;
        const base = {
          id: `${threadId}_${n}`,
          threadId,
          chatId,
          licenseId: fx.a.licenseId,
          createdAt: new Date(startedAt.getTime() + n * 60_000),
        };
        await owner.event.create({
          data:
            'system' in line
              ? {
                  ...base,
                  type: 'system_message',
                  authorType: 'system',
                  authorId: 'system',
                  properties: { system_event: line.system, reason: line.reason },
                }
              : {
                  ...base,
                  type: 'message',
                  text: 'x',
                  authorType: line.author,
                  authorId: line.author === 'agent' ? fx.a.agentAccountId : `${line.author}-1`,
                  recipients: 'all',
                },
        });
      }
      return threadId;
    }

    it('infers each reason by the close’s own rule, and leaves what it cannot tell alone', async () => {
      const handoff: Line = { system: 'chat_transferred', reason: 'ai_handoff' };
      const made: Record<string, string> = {
        assigned: await old({ assignee: fx.a.agentAccountId }),
        queued: await old({ queued: true }),
        handedOver: await old({
          assignee: fx.a.ownerAccountId,
          lines: [{ author: 'customer' }, { author: 'bot' }, handoff],
        }),
        stalled: await old({
          lines: [
            { author: 'bot' },
            { system: 'ai_mode_changed', reason: 'ai_failure' },
            { author: 'customer' },
          ],
        }),
        aiKept: await old({
          assignee: fx.a.agentAccountId,
          lines: [{ author: 'customer' }, { author: 'bot' }],
        }),
        answered: await old({ assignee: fx.a.agentAccountId, answered: true }),
        agentStart: await old({ assignee: fx.a.agentAccountId, openedVia: 'agent_start' }),
        nobodyNeeded: await old({}),
      };

      // The live rule, read off the same rows as if `needs_human_since` had
      // been recorded wherever the backfill infers a person was needed.
      const live = async (id: string): Promise<string | null> => {
        const [r] = await owner.$queryRaw<Array<{ reason: string | null }>>`
          SELECT CASE WHEN ${MISSED_SQL} THEN ${MISSED_REASON_SQL} END AS reason
            FROM (SELECT x.id, x.assignee_id, x.first_response_at,
                         x.closed_at AS needs_human_since
                    FROM threads x WHERE x.id = ${id}) t`;
        return r?.reason ?? null;
      };

      await owner.$executeRawUnsafe(readFileSync(BACKFILL, 'utf8'));
      const stored = Object.fromEntries(
        await Promise.all(
          Object.entries(made).map(
            async ([name, id]) =>
              [
                name,
                (await owner.thread.findUniqueOrThrow({ where: { id } })).missedReason,
              ] as const,
          ),
        ),
      );
      expect(stored).toEqual({
        assigned: 'unanswered_assigned',
        queued: 'queue_abandoned',
        handedOver: 'unanswered_after_ai',
        stalled: 'unanswered_after_ai',
        aiKept: null,
        answered: null,
        agentStart: null,
        nobodyNeeded: null,
      });
      // Each inferred reason is the one the live close would have written.
      for (const name of ['assigned', 'queued', 'handedOver', 'stalled', 'aiKept', 'answered']) {
        expect(await live(made[name]!), name).toBe(stored[name]);
      }
      // Estimates carry no recorded moment; a re-run changes nothing.
      expect(
        await owner.thread.count({
          where: { id: { in: Object.values(made) }, needsHumanSince: { not: null } },
        }),
      ).toBe(0);
      await owner.$executeRawUnsafe(readFileSync(BACKFILL, 'utf8'));
      expect(
        await owner.thread.count({
          where: { id: { in: Object.values(made) }, missedReason: { not: null } },
        }),
      ).toBe(4);
    });
  });
});
