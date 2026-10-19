/**
 * The "resolved" criteria (tm 303.4 · SiyahTuş analysis AI-09; owner decision
 * K9), through the real server and the real database:
 *
 *   - the agent's default in `GET|PUT /ai-agents/{id}/handoff-settings`
 *     (`resolution_criteria`): none by default, written and read back, `null`
 *     back to the platform's; criteria that name a slot, a fact or a function
 *     needing one are refused with the procedure problem, nothing written; the
 *     column's CHECK under the route;
 *   - a procedure skill's own criteria, stored with its procedure and judged
 *     against its slots;
 *   - on a live conversation: the AI does not say "solved" before the player
 *     does — the answer asks, "evet" resolves, and the decision record says
 *     why; "hayır" sends a person, routed by the workspace's "AI could not
 *     solve it" rule; the workspace's default holds a procedure without its
 *     own, and unmet it never claims.
 */
import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_HANDOFF_MESSAGES,
  RESOLUTION_PHRASES,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const ANSWER = 'Bonus kurallarını kısaca anlat.';
const CONFIRMED = { fn: { name: 'player_confirmed', args: [] } };

function build(raw: Record<string, unknown>): Procedure {
  const result = validateProcedure(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

describe('the "resolved" criteria (AI-09 · K9 · tm 303.4)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let skillId: string;
  let financeGroupId: number;
  let adminToken: string;

  const auth = () => ({ authorization: `Bearer ${adminToken}` });
  const settings = () => `/ai-agents/${aiAgentId}/handoff-settings`;
  const put = (payload: object) =>
    server.app.inject({ method: 'PUT', url: server.url(settings()), headers: auth(), payload });
  const stored = async () =>
    (
      await owner.aiHandoffSettings.findUnique({
        where: { aiAgentId },
        select: { resolutionCriteria: true },
      })
    )?.resolutionCriteria ?? null;

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
    // A one-turn procedure with no team of its own: the routes decide where it goes.
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
  });

  describe('the agent’s default', () => {
    it('is none until written; written, it is read back and stored; null goes back to the platform’s (K9)', async () => {
      const first = await server.get(settings(), auth());
      expect(first.json()).toMatchObject({ resolution_criteria: null });

      const criteria = {
        all: [CONFIRMED, { ai: { question: 'Oyuncu sorununun çözüldüğünü söyledi mi?' } }],
      };
      const written = await put({ resolution_criteria: criteria });
      expect(written.statusCode, written.body).toBe(200);
      expect(written.json()).toMatchObject({ resolution_criteria: criteria });
      expect((await server.get(settings(), auth())).json()).toMatchObject({
        resolution_criteria: criteria,
      });
      expect(await stored()).toEqual(criteria);

      // Another field alone leaves it as it is.
      expect((await put({ assignment_mode: 'ai_first' })).json()).toMatchObject({
        resolution_criteria: criteria,
      });

      const cleared = await put({ resolution_criteria: null });
      expect(cleared.json()).toMatchObject({ resolution_criteria: null });
      expect(await stored()).toBeNull();
    });

    it('refuses what names a slot, a fact or a function needing one — the procedure problem, nothing written', async () => {
      const refused = async (criteria: unknown, reason: string) => {
        const response = await put({ resolution_criteria: criteria });
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json()).toMatchObject({
          error: {
            type: 'validation',
            details: { reason, section: 'handoff', field: 'resolution_criteria' },
          },
        });
      };
      await refused({ slot: { name: 'yontem', op: 'exists' } }, 'slot_unknown_reference');
      await refused(
        { fact: { path: 'method.expected_minutes', op: 'exists' } },
        'procedure_fact_without_source',
      );
      await refused(
        { fn: { name: 'elapsed_minutes', args: ['islem_zamani'], op: 'gt', value: 30 } },
        'slot_unknown_reference',
      );
      await refused(
        { fn: { name: 'next_window', args: ['method'], op: 'exists' } },
        'procedure_fact_without_source',
      );
      await refused(
        { fn: { name: 'player_confirmed', args: ['x'] } },
        'procedure_bad_function_args',
      );
      await refused({ eval: 'true' }, 'procedure_bad_condition');
      await refused(
        { any: [{ ai: { question: 'Bir?' } }, { ai: { question: 'İki?' } }] },
        'procedure_ai_condition_repeated',
      );
      expect((await put({ resolution_criteria: 'player_confirmed' })).statusCode).toBe(400);
      expect(await stored()).toBeNull();
    });

    it('the column holds an object, within its size — the CHECK under the route', async () => {
      await owner.aiHandoffSettings.create({
        data: { aiAgentId, licenseId: fx.a.licenseId },
      });
      await expect(
        owner.aiHandoffSettings.update({
          where: { aiAgentId },
          data: { resolutionCriteria: [CONFIRMED] },
        }),
      ).rejects.toThrow(/ai_handoff_settings_resolution_criteria_check/);
      await expect(
        owner.aiHandoffSettings.update({
          where: { aiAgentId },
          data: { resolutionCriteria: { ai: { question: 'x'.repeat(17_000) } } },
        }),
      ).rejects.toThrow(/ai_handoff_settings_resolution_criteria_check/);
    });
  });

  describe('a procedure’s own', () => {
    const procedureSkill = (criteria: unknown) => ({
      name: 'Yatırım',
      mode: 'procedure',
      when_to_use: 'Oyuncu yatırımının geçmediğini söylüyor.',
      examples: ['param yatmadı'],
      slots: [{ name: 'yontem', label: 'Yöntem', type: 'text', ask: 'Hangi yöntemle?' }],
      procedure: {
        steps: [
          { id: 'sor', type: 'collect', slots: ['yontem'] },
          { id: 'bitti', type: 'resolve', outcome: 'resolved' },
        ],
        resolution_criteria: criteria,
      },
    });

    it('is stored with the procedure, judged against its slots (K9)', async () => {
      const criteria = { all: [{ slot: { name: 'yontem', op: 'exists' } }, CONFIRMED] };
      const created = await server.post('/skills', procedureSkill(criteria), auth());
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json()).toMatchObject({ procedure: { resolution_criteria: criteria } });
      const row = await owner.skill.findUniqueOrThrow({
        where: { id: (created.json() as { id: string }).id },
        select: { procedure: true },
      });
      expect(row.procedure).toMatchObject({ resolution_criteria: criteria });

      const refused = await server.post(
        '/skills',
        procedureSkill({ slot: { name: 'tutar', op: 'exists' } }),
        auth(),
      );
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({
        error: {
          details: {
            reason: 'slot_unknown_reference',
            section: 'handoff',
            field: 'resolution_criteria',
            slot: 'tutar',
          },
        },
      });
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

    /** One message of a visitor's conversation; what the bot has said so far, its hand-over lines, records. */
    async function say(headers: Record<string, string>, text: string) {
      const response = await server.post('/customer/chat/events', { text }, headers);
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
        orderBy: { createdAt: 'asc' },
        select: { decision: true, handoffReason: true, details: true },
      });
      const thread = await owner.thread.findFirstOrThrow({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
        select: { aiMode: true, groupId: true },
      });
      return {
        chatId,
        said: bot.map((event) => event.text),
        lines: events
          .map((event) => event.properties as Record<string, unknown>)
          .filter((properties) => properties['handoff_id'] !== undefined),
        records,
        thread,
      };
    }

    it('the AI does not say "solved" before the player does: the answer asks, "evet" resolves — and the record says why (K9 acceptance)', async () => {
      const headers = await visitor(fx.a);
      const asked = await say(headers, 'bonus nedir');
      expect(asked.said).toEqual([`${ANSWER}\n${RESOLUTION_PHRASES.tr.confirm.resolved}`]);
      expect(asked.records).toEqual([
        expect.objectContaining({
          decision: 'answered',
          details: expect.objectContaining({
            resolution: {
              decision: 'asked',
              reason: 'awaiting_confirmation',
              basis: 'platform',
              result: 'unknown',
              unknown: ['fn player_confirmed'],
              confirmation: null,
              outcome: 'resolved',
              step_id: 'bitti',
            },
          }),
        }),
      ]);
      const waiting = await owner.aiConversation.findFirstOrThrow({
        where: { chatId: asked.chatId },
        select: { activeSkillId: true, stepId: true, stepStatus: true },
      });
      expect(waiting).toEqual({
        activeSkillId: skillId,
        stepId: 'bitti',
        stepStatus: 'awaiting_answer',
      });

      const solved = await say(headers, 'evet');
      expect(solved.said.at(-1)).toBe(RESOLUTION_PHRASES.tr.thanks);
      expect(solved.records.at(-1)).toMatchObject({
        decision: 'answered',
        details: {
          resolution: {
            decision: 'resolved',
            reason: 'criteria_met',
            basis: 'platform',
            result: true,
            confirmation: 'yes',
          },
        },
      });
      expect(solved.thread.aiMode).toBe('ai');
      expect(solved.lines).toEqual([]);
    });

    it('"hayır": a person takes over — routed by the workspace’s "AI could not solve it" rule, the reason on the events and the record (K9 acceptance)', async () => {
      const rule = await server.post(
        `/ai-agents/${aiAgentId}/handoff-rules`,
        {
          title: 'AI çözemedi',
          trigger: { type: 'ai_unresolved', value: null },
          target: { group_id: financeGroupId },
          priority: 'high',
        },
        auth(),
      );
      expect(rule.statusCode, rule.body).toBe(201);
      const ruleId = (rule.json() as { id: string }).id;

      const headers = await visitor(fx.a);
      await say(headers, 'bonus nedir');
      const handed = await say(headers, 'hayır');
      expect(handed.said.at(-1)).toBe(DEFAULT_HANDOFF_MESSAGES.player_said_unresolved.tr);
      expect(handed.thread).toEqual({ aiMode: 'human', groupId: BigInt(financeGroupId) });
      expect(handed.lines.length).toBeGreaterThan(0);
      for (const line of handed.lines) {
        expect(line).toMatchObject({
          reason_codes: ['player_said_unresolved'],
          priority: 'high',
          handoff_rule_id: ruleId,
        });
      }
      expect(handed.records.at(-1)).toMatchObject({
        decision: 'handoff',
        handoffReason: 'player_said_unresolved',
        details: {
          reason_codes: ['player_said_unresolved'],
          resolution: {
            decision: 'unresolved',
            reason: 'player_said_no',
            result: false,
            confirmation: 'no',
          },
        },
      });
    });

    it('the workspace’s default holds a procedure without its own: unmet, a person — never a claim', async () => {
      // An `ai` question the in-process understanding never answers: never met.
      expect(
        (await put({ resolution_criteria: { ai: { question: 'Oyuncu memnun kaldı mı?' } } }))
          .statusCode,
      ).toBe(200);
      const handed = await say(await visitor(fx.a), 'bonus nedir');
      // What the steps said goes out; in place of "solved", a person — no question.
      expect(handed.said).toEqual([ANSWER]);
      expect(handed.thread.aiMode).toBe('human');
      expect(handed.records).toEqual([
        expect.objectContaining({
          decision: 'handoff',
          handoffReason: 'resolution_criteria_unmet',
          details: expect.objectContaining({
            reason_codes: ['player_said_unresolved'],
            resolution: expect.objectContaining({
              decision: 'unresolved',
              reason: 'criteria_unmet',
              basis: 'workspace',
              result: 'unknown',
              unknown: ['ai'],
            }),
          }),
        }),
      ]);
    });
  });
});
