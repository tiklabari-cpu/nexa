/**
 * The per-member daily AI allowance (tm 339.1 · SiyahTuş analysis GV-01),
 * through the real server, the AI job worker and a scripted model that says
 * the topic's line — the allowance counts turns, not tokens:
 *
 *   - a member's 40th AI turn is answered and counted; the 41st is not: the
 *     player reads the fixed sentence, the conversation goes to a person, the
 *     agents see a note saying why and the decision record says `cap_reached`
 *     with `cap_scope: customer`;
 *   - the allowance is the member's: another visitor of the same workspace is
 *     still answered; 0 turns it off; a connection routing gave a person is
 *     left to them;
 *   - `PATCH /settings/security` sets it (0–10 000, admin), `GET` reads 40;
 *   - ten claims at once under a cap of 5 let exactly five through; the day is
 *     the workspace's conversation day; a workspace reads only its own rows;
 *   - the workspace's own cap handing a conversation over leaves the same note.
 *
 * The 80% notice of the workspace's allowance — once a day, to the owner and
 * the admins the owner chose — is tm 283.3's, held in `ai-usage.test.ts`.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_CAP_REACHED_SYSTEM_EVENT,
  DEFAULT_HANDOFF_MESSAGES,
  localDayKey,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { utcDayKey } from '../../src/services/ai/ai-daily-budget.js';
import { CAP_NOTE_TEXT } from '../../src/services/ai/ai-responder.js';
import { claimCustomerAiTurn } from '../../src/services/ai/customer-ai-quota.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const BONUS = 'Bonus kurallarını kısaca anlat.';
/** The topic's answer, whatever its resolve step adds after it. */
const ANSWER = expect.stringContaining(BONUS) as unknown as string;

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

/** The workspace's conversation day today (no inbox settings: Istanbul, 00:00). */
const today = () => localDayKey(new Date());
const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

