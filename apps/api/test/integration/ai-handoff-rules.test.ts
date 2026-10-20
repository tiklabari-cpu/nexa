/**
 * The workspace's hand-over rules (tm 303.3 · SiyahTuş analysis AI-09; owner
 * decision K9), through the real server and the real database:
 *
 *   - `GET|POST /ai-agents/{id}/handoff-rules`, `PATCH|DELETE …/{ruleId}` and
 *     `PUT …/order`: the list in order, the locked G rows above it, the three
 *     ready-made examples; add, edit, turn off, delete, reorder;
 *   - the locked rules cannot be changed, turned off, deleted or moved (400
 *     `handoff_trigger_locked`), and nothing is written;
 *   - what a rule names is the workspace's own; Copilot and another
 *     workspace's agent have no list; row level security and the write
 *     trigger under the route; the CHECKs and the contract name the types'
 *     lists;
 *   - on a live conversation: "Para yatırma → Finans, high" hands a deposit
 *     question over, its reason and rule on the events and the record;
 *     turned off, it does not; the order decides.
 */
import { PrismaClient } from '@prisma/client';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  DEFAULT_HANDOFF_MESSAGES,
  HANDOFF_RULE_EXAMPLES,
  HANDOFF_RULE_TOPICS,
  HANDOFF_RULE_TRIGGER_TYPES,
  HANDOFF_RULES_PER_AGENT_MAX,
  HANDOFF_TRIGGER_LOCKED_REASON,
  LOCKED_HANDOFF_RULE_IDS,
  RISK_FLAG_TYPES,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

interface RuleBody {
  id: string;
  position: number;
  active: boolean;
  title: string;
  trigger: { type: string; value: string | null };
  target: { group_id: number } | { topic: string } | null;
  priority: string;
}

