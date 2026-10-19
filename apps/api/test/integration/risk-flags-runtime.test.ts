/**
 * Risk flags on live conversations (tm 302.2 · SiyahTuş analysis AI-27),
 * through the real server, the AI job worker and the in-process model stub:
 *
 *   - "Hesabımı kapatmak istiyorum, oynamayı bırakacağım" raises
 *     `self_exclusion_request` (urgent, the player's) in the same transaction
 *     as the hand-over, with no bonus said — and the operator's webhook, the
 *     chosen address and the supervisors hear of it, without a word of it;
 *   - a flag raised by an agent while the AI had the conversation keeps the AI
 *     out: its next turn writes nothing and hands over, and the conversation
 *     cannot be given back (409, from the stored flag alone);
 *   - a player flagged in an earlier conversation is talked to without a
 *     bonus (G4), and the AI still answers;
 *   - the flag and the hand-over commit together or not at all.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RISK_FLAG_DEFAULTS,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { raiseRiskFlag } from '../../src/services/risk/risk-flags.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const SAFE = 'Bilgilerinizi ilgili ekibimize iletiyorum.';
const BONUS = 'Bonus kurallarını kısaca anlat.';
/** The answer with "is it solved?" after it (K9 · tm 303.4). */
const BONUS_ASKED = `${BONUS}\nSorununuz çözüldü mü?`;
const PROMOTION = /bonus|promosyon|kampanya|freespin|yatırın/i;
const KK = 'Hesabımı kapatmak istiyorum, oynamayı bırakacağım';
const OPERATOR = 'rg-desk@operator.test';

interface Delivery {
  action: string;
  data: Record<string, unknown>;
}

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