describe("a member's daily AI allowance (GV-01 · tm 339.1)", () => {
  let owner: PrismaClient;
  let fx: Fixtures;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  const tenantOf = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  /** An AI agent with one topic — "bonus nedir", one written part — answering first. */
  async function agentOf(t: TenantFixture, assignmentMode = 'ai_first'): Promise<void> {
    const { id } = await owner.aiAgent.create({
      data: { licenseId: t.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
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
    if (assignmentMode !== 'parallel') {
      await owner.aiHandoffSettings.create({
        data: { aiAgentId: id, licenseId: t.licenseId, assignmentMode },
      });
    }
  }

  /** A new visitor of `t`: their token, and the member row it minted. */
  async function visitor(server: TestServer, t: TenantFixture) {
    const response = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as { token: string; customer_id: string };
    return {
      headers: { authorization: `Bearer ${body.token}` },
      customerId: body.customer_id,
    };
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

  /** The agents' allowance notes on a chat, and its decision records. */
  async function capOf(chatId: string) {
    const notes = await owner.event.findMany({
      where: {
        chatId,
        type: 'system_message',
        properties: { path: ['system_event'], equals: AI_CAP_REACHED_SYSTEM_EVENT },
      },
      select: { text: true, recipients: true, authorType: true, properties: true },
    });
    const records = await owner.aiDecisionLog.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { decision: true, details: true },
    });
    return { notes, records };
  }

  async function seedTurns(t: TenantFixture, customerId: string, turns: number, day = today()) {
    await owner.aiCustomerDailyUsage.create({
      data: { licenseId: t.licenseId, customerId, day: asDate(day), aiTurns: turns },
    });
  }

  async function turnsOf(t: TenantFixture, customerId: string, day = today()) {
    const row = await owner.aiCustomerDailyUsage.findUnique({
      where: {
        licenseId_customerId_day: { licenseId: t.licenseId, customerId, day: asDate(day) },
      },
    });
    return row?.aiTurns ?? null;
  }

  async function setAllowance(t: TenantFixture, turns: number) {
    const brand = (await owner.brand.findFirst({
      where: { licenseId: t.licenseId, isDefault: true },
      select: { id: true },
    })) ?? { id: await seedDefaultBrand(owner, t.licenseId) };
    await owner.securitySettings.upsert({
      where: { licenseId_brandId: { licenseId: t.licenseId, brandId: brand.id } },
      create: { licenseId: t.licenseId, brandId: brand.id, aiTurnsPerCustomerDay: turns },
      update: { aiTurnsPerCustomerDay: turns },
    });
  }

  describe('over a scripted model', () => {
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer(
        { LOG_LEVEL: 'fatal' },
        { llm: new FakeLlmProvider({ reply: BONUS }) },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await seedDefaultBrand(owner, fx.a.licenseId);
      await clearRateLimits(server.app);
    });

    it('answers the 40th turn and counts it; the 41st goes to a person with a note for the agents (GV-01 acceptance)', async () => {
      await agentOf(fx.a);
      const member = await visitor(server, fx.a);
      await seedTurns(fx.a, member.customerId, 39);

      const fortieth = await say(server, member.headers, 'bonus nedir');
      expect(fortieth.said).toEqual([ANSWER]);
      expect(fortieth.aiMode).toBe('ai');
      expect(await turnsOf(fx.a, member.customerId)).toBe(40);

      const fortyFirst = await say(server, member.headers, 'bonus nedir');
      // The AI said nothing of its own: the fixed hand-over sentence, then a person.
      expect(fortyFirst.said).toEqual([ANSWER, DEFAULT_HANDOFF_MESSAGES.ai_failure.tr]);
      expect(fortyFirst.aiMode).toBe('human');
      // A refused claim writes nothing.
      expect(await turnsOf(fx.a, member.customerId)).toBe(40);

      const { notes, records } = await capOf(fortyFirst.chatId);
      expect(notes).toEqual([
        {
          text: CAP_NOTE_TEXT.customer,
          recipients: 'agents',
          authorType: 'system',
          properties: { system_event: AI_CAP_REACHED_SYSTEM_EVENT, cap_scope: 'customer' },
        },
      ]);
      expect(records.at(-1)).toEqual({
        decision: 'cap_reached',
        details: {
          cap_scope: 'customer',
          turns: 40,
          cap: 40,
          handoff_id: expect.any(String),
          reason_codes: ['ai_failure'],
        },
      });
      expect(records.filter((r) => r.decision === 'cap_reached')).toHaveLength(1);
    });

    it('is the member’s own: another visitor of the workspace is still answered', async () => {
      await agentOf(fx.a);
      const spent = await visitor(server, fx.a);
      await seedTurns(fx.a, spent.customerId, 40);
      const other = await visitor(server, fx.a);

      const capped = await say(server, spent.headers, 'bonus nedir');
      expect(capped.said).toEqual([DEFAULT_HANDOFF_MESSAGES.ai_failure.tr]);
      const answered = await say(server, other.headers, 'bonus nedir');
      expect(answered.said).toEqual([ANSWER]);
      expect(await turnsOf(fx.a, other.customerId)).toBe(1);
    });

    it('follows the workspace’s setting, and 0 turns the allowance off', async () => {
      await agentOf(fx.a);
      await setAllowance(fx.a, 2);
      const member = await visitor(server, fx.a);
      await seedTurns(fx.a, member.customerId, 2);
      const capped = await say(server, member.headers, 'bonus nedir');
      expect(capped.aiMode).toBe('human');
      expect((await capOf(capped.chatId)).records.at(-1)?.details).toMatchObject({
        cap_scope: 'customer',
        turns: 2,
        cap: 2,
      });

      await setAllowance(fx.a, 0);
      const free = await visitor(server, fx.a);
      await seedTurns(fx.a, free.customerId, 5_000);
      const answered = await say(server, free.headers, 'bonus nedir');
      expect(answered.said).toEqual([ANSWER]);
      // Off: nothing is counted.
      expect(await turnsOf(fx.a, free.customerId)).toBe(5_000);
    });

    it('leaves a connection routing gave a person to them — no sentence, no note, the refusal on record', async () => {
      await agentOf(fx.a, 'parallel');
      const member = await visitor(server, fx.a);
      await seedTurns(fx.a, member.customerId, 40);
      const turn = await say(server, member.headers, 'bonus nedir');
      expect(turn.said).toEqual([]);
      const { notes, records } = await capOf(turn.chatId);
      expect(notes).toEqual([]);
      expect(records).toEqual([
        { decision: 'cap_reached', details: { cap_scope: 'customer', turns: 40, cap: 40 } },
      ]);
    });

    it('is set on Settings › Security: 40 until saved, 0–10 000, admins only', async () => {
      const token = (scopes: string[], ownerId = fx.a.ownerAccountId) =>
        grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId,
          scopes,
        });
      const admin = { authorization: `Bearer ${await token(['access_rules:rw'])}` };

      const fresh = await server.get('/settings/security', admin);
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json()).toMatchObject({ ai_turns_per_customer_day: 40 });

      const saved = await server.patch(
        '/settings/security',
        { ai_turns_per_customer_day: 12 },
        admin,
      );
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ ai_turns_per_customer_day: 12 });
      expect((await server.get('/settings/security', admin)).json()).toMatchObject({
        ai_turns_per_customer_day: 12,
      });

      for (const bad of [-1, 10_001, 1.5, '40', null]) {
        const refused = await server.patch(
          '/settings/security',
          { ai_turns_per_customer_day: bad },
          admin,
        );
        expect(refused.statusCode).toBe(400);
      }
      const off = await server.patch('/settings/security', { ai_turns_per_customer_day: 0 }, admin);
      expect(off.json()).toMatchObject({ ai_turns_per_customer_day: 0 });

      const agent = {
        authorization: `Bearer ${await token(['access_rules:rw'], fx.a.agentAccountId)}`,
      };
      const forbidden = await server.patch(
        '/settings/security',
        { ai_turns_per_customer_day: 100 },
        agent,
      );
      expect(forbidden.statusCode).toBe(403);
    });
  });

  describe('the counter', () => {
    beforeEach(async () => {
      fx = await seedFixtures(owner);
    });

    it('lets exactly the cap through when ten turns are claimed at once', async () => {
      await setAllowance(fx.a, 5);
      // No chat needed: the chat only names the brand whose setting applies.
      const chatId = 'QUOTA0000001';
      // Ten connections, so the claims really race rather than queue on one.
      const clients = Array.from({ length: 10 }, () => ownerClient());
      try {
        await Promise.all(clients.map((client) => client.$connect()));
        const claims = await Promise.all(
          clients.map((client) =>
            withTenant(client, tenantOf(fx.a), (tx) =>
              claimCustomerAiTurn(tx, {
                licenseId: fx.a.licenseId,
                customerId: fx.a.customerId,
                chatId,
              }),
            ),
          ),
        );
        expect(claims.filter((c) => c.allowed)).toHaveLength(5);
        expect(
          claims
            .filter((c) => c.allowed)
            .map((c) => c.turns)
            .sort(),
        ).toEqual([1, 2, 3, 4, 5]);
        expect(claims.filter((c) => !c.allowed).every((c) => c.turns === 5 && c.cap === 5)).toBe(
          true,
        );
        expect(await turnsOf(fx.a, fx.a.customerId)).toBe(5);
      } finally {
        await Promise.all(clients.map((client) => client.$disconnect()));
      }
    });

    it('counts on the workspace’s conversation day, not the UTC one', async () => {
      // 23:30 UTC is 02:30 the next day in Istanbul; 20:30 UTC is 23:30 the same day.
      const lateUtc = new Date('2026-03-10T23:30:00.000Z');
      const evening = new Date('2026-03-10T20:30:00.000Z');
      const chatId = 'QUOTA0000002';
      for (const at of [lateUtc, evening]) {
        const claim = await withTenant(owner, tenantOf(fx.a), (tx) =>
          claimCustomerAiTurn(tx, {
            licenseId: fx.a.licenseId,
            customerId: fx.a.customerId,
            chatId,
            at,
          }),
        );
        expect(claim.allowed).toBe(true);
        expect(claim.turns).toBe(1);
      }
      expect(utcDayKey(lateUtc)).toBe('20260310');
      expect(await turnsOf(fx.a, fx.a.customerId, '2026-03-11')).toBe(1);
      expect(await turnsOf(fx.a, fx.a.customerId, '2026-03-10')).toBe(1);
    });

    it.skipIf(!APP_URL)(
      'shows a workspace its own rows only, and refuses a row written in another’s name',
      async () => {
        await seedTurns(fx.a, fx.a.customerId, 3);
        const app = new PrismaClient({ datasources: { db: { url: APP_URL! } } });
        try {
          expect(
            await withTenant(app, tenantOf(fx.b), (tx) => tx.aiCustomerDailyUsage.findMany()),
          ).toEqual([]);
          expect(
            await withTenant(app, tenantOf(fx.a), (tx) => tx.aiCustomerDailyUsage.count()),
          ).toBe(1);
          await expect(
            withTenant(
              app,
              tenantOf(fx.b),
              (tx) =>
                tx.$executeRaw`
                INSERT INTO ai_customer_daily_usage (license_id, customer_id, day, ai_turns)
                VALUES (${fx.a.licenseId}, ${fx.a.customerId}::uuid, ${today()}::date, 1)`,
            ),
          ).rejects.toThrow(/row-level security/);
        } finally {
          await app.$disconnect();
        }
      },
    );
  });

  describe("over the workspace's own cap", () => {
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

    it('leaves the agents the same note when the workspace’s allowance hands the conversation over — and counts no member turn', async () => {
      await agentOf(fx.a);
      await owner.aiDailyUsage.create({
        data: { licenseId: fx.a.licenseId, day: utcDayKey(new Date()), meter: 'llm', used: 1000n },
      });
      const member = await visitor(server, fx.a);
      const turn = await say(server, member.headers, 'bonus nedir');
      expect(turn.aiMode).toBe('human');
      const { notes } = await capOf(turn.chatId);
      expect(notes).toMatchObject([
        {
          text: CAP_NOTE_TEXT.workspace,
          properties: { system_event: AI_CAP_REACHED_SYSTEM_EVENT, cap_scope: 'workspace' },
        },
      ]);
      expect(await turnsOf(fx.a, member.customerId)).toBeNull();
    });
  });
});
