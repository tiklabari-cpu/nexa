/**
 * The AI test bench's endpoints (tm 314.2 · SiyahTuş analysis AI-19 ·
 * `paths/ai-testing.yaml`), through the real server.
 *
 *   - **Scenarios.** Written with what is masked (AI-26) masked; refused with
 *     `details.problems` the editor shows by field; a change merged over the
 *     scenario and judged whole; deleted with its results keeping their key.
 *   - **Runs.** 202 queued; one open run per agent and target (409
 *     `ai_test_run_in_progress`); every active scenario when none is named, a
 *     validation error when there is none; a named version is tm 316's (404);
 *     the history newest first; failed results first.
 *   - **"Talk like a player".** A turn answers with its decision trace — the
 *     procedure and why, the knowledge source it used (AI-19 acceptance 6);
 *     the session is its starter's alone, gone once it expires, bounded in
 *     length, and saved as a scripted scenario with expectations suggested
 *     from how it went.
 *   - **Who.** Another workspace sees none of it (NFR-S4); an agent without the
 *     AI's configuration scope cannot open the Test tab (AI-19 acceptance 8).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_SANDBOX_MESSAGES_MAX,
  DEFAULT_AGENT_SCOPES,
  splitSkillProcedure,
  type AiTestTranscriptEntry,
  type AiTestTurnTrace,
} from '@siyahtus/types';
import {
  AI_PASSAGE,
  AI_QUESTION,
  seedAiWorkspace,
  type AiWorkspace,
} from '../helpers/ai-workspace.js';
import { grantToken, ownerClient, resetDatabase } from '../helpers/fixtures.js';
import { PAPARA_LINES, paparaAcceptanceProcedure } from '../helpers/procedure-fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Json = Record<string, unknown>;

interface ErrorBody {
  error: { type: string; message: string; details?: Json };
}

interface ScenarioBody {
  id: string;
  ai_agent_id: string;
  name: string;
  origin: string;
  origin_ref: string | null;
  mode: string;
  persona: string;
  language: string;
  turns: string[];
  facts: Json;
  goal: string | null;
  expectations: Json;
  active: boolean;
  created_by: string | null;
}

interface SessionBody {
  id: string;
  transcript: AiTestTranscriptEntry[];
  tokens: number;
  expires_at: string;
}

/**
 * A sandbox turn runs on the real clock, so its deposit time is said relative
 * to it: two hours ago is past Papara's 30 minutes at any hour of the day.
 */
const SANDBOX_LINES = ['param yatmadı', 'Papara, 2 saat önce', 'evet', 'PPR12345'];

