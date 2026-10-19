/**
 * The hand-over triggers on live conversations (tm 303.2 · SiyahTuş analysis
 * AI-09), through the real server, the AI job worker and the in-process
 * model stub (or a failing one):
 *
 *   - "insanla görüşmek istiyorum" with the topic in the message hands over
 *     the same turn; without one, one question first, then a person;
 *   - a model that fails, today's cap — on the model call or before it — and
 *     a language the persona does not speak: the player reads a fixed
 *     sentence and a person takes over, never a silence;
 *   - every hand-over's system events carry `handoff_id`, `reason_codes`,
 *     `primary_reason` and `priority`, and its decision record names the same
 *     id and reasons; a workspace's own message is said as written.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_HANDOFF_MESSAGES,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { utcDayKey } from '../../src/services/ai/ai-daily-budget.js';
import { HANDOFF_PHRASES } from '../../src/services/ai/conversation/handoff/triggers.js';
import { LlmProviderError } from '../../src/services/ai/provider/llm-error.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const BONUS = 'Bonus kurallarını kısaca anlat.';
const PERSON = 'müşteri temsilcisiyle görüşmek istiyorum';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

const today = () => utcDayKey(new Date());

describe('the hand-over triggers on a live conversation (AI-09 · tm 303.2)', () => {
  let owner: PrismaClient;
  let fx: Fixtures;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  /** An agent with one topic — "bonus nedir", one written part — and its settings. */
  async function agentOf(
    t: TenantFixture,
    settings: { assignmentMode?: string; messages?: object; languages?: string[] } = {},
  ): Promise<string> {
    const { id } = await owner.aiAgent.create({
      data: {
        licenseId: t.licenseId,
        name: 'Ada',
        kind: 'ai_agent',
        active: true,
        languages: settings.languages ?? [],
      },
      select: { id: true },
    });
    const { procedure: body, ...own } = splitSkillProcedure(
      build({
        when_to_use: 'Oyuncu bonus nedir diyor.',
        examples: ['bonus nedir'],
        steps: [
          { id: 'anlat', type: 'say', instruction: BONUS },
          { id: 'bitti', type: 'resolve', outcome: 'resolved' },
        ],
      }),
    );
    await owner.skill.create({
      data: {
        licenseId: t.licenseId,
        aiAgentId: id,
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
    if (settings.assignmentMode || settings.messages) {
      await owner.aiHandoffSettings.create({
        data: {
          aiAgentId: id,
          licenseId: t.licenseId,
          assignmentMode: settings.assignmentMode ?? 'parallel',
          ...(settings.messages ? { messages: settings.messages } : {}),
        },
      });
    }
    return id;
  }

  async function visitor(server: TestServer, t: TenantFixture): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  /** One visitor message, answered: what the bot said so far, whose the connection is. */
  async function say(server: TestServer, headers: Record<string, string>, text: string) {
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
    return { chatId: sent.chat_id, said: bot.map((event) => event.text), aiMode: thread.aiMode };
  }

  /** The hand-over's share of its system events, and of its decision record. */
  async function handoverOf(chatId: string) {
    const events = await owner.event.findMany({
      where: { chatId, type: 'system_message' },
      orderBy: { createdAt: 'asc' },
      select: { properties: true },
    });
    const lines = events
      .map((event) => event.properties as Record<string, unknown>)
      .filter((properties) => properties['handoff_id'] !== undefined);
    const records = await owner.aiDecisionLog.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { decision: true, details: true },
    });
    return {
      lines,
      records: records.map((r) => ({ ...r, details: r.details as Record<string, unknown> })),
    };
  }

  describe('over the model stub', () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer();
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await clearRateLimits(server.app);
    });

    it('“insanla görüşmek istiyorum” with the topic named: a person this turn, no question — its reasons on the events and the record (AI-09 acceptance)', async () => {
      await agentOf(fx.a);
      const turn = await say(server, await visitor(server, fx.a), `${PERSON}, bonus nedir`);

      expect(turn.said).toEqual([DEFAULT_HANDOFF_MESSAGES.player_request.tr]);
      expect(turn.aiMode).toBe('human');

      const { lines, records } = await handoverOf(turn.chatId);
      expect(lines).toEqual([
        expect.objectContaining({
          system_event: 'ai_mode_changed',
          ai_mode: 'human',
          handoff_id: expect.stringMatching(UUID),
          reason_codes: ['player_request'],
          primary_reason: 'player_request',
          priority: 'normal',
        }),
      ]);
      const [record] = records;
      expect(record).toMatchObject({
        decision: 'handoff',
        details: { reason_codes: ['player_request'], handoff_id: lines[0]!['handoff_id'] },
      });
    });

    it('no topic yet: one question — what is it about — and a person on the next message', async () => {
      await agentOf(fx.a);
      const headers = await visitor(server, fx.a);
      const asked = await say(server, headers, PERSON);
      expect(asked.said).toEqual([HANDOFF_PHRASES.tr.topic]);
      expect(asked.aiMode).toBe('ai');

      const answered = await say(server, headers, 'hesabıma giriş yapamıyorum');
      expect(answered.said).toEqual([
        HANDOFF_PHRASES.tr.topic,
        DEFAULT_HANDOFF_MESSAGES.player_request.tr,
      ]);
      expect(answered.aiMode).toBe('human');
    });

    it("the workspace's own message, as written", async () => {
      await agentOf(fx.a, { messages: { player_request: 'Hemen bir arkadaşımı bağlıyorum.' } });
      const turn = await say(server, await visitor(server, fx.a), `${PERSON}, bonus nedir`);
      expect(turn.said).toEqual(['Hemen bir arkadaşımı bağlıyorum.']);
    });

    it('a language the persona does not speak: a fixed sentence and a person — no silence (AI-09 acceptance)', async () => {
      await agentOf(fx.a, { languages: ['tr'] });
      const turn = await say(
        server,
        await visitor(server, fx.a),
        'Hello, I would like to know what the bonus rules are please',
      );
      expect(turn.said).toEqual([DEFAULT_HANDOFF_MESSAGES.unsupported_language.en]);
      expect(turn.aiMode).toBe('human');
      const { lines } = await handoverOf(turn.chatId);
      expect(lines).toEqual([expect.objectContaining({ reason_codes: ['unsupported_language'] })]);
    });
  });

  describe('over a model that fails', () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer(
        { LOG_LEVEL: 'fatal' },
        {
          llm: new FakeLlmProvider({
            understand: new LlmProviderError('unavailable', { status: 503 }),
          }),
        },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await clearRateLimits(server.app);
    });

    it('the AI’s own connection: the fixed sentence, a person, ai_failure on the events (AI-09 acceptance)', async () => {
      await agentOf(fx.a, { assignmentMode: 'ai_first' });
      const turn = await say(server, await visitor(server, fx.a), 'bonus nedir');

      expect(turn.said).toEqual([DEFAULT_HANDOFF_MESSAGES.ai_failure.tr]);
      expect(turn.aiMode).toBe('human');
      const { lines, records } = await handoverOf(turn.chatId);
      expect(lines).toEqual([
        expect.objectContaining({
          system_event: 'ai_mode_changed',
          reason: 'ai_failure',
          reason_codes: ['ai_failure'],
          primary_reason: 'ai_failure',
        }),
      ]);
      expect(records[0]).toMatchObject({
        decision: 'handoff',
        details: { reason_codes: ['ai_failure'] },
      });
    });
  });

  describe("over today's cap", () => {
    let server: TestServer;

    beforeAll(async () => {
      // A counted model: the stub is never metered.
      server = await startTestServer(
        { LOG_LEVEL: 'fatal', AI_DAILY_LLM_TOKENS_PER_WORKSPACE: '1000' },
        { llm: new FakeLlmProvider({ reply: BONUS }) },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await clearRateLimits(server.app);
    });

    it('the cap spent before the turn, on the AI’s own connection: the fixed sentence and a person — no silence (AI-09 acceptance)', async () => {
      await agentOf(fx.a, { assignmentMode: 'ai_first' });
      await owner.aiDailyUsage.create({
        data: { licenseId: fx.a.licenseId, day: today(), meter: 'llm', used: 1000n },
      });
      const turn = await say(server, await visitor(server, fx.a), 'bonus nedir');

      expect(turn.said).toEqual([DEFAULT_HANDOFF_MESSAGES.ai_failure.tr]);
      expect(turn.aiMode).toBe('human');
      const { lines, records } = await handoverOf(turn.chatId);
      expect(lines).toEqual([expect.objectContaining({ reason_codes: ['ai_failure'] })]);
      expect(records).toEqual([
        {
          decision: 'cap_reached',
          details: {
            cap_scope: 'workspace',
            handoff_id: lines[0]!['handoff_id'],
            reason_codes: ['ai_failure'],
          },
        },
      ]);
    });

    it('a connection routing gave a person: the cap leaves it to them, as before', async () => {
      await agentOf(fx.a);
      await owner.aiDailyUsage.create({
        data: { licenseId: fx.a.licenseId, day: today(), meter: 'llm', used: 1000n },
      });
      const turn = await say(server, await visitor(server, fx.a), 'bonus nedir');
      expect(turn.said).toEqual([]);
      expect(turn.aiMode).toBeNull();
    });
  });
});