describe('risk flags on a live conversation (AI-27 · tm 302.2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let mailDir: string;
  let mailer: FileMailer;
  let received: Delivery[] = [];
  let ownerHeaders: Record<string, string>;

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-riskflags-'));
    mailer = new FileMailer(mailDir);
    server = await startTestServer(
      {},
      {
        mailer,
        webhookSender: async (_target, request) => {
          received.push(JSON.parse(request.body) as Delivery);
          return { ok: true, statusCode: 200 };
        },
      },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  async function agentOf(t: TenantFixture): Promise<string> {
    return (
      await owner.aiAgent.create({
        data: { licenseId: t.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
  }

  /** A topic whose turn is one written part — the stub writes the instruction back. */
  async function storeSaying(
    t: TenantFixture,
    agentId: string,
    example: string,
    instruction: string,
  ): Promise<void> {
    const { procedure: body, ...own } = splitSkillProcedure(
      build({
        when_to_use: `Oyuncu ${example} diyor.`,
        examples: [example],
        steps: [
          { id: 'anlat', type: 'say', instruction },
          { id: 'bitti', type: 'resolve', outcome: 'resolved' },
        ],
      }),
    );
    await owner.skill.create({
      data: {
        licenseId: t.licenseId,
        aiAgentId: agentId,
        name: example,
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
  }

  async function visitor(t: TenantFixture): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  /** One visitor message, answered: the chat, the connection, the message, what the bot said, whose it is. */
  async function say(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { id: string; thread_id: string } };
    const bot = await owner.event.findMany({
      where: { chatId: sent.chat_id, authorType: 'bot' },
      orderBy: { createdAt: 'asc' },
      select: { text: true },
    });
    const thread = await owner.thread.findUniqueOrThrow({
      where: { id: sent.event.thread_id },
      select: { aiMode: true },
    });
    return {
      chatId: sent.chat_id,
      threadId: sent.event.thread_id,
      eventId: sent.event.id,
      said: bot.map((event) => event.text),
      aiMode: thread.aiMode,
    };
  }

  const flags = (licenseId: bigint) =>
    owner.riskFlag.findMany({ where: { licenseId }, orderBy: { raisedAt: 'asc' } });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    received = [];
    const aiAgentId = await agentOf(fx.a);
    await storeSaying(fx.a, aiAgentId, 'bonus nedir', BONUS);
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'access_rules:rw', 'webhooks--all:rw'],
    });
    ownerHeaders = { authorization: `Bearer ${token}` };
  });

  it('“Hesabımı kapatmak istiyorum, oynamayı bırakacağım”: self_exclusion_request (urgent, the player’s) with the hand-over, no bonus — the operator hears without a word of it (AI-27 acceptance)', async () => {
    const settings = await server.put(
      '/risk-flags/settings',
      { notify_emails: [OPERATOR] },
      ownerHeaders,
    );
    expect(settings.statusCode).toBe(200);
    const hook = await server.post(
      '/webhooks',
      { url: 'https://93.184.216.34/hooks/risk', action: 'risk_flag_raised' },
      ownerHeaders,
    );
    expect(hook.statusCode).toBe(201);

    const turn = await say(await visitor(fx.a), KK);

    // No persuasion, no bonus, no alternative: a person, this turn.
    expect(turn.said).toEqual([SAFE]);
    expect(turn.said.join(' ')).not.toMatch(PROMOTION);
    expect(turn.aiMode).toBe('human');

    const chat = await owner.chat.findUniqueOrThrow({
      where: { id: turn.chatId },
      select: { customerId: true },
    });
    const [flag, ...more] = await flags(fx.a.licenseId);
    expect(more).toEqual([]);
    expect(flag).toMatchObject({
      type: 'self_exclusion_request',
      severity: 'urgent',
      scope: 'member',
      source: 'ai_rule',
      ruleRef: 'G1',
      raisedBy: null,
      basis: 'declared',
      status: 'active',
      chatId: turn.chatId,
      threadId: turn.threadId,
      customerId: chat.customerId,
      evidenceEventIds: [turn.eventId],
      note: null,
    });
    expect(RISK_FLAG_DEFAULTS.self_exclusion_request.topic).toBe('responsible_gaming');

    // The webhook: what, where, whose — not what was said.
    expect(received).toEqual([
      {
        action: 'risk_flag_raised',
        data: {
          flag_id: flag!.id,
          type: 'self_exclusion_request',
          severity: 'urgent',
          scope: 'member',
          status: 'active',
          chat_id: turn.chatId,
          thread_id: turn.threadId,
          member_key: null,
          raised_at: flag!.raisedAt.toISOString(),
          cleared_at: null,
        },
      },
    ]);
    expect(JSON.stringify(received)).not.toMatch(/kapatmak|oynamay|bırak/i);

    // The urgent mail: the chosen address and the owner (a supervisor).
    const outbox = await mailer.outbox();
    const to = outbox.filter((mail) => mail.kind === 'notification').map((mail) => mail.to);
    expect(to).toEqual(expect.arrayContaining([OPERATOR]));
    expect(to.length).toBeGreaterThanOrEqual(2);
    for (const mail of outbox) {
      expect(`${mail.subject} ${mail.body}`).not.toMatch(/kapatmak|oynamay|bırak/i);
    }
    expect(outbox.find((mail) => mail.to === OPERATOR)?.subject).toContain(
      'Kendini oyundan men talebi',
    );

    // The same turn again raises nothing new: one active flag of a type per conversation.
    expect(await flags(fx.a.licenseId)).toHaveLength(1);
  });

  it('an agent’s flag while the AI has the conversation keeps the AI out: no reply, a hand-over, and no hand-back (409 from the stored flag)', async () => {
    const headers = await visitor(fx.a);
    const first = await say(headers, 'bonus nedir');
    expect(first.said).toEqual([BONUS_ASKED]);
    expect(first.aiMode).toBe('ai');

    const raised = await server.post(
      `/chats/${first.chatId}/risk-flags`,
      { type: 'rg_signal', note: 'Kayıplarını kovaladığını yazdı.' },
      ownerHeaders,
    );
    expect(raised.statusCode).toBe(201);
    // Not the conversation's state: the stored flag is all there is.
    const conversation = await owner.aiConversation.findFirstOrThrow({
      where: { threadId: first.threadId },
      select: { signals: true },
    });
    expect((conversation.signals as { risk_flags?: unknown }).risk_flags).toBeUndefined();

    const second = await say(headers, 'bonus nedir');
    expect(second.said).toEqual([BONUS_ASKED]);
    expect(second.aiMode).toBe('human');
    const [, record] = await owner.aiDecisionLog.findMany({
      where: { licenseId: fx.a.licenseId },
      orderBy: { createdAt: 'asc' },
    });
    expect(record).toMatchObject({ decision: 'handoff', handoffReason: 'risk_flag' });

    const back = await server.post(`/chats/${first.chatId}/return-to-ai`, {}, ownerHeaders);
    expect(back.statusCode).toBe(409);
    expect(back.json()).toMatchObject({
      error: { type: 'ai_return_blocked', details: { risk_flags: ['rg_signal'] } },
    });
  });

  it('a player flagged in an earlier conversation gets no bonus talk (G4), and the AI still answers', async () => {
    const headers = await visitor(fx.a);
    const first = await say(headers, 'bonus nedir');
    expect(first.said).toEqual([BONUS_ASKED]);
    const chat = await owner.chat.findUniqueOrThrow({
      where: { id: first.chatId },
      select: { customerId: true },
    });
    // Yesterday's self-exclusion request, its conversation gone (retention).
    await owner.riskFlag.create({
      data: {
        licenseId: fx.a.licenseId,
        scope: 'member',
        customerId: chat.customerId,
        type: 'self_exclusion_request',
        severity: 'urgent',
        source: 'agent',
        raisedBy: fx.a.ownerAccountId,
      },
    });

    const second = await say(headers, 'bonus nedir');
    // Not a yes to "is it solved?": the first topic is let go and the question runs anew (K9).
    expect(second.said).toEqual([BONUS_ASKED, SAFE]);
    const records = await owner.aiDecisionLog.findMany({
      where: { licenseId: fx.a.licenseId },
      orderBy: { createdAt: 'asc' },
    });
    expect(records[1]).toMatchObject({
      handoffReason: 'guardrail_output_block',
      guardrailHits: ['G4'],
    });
    // Promotions off, the AI not kept out: no new flag, no risk hand-over.
    expect(records[1]?.handoffReason).not.toBe('risk_flag');
    expect(await flags(fx.a.licenseId)).toHaveLength(1);
  });

  it('the flag and the hand-over commit together: a hand-over that fails takes the flag with it', async () => {
    const headers = await visitor(fx.a);
    const first = await say(headers, 'bonus nedir');
    expect(first.aiMode).toBe('ai');

    const chats = new ChatService(server.app.db, server.app.redis);
    const tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    const ref = { chatId: first.chatId, threadId: first.threadId };
    const raise = {
      type: 'underage_suspected' as const,
      chatId: first.chatId,
      threadId: first.threadId,
      source: 'ai_rule' as const,
      ruleRef: 'G5',
      raisedBy: null,
      note: null,
      evidenceEventIds: [first.eventId],
    };

    await expect(
      chats.handOverFromAi(tenant, ref, 'ai_handoff', {
        alongside: async (tx) => {
          await raiseRiskFlag(tx, fx.a.licenseId, raise);
          throw new Error('the hand-over failed after the flag');
        },
      }),
    ).rejects.toThrow('the hand-over failed after the flag');
    expect(await flags(fx.a.licenseId)).toEqual([]);
    const after = await owner.thread.findUniqueOrThrow({
      where: { id: first.threadId },
      select: { aiMode: true },
    });
    expect(after.aiMode).toBe('ai');

    expect(
      await chats.handOverFromAi(tenant, ref, 'ai_handoff', {
        alongside: async (tx) => {
          await raiseRiskFlag(tx, fx.a.licenseId, raise);
        },
      }),
    ).toBe(true);
    expect(await flags(fx.a.licenseId)).toMatchObject([
      { type: 'underage_suspected', ruleRef: 'G5' },
    ]);
    expect(
      (
        await owner.thread.findUniqueOrThrow({
          where: { id: first.threadId },
          select: { aiMode: true },
        })
      ).aiMode,
    ).toBe('human');
  });
});
