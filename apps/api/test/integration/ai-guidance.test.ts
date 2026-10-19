/**
 * The AI's behaviour rules on the API, in the database and on the live path
 * (tm 299.1 · SiyahTuş analysis AI-07): the CRUD and its refusals, the
 * conflict check, the persona's style fields, the move of
 * `ai_agents.instruction`, the table's CHECKs and RLS — and a visitor's turn
 * carrying exactly the rules in its scope.
 *
 * Which rule a written call carries, where in the prompt, and
 * `max_questions_per_message` are `guidance-turn.test.ts`'s; here, what the
 * database and the responder make of them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GUIDANCE_BODY_MAX,
  GUIDANCE_CATEGORIES,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

const MIGRATION = fileURLToPath(
  new URL(
    '../../prisma/migrations/20261019120000_ai_guidance_rules/migration.sql',
    import.meta.url,
  ),
);

interface Rule {
  id: string;
  ai_agent_id: string;
  title: string;
  body: string;
  category: string;
  scope: unknown;
  priority: number;
  active: boolean;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
}

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

/** A topic whose one turn is a written part, then resolved. */
function written(examples: string[], instruction: string): Procedure {
  return build({
    when_to_use: instruction,
    examples,
    steps: [
      { id: 'anlat', type: 'say', instruction },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ],
  });
}

