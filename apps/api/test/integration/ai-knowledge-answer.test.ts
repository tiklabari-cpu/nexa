/**
 * The knowledge answer and "I cannot answer this" on real visitor messages
 * (tm 298 · SiyahTuş analysis AI-06), through the real server, the AI job
 * worker and a real knowledge base (mock embeddings), with a recording model:
 *
 *   - the setting: `ai_handoff_settings.no_answer` — its defaults (AI-06-S1),
 *     a partial write that keeps the rest, its refusals and its CHECK;
 *   - a question an FAQ answers: the passage's answer goes out, and the
 *     decision record names the source it came from;
 *   - a question nothing answers: the AI says it cannot — a money question
 *     goes to a person at once (`no_knowledge`), anything else is asked once;
 *   - a draft with a figure no passage gives is written again, and withheld
 *     when it still has one;
 *   - **the silence rule, tested here and only here (AI-06 §9):** on a
 *     connection that is the AI's, every turn ends with a message from the
 *     bot or a hand-over to a person.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { splitSkillProcedure, type Procedure } from '@siyahtus/types';
import { mockKnowledgeAnswer } from '../../src/services/ai/conversation/knowledge-answer.js';
import { readAnswerGrounding } from '../../src/services/ai/provider/answer-prompt.js';
import { LlmProviderError } from '../../src/services/ai/provider/llm-error.js';
import type { LlmCompletionRequest } from '../../src/services/ai/provider/llm-provider.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { depositProcedure } from '../helpers/procedure-fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const FAQ = 'Çekim talepleri 24 saat içinde işlenir.';
const CANNOT_HAND_OVER =
  'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarıyorum.';
const CANNOT_ASK = 'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarayım mı?';

/** What the model writes for a knowledge answer: the stub's cited answer, unless a test says. */
type Script = (request: LlmCompletionRequest) => string;
const asTheStubWould: Script = (request) => {
  const grounding = readAnswerGrounding(request.system);
  if (!grounding) throw new Error('a knowledge answer request without its grounding');
  return JSON.stringify(mockKnowledgeAnswer(grounding));
};

