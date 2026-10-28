/**
 * What became of each connection the AI took part in (tm 320.1 · SiyahTuş
 * analysis AI-25; owner decisions K9, K10), through the real server and the
 * real database — the write points of `ai_conversation_outcomes`:
 *
 *   - the AI's first turn opens the row (identity, topic, counts, the
 *     required slots) and marks its "is it solved?" message for the widget;
 *     a typed "evet" confirms (K9: what the AI claimed and what the player
 *     confirmed, apart);
 *   - the widget's Yes / No buttons: yes is thanked and confirms, no hands
 *     over with `player_said_unresolved`, a press with nothing asked keeps
 *     nothing;
 *   - a guardrail's hand-over on the first message: `handed_off`, the
 *     mandatory rule, the risk flag;
 *   - the person's first reply, the rating's subject (BSAT before a person,
 *     CSAT after), the card's verdict;
 *   - the close: `assumed_pending` with no answer and no hand-over, a
 *     confirmed one stays confirmed — and ADR-09's billed AI resolution
 *     (`handled_by`) is what it was (AI-25-S1);
 *   - the QA review's result and a risk flag raised later;
 *   - the table: RLS, grants, the CHECKs of the closed lists.
 */
import { PrismaClient } from '@prisma/client';
import {
  AI_OUTCOMES,
  DEFAULT_HANDOFF_MESSAGES,
  HANDOFF_REASONS,
  QA_MANDATORY_HANDOFF_REASONS,
  RESOLUTION_PHRASES,
  RESOLUTION_PROMPT_PROPERTY,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { raiseRiskFlag } from '../../src/services/risk/risk-flags.js';
import { recordOutcomeQa } from '../../src/services/reports/ai-outcomes.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const ANSWER = 'Bonus kurallarını kısaca anlat.';
const RG_MESSAGE = 'artık oynamak istemiyorum, hesabımı kapatın';

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

describe('the AI outcome of a connection (AI-25 · tm 320.1)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let skillId: string;
  let agentToken: string;

  const tenantOf = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
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
    // One required slot, then "solved": the platform's criteria ask the player.
    const { procedure: body, ...own } = splitSkillProcedure(
      build({
        when_to_use: 'Oyuncu bonus nedir diyor.',
        examples: ['bonus nedir'],
        steps: [
          { id: 'anlat', type: 'say', instruction: ANSWER },
          { id: 'bitti', type: 'resolve', outcome: 'resolved' },
        ],
      }),
    );
    skillId = (
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
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
        select: { id: true },
      })
    ).id;
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--all:rw'],
    });
  });

  async function visitor(t: TenantFixture): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  /** One visitor message, answered: the connection and what the bot said, with its properties. */
  async function say(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    const bot = await owner.event.findMany({
      where: { chatId: sent.chat_id, authorType: 'bot', type: 'message' },
      orderBy: { createdAt: 'asc' },
      select: { text: true, properties: true },
    });
    return {
      chatId: sent.chat_id,
      threadId: sent.event.thread_id,
      said: bot.map((event) => event.text),
      last: bot.at(-1)?.properties as Record<string, unknown> | undefined,
    };
  }

  const row = (threadId: string) =>
    owner.aiConversationOutcome.findFirstOrThrow({ where: { threadId } });
  const answer = (headers: Record<string, string>, value: 'yes' | 'no') =>
    server.post('/customer/chat/resolution', { answer: value }, headers);
  const close = (headers: Record<string, string>) =>
    server.post('/customer/chat/close', {}, headers);

  describe('the AI’s turns', () => {
    it('the first turn opens the row; the "is it solved?" message carries the prompt; "evet" confirms (K9)', async () => {
      const headers = await visitor(fx.a);
      const asked = await say(headers, 'bonus nedir');
      expect(asked.last?.[RESOLUTION_PROMPT_PROPERTY]).toBe('asked');

      const chat = await owner.chat.findUniqueOrThrow({
        where: { id: asked.chatId },
        select: { brandId: true, customerId: true },
      });
      const opened = await row(asked.threadId);
      expect(opened).toMatchObject({
        licenseId: fx.a.licenseId,
        chatId: asked.chatId,
        threadId: asked.threadId,
        brandId: chat.brandId,
        aiAgentId,
        intent: skillId,
        procedureId: skillId,
        aiTurns: 1,
        playerTurns: 1,
        clarificationTurns: 0,
        requiredSlotsTotal: 0,
        requiredSlotsFilled: 0,
        outcome: null,
        aiClaimedResolved: false,
        resolutionConfirmation: null,
        confirmedAt: null,
        handoffAt: null,
        endedAt: null,
      });
      // A visitor this workspace signed: the repeat search follows them (K4).
      expect(opened.memberKey).toBe(chat.customerId);

      const solved = await say(headers, 'evet');
      expect(solved.said.at(-1)).toBe(RESOLUTION_PHRASES.tr.thanks);
      expect(solved.last?.[RESOLUTION_PROMPT_PROPERTY]).toBeUndefined();
      const confirmed = await row(asked.threadId);
      expect(confirmed).toMatchObject({
        aiTurns: 2,
        playerTurns: 2,
        aiClaimedResolved: true,
        resolutionConfirmation: 'yes',
        outcome: 'confirmed_resolved',
      });
      expect(confirmed.confirmedAt).toBeInstanceOf(Date);

      // The close keeps it confirmed, and ADR-09 bills it as it always did (AI-25-S1).
      expect((await close(headers)).statusCode).toBe(204);
      const closed = await row(asked.threadId);
      expect(closed.outcome).toBe('confirmed_resolved');
      expect(closed.endedAt).toBeInstanceOf(Date);
      const thread = await owner.thread.findUniqueOrThrow({
        where: { id: asked.threadId },
        select: { handledBy: true },
      });
      expect(thread.handledBy).toBe('ai');
    });

    it('closed with no answer and no hand-over, it waits as assumed_pending — ADR-09 unchanged', async () => {
      const headers = await visitor(fx.a);
      const asked = await say(headers, 'bonus nedir');
      expect((await close(headers)).statusCode).toBe(204);
      const closed = await row(asked.threadId);
      expect(closed).toMatchObject({ outcome: 'assumed_pending', resolutionConfirmation: null });
      expect(closed.endedAt).toBeInstanceOf(Date);
      expect(closed.finalizedAt).toBeNull();
      const thread = await owner.thread.findUniqueOrThrow({
        where: { id: asked.threadId },
        select: { handledBy: true },
      });
      expect(thread.handledBy).toBe('ai');
    });
  });

  describe('the widget’s Yes / No (AI-25-S2)', () => {
    it('yes: kept, thanked in the persona’s language, confirmed — and the buttons have nothing left to answer', async () => {
      const headers = await visitor(fx.a);
      const asked = await say(headers, 'bonus nedir');
      const yes = await answer(headers, 'yes');
      expect(yes.statusCode, yes.body).toBe(200);
      expect(yes.json()).toEqual({
        answer: 'yes',
        recorded: true,
        owner: 'ai',
        human_available: expect.any(Boolean),
      });
      const thanked = await owner.event.findFirstOrThrow({
        where: { threadId: asked.threadId, authorType: 'bot', type: 'message' },
        orderBy: { createdAt: 'desc' },
        select: { text: true, properties: true },
      });
      expect(thanked.text).toBe(RESOLUTION_PHRASES.tr.thanks);
      expect(await row(asked.threadId)).toMatchObject({
        resolutionConfirmation: 'yes',
        outcome: 'confirmed_resolved',
        aiTurns: 1,
      });

      const again = await answer(headers, 'no');
      expect(again.json()).toMatchObject({ recorded: false, owner: 'ai' });
      expect(await row(asked.threadId)).toMatchObject({
        resolutionConfirmation: 'yes',
        outcome: 'confirmed_resolved',
        handoffAt: null,
      });
    });

    it('no: a person at once, reason player_said_unresolved — the row handed off with the answer kept', async () => {
      const headers = await visitor(fx.a);
      const asked = await say(headers, 'bonus nedir');
      const no = await answer(headers, 'no');
      expect(no.statusCode, no.body).toBe(200);
      expect(no.json()).toMatchObject({ answer: 'no', recorded: true });
      expect(['human', 'queue']).toContain((no.json() as { owner: string }).owner);

      const said = await owner.event.findFirstOrThrow({
        where: { threadId: asked.threadId, authorType: 'bot', type: 'message' },
        orderBy: { createdAt: 'desc' },
        select: { text: true },
      });
      expect(said.text).toContain(DEFAULT_HANDOFF_MESSAGES.player_said_unresolved.tr);
      const thread = await owner.thread.findUniqueOrThrow({
        where: { id: asked.threadId },
        select: { aiMode: true },
      });
      expect(thread.aiMode).toBe('human');
      const card = await owner.aiHandoff.findFirstOrThrow({ where: { threadId: asked.threadId } });
      expect(card.primaryReason).toBe('player_said_unresolved');
      expect(card.requestedVia).toBeNull();

      const handed = await row(asked.threadId);
      expect(handed).toMatchObject({
        outcome: 'handed_off',
        handoffReason: 'player_said_unresolved',
        handoffMandatoryRule: null,
        resolutionConfirmation: 'no',
      });
      expect(handed.handoffAt).toBeInstanceOf(Date);
    });

    it('with nothing asked, or no open connection, a press keeps nothing', async () => {
      const headers = await visitor(fx.a);
      expect((await answer(headers, 'yes')).statusCode).toBe(409);

      const asked = await say(headers, 'bonus nedir');
      await server.post('/customer/chat/events', { text: 'bir şey daha' }, headers);
      const late = await answer(headers, 'yes');
      expect(late.json()).toMatchObject({ recorded: false });
      expect((await row(asked.threadId)).resolutionConfirmation).toBeNull();

      expect(
        (await server.post('/customer/chat/resolution', { answer: 'maybe' }, headers)).statusCode,
      ).toBe(400);
    });
  });

  describe('a hand-over, a person, a rating, the card', () => {
    it('a guardrail’s hand-over on the first message: handed off, the mandatory rule, the risk flag', async () => {
      const turn = await say(await visitor(fx.a), RG_MESSAGE);
      const handed = await row(turn.threadId);
      expect(handed).toMatchObject({
        outcome: 'handed_off',
        handoffReason: 'guardrail_rg',
        handoffMandatoryRule: 'guardrail_rg',
      });
      expect(handed.handoffAt).toBeInstanceOf(Date);
      // "close my account": a self-exclusion request, raised by the turn (AI-27).
      expect(handed.flags).toEqual(['self_exclusion_request']);
      expect(handed.guardrailHits).toEqual(
        expect.arrayContaining([expect.objectContaining({ stage: 'input' })]),
      );
    });

    it('the first person’s reply, then the rating is a CSAT; the card’s verdict is the hand-over quality', async () => {
      const headers = await visitor(fx.a);
      const asked = await say(headers, 'bonus nedir');
      await answer(headers, 'no');
      const reply = await server.post(
        `/chats/${asked.chatId}/events`,
        { type: 'message', text: 'Merhaba, inceliyorum.' },
        { authorization: `Bearer ${agentToken}` },
      );
      expect(reply.statusCode, reply.body).toBe(201);
      await server.post(
        `/chats/${asked.chatId}/events`,
        { type: 'message', text: 'Bir dakika.' },
        { authorization: `Bearer ${agentToken}` },
      );
      const replied = await row(asked.threadId);
      expect(replied.firstHumanReplyAt).toBeInstanceOf(Date);
      expect(replied.firstHumanReplyAt!.getTime()).toBeGreaterThanOrEqual(
        replied.handoffAt!.getTime(),
      );

      const rated = await server.post('/customer/chat/rating', { value: 'bad' }, headers);
      expect(rated.statusCode, rated.body).toBe(201);
      const rating = await owner.rating.findFirstOrThrow({ where: { threadId: asked.threadId } });
      expect(rating.subject).toBe('human');
      expect(await row(asked.threadId)).toMatchObject({ bsat: null, csatAfterHandoff: 'bad' });

      const card = await owner.aiHandoff.findFirstOrThrow({ where: { threadId: asked.threadId } });
      const verdict = await server.post(
        `/ai-handoffs/${card.id}/feedback`,
        { value: 'insufficient', missing: ['yontem', ' tutar ', 'yontem'], reasked: true },
        { authorization: `Bearer ${agentToken}` },
      );
      expect(verdict.statusCode, verdict.body).toBe(200);
      expect(await row(asked.threadId)).toMatchObject({
        handoffCardRating: 'insufficient',
        handoffCardMissing: ['yontem', 'tutar'],
        agentReasked: true,
      });
      const refused = await server.post(
        `/ai-handoffs/${card.id}/feedback`,
        { value: 'sufficient', missing: Array.from({ length: 21 }, (_, i) => `f${i}`) },
        { authorization: `Bearer ${agentToken}` },
      );
      expect(refused.statusCode).toBe(400);
    });

    it('a rating before any person is the AI’s: BSAT', async () => {
      const headers = await visitor(fx.a);
      const asked = await say(headers, 'bonus nedir');
      const rated = await server.post('/customer/chat/rating', { value: 'good' }, headers);
      expect(rated.statusCode, rated.body).toBe(201);
      const rating = await owner.rating.findFirstOrThrow({ where: { threadId: asked.threadId } });
      expect(rating.subject).toBe('ai');
      expect(await row(asked.threadId)).toMatchObject({ bsat: 'good', csatAfterHandoff: null });
    });
  });

  describe('QA and risk flags', () => {
    it('a completed review keeps its result; a failed hand-over timing is a mandatory hand-over violation', async () => {
      const asked = await say(await visitor(fx.a), 'bonus nedir');
      const db = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
        withTenant(app, tenantOf(fx.a), fn);

      await db((tx) => recordOutcomeQa(tx, asked.threadId, { final: 'pass', failed: [] }));
      expect(await row(asked.threadId)).toMatchObject({
        qaResult: 'pass',
        guardrailViolationsConfirmed: 0,
        mandatoryHandoffViolation: false,
      });
      await db((tx) =>
        recordOutcomeQa(tx, asked.threadId, {
          final: 'fail',
          failed: ['guardrails', 'handoff_timing'],
        }),
      );
      expect(await row(asked.threadId)).toMatchObject({
        qaResult: 'fail',
        guardrailViolationsConfirmed: 1,
        mandatoryHandoffViolation: true,
      });
      await db((tx) => recordOutcomeQa(tx, asked.threadId, { final: 'fail', failed: ['topic'] }));
      expect((await row(asked.threadId)).qaResult).toBe('unresolved');

      // Licence B cannot write licence A's row.
      await withTenant(app, tenantOf(fx.b), (tx) =>
        recordOutcomeQa(tx, asked.threadId, { final: 'pass', failed: [] }),
      );
      expect((await row(asked.threadId)).qaResult).toBe('unresolved');
    });

    it('a risk flag an agent raises later joins the row, once', async () => {
      const asked = await say(await visitor(fx.a), 'bonus nedir');
      for (let i = 0; i < 2; i += 1) {
        await withTenant(app, tenantOf(fx.a), (tx) =>
          raiseRiskFlag(tx, fx.a.licenseId, {
            type: 'multi_account',
            chatId: asked.chatId,
            threadId: asked.threadId,
            source: 'agent',
            ruleRef: null,
            raisedBy: fx.a.agentAccountId,
            note: null,
            evidenceEventIds: [],
          }),
        );
      }
      expect((await row(asked.threadId)).flags).toEqual(['multi_account']);
    });
  });

  describe('the table', () => {
    it('is behind RLS: another licence sees no row; the app reads, writes and updates, never deletes', async () => {
      const asked = await say(await visitor(fx.a), 'bonus nedir');
      const mine = await withTenant(app, tenantOf(fx.a), (tx) =>
        tx.aiConversationOutcome.count({ where: { threadId: asked.threadId } }),
      );
      const theirs = await withTenant(app, tenantOf(fx.b), (tx) =>
        tx.aiConversationOutcome.count({ where: { threadId: asked.threadId } }),
      );
      expect([mine, theirs]).toEqual([1, 0]);

      const [grants] = await owner.$queryRaw<
        Array<{ select: boolean; insert: boolean; update: boolean; delete: boolean }>
      >`
        SELECT has_table_privilege('siyahtus_app', 'ai_conversation_outcomes', 'SELECT') AS select,
               has_table_privilege('siyahtus_app', 'ai_conversation_outcomes', 'INSERT') AS insert,
               has_table_privilege('siyahtus_app', 'ai_conversation_outcomes', 'UPDATE') AS update,
               has_table_privilege('siyahtus_app', 'ai_conversation_outcomes', 'DELETE') AS delete`;
      expect(grants).toEqual({ select: true, insert: true, update: true, delete: false });
    });

    it('its CHECKs are the closed lists of @siyahtus/types', async () => {
      const definitions = await owner.$queryRaw<Array<{ name: string; def: string }>>`
        SELECT conname AS name, pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conrelid IN ('ai_conversation_outcomes'::regclass, 'ratings'::regclass)
           AND contype = 'c'`;
      const listed = (name: string): string[] => {
        const def = definitions.find((d) => d.name === name)?.def ?? '';
        const inner = /ARRAY\[(.*?)\]/s.exec(def)?.[1] ?? def;
        return [...inner.matchAll(/'([a-z_0-9]+)'::text/g)].map((m) => m[1]!);
      };
      expect(listed('ai_conversation_outcomes_outcome_check')).toEqual([...AI_OUTCOMES]);
      expect(listed('ai_conversation_outcomes_handoff_reason_check')).toEqual([...HANDOFF_REASONS]);
      expect(listed('ai_conversation_outcomes_mandatory_rule_check')).toEqual([
        ...QA_MANDATORY_HANDOFF_REASONS,
      ]);
      expect(listed('ratings_subject_check')).toEqual(['ai', 'human']);

      const asked = await say(await visitor(fx.a), 'bonus nedir');
      await expect(
        owner.aiConversationOutcome.update({
          where: { licenseId_threadId: { licenseId: fx.a.licenseId, threadId: asked.threadId } },
          data: { outcome: 'resolved' },
        }),
      ).rejects.toThrow(/ai_conversation_outcomes_outcome_check/);
      await expect(
        owner.aiConversationOutcome.update({
          where: { licenseId_threadId: { licenseId: fx.a.licenseId, threadId: asked.threadId } },
          data: { resolutionConfirmation: 'yes' },
        }),
      ).rejects.toThrow(/ai_conversation_outcomes_confirmed_at_check/);
    });
  });
});