describe('the AI test bench’s endpoints (tm 314.2 · AI-19)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let ws: AiWorkspace;
  let other: AiWorkspace;
  let token: string;
  let skillId: string;

  const auth = (t = token) => ({ authorization: `Bearer ${t}` });
  const tokenFor = (w: AiWorkspace, scopes: string[], ownerId = w.ownerId) =>
    grantToken(owner, {
      licenseId: w.licenseId,
      organizationId: w.organizationId,
      ownerId,
      scopes,
      kind: 'oauth',
    });
  const create = (body: Json, t = token) =>
    server.post('/ai/test-scenarios', { ai_agent_id: ws.aiAgentId, ...body }, auth(t));

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(server.app);
    ws = await seedAiWorkspace(owner);
    other = await seedAiWorkspace(owner);
    token = await tokenFor(ws, ['agents-bot--all:rw']);
    // Turkish and English: the procedure is Turkish, the knowledge passage English.
    await owner.aiAgent.update({ where: { id: ws.aiAgentId }, data: { languages: ['tr', 'en'] } });
    await owner.group.create({
      data: { licenseId: ws.licenseId, name: 'Finans', topicRole: 'finance' },
    });
    await owner.kbPaymentMethod.create({
      data: { licenseId: ws.licenseId, name: 'Papara', direction: 'deposit', expectedMinutes: 30 },
    });
    const { procedure: body, ...own } = splitSkillProcedure(paparaAcceptanceProcedure());
    skillId = (
      await owner.skill.create({
        data: {
          licenseId: ws.licenseId,
          aiAgentId: ws.aiAgentId,
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
        select: { id: true },
      })
    ).id;
  });

  describe('scenarios', () => {
    it('writes one with the defaults, the player’s words and facts masked, origin manual', async () => {
      const response = await create({
        name: 'Kart ile yatırım',
        turns: ['kartım 4111 1111 1111 1111 ile yatırdım geçmedi'],
        facts: { kart: '4111 1111 1111 1111', tutar: 2500, kendisi: true },
        expectations: { outcome: 'handoff', max_turns: 4 },
      });
      expect(response.statusCode, response.body).toBe(201);
      const body = response.json() as ScenarioBody;
      expect(body).toMatchObject({
        ai_agent_id: ws.aiAgentId,
        origin: 'manual',
        origin_ref: null,
        mode: 'scripted',
        persona: 'normal',
        language: 'tr',
        goal: null,
        active: true,
        created_by: ws.ownerId,
      });
      expect(body.turns[0]).not.toContain('4111 1111 1111 1111');
      expect(String(body.facts['kart'])).not.toContain('4111 1111 1111 1111');
      expect(body.facts).toMatchObject({ tutar: 2500, kendisi: true });
      const stored = await owner.aiTestScenario.findUniqueOrThrow({ where: { id: body.id } });
      expect(JSON.stringify(stored.turns)).not.toContain('4111 1111 1111 1111');
    });

    it('refuses a malformed one with the problems by field', async () => {
      const response = await create({
        name: '',
        mode: 'simulated',
        persona: 'unknown',
        turns: [],
        expectations: { outcome: 'handoff', max_turns: 99, team_id: -1 },
        extra: true,
      });
      expect(response.statusCode).toBe(400);
      const body = response.json() as ErrorBody;
      expect(body.error.type).toBe('validation');
      expect(body.error.details?.['problems']).toEqual(
        expect.arrayContaining([
          { field: 'extra', code: 'not_allowed' },
          { field: 'name', code: 'required' },
          { field: 'persona', code: 'invalid' },
          { field: 'goal', code: 'required' },
          { field: 'expectations.max_turns', code: 'out_of_range' },
          { field: 'expectations.team_id', code: 'invalid' },
        ]),
      );
      expect(await owner.aiTestScenario.count()).toBe(0);
    });

    it('lists the agent’s newest first, filters by active, and reads one', async () => {
      const first = (
        (
          await create({
            name: 'Bir',
            turns: ['a'],
            expectations: { outcome: 'resolved', max_turns: 2 },
          })
        ).json() as ScenarioBody
      ).id;
      const second = (
        (
          await create({
            name: 'İki',
            turns: ['b'],
            active: false,
            expectations: { outcome: 'resolved', max_turns: 2 },
          })
        ).json() as ScenarioBody
      ).id;
      const all = (
        await server.get(`/ai/test-scenarios?ai_agent_id=${ws.aiAgentId}`, auth())
      ).json() as {
        scenarios: ScenarioBody[];
      };
      expect(all.scenarios.map((scenario) => scenario.id)).toEqual([second, first]);
      const active = (
        await server.get(`/ai/test-scenarios?ai_agent_id=${ws.aiAgentId}&active=true`, auth())
      ).json() as { scenarios: ScenarioBody[] };
      expect(active.scenarios.map((scenario) => scenario.id)).toEqual([first]);
      const one = await server.get(`/ai/test-scenarios/${first}`, auth());
      expect((one.json() as ScenarioBody).name).toBe('Bir');
    });

    it('merges a change over the scenario and judges the whole', async () => {
      const id = (
        (
          await create({
            name: 'Bir',
            turns: ['a'],
            expectations: { outcome: 'resolved', max_turns: 2 },
          })
        ).json() as ScenarioBody
      ).id;
      const changed = await server.patch(
        `/ai/test-scenarios/${id}`,
        { name: 'Bir — düzeltildi', persona: 'sabirsiz' },
        auth(),
      );
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json()).toMatchObject({
        name: 'Bir — düzeltildi',
        persona: 'sabirsiz',
        turns: ['a'],
      });
      // Simulated without a goal: the merged scenario is what is judged.
      const refused = await server.patch(`/ai/test-scenarios/${id}`, { mode: 'simulated' }, auth());
      expect(refused.statusCode).toBe(400);
      expect((refused.json() as ErrorBody).error.details?.['problems']).toEqual([
        { field: 'goal', code: 'required' },
      ]);
      expect(
        (await server.patch(`/ai/test-scenarios/${id}`, { ai_agent_id: other.aiAgentId }, auth()))
          .statusCode,
      ).toBe(400);
    });

    it('deletes one; its results keep their key and name', async () => {
      const id = (
        (
          await create({
            name: 'Silinecek',
            turns: PAPARA_LINES,
            expectations: { outcome: 'handoff', max_turns: 4 },
          })
        ).json() as ScenarioBody
      ).id;
      const run = (
        await server.post('/ai/test-runs', { ai_agent_id: ws.aiAgentId, target: 'draft' }, auth())
      ).json() as { id: string };
      expect((await server.del(`/ai/test-scenarios/${id}`, auth())).statusCode).toBe(204);
      expect((await server.get(`/ai/test-scenarios/${id}`, auth())).statusCode).toBe(404);
      expect((await server.del(`/ai/test-scenarios/${id}`, auth())).statusCode).toBe(404);
      const results = (
        (await server.get(`/ai/test-runs/${run.id}/results`, auth())).json() as {
          results: Json[];
        }
      ).results;
      expect(results).toEqual([
        expect.objectContaining({
          scenario_id: null,
          scenario_key: id,
          scenario_name: 'Silinecek',
        }),
      ]);
    });

    it('a scenario names this workspace’s agent and brand only', async () => {
      expect(
        (
          await create({
            name: 'x',
            turns: ['a'],
            ai_agent_id: other.aiAgentId,
            expectations: { outcome: 'resolved', max_turns: 2 },
          })
        ).statusCode,
      ).toBe(404);
      const brand = await owner.brand.create({
        data: { licenseId: other.licenseId, name: 'B', slug: 'b' },
        select: { id: true },
      });
      const response = await create({
        name: 'x',
        turns: ['a'],
        brand_id: brand.id,
        expectations: { outcome: 'resolved', max_turns: 2 },
      });
      expect(response.statusCode).toBe(404);
      expect((response.json() as ErrorBody).error.type).toBe('brand_not_found');
    });
  });

  describe('runs', () => {
    it('queues one (202) and plays every active scenario when none is named; the history newest first', async () => {
      await create({
        name: 'Etkin',
        turns: PAPARA_LINES,
        expectations: { outcome: 'handoff', max_turns: 4 },
      });
      await create({
        name: 'Kapalı',
        turns: ['a'],
        active: false,
        expectations: { outcome: 'resolved', max_turns: 2 },
      });
      const queued = await server.post(
        '/ai/test-runs',
        { ai_agent_id: ws.aiAgentId, target: 'draft' },
        auth(),
      );
      expect(queued.statusCode, queued.body).toBe(202);
      expect(queued.json()).toMatchObject({
        status: 'queued',
        target: 'draft',
        trigger: 'manual',
        scenario_count: 1,
        compliance: null,
        started_by: ws.ownerId,
      });
      const id = (queued.json() as { id: string }).id;
      const played = (await server.get(`/ai/test-runs/${id}`, auth())).json() as Json;
      expect(played).toMatchObject({ status: 'completed', scenario_count: 1 });
      expect(played['finished_at']).not.toBeNull();
      const second = (
        await server.post(
          '/ai/test-runs',
          { ai_agent_id: ws.aiAgentId, target: 'published' },
          auth(),
        )
      ).json() as { id: string };
      const history = (
        await server.get(`/ai/test-runs?ai_agent_id=${ws.aiAgentId}&limit=10`, auth())
      ).json() as { runs: Array<{ id: string }> };
      expect(history.runs.map((run) => run.id)).toEqual([second.id, id]);
    });

    it('lists failed results first, with no regression and no judge yet (tm 314.3)', async () => {
      const failing = (
        (
          await create({
            name: 'Kalır',
            turns: PAPARA_LINES,
            simulated_now: '2026-10-19T15:15:00+03:00',
            expectations: { outcome: 'resolved', max_turns: 4 },
          })
        ).json() as ScenarioBody
      ).id;
      const passing = (
        (
          await create({
            name: 'Geçer',
            turns: PAPARA_LINES,
            simulated_now: '2026-10-19T15:15:00+03:00',
            expectations: { outcome: 'handoff', max_turns: 4, language: 'tr' },
          })
        ).json() as ScenarioBody
      ).id;
      const run = (
        await server.post(
          '/ai/test-runs',
          { ai_agent_id: ws.aiAgentId, target: 'draft', scenario_ids: [passing, failing] },
          auth(),
        )
      ).json() as { id: string };
      const body = (await server.get(`/ai/test-runs/${run.id}/results`, auth())).json() as {
        results: Array<{
          scenario_key: string;
          status: string;
          regression: unknown;
          judge: unknown;
        }>;
        compared_run_id: unknown;
      };
      expect(body.compared_run_id).toBeNull();
      expect(body.results.map((result) => result.scenario_key)).toEqual([failing, passing]);
      expect(body.results[0]).toMatchObject({ status: 'failed', regression: null, judge: null });
    });

    it('refuses a second open run of the agent and target (409), but not another target', async () => {
      await create({
        name: 'x',
        turns: ['a'],
        expectations: { outcome: 'resolved', max_turns: 2 },
      });
      await owner.aiTestRun.create({
        data: {
          licenseId: ws.licenseId,
          aiAgentId: ws.aiAgentId,
          configTarget: 'draft',
          trigger: 'manual',
          status: 'queued',
        },
      });
      const refused = await server.post(
        '/ai/test-runs',
        { ai_agent_id: ws.aiAgentId, target: 'draft' },
        auth(),
      );
      expect(refused.statusCode).toBe(409);
      expect((refused.json() as ErrorBody).error.type).toBe('ai_test_run_in_progress');
      const published = await server.post(
        '/ai/test-runs',
        { ai_agent_id: ws.aiAgentId, target: 'published' },
        auth(),
      );
      expect(published.statusCode).toBe(202);
    });

    it('refuses a run with nothing to play, a scenario not the agent’s and a version (tm 316)', async () => {
      const empty = await server.post(
        '/ai/test-runs',
        { ai_agent_id: ws.aiAgentId, target: 'draft' },
        auth(),
      );
      expect(empty.statusCode).toBe(400);
      expect((empty.json() as ErrorBody).error.details?.['problems']).toEqual([
        { field: 'scenario_ids', code: 'required' },
      ]);
      const foreign = await owner.aiTestScenario.create({
        data: {
          licenseId: other.licenseId,
          aiAgentId: other.aiAgentId,
          name: 'B',
          turns: ['a'],
          expectations: { outcome: 'resolved', max_turns: 2 },
        },
        select: { id: true },
      });
      expect(
        (
          await server.post(
            '/ai/test-runs',
            { ai_agent_id: ws.aiAgentId, target: 'draft', scenario_ids: [foreign.id] },
            auth(),
          )
        ).statusCode,
      ).toBe(404);
      const version = await server.post(
        '/ai/test-runs',
        {
          ai_agent_id: ws.aiAgentId,
          target: 'version',
          config_version_id: '0b6c7a8e-1f2d-4c3b-9a4e-5d6f7a8b9c0d',
        },
        auth(),
      );
      expect(version.statusCode).toBe(404);
      expect(
        (
          await server.post(
            '/ai/test-runs',
            { ai_agent_id: ws.aiAgentId, target: 'version' },
            auth(),
          )
        ).statusCode,
      ).toBe(400);
    });
  });

  describe('"talk like a player"', () => {
    async function session(t = token): Promise<SessionBody> {
      const response = await server.post(
        '/ai/sandbox-sessions',
        { ai_agent_id: ws.aiAgentId },
        auth(t),
      );
      expect(response.statusCode, response.body).toBe(201);
      return response.json() as SessionBody;
    }
    const say = (id: string, message: string, t = token) =>
      server.post(`/ai/sandbox-sessions/${id}/turns`, { message }, auth(t));

    it('every turn answers with its trace: the procedure and why, the knowledge source used (AI-19 acceptance 6)', async () => {
      const { id, expires_at: started } = await session();
      const first = await say(id, 'param yatmadı');
      expect(first.statusCode, first.body).toBe(200);
      const opened = first.json() as {
        reply: string;
        trace: AiTestTurnTrace;
        session: SessionBody;
      };
      expect(opened.trace).toMatchObject({
        decision: 'asked',
        procedure: { skill_id: skillId, name: 'Yatırım geçmedi', reason: 'start' },
      });
      const second = (await say(id, SANDBOX_LINES[1]!)).json() as {
        trace: AiTestTurnTrace;
        session: SessionBody;
      };
      expect(second.trace.procedure).toMatchObject({ skill_id: skillId, reason: 'continue' });
      expect(second.trace.slots).toMatchObject({ yontem: 'Papara' });
      // Two player lines and the AI's answers, kept; the session lives 24 h past the last.
      expect(second.session.transcript.map((entry) => entry.role)).toEqual([
        'player',
        'ai',
        'player',
        'ai',
      ]);
      expect(Date.parse(second.session.expires_at)).toBeGreaterThanOrEqual(Date.parse(started));
      const reread = (await server.get(`/ai/sandbox-sessions/${id}`, auth())).json() as SessionBody;
      expect(reread.transcript).toHaveLength(4);

      // A question for the knowledge base, in a session of its own: the source it was answered from.
      const fresh = await session();
      const knowledge = (await say(fresh.id, AI_QUESTION)).json() as {
        reply: string;
        trace: AiTestTurnTrace;
      };
      expect(knowledge.reply).toContain('Q7-courier');
      expect(AI_PASSAGE).toContain('Q7-courier');
      expect(knowledge.trace).toMatchObject({
        decision: 'answered',
        procedure: { name: 'Delivery' },
      });
      expect(knowledge.trace.sources).toEqual([
        expect.objectContaining({ title: 'Delivery', page: null }),
      ]);
    });

    it('is its starter’s alone, and gone once it expires', async () => {
      const { id } = await session();
      const colleague = await owner.account.create({
        data: { email: 'colleague@example.test', name: 'Colleague' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: ws.licenseId, agentId: colleague.id, role: 'admin' },
      });
      const theirs = await tokenFor(ws, ['agents-bot--all:rw'], colleague.id);
      expect((await server.get(`/ai/sandbox-sessions/${id}`, auth(theirs))).statusCode).toBe(404);
      expect((await say(id, 'merhaba', theirs)).statusCode).toBe(404);
      await owner.aiSandboxSession.update({
        where: { id },
        data: {
          createdAt: new Date(Date.now() - 86_400_000),
          expiresAt: new Date(Date.now() - 1_000),
        },
      });
      expect((await server.get(`/ai/sandbox-sessions/${id}`, auth())).statusCode).toBe(404);
      expect((await say(id, 'merhaba')).statusCode).toBe(404);
    });

    it('takes at most AI_SANDBOX_MESSAGES_MAX messages, refusing the next before any turn', async () => {
      const { id } = await session();
      const at = new Date().toISOString();
      const full: AiTestTranscriptEntry[] = Array.from(
        { length: AI_SANDBOX_MESSAGES_MAX },
        (_, i): AiTestTranscriptEntry[] => [
          { role: 'player', text: `mesaj ${i + 1}`, at },
          { role: 'ai', text: 'Anladım.', at },
        ],
      ).flat();
      await owner.aiSandboxSession.update({
        where: { id },
        data: { transcript: full as unknown as object },
      });
      const refused = await say(id, 'bir tane daha');
      expect(refused.statusCode).toBe(400);
      expect((refused.json() as ErrorBody).error.details?.['problems']).toEqual([
        { field: 'message', code: 'too_many' },
      ]);
      const kept = await owner.aiSandboxSession.findUniqueOrThrow({ where: { id } });
      expect(kept.transcript).toEqual(full);
      expect(kept.tokens).toBe(0);
    });

    it('saves the player’s lines as a scripted scenario, its expectations suggested from how it went', async () => {
      const { id } = await session();
      for (const line of SANDBOX_LINES) {
        expect((await say(id, line)).statusCode).toBe(200);
      }
      const saved = await server.post(
        `/ai/sandbox-sessions/${id}/save-as-scenario`,
        { name: 'Sandbox’tan' },
        auth(),
      );
      expect(saved.statusCode, saved.body).toBe(201);
      const scenario = saved.json() as ScenarioBody;
      expect(scenario).toMatchObject({
        origin: 'from_chat',
        origin_ref: id,
        mode: 'scripted',
        language: 'tr',
        turns: SANDBOX_LINES,
      });
      expect(scenario.expectations).toMatchObject({
        outcome: 'handoff',
        topic: 'finance',
        reason_code: 'expected_time_exceeded',
        procedure_id: skillId,
        max_turns: 4,
      });
      expect(scenario.expectations['required_slots']).toEqual(
        expect.arrayContaining(['yontem', 'islem_zamani', 'talep_olusturuldu', 'referans']),
      );
      // A session with nothing said is no scenario.
      const silent = await session();
      const empty = await server.post(
        `/ai/sandbox-sessions/${silent.id}/save-as-scenario`,
        { name: 'Boş' },
        auth(),
      );
      expect(empty.statusCode).toBe(400);
    });
  });

  describe('who', () => {
    it('another workspace sees none of it (NFR-S4)', async () => {
      const id = (
        (
          await create({
            name: 'A',
            turns: ['a'],
            expectations: { outcome: 'resolved', max_turns: 2 },
          })
        ).json() as ScenarioBody
      ).id;
      const run = (
        await server.post('/ai/test-runs', { ai_agent_id: ws.aiAgentId, target: 'draft' }, auth())
      ).json() as { id: string };
      const sandbox = (
        await server.post('/ai/sandbox-sessions', { ai_agent_id: ws.aiAgentId }, auth())
      ).json() as { id: string };
      const theirs = await tokenFor(other, ['agents-bot--all:rw']);
      for (const path of [
        `/ai/test-scenarios/${id}`,
        `/ai/test-runs/${run.id}`,
        `/ai/test-runs/${run.id}/results`,
        `/ai/sandbox-sessions/${sandbox.id}`,
      ]) {
        expect((await server.get(path, auth(theirs))).statusCode, path).toBe(404);
      }
      expect(
        (await server.patch(`/ai/test-scenarios/${id}`, { name: 'B' }, auth(theirs))).statusCode,
      ).toBe(404);
      expect((await server.del(`/ai/test-scenarios/${id}`, auth(theirs))).statusCode).toBe(404);
      const listed = (
        await server.get(`/ai/test-scenarios?ai_agent_id=${ws.aiAgentId}`, auth(theirs))
      ).json() as { scenarios: unknown[] };
      expect(listed.scenarios).toEqual([]);
      expect(
        (
          await server.post(
            '/ai/test-runs',
            { ai_agent_id: ws.aiAgentId, target: 'draft' },
            auth(theirs),
          )
        ).statusCode,
      ).toBe(404);
    });

    it('an agent with the default scopes cannot open the Test tab (AI-19 acceptance 8)', async () => {
      const agent = await tokenFor(ws, [...DEFAULT_AGENT_SCOPES]);
      for (const path of [
        `/ai/test-scenarios?ai_agent_id=${ws.aiAgentId}`,
        `/ai/test-runs?ai_agent_id=${ws.aiAgentId}`,
      ]) {
        expect((await server.get(path, auth(agent))).statusCode, path).toBe(403);
      }
      expect(
        (await server.post('/ai/sandbox-sessions', { ai_agent_id: ws.aiAgentId }, auth(agent)))
          .statusCode,
      ).toBe(403);
      // Whoever configures the AI does.
      expect(
        (await server.get(`/ai/test-runs?ai_agent_id=${ws.aiAgentId}`, auth())).statusCode,
      ).toBe(200);
    });
  });
});