describe('hand-over rules (AI-09 · K9 · tm 303.3)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let otherAgentId: string;
  let skillId: string;
  let financeGroupId: number;
  let adminToken: string;
  let readToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const tenant = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });
  const base = (id = aiAgentId) => `/ai-agents/${id}/handoff-rules`;
  const send = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, payload?: object) =>
    server.app.inject({
      method,
      url: server.url(path),
      headers: auth(adminToken),
      ...(payload ? { payload } : {}),
    });
  const list = async (id = aiAgentId) => {
    const response = await server.get(base(id), auth(adminToken));
    expect(response.statusCode).toBe(200);
    return response.json() as { locked: { id: string }[]; items: RuleBody[]; examples: unknown[] };
  };
  const add = async (payload: object): Promise<RuleBody> => {
    const response = await send('POST', base(), payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as RuleBody;
  };
  const DEPOSIT = {
    title: 'Para yatırma',
    trigger: { type: 'topic', value: 'deposit' },
    priority: 'high',
  };

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL is not set');
    owner = ownerClient();
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
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    otherAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.b.licenseId, name: 'Bea', kind: 'ai_agent', active: true },
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
    financeGroupId = Number(
      (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name: 'Finans' },
          select: { id: true },
        })
      ).id,
    );
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:ro'],
    });
  });

  describe('the list', () => {
    it('an agent with no rules: the locked G rows, the three examples, nothing installed (K9)', async () => {
      const body = await list();
      expect(body.locked.map((row) => row.id)).toEqual([...LOCKED_HANDOFF_RULE_IDS]);
      expect(body.items).toEqual([]);
      expect(body.examples).toEqual(JSON.parse(JSON.stringify(HANDOFF_RULE_EXAMPLES)));
    });

    it('adds at the end, edits, turns off, deletes — the rest move up (AI-09 · K9)', async () => {
      const first = await add({ ...DEPOSIT, target: { group_id: financeGroupId } });
      expect(first).toMatchObject({
        position: 1,
        active: true,
        title: 'Para yatırma',
        trigger: { type: 'topic', value: 'deposit' },
        target: { group_id: financeGroupId },
        priority: 'high',
      });
      const second = await add({
        title: 'AI çözemedi',
        trigger: { type: 'ai_unresolved', value: null },
      });
      expect(second).toMatchObject({ position: 2, priority: 'normal', target: null });
      const third = await add({
        title: 'Şifre',
        trigger: { type: 'phrase', value: '  şifre sıfırla  ' },
        target: { topic: 'kyc_risk' },
        active: false,
      });
      expect(third).toMatchObject({
        position: 3,
        active: false,
        trigger: { type: 'phrase', value: 'şifre sıfırla' },
      });

      const off = await send('PATCH', `${base()}/${first.id}`, { active: false });
      expect(off.statusCode).toBe(200);
      expect(off.json()).toMatchObject({ active: false, title: 'Para yatırma', priority: 'high' });
      const edited = await send('PATCH', `${base()}/${first.id}`, {
        trigger: { type: 'procedure', value: skillId },
        target: null,
        priority: 'urgent',
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json()).toMatchObject({
        trigger: { type: 'procedure', value: skillId },
        target: null,
        priority: 'urgent',
      });

      expect((await send('DELETE', `${base()}/${second.id}`)).statusCode).toBe(204);
      const after = await list();
      expect(after.items.map((rule) => [rule.id, rule.position])).toEqual([
        [first.id, 1],
        [third.id, 2],
      ]);
      expect((await send('DELETE', `${base()}/${second.id}`)).statusCode).toBe(404);
    });

    it('reorders: every rule once, in the new order; anything else is refused and nothing moves', async () => {
      const a = await add(DEPOSIT);
      const b = await add({ title: 'B', trigger: { type: 'player_request', value: null } });
      const c = await add({ title: 'C', trigger: { type: 'risk_flag', value: 'fraud_suspected' } });

      const moved = await send('PUT', `${base()}/order`, { rule_ids: [c.id, a.id, b.id] });
      expect(moved.statusCode).toBe(200);
      expect((moved.json() as { items: RuleBody[] }).items.map((rule) => rule.id)).toEqual([
        c.id,
        a.id,
        b.id,
      ]);

      for (const ruleIds of [
        [c.id, a.id],
        [c.id, a.id, b.id, a.id],
        [c.id, a.id, b.id, '3f1e0c2a-6a43-4c55-9d7b-0f6f3a3b9a01'],
      ]) {
        const refused = await send('PUT', `${base()}/order`, { rule_ids: ruleIds });
        expect(refused.statusCode).toBe(400);
        expect(refused.json()).toMatchObject({
          error: { details: { reason: 'handoff_rules_order_mismatch' } },
        });
      }
      expect((await list()).items.map((rule) => rule.id)).toEqual([c.id, a.id, b.id]);
    });

    it('a read-only token reads the list and writes nothing', async () => {
      expect((await server.get(base(), auth(readToken))).statusCode).toBe(200);
      const refused = await server.app.inject({
        method: 'POST',
        url: server.url(base()),
        headers: auth(readToken),
        payload: DEPOSIT,
      });
      expect(refused.statusCode).toBe(403);
    });
  });

  describe('the locked rules (G1–G5, G13, G15)', () => {
    it('cannot be changed, turned off, deleted or moved: 400 handoff_trigger_locked, nothing written (AI-09 acceptance)', async () => {
      const own = await add(DEPOSIT);
      const before = await owner.aiHandoffRule.findMany({ orderBy: { position: 'asc' } });
      for (const id of LOCKED_HANDOFF_RULE_IDS) {
        const off = await send('PATCH', `${base()}/${id}`, { active: false });
        expect(off.statusCode).toBe(400);
        expect(off.json()).toMatchObject({
          error: {
            type: 'validation',
            details: { reason: HANDOFF_TRIGGER_LOCKED_REASON, rule: id },
          },
        });
        const gone = await send('DELETE', `${base()}/${id}`);
        expect(gone.statusCode).toBe(400);
        expect(gone.json()).toMatchObject({
          error: { details: { reason: HANDOFF_TRIGGER_LOCKED_REASON } },
        });
      }
      const moved = await send('PUT', `${base()}/order`, { rule_ids: [own.id, 'G1'] });
      expect(moved.statusCode).toBe(400);
      expect(moved.json()).toMatchObject({
        error: { details: { reason: HANDOFF_TRIGGER_LOCKED_REASON, rule: 'G1' } },
      });
      expect(await owner.aiHandoffRule.findMany({ orderBy: { position: 'asc' } })).toEqual(before);
      expect((await list()).locked.map((row) => row.id)).toEqual([...LOCKED_HANDOFF_RULE_IDS]);
    });
  });

  describe('what a rule may name', () => {
    it("refuses what is not the workspace's, a malformed trigger or target, and a 51st rule", async () => {
      const otherSkill = await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'tek mesaj',
          kind: 'ai_agent',
          aiAgentId,
          mode: 'single',
          active: true,
          updatedAt: new Date(),
        },
        select: { id: true },
      });
      const otherGroup = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Başkası' },
        select: { id: true },
      });
      const refusals: [object, string | null][] = [
        [
          { title: 'x', trigger: { type: 'procedure', value: otherSkill.id } },
          'handoff_rule_unknown_procedure',
        ],
        [
          {
            title: 'x',
            trigger: { type: 'procedure', value: '3f1e0c2a-6a43-4c55-9d7b-0f6f3a3b9a01' },
          },
          'handoff_rule_unknown_procedure',
        ],
        [{ ...DEPOSIT, target: { group_id: Number(otherGroup.id) } }, 'handoff_rule_unknown_team'],
        [{ title: 'x', trigger: { type: 'topic', value: 'trading' } }, null],
        [{ title: 'x', trigger: { type: 'ai_unresolved', value: 'x' } }, null],
        [{ title: 'x', trigger: { type: 'phrase', value: '   ' } }, null],
        [{ title: 'x', trigger: { type: 'risk_flag', value: 'nope' } }, null],
        [{ ...DEPOSIT, target: { group_id: 1, topic: 'finance' } }, null],
        [{ ...DEPOSIT, target: { topic: 'Finans Ekibi' } }, null],
        [{ ...DEPOSIT, title: 'x'.repeat(81) }, null],
        [{ ...DEPOSIT, priority: 'low' }, null],
        [{ ...DEPOSIT, locked: true }, null],
      ];
      for (const [payload, reason] of refusals) {
        const response = await send('POST', base(), payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        if (reason) expect(response.json()).toMatchObject({ error: { details: { reason } } });
      }
      expect(await owner.aiHandoffRule.count()).toBe(0);

      await owner.aiHandoffRule.createMany({
        data: Array.from({ length: HANDOFF_RULES_PER_AGENT_MAX }, (_, index) => ({
          licenseId: fx.a.licenseId,
          aiAgentId,
          position: index + 1,
          title: `r${index}`,
          triggerType: 'player_request',
        })),
      });
      const full = await send('POST', base(), DEPOSIT);
      expect(full.statusCode).toBe(400);
      expect(full.json()).toMatchObject({ error: { details: { reason: 'handoff_rules_limit' } } });
    });

    it("Copilot and another workspace's agent have no list (404)", async () => {
      const copilot = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Copilot', kind: 'copilot', active: true },
        select: { id: true },
      });
      for (const id of [copilot.id, otherAgentId]) {
        expect((await server.get(base(id), auth(adminToken))).statusCode).toBe(404);
        expect((await send('POST', base(id), DEPOSIT)).statusCode).toBe(404);
      }
      const theirs = await owner.aiHandoffRule.create({
        data: {
          licenseId: fx.b.licenseId,
          aiAgentId: otherAgentId,
          position: 1,
          title: 'B',
          triggerType: 'player_request',
        },
      });
      expect((await send('PATCH', `${base()}/${theirs.id}`, { active: false })).statusCode).toBe(
        404,
      );
      expect((await send('DELETE', `${base()}/${theirs.id}`)).statusCode).toBe(404);
      expect(
        (await owner.aiHandoffRule.findUniqueOrThrow({ where: { id: theirs.id } })).active,
      ).toBe(true);
    });
  });

  describe('under the route', () => {
    it('row level security: the app role sees only its own rules and cannot write one for another workspace (NFR-S4)', async () => {
      await add(DEPOSIT);
      const seen = await withTenant(appRole, tenant(fx.b), (tx) =>
        tx.aiHandoffRule.findMany({ select: { id: true } }),
      );
      expect(seen).toEqual([]);
      await expect(
        withTenant(appRole, tenant(fx.b), (tx) =>
          tx.aiHandoffRule.create({
            data: {
              licenseId: fx.b.licenseId,
              aiAgentId,
              position: 1,
              title: 'B',
              triggerType: 'player_request',
            },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        withTenant(appRole, tenant(fx.a), (tx) => tx.$executeRaw`TRUNCATE ai_handoff_rules`),
      ).rejects.toThrow(/permission denied/);
    });

    it("the CHECKs hold the types' lists: every topic, trigger and risk flag in, anything else out", async () => {
      const row = (triggerType: string, triggerValue: string | null) => ({
        licenseId: fx.a.licenseId,
        aiAgentId,
        position: 1,
        title: 't',
        triggerType,
        triggerValue,
      });
      const values: Record<string, string | null> = {
        topic: 'deposit',
        procedure: skillId,
        phrase: 'para',
        ai_unresolved: null,
        player_request: null,
        risk_flag: 'fraud_suspected',
      };
      for (const type of HANDOFF_RULE_TRIGGER_TYPES) {
        await owner.aiHandoffRule.create({ data: row(type, values[type] ?? null) });
      }
      for (const topic of HANDOFF_RULE_TOPICS) {
        await owner.aiHandoffRule.create({ data: row('topic', topic) });
      }
      for (const flag of RISK_FLAG_TYPES) {
        await owner.aiHandoffRule.create({ data: row('risk_flag', flag) });
      }
      for (const [type, value] of [
        ['teleport', null],
        ['topic', 'trading'],
        ['risk_flag', 'nope'],
        ['ai_unresolved', 'x'],
        ['phrase', ' '],
        ['procedure', 'not-a-uuid'],
      ] as const) {
        await expect(owner.aiHandoffRule.create({ data: row(type, value) })).rejects.toThrow();
      }
      await expect(
        owner.aiHandoffRule.create({
          data: { ...row('player_request', null), targetGroupId: 1n, targetTopic: 'finance' },
        }),
      ).rejects.toThrow();
      await expect(
        owner.aiHandoffRule.create({ data: { ...row('player_request', null), priority: 'low' } }),
      ).rejects.toThrow();
      // 80 Turkish letters pass, as the route lets them.
      await owner.aiHandoffRule.create({
        data: { ...row('player_request', null), title: 'ş'.repeat(80) },
      });
    });

    it("the contract names the types' lists", () => {
      const doc = loadOpenApiDocument() as unknown as {
        components: {
          schemas: Record<string, { properties?: Record<string, { enum?: unknown[] }> }>;
        };
      };
      const schemas = doc.components.schemas;
      expect(schemas['AiHandoffRuleTrigger']!.properties!['type']!.enum).toEqual([
        ...HANDOFF_RULE_TRIGGER_TYPES,
      ]);
      expect(schemas['AiHandoffLockedRule']!.properties!['id']!.enum).toEqual([
        ...LOCKED_HANDOFF_RULE_IDS,
      ]);
      expect(schemas['AiHandoffRuleExample']!.properties!['key']!.enum).toEqual(
        HANDOFF_RULE_EXAMPLES.map((example) => example.key),
      );
    });
  });

  describe('on a live conversation', () => {
    async function visitor(t: TenantFixture): Promise<Record<string, string>> {
      const response = await server.post(
        '/customer/token',
        { organization_id: t.organizationId },
        { origin: `https://${t.trustedDomain}` },
      );
      expect(response.statusCode).toBe(200);
      return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
    }

    /** One visitor message; what the bot said, the hand-over's event lines and record. */
    async function say(text: string) {
      const response = await server.post('/customer/chat/events', { text }, await visitor(fx.a));
      expect(response.statusCode).toBe(201);
      const chatId = (response.json() as { chat_id: string }).chat_id;
      const bot = await owner.event.findMany({
        where: { chatId, authorType: 'bot' },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      });
      const events = await owner.event.findMany({
        where: { chatId, type: 'system_message' },
        orderBy: { createdAt: 'asc' },
        select: { properties: true },
      });
      const records = await owner.aiDecisionLog.findMany({
        where: { chatId },
        select: { decision: true, details: true },
      });
      return {
        chatId,
        said: bot.map((event) => event.text),
        lines: events
          .map((event) => event.properties as Record<string, unknown>)
          .filter((properties) => properties['handoff_id'] !== undefined),
        records,
      };
    }

    it('"Para yatırma → Finans, high" hands a deposit question over; turned off, it does not; the order decides (AI-09 acceptance)', async () => {
      const rule = await add({ ...DEPOSIT, target: { group_id: financeGroupId } });

      const handed = await say('Param yatmadı, 500 TL gönderdim');
      expect(handed.said).toEqual([DEFAULT_HANDOFF_MESSAGES.tenant_rule.tr]);
      expect(handed.lines.length).toBeGreaterThan(0);
      for (const line of handed.lines) {
        expect(line).toMatchObject({
          reason_codes: ['tenant_rule'],
          primary_reason: 'tenant_rule',
          priority: 'high',
          handoff_rule_id: rule.id,
        });
      }
      // The hand-over's priority, and why, on the connection (tm 307.1).
      expect(
        await owner.thread.findFirstOrThrow({
          where: { chatId: handed.chatId },
          orderBy: { createdAt: 'desc' },
          select: { priority: true, priorityReason: true },
        }),
      ).toEqual({ priority: 1, priorityReason: 'tenant_rule' });
      expect(handed.records).toEqual([
        expect.objectContaining({
          decision: 'handoff',
          details: expect.objectContaining({
            reason_codes: ['tenant_rule'],
            handoff_rule_id: rule.id,
            handoff_id: handed.lines[0]!['handoff_id'],
          }),
        }),
      ]);

      expect((await send('PATCH', `${base()}/${rule.id}`, { active: false })).statusCode).toBe(200);
      const kept = await say('Param yatmadı, 500 TL gönderdim');
      expect(kept.said).not.toContain(DEFAULT_HANDOFF_MESSAGES.tenant_rule.tr);
      for (const line of kept.lines) {
        expect(line['reason_codes']).not.toContain('tenant_rule');
        expect(line['handoff_rule_id']).toBeUndefined();
      }

      // Two rules that both match: the first in the list decides.
      expect((await send('PATCH', `${base()}/${rule.id}`, { active: true })).statusCode).toBe(200);
      const phrase = await add({
        title: 'Yatırım sözü',
        trigger: { type: 'phrase', value: 'para yatır' },
        priority: 'normal',
      });
      const byDeposit = await say('Paramı yatırdım ama görünmüyor');
      expect(byDeposit.lines[0]).toMatchObject({ handoff_rule_id: rule.id, priority: 'high' });
      expect(
        (await send('PUT', `${base()}/order`, { rule_ids: [phrase.id, rule.id] })).statusCode,
      ).toBe(200);
      const byPhrase = await say('Paramı yatırdım ama görünmüyor');
      expect(byPhrase.lines[0]).toMatchObject({ handoff_rule_id: phrase.id, priority: 'normal' });
    });
  });
});