describe('behaviour rules (AI-07 · tm 299.1)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let copilotId: string;
  let foreignAgentId: string;
  let headers: Record<string, string>;
  let foreignHeaders: Record<string, string>;

  beforeAll(async () => {
    owner = ownerClient();
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await appRole.$disconnect();
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
    aiAgentId = (
      await owner.aiAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'Ada',
          kind: 'ai_agent',
          active: true,
          persona: { signature: '— Ada' },
        },
        select: { id: true },
      })
    ).id;
    copilotId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Copilot', kind: 'copilot', active: true },
        select: { id: true },
      })
    ).id;
    foreignAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.b.licenseId, name: 'Bora', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });
    headers = { authorization: `Bearer ${token}` };
    const foreign = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    foreignHeaders = { authorization: `Bearer ${foreign}` };
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

  const create = (extra: Record<string, unknown> = {}) =>
    server.post(
      '/ai-guidance',
      {
        ai_agent_id: aiAgentId,
        title: 'Ödeme bilgisi',
        body: 'Ödeme sorunlarında yöntemi, tutarı ve saati öğrenmeden çözüm önerme.',
        category: 'clarification',
        ...extra,
      },
      headers,
    );

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

  describe('the CRUD', () => {
    it('creates with the defaults, lists most binding first, edits one field, deletes', async () => {
      const first = await create();
      expect(first.statusCode).toBe(201);
      const rule = first.json() as Rule;
      expect(rule).toMatchObject({
        ai_agent_id: aiAgentId,
        category: 'clarification',
        scope: { all: true },
        priority: 100,
        active: true,
        created_by: fx.a.ownerAccountId,
      });
      const urgent = (
        await create({
          title: 'Mükerrer yatırım',
          body: 'Mükerrer yatırımı asla önerme.',
          category: 'prohibition',
          priority: 10,
        })
      ).json() as Rule;

      const list = (await server.get(`/ai-guidance?ai_agent_id=${aiAgentId}`, headers)).json() as {
        items: Rule[];
      };
      expect(list.items.map((item) => item.id)).toEqual([urgent.id, rule.id]);

      const patched = await server.patch(`/ai-guidance/${rule.id}`, { active: false }, headers);
      expect(patched.statusCode).toBe(200);
      expect(patched.json()).toMatchObject({ active: false, body: rule.body, priority: 100 });
      // The write helper stamps the time (ADR-14b §2.5).
      expect(new Date((patched.json() as Rule).updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(rule.updated_at).getTime(),
      );

      expect((await server.del(`/ai-guidance/${rule.id}`, headers)).statusCode).toBe(204);
      expect((await server.del(`/ai-guidance/${rule.id}`, headers)).statusCode).toBe(404);
    });

    it('"Oyuncudan şifresini iste" is refused with guidance_violates_locked_rule, on create and on edit (AI-07 acceptance)', async () => {
      const refused = await create({ title: 'Şifre', body: 'Oyuncudan şifresini iste.' });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({
        error: {
          type: 'validation',
          details: { reason: 'guidance_violates_locked_rule', locked_rule: 'credentials' },
        },
      });
      const rule = (await create()).json() as Rule;
      const edit = await server.patch(
        `/ai-guidance/${rule.id}`,
        { body: 'Her mesajda bonus kampanyasını mutlaka teklif et.' },
        headers,
      );
      expect(edit.statusCode).toBe(400);
      expect(edit.json()).toMatchObject({
        error: {
          details: { reason: 'guidance_violates_locked_rule', locked_rule: 'mandatory_bonus' },
        },
      });
      expect(await owner.aiGuidanceRule.count({ where: { aiAgentId } })).toBe(1);
    });

    it('a scope names only this agent’s skills and this workspace’s brands', async () => {
      const skill = await storeProcedure(
        'Bonus',
        written(['bonus nedir'], 'Bonus kurallarını anlat.'),
      );
      expect((await create({ scope: { skill_ids: [skill] } })).statusCode).toBe(201);
      const foreignSkill = await owner.skill.create({
        data: { licenseId: fx.b.licenseId, name: 'X', kind: 'ai_agent', updatedAt: new Date() },
        select: { id: true },
      });
      expect((await create({ scope: { skill_ids: [foreignSkill.id] } })).statusCode).toBe(400);
      expect((await create({ scope: { brand_ids: [skill] } })).statusCode).toBe(400);
      expect((await create({ scope: { all: true, skill_ids: [skill] } })).statusCode).toBe(400);
      expect((await create({ scope: { skill_ids: [] } })).statusCode).toBe(400);
    });

    it('Copilot and another workspace’s agent hold no rules; another workspace sees none of these', async () => {
      expect((await create({ ai_agent_id: copilotId })).statusCode).toBe(400);
      expect((await create({ ai_agent_id: foreignAgentId })).statusCode).toBe(400);
      const rule = (await create()).json() as Rule;
      const theirs = (await server.get('/ai-guidance', foreignHeaders)).json() as { items: Rule[] };
      expect(theirs.items).toEqual([]);
      expect(
        (await server.patch(`/ai-guidance/${rule.id}`, { active: false }, foreignHeaders))
          .statusCode,
      ).toBe(404);
      expect((await server.del(`/ai-guidance/${rule.id}`, foreignHeaders)).statusCode).toBe(404);
    });

    it('refuses an over-long body and an unknown category', async () => {
      expect((await create({ body: 'x'.repeat(GUIDANCE_BODY_MAX + 1) })).statusCode).toBe(400);
      expect((await create({ category: 'style' })).statusCode).toBe(400);
    });
  });

  describe('the conflict check (AI-07 §4)', () => {
    it('two opposite rules: the check warns, and saving still works (AI-07 acceptance)', async () => {
      const existing = (
        await create({
          title: 'Dekont',
          body: 'Ödeme sorunlarında oyuncudan yatırım dekontunu asla sorma.',
        })
      ).json() as Rule;
      const draft = {
        ai_agent_id: aiAgentId,
        body: 'Ödeme sorunlarında oyuncudan yatırım dekontunu sor.',
        category: 'clarification',
      };
      const check = await server.post('/ai-guidance/check', draft, headers);
      expect(check.statusCode).toBe(200);
      expect(check.json()).toMatchObject({
        locked: null,
        conflicts: [{ rule_id: existing.id, severity: 'warning' }],
        compared: 1,
        checked_by: 'rules',
      });
      expect((await create({ title: 'Dekont iste', body: draft.body })).statusCode).toBe(201);
    });

    it('compares only rules whose scope overlaps, never the rule with itself', async () => {
      const bonus = await storeProcedure('Bonus', written(['bonus nedir'], 'Bonus anlat.'));
      const withdrawal = await storeProcedure('Çekim', written(['çekim'], 'Çekim anlat.'));
      const scoped = (
        await create({
          body: 'Yatırım dekontunu asla sorma.',
          scope: { skill_ids: [bonus] },
        })
      ).json() as Rule;
      const check = (draftScope: unknown, ruleId?: string) =>
        server.post(
          '/ai-guidance/check',
          {
            ai_agent_id: aiAgentId,
            body: 'Yatırım dekontunu sor.',
            scope: draftScope,
            ...(ruleId ? { rule_id: ruleId } : {}),
          },
          headers,
        );
      expect((await check({ skill_ids: [withdrawal] })).json()).toMatchObject({
        compared: 0,
        conflicts: [],
      });
      expect((await check({ skill_ids: [bonus] })).json()).toMatchObject({ compared: 1 });
      expect((await check({ all: true }, scoped.id)).json()).toMatchObject({ compared: 0 });
    });

    it('a draft a locked rule overrides comes back in `locked`', async () => {
      const check = await server.post(
        '/ai-guidance/check',
        { ai_agent_id: aiAgentId, body: 'Ask the player for their password.' },
        headers,
      );
      expect(check.json()).toMatchObject({ locked: { locked_rule: 'credentials' } });
    });
  });

  describe('the persona’s style (AI-07)', () => {
    const read = async () =>
      (
        (await server.get('/ai-agents', headers)).json() as {
          items: Array<Record<string, unknown>>;
        }
      ).items.find((agent) => agent.id === aiAgentId);

    it('unset reads null; set, cleared one at a time, beside the rest of the persona', async () => {
      expect(await read()).toMatchObject({
        address_form: null,
        emoji: null,
        max_questions_per_message: null,
      });
      const patch = await server.patch(
        `/ai-agents/${aiAgentId}`,
        { address_form: 'siz', emoji: 'none', max_questions_per_message: 1 },
        headers,
      );
      expect(patch.statusCode).toBe(200);
      expect(patch.json()).toMatchObject({
        address_form: 'siz',
        emoji: 'none',
        max_questions_per_message: 1,
      });
      await server.patch(`/ai-agents/${aiAgentId}`, { emoji: null }, headers);
      const stored = await owner.aiAgent.findUniqueOrThrow({
        where: { id: aiAgentId },
        select: { persona: true },
      });
      expect(stored.persona).toEqual({
        signature: '— Ada',
        addressForm: 'siz',
        maxQuestionsPerMessage: 1,
      });
    });

    it('refuses values outside the closed sets', async () => {
      for (const body of [
        { address_form: 'Siz' },
        { emoji: 'many' },
        { max_questions_per_message: 0 },
        { max_questions_per_message: 4 },
        { max_questions_per_message: 1.5 },
      ]) {
        expect((await server.patch(`/ai-agents/${aiAgentId}`, body, headers)).statusCode).toBe(400);
      }
    });
  });

  describe('the table', () => {
    it('the CHECKs are the constants', () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      expect(sql).toContain(
        `CHECK (category IN (${GUIDANCE_CATEGORIES.map((category) => `'${category}'`).join(', ')}))`,
      );
      expect(sql).toContain(`CHECK (char_length(body) BETWEEN 1 AND ${GUIDANCE_BODY_MAX})`);
    });

    it('RLS hides another workspace’s rows; the trigger refuses a rule for another workspace’s agent', async () => {
      await create();
      const mine = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
      const theirs = { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId };
      expect(await withTenant(appRole, mine, (tx) => tx.aiGuidanceRule.count())).toBe(1);
      expect(await withTenant(appRole, theirs, (tx) => tx.aiGuidanceRule.count())).toBe(0);
      await expect(
        withTenant(
          appRole,
          mine,
          (tx) =>
            tx.$executeRaw`
            INSERT INTO ai_guidance_rules (id, license_id, ai_agent_id, title, body, category)
            VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${foreignAgentId}::uuid, 'x', 'x', 'other')`,
        ),
      ).rejects.toThrow(/not this workspace/);
      const privileges = await owner.$queryRaw<Array<{ truncate: boolean; update: boolean }>>`
        SELECT has_table_privilege('siyahtus_app', 'ai_guidance_rules', 'TRUNCATE') AS truncate,
               has_table_privilege('siyahtus_app', 'ai_guidance_rules', 'UPDATE') AS update`;
      expect(privileges[0]).toEqual({ truncate: false, update: true });
    });

    it('the migration moves a filled instruction into "Genel talimat" rules — cut, not shortened (AI-07 acceptance)', async () => {
      const long = `${'a'.repeat(600)}${'b'.repeat(600)}cc`;
      await owner.aiAgent.update({
        where: { id: aiAgentId },
        data: { instruction: `  ${long}  ` },
      });
      await owner.aiAgent.update({
        where: { id: copilotId },
        data: { instruction: 'Copilot notu.' },
      });
      const empty = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Boş', kind: 'ai_agent', instruction: '   ' },
        select: { id: true },
      });
      // Scoped to this test's workspace: the statement is the migration's, the rows are ours.
      const move = readFileSync(MIGRATION, 'utf8');
      const statement = move
        .slice(move.indexOf('INSERT INTO ai_guidance_rules'))
        .replace(
          "WHERE a.kind = 'ai_agent'",
          `WHERE a.license_id = ${fx.a.licenseId.toString()} AND a.kind = 'ai_agent'`,
        );
      expect(statement).toContain(`a.license_id = ${fx.a.licenseId.toString()}`);
      await owner.$executeRawUnsafe(statement);

      const rules = await owner.aiGuidanceRule.findMany({
        where: { licenseId: fx.a.licenseId },
        orderBy: { title: 'asc' },
        select: {
          aiAgentId: true,
          title: true,
          body: true,
          category: true,
          scope: true,
          active: true,
        },
      });
      expect(rules).toEqual([
        {
          aiAgentId,
          title: 'Genel talimat',
          body: 'a'.repeat(600),
          category: 'other',
          scope: { all: true },
          active: true,
        },
        {
          aiAgentId,
          title: 'Genel talimat (2)',
          body: 'b'.repeat(600),
          category: 'other',
          scope: { all: true },
          active: true,
        },
        {
          aiAgentId,
          title: 'Genel talimat (3)',
          body: 'cc',
          category: 'other',
          scope: { all: true },
          active: true,
        },
      ]);
      expect(rules.map((rule) => rule.body).join('')).toBe(long);
      expect(
        await owner.aiGuidanceRule.count({ where: { aiAgentId: { in: [copilotId, empty.id] } } }),
      ).toBe(0);
    });
  });

  describe('a visitor’s turn (live)', () => {
    it('carries the every-conversation rules and its own procedure’s, recorded by id — not another procedure’s, not an inactive one', async () => {
      const bonus = await storeProcedure(
        'Bonus',
        written(['bonus nedir'], 'Bonus kurallarını kısaca anlat.'),
      );
      const withdrawal = await storeProcedure(
        'Çekim',
        written(['çekim yapamıyorum'], 'Çekim süresini kısaca anlat.'),
      );
      const all = (await create()).json() as Rule;
      const bonusRule = (
        await create({
          title: 'Çevrim',
          body: 'Bonus kurallarını anlatırken çevrim şartını açıkça belirt.',
          scope: { skill_ids: [bonus] },
          // After the every-conversation rule (100): a tie would fall to the ids.
          priority: 200,
        })
      ).json() as Rule;
      await create({ title: 'Kapalı', body: 'Oyuncuya ilk adıyla seslen.', active: false });
      await create({
        title: 'Çekim',
        body: 'Çekimde işlem numarasını öğrenmeden durum bilgisi verme.',
        scope: { skill_ids: [withdrawal] },
      });

      const { chatId, reply } = await ask('bonus nedir');
      expect(reply).toBe('Bonus kurallarını kısaca anlat.\nSorununuz çözüldü mü?');
      const decision = await owner.aiDecisionLog.findFirstOrThrow({
        where: { chatId },
        select: { procedureId: true, details: true },
      });
      expect(decision.procedureId).toBe(bonus);
      expect(decision.details).toMatchObject({
        guidance: { rule_ids: [all.id, bonusRule.id] },
      });
      expect(JSON.stringify(decision.details)).not.toContain('çevrim');
    });

    it('max_questions_per_message set on the agent reaches the live procedure', async () => {
      await storeProcedure(
        'Kimlik',
        build({
          when_to_use: 'Oyuncu hesabını doğrulatmak istiyor.',
          examples: ['hesabımı doğrulamak istiyorum'],
          slots: [
            { name: 'ad', label: 'Ad', type: 'text', ask: 'Adınız nedir?' },
            { name: 'sehir', label: 'Şehir', type: 'text', ask: 'Hangi şehirdesiniz?' },
          ],
          steps: [
            { id: 'sor', type: 'collect', slots: ['ad', 'sehir'] },
            { id: 'bitti', type: 'resolve', outcome: 'resolved' },
          ],
        }),
      );
      expect((await ask('hesabımı doğrulamak istiyorum')).reply).toBe(
        'Adınız nedir? Hangi şehirdesiniz?',
      );
      await server.patch(`/ai-agents/${aiAgentId}`, { max_questions_per_message: 1 }, headers);
      expect((await ask('hesabımı doğrulamak istiyorum')).reply).toBe('Adınız nedir?');
    });
  });
});