describe('the knowledge answer and "I cannot answer this" (AI-06)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let token: string;
  let script: Script = asTheStubWould;
  const llm = new FakeLlmProvider({ reply: (request) => script(request) });

  const auth = () => ({ authorization: `Bearer ${token}` });
  const settings = (payload: unknown) =>
    server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${aiAgentId}/handoff-settings`),
      payload: payload as object,
      headers: auth(),
    });

  async function seedFaq(text: string): Promise<string> {
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId,
        licenseId: fx.a.licenseId,
        type: 'faq',
        name: 'Çekim SSS',
        status: 'ready',
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    await owner.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0)`,
      source.id,
      fx.a.licenseId.toString(),
      text,
      toVectorLiteral(embed(text)),
    );
    return source.id;
  }

  /** A procedure the questions here are not about: the decision order's knowledge path. */
  async function storeProcedure(procedure: Procedure): Promise<void> {
    const { procedure: body, ...own } = splitSkillProcedure(procedure);
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Yatırım geçmedi',
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

  async function storeSingle(steps: unknown[]): Promise<void> {
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'İadeler',
        kind: 'ai_agent',
        steps: steps as object,
        active: true,
        updatedAt: new Date(),
      },
    });
  }

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  /** One visitor message, answered: the chat, the connection and what the bot has said. */
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
      select: { aiMode: true },
    });
    return {
      chatId: sent.chat_id,
      threadId: sent.event.thread_id,
      said: bot.map((event) => event.text),
      aiMode: thread.aiMode,
    };
  }

  const decisions = () =>
    owner.aiDecisionLog.findMany({
      where: { licenseId: fx.a.licenseId },
      orderBy: { createdAt: 'asc' },
    });
  const knowledgeCalls = () =>
    llm.calls.filter((call) => call.responseFormat?.name === 'knowledge_answer');

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { llm });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    llm.reset();
    script = asTheStubWould;
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });
    // "Önce AI": the connection is the AI's from its first message (AI-11).
    expect((await settings({ assignment_mode: 'ai_first' })).statusCode).toBe(200);
  });

  describe('the no_answer setting', () => {
    it('reads the defaults, keeps what a write leaves out, and refuses what it does not know (AI-06-S1)', async () => {
      const read = await server.get(`/ai-agents/${aiAgentId}/handoff-settings`, auth());
      expect(read.json()).toMatchObject({
        no_answer: {
          policy_by_category: {
            money: 'handoff',
            account: 'handoff',
            bonus: 'handoff',
            rg: 'handoff',
            other: 'ask',
          },
          text: null,
        },
      });

      const written = await settings({
        no_answer: {
          policy_by_category: { other: 'handoff' },
          text: 'Sizi bir uzmanımıza bağlıyorum.',
        },
      });
      expect(written.statusCode).toBe(200);
      const both = await settings({ no_answer: { policy_by_category: { bonus: 'ask' } } });
      expect(both.json()).toMatchObject({
        assignment_mode: 'ai_first',
        no_answer: {
          policy_by_category: { money: 'handoff', bonus: 'ask', other: 'handoff' },
          text: 'Sizi bir uzmanımıza bağlıyorum.',
        },
      });
      expect((await settings({ no_answer: { text: null } })).json().no_answer.text).toBeNull();

      for (const refused of [
        { no_answer: { policy_by_category: { money: 'later' } } },
        { no_answer: { policy_by_category: { casino: 'ask' } } },
        { no_answer: { text: 'x'.repeat(501) } },
        { no_answer: {} },
      ]) {
        expect((await settings(refused)).statusCode).toBe(400);
      }
    });

    it('holds the stored value to an object and its sentence to 500 characters (CHECK)', async () => {
      await owner.aiHandoffSettings.update({ where: { aiAgentId }, data: { noAnswer: {} } });
      await expect(
        owner.aiHandoffSettings.update({
          where: { aiAgentId },
          data: { noAnswer: { text: 'x'.repeat(501) } },
        }),
      ).rejects.toThrow(/ai_handoff_settings_no_answer_check/);
      await expect(
        owner.aiHandoffSettings.update({ where: { aiAgentId }, data: { noAnswer: [1] } }),
      ).rejects.toThrow(/ai_handoff_settings_no_answer_check/);
    });
  });

  it('answers a question the FAQ answers from it, and the decision record names the source (AI-06 acceptance)', async () => {
    await storeProcedure(depositProcedure());
    const sourceId = await seedFaq(FAQ);

    const turn = await say(await visitor(), 'Çekim talepleri ne kadar sürede işlenir?');

    expect(turn.said).toEqual([FAQ]);
    expect(turn.aiMode).toBe('ai');
    const [row] = await decisions();
    expect(row).toMatchObject({
      decision: 'answered',
      procedureId: null,
      details: {
        policy: { step: 5, rule: 'knowledge' },
        knowledge: { grounded: 'full', source_ids: [sourceId] },
      },
    });
    expect(knowledgeCalls()).toHaveLength(1);
  });

  it('says it cannot answer a money question nothing answers, and hands it to a person at once (AI-06 acceptance)', async () => {
    await storeProcedure(depositProcedure());
    await seedFaq(FAQ);

    const turn = await say(await visitor(), 'USDT cüzdan adresimi nasıl değiştiririm?');

    expect(turn.said).toEqual([CANNOT_HAND_OVER]);
    expect(turn.aiMode).toBe('human');
    const [row] = await decisions();
    expect(row).toMatchObject({
      decision: 'handoff',
      handoffReason: 'no_knowledge',
      details: {
        policy: { step: 6, rule: 'unmatched' },
        unanswered: { category: 'money', policy: 'handoff', reason: 'no_passages' },
      },
    });
    // The words stay in the transcript, never in the record (ID-08).
    expect(
      JSON.stringify(row, (_, v: unknown) => (typeof v === 'bigint' ? `${v}` : v)),
    ).not.toMatch(/cüzdan|USDT|kesin bilgi/);
  });

  it('asks once about anything else, and "evet" hands over', async () => {
    await storeProcedure(depositProcedure());
    await seedFaq(FAQ);
    const headers = await visitor();

    const asked = await say(headers, 'Canlı casino masaları hangi saatlerde açık?');
    expect(asked.said).toEqual([CANNOT_ASK]);
    expect(asked.aiMode).toBe('ai');

    const yes = await say(headers, 'evet');
    expect(yes.said).toEqual([CANNOT_ASK, 'Sizi bir temsilcimize aktarıyorum.']);
    expect(yes.aiMode).toBe('human');
    expect((await decisions()).map((row) => [row.decision, row.handoffReason])).toEqual([
      ['asked', null],
      ['handoff', 'no_knowledge'],
    ]);
  });

  it('says the workspace’s own sentence when it set one', async () => {
    await storeProcedure(depositProcedure());
    await settings({ no_answer: { text: 'Sizi hemen bir uzmanımıza bağlıyorum.' } });

    const turn = await say(await visitor(), 'USDT cüzdan adresimi nasıl değiştiririm?');
    expect(turn.said).toEqual(['Sizi hemen bir uzmanımıza bağlıyorum.']);
    expect(turn.aiMode).toBe('human');
  });

  it('writes a draft with a figure no passage gives again, and sends only the clean one (AI-06 acceptance)', async () => {
    await storeProcedure(depositProcedure());
    await seedFaq(FAQ);
    let draft = 0;
    script = () =>
      JSON.stringify({
        reply: draft++ === 0 ? 'Çekim talepleri 2 saat içinde işlenir.' : FAQ,
        grounded: 'full',
        cited_ids: ['P1'],
      });

    const turn = await say(await visitor(), 'Çekim talepleri ne kadar sürede işlenir?');

    expect(turn.said).toEqual([FAQ]);
    expect(knowledgeCalls()).toHaveLength(2);
    expect((await decisions())[0]).toMatchObject({
      decision: 'answered',
      details: { knowledge: { drafts: 2 } },
    });
  });

  it('withholds a draft that still invents a figure: the player hears the AI cannot answer', async () => {
    await storeProcedure(depositProcedure());
    await seedFaq(FAQ);
    script = () =>
      JSON.stringify({
        reply: 'Çekim talepleri 2 saat içinde işlenir.',
        grounded: 'full',
        cited_ids: ['P1'],
      });

    const turn = await say(await visitor(), 'Çekim talepleri ne kadar sürede işlenir?');

    expect(turn.said).toEqual([CANNOT_HAND_OVER]);
    expect(turn.said.join(' ')).not.toContain('2 saat');
    expect((await decisions())[0]).toMatchObject({
      details: {
        knowledge: { withheld: ['invented_figure'] },
        unanswered: { reason: 'withheld' },
      },
    });
  });

  it('on the AI’s connection, every turn ends with a bot message or a hand-over — whatever the turn was (AI-06 §9)', async () => {
    // No procedure here: one-message skills — one that answers refunds, one
    // that only tags a bonus question, one that answers campaigns from the
    // knowledge base.
    await storeSingle([
      { type: 'detect_intent', intent: 'refund', phrases: ['iade'] },
      { type: 'send_message', source: 'text', text: 'İadeler 5 iş günü içinde yapılır.' },
    ]);
    await storeSingle([
      { type: 'detect_intent', intent: 'bonus', phrases: ['bonus'] },
      { type: 'tag', tag: 'bonus' },
    ]);
    await storeSingle([
      { type: 'detect_intent', intent: 'campaign', phrases: ['kampanya'] },
      { type: 'send_message', source: 'knowledge' },
    ]);
    await seedFaq(FAQ);
    const failing = () => {
      script = () => {
        throw new LlmProviderError('timeout');
      };
    };
    const turns: Array<{ name: string; message: string; setup?: () => void }> = [
      { name: 'a skill answers', message: 'iade istiyorum' },
      { name: 'a skill runs and says nothing', message: 'bonus' },
      {
        name: 'a skill’s model cannot answer',
        message: 'kampanya çekim talepleri',
        setup: failing,
      },
      { name: 'the knowledge base answers', message: 'Çekim talepleri ne kadar sürede işlenir?' },
      {
        name: 'nothing answers a money question',
        message: 'USDT cüzdan adresimi nasıl değiştiririm?',
      },
      {
        name: 'nothing answers anything else',
        message: 'Canlı casino masaları hangi saatlerde açık?',
      },
      {
        name: 'the model cannot answer',
        message: 'Çekim talepleri ne kadar sürede işlenir?',
        setup: failing,
      },
    ];
    for (const turn of turns) {
      script = asTheStubWould;
      turn.setup?.();
      const after = await say(await visitor(), turn.message);
      const ended =
        after.said.length > 0 ? 'message' : after.aiMode === 'human' ? 'hand-over' : 'silence';
      expect({ turn: turn.name, ended }).not.toEqual({ turn: turn.name, ended: 'silence' });
    }
  });
});
