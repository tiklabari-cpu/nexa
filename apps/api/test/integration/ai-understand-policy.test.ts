/**
 * The decision order on the API and the live path (tm 297.2 · SiyahTuş
 * analysis AI-05 §4, §5): the agent's `clarify_thresholds`, the one fallback
 * per agent, the migration that moves the old catch-all skills onto it, and a
 * visitor's message the AI is unsure about getting one either-or question.
 *
 * The decisions themselves are `policy.test.ts`'s and `procedure-turn.test.ts`'s;
 * here, what the database and the responder make of them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { splitSkillProcedure, validateProcedure, type Procedure } from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const MIGRATION = fileURLToPath(
  new URL(
    '../../prisma/migrations/20261018150000_skills_legacy_fallback/migration.sql',
    import.meta.url,
  ),
);

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

/** A one-turn topic: says its line and resolves. */
function topic(examples: string[], line: string, priority = 100): Procedure {
  return build({
    when_to_use: line,
    examples,
    priority,
    steps: [
      { id: 'bilgi', type: 'say', template_key: 'bilgi' },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ],
    templates: [{ key: 'bilgi', text: line }],
  });
}

describe('the decision order on the API and the live path (AI-05 · tm 297.2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let otherAgentId: string;
  let headers: Record<string, string>;

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
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
        priority: 100,
      },
    });
    const agent = (name: string) =>
      owner.aiAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          name,
          kind: 'ai_agent',
          active: true,
          persona: { signature: '— Ada' },
        },
        select: { id: true },
      });
    aiAgentId = (await agent('Ada')).id;
    otherAgentId = (await agent('Bora')).id;
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });
    headers = { authorization: `Bearer ${token}` };
  });

  async function storeProcedure(name: string, procedure: Procedure): Promise<string> {
    const { procedure: body, ...own } = splitSkillProcedure(procedure);
    const skill = await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name,
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
    });
    return skill.id;
  }

  async function storeSingle(
    name: string,
    steps: unknown[],
    extra: { isFallback?: boolean; updatedAt?: Date } = {},
  ): Promise<string> {
    const skill = await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name,
        kind: 'ai_agent',
        steps: steps as object,
        active: true,
        isFallback: extra.isFallback ?? false,
        updatedAt: extra.updatedAt ?? new Date(),
      },
      select: { id: true },
    });
    return skill.id;
  }

  /** A visitor's message through the widget: the chat and what the AI said, if anything. */
  async function ask(text: string): Promise<{ chatId: string; reply: string | null }> {
    const visitor = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const auth = { authorization: `Bearer ${(visitor.json() as { token: string }).token}` };
    const response = await server.post('/customer/chat/events', { text }, auth);
    expect(response.statusCode).toBe(201);
    const { chat_id: chatId } = response.json() as { chat_id: string };
    const written = await owner.event.findMany({
      where: { chatId, authorType: 'bot' },
      orderBy: { createdAt: 'asc' },
      select: { text: true },
    });
    return { chatId, reply: written[0]?.text ?? null };
  }

  describe('clarify_thresholds (AI-05 §4)', () => {
    const read = async () =>
      (
        (await server.get('/ai-agents', headers)).json() as {
          items: Array<{ id: string; clarify_thresholds: { high: number; low: number } }>;
        }
      ).items.find((agent) => agent.id === aiAgentId)?.clarify_thresholds;

    it('an agent nobody tuned reads the defaults, 0.70 and 0.40', async () => {
      expect(await read()).toEqual({ high: 0.7, low: 0.4 });
    });

    it('one field alone keeps the other, beside the rest of the persona', async () => {
      const patch = await server.patch(
        `/ai-agents/${aiAgentId}`,
        { clarify_thresholds: { high: 0.8 } },
        headers,
      );
      expect(patch.statusCode).toBe(200);
      expect(patch.json()).toMatchObject({ clarify_thresholds: { high: 0.8, low: 0.4 } });
      expect(await read()).toEqual({ high: 0.8, low: 0.4 });
      const stored = await owner.aiAgent.findUniqueOrThrow({
        where: { id: aiAgentId },
        select: { persona: true },
      });
      expect(stored.persona).toEqual({
        signature: '— Ada',
        clarifyThresholds: { high: 0.8, low: 0.4 },
      });
    });

    it('refuses a pair that leaves no room to ask, and stores nothing', async () => {
      await server.patch(`/ai-agents/${aiAgentId}`, { clarify_thresholds: { high: 0.8 } }, headers);
      for (const body of [{ low: 0.85 }, { high: 0.3 }, { high: 0 }, { low: 1.5 }, {}]) {
        const refused = await server.patch(
          `/ai-agents/${aiAgentId}`,
          { clarify_thresholds: body },
          headers,
        );
        expect(refused.statusCode).toBe(400);
      }
      expect(await read()).toEqual({ high: 0.8, low: 0.4 });
    });
  });

  describe('one fallback per agent (AI-05 §5)', () => {
    const single = (name: string, extra: Record<string, unknown> = {}) => ({
      name,
      ai_agent_id: aiAgentId,
      steps: [{ type: 'send_message', source: 'text', text: 'Size nasıl yardımcı olabilirim?' }],
      ...extra,
    });

    it('a second fallback for the same agent is refused, naming the first; another agent may have its own', async () => {
      const first = await server.post('/skills', single('Genel', { is_fallback: true }), headers);
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ is_fallback: true });

      const second = await server.post('/skills', single('Yedek', { is_fallback: true }), headers);
      expect(second.statusCode).toBe(400);
      expect(second.json()).toMatchObject({
        error: {
          type: 'validation',
          details: {
            reason: 'procedure_fallback_taken',
            section: 'procedure',
            field: 'is_fallback',
            reference: 'Genel',
          },
        },
      });

      const elsewhere = await server.post(
        '/skills',
        { ...single('Bora genel', { is_fallback: true }), ai_agent_id: otherAgentId },
        headers,
      );
      expect(elsewhere.statusCode).toBe(201);
    });

    it('editing the fallback keeps it; marking another is refused until the first lets go', async () => {
      const first = (
        await server.post('/skills', single('Genel', { is_fallback: true }), headers)
      ).json() as { id: string };
      const other = (await server.post('/skills', single('Yedek'), headers)).json() as {
        id: string;
        is_fallback: boolean;
      };
      expect(other.is_fallback).toBe(false);

      const renamed = await server.patch(
        `/skills/${first.id}`,
        { name: 'Genel yardım', is_fallback: true },
        headers,
      );
      expect(renamed.statusCode).toBe(200);

      const taken = await server.patch(`/skills/${other.id}`, { is_fallback: true }, headers);
      expect(taken.statusCode).toBe(400);
      expect(taken.json()).toMatchObject({
        error: { details: { reason: 'procedure_fallback_taken', reference: 'Genel yardım' } },
      });

      await server.patch(`/skills/${first.id}`, { is_fallback: false }, headers);
      const moved = await server.patch(`/skills/${other.id}`, { is_fallback: true }, headers);
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toMatchObject({ is_fallback: true });
    });
  });

  it('the migration marks the one-message skills that match everything — only those', async () => {
    const answer = { type: 'send_message', source: 'text', text: 'Merhaba' };
    const catchAll = await storeSingle('Catch-all', [answer]);
    const gated = await storeSingle('Gated', [
      { type: 'detect_intent', intent: 'kargo', phrases: ['kargom nerede'] },
      answer,
    ]);
    const empty = await storeSingle('Taslak', []);
    const procedure = await storeProcedure('Yatırım', topic(['param yatmadı'], 'Yatırım.'));
    // Scoped to this test's workspace: the statement is the migration's, the rows are ours.
    const sql = readFileSync(MIGRATION, 'utf8').replace(
      "WHERE kind = 'ai_agent'",
      `WHERE license_id = ${fx.a.licenseId.toString()} AND kind = 'ai_agent'`,
    );
    expect(sql).toContain(`license_id = ${fx.a.licenseId.toString()}`);
    await owner.$executeRawUnsafe(sql);

    const flags = Object.fromEntries(
      (
        await owner.skill.findMany({
          where: { id: { in: [catchAll, gated, empty, procedure] } },
          select: { id: true, isFallback: true },
        })
      ).map((row) => [row.id, row.isFallback]),
    );
    expect(flags).toEqual({ [catchAll]: true, [gated]: false, [empty]: false, [procedure]: false });
  });

  describe('a visitor’s message (AI-05 §4 · live)', () => {
    it('unsure between two procedures: the AI asks which, as the bot, and files the rule (AI-05 acceptance)', async () => {
      const deposit = await storeProcedure(
        'Yatırım geçmedi',
        topic(['param yatmadı'], 'Yatırımınız kontrol ediliyor.', 50),
      );
      const withdrawal = await storeProcedure(
        'Çekim',
        topic(['çekim yapamıyorum'], 'Çekim talepleri 24 saat içinde işlenir.'),
      );
      const { chatId, reply } = await ask('param çekim');
      expect(reply).toBe(
        'Tam anlayamadım: “Yatırım geçmedi” konusunda mı, yoksa “Çekim” konusunda mı yardım istiyorsunuz?',
      );
      const decision = await owner.aiDecisionLog.findFirstOrThrow({
        where: { chatId },
        select: { decision: true, procedureId: true, details: true },
      });
      expect(decision).toMatchObject({
        decision: 'asked',
        procedureId: null,
        details: { policy: { step: 4, rule: 'clarify', options: [deposit, withdrawal] } },
      });
      const conversation = await owner.aiConversation.findFirstOrThrow({ where: { chatId } });
      expect(conversation.signals).toMatchObject({
        clarify: { keys: [deposit, withdrawal], turn: 1 },
      });
    });

    it('the agent’s thresholds reach the live turn: with `high` at 0.5 the same message starts one', async () => {
      await storeProcedure(
        'Yatırım geçmedi',
        topic(['param yatmadı'], 'Yatırımınız kontrol ediliyor.', 50),
      );
      await storeProcedure(
        'Çekim',
        topic(['çekim yapamıyorum'], 'Çekim talepleri 24 saat içinde işlenir.'),
      );
      await server.patch(
        `/ai-agents/${aiAgentId}`,
        { clarify_thresholds: { high: 0.5, low: 0.3 } },
        headers,
      );
      expect((await ask('param çekim')).reply).toBe('Yatırımınız kontrol ediliyor.');
    });

    it('an old catch-all edited last no longer answers before the skill written for the message (AI-05 acceptance)', async () => {
      const gated = [
        { type: 'detect_intent', intent: 'kargo', phrases: ['kargom nerede'] },
        { type: 'send_message', source: 'text', text: 'Kargonuz yolda.' },
      ];
      await storeSingle('Kargo', gated, { updatedAt: new Date(Date.now() - 60_000) });
      await storeSingle(
        'Catch-all',
        [{ type: 'send_message', source: 'text', text: 'Size nasıl yardımcı olabilirim?' }],
        { isFallback: true },
      );
      expect((await ask('kargom nerede')).reply).toBe('Kargonuz yolda.');
      expect((await ask('merhaba')).reply).toBe('Size nasıl yardımcı olabilirim?');
    });
  });
});
