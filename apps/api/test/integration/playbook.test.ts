/**
 * Playbook — AI agent skill CRUD, authoring and run history (`routes/playbook.ts`).
 *
 * Deliberately narrow: `GET/PATCH /ai-agents` already has full coverage in
 * `ai-agent-profile.test.ts` (persona round-trip, merge, validation,
 * cross-tenant 404), and every `/knowledge-sources*` endpoint is covered end
 * to end across `knowledge-bulk.test.ts`, `knowledge-bulk-website.test.ts`,
 * `knowledge-crawl.test.ts` (create/list/website crawl/bulk import) and
 * `audit-log.test.ts` (delete + audit trail) — none of that is repeated here.
 * `ai-skills.test.ts` exercises the skill *engine* through real customer
 * messages, never the HTTP route.
 *
 * What was left with no route-level coverage: the skill CRUD surface itself
 * (list/create/read/update/delete — `audit-log.test.ts` only touches create
 * and same-tenant delete for its audit-trail assertion), `compile`/`preview`
 * (only region-gating touches `/skills/compile` today, in
 * `hipaa-constraints.test.ts`), `GET /skills/:id/runs`, and scope/cross-tenant
 * enforcement across all of the above.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('playbook — skills', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const writeToken = (tenant: TenantFixture) =>
    grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });

  const readToken = (tenant: TenantFixture) =>
    grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes: ['agents-bot--all:ro'],
    });

  /** A token that carries a real scope, just not one this route accepts. */
  const unrelatedToken = (tenant: TenantFixture) =>
    grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes: ['chats--all:rw'],
    });

  async function createSkillViaApi(token: string, overrides: Record<string, unknown> = {}) {
    return server.post(
      '/skills',
      { name: 'Order status', ai_agent_id: aiAgentId, ...overrides },
      auth(token),
    );
  }

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

    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada', active: true },
      select: { id: true },
    });
    aiAgentId = agent.id;
  });

  // ===========================================================================
  // Create
  // ===========================================================================

  describe('POST /skills', () => {
    it('creates a skill inactive, whatever the caller sends — a new skill must not start answering', async () => {
      const token = await writeToken(fx.a);
      const response = await createSkillViaApi(token, {
        instruction: 'greet the customer',
        steps: [{ type: 'send_message', source: 'text', text: 'Hi there.' }],
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        id: string;
        active: boolean;
        kind: string;
        ai_agent_id: string;
      };
      expect(body.active).toBe(false);
      expect(body.kind).toBe('ai_agent');
      expect(body.ai_agent_id).toBe(aiAgentId);
    });

    it('rejects a step list the engine could not run, naming the offending step', async () => {
      const token = await writeToken(fx.a);
      const response = await createSkillViaApi(token, {
        steps: [{ type: 'send_message', source: 'text', text: 'ok' }, { type: 'not_a_real_step' }],
      });
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: { type: string; message: string } };
      expect(body.error.type).toBe('validation');
      expect(body.error.message).toContain('Step 2');
    });

    it('rejects an ai_agent_id that does not exist', async () => {
      const token = await writeToken(fx.a);
      const response = await createSkillViaApi(token, { ai_agent_id: randomUUID() });
      expect(response.statusCode).toBe(400);
    });

    it('is closed to a read-only token', async () => {
      const token = await readToken(fx.a);
      expect((await createSkillViaApi(token)).statusCode).toBe(403);
    });

    it('is closed to a token without any agents-bot scope', async () => {
      const token = await unrelatedToken(fx.a);
      expect((await createSkillViaApi(token)).statusCode).toBe(403);
    });
  });

  // ===========================================================================
  // Read
  // ===========================================================================

  describe('GET /skills, GET /skills/:id', () => {
    it('lists AI-agent skills only, and never a copilot anchor skill', async () => {
      const token = await writeToken(fx.a);
      const created = await createSkillViaApi(token, {
        steps: [{ type: 'send_message', source: 'text', text: 'hi' }],
      });
      const skillId = (created.json() as { id: string }).id;

      // Copilot owns a `kind: 'workspace'` skill purely to anchor its assist
      // runs (FR-MOD-12 — `services/ai/copilot-service.ts`'s `COPILOT_SKILL_KIND`)
      // — it is not something an admin wrote and must not appear in the
      // Playbook list.
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'copilot-anchor',
          kind: 'workspace',
          steps: [],
          active: true,
          updatedAt: new Date(),
        },
      });

      const list = await server.get('/skills', auth(token));
      expect(list.statusCode).toBe(200);
      const items = (list.json() as { items: Array<{ id: string; kind: string }> }).items;
      expect(items.map((s) => s.id)).toContain(skillId);
      expect(items.every((s) => s.kind === 'ai_agent')).toBe(true);
    });

    it('reads one skill back with its steps', async () => {
      const token = await writeToken(fx.a);
      const steps = [{ type: 'send_message', source: 'text', text: 'hi' }];
      const created = await createSkillViaApi(token, { steps });
      const skillId = (created.json() as { id: string }).id;

      const read = await server.get(`/skills/${skillId}`, auth(token));
      expect(read.statusCode).toBe(200);
      expect((read.json() as { steps: unknown[] }).steps).toEqual(steps);
    });

    it('returns 404 for a skill that does not exist', async () => {
      const token = await writeToken(fx.a);
      expect((await server.get(`/skills/${randomUUID()}`, auth(token))).statusCode).toBe(404);
    });

    it("never reads another tenant's skill — a 404, not a 403, so IDs stay opaque", async () => {
      const tokenA = await writeToken(fx.a);
      const created = await createSkillViaApi(tokenA);
      const skillId = (created.json() as { id: string }).id;

      const tokenB = await writeToken(fx.b);
      expect((await server.get(`/skills/${skillId}`, auth(tokenB))).statusCode).toBe(404);
    });

    it('is closed to a token without any agents-bot scope', async () => {
      const token = await unrelatedToken(fx.a);
      expect((await server.get('/skills', auth(token))).statusCode).toBe(403);
    });
  });

  // ===========================================================================
  // Update
  // ===========================================================================

  describe('PATCH /skills/:id', () => {
    it('updates name, instruction and steps', async () => {
      const token = await writeToken(fx.a);
      const created = await createSkillViaApi(token, {
        steps: [{ type: 'send_message', source: 'text', text: 'old' }],
      });
      const skillId = (created.json() as { id: string }).id;

      const newSteps = [{ type: 'send_message', source: 'text', text: 'new' }];
      const patched = await server.patch(
        `/skills/${skillId}`,
        { name: 'Renamed', instruction: 'say new', steps: newSteps },
        auth(token),
      );
      expect(patched.statusCode).toBe(200);
      const body = patched.json() as { name: string; instruction: string; steps: unknown[] };
      expect(body.name).toBe('Renamed');
      expect(body.instruction).toBe('say new');
      expect(body.steps).toEqual(newSteps);
    });

    it('refuses to activate a skill with no steps', async () => {
      const token = await writeToken(fx.a);
      const created = await createSkillViaApi(token); // no steps
      const skillId = (created.json() as { id: string }).id;

      const patched = await server.patch(`/skills/${skillId}`, { active: true }, auth(token));
      expect(patched.statusCode).toBe(403);
      const body = patched.json() as { error: { type: string } };
      expect(body.error.type).toBe('not_allowed');
    });

    it('activates a skill that already has steps', async () => {
      const token = await writeToken(fx.a);
      const created = await createSkillViaApi(token, {
        steps: [{ type: 'send_message', source: 'text', text: 'ok' }],
      });
      const skillId = (created.json() as { id: string }).id;

      const patched = await server.patch(`/skills/${skillId}`, { active: true }, auth(token));
      expect(patched.statusCode).toBe(200);
      expect((patched.json() as { active: boolean }).active).toBe(true);
    });

    it('rejects an update with no fields at all', async () => {
      const token = await writeToken(fx.a);
      const created = await createSkillViaApi(token);
      const skillId = (created.json() as { id: string }).id;
      expect((await server.patch(`/skills/${skillId}`, {}, auth(token))).statusCode).toBe(400);
    });

    it('returns 404 for a skill that does not exist', async () => {
      const token = await writeToken(fx.a);
      expect(
        (await server.patch(`/skills/${randomUUID()}`, { name: 'x' }, auth(token))).statusCode,
      ).toBe(404);
    });

    it("never updates another tenant's skill", async () => {
      const tokenA = await writeToken(fx.a);
      const created = await createSkillViaApi(tokenA);
      const skillId = (created.json() as { id: string }).id;

      const tokenB = await writeToken(fx.b);
      const patched = await server.patch(`/skills/${skillId}`, { name: 'Hijacked' }, auth(tokenB));
      expect(patched.statusCode).toBe(404);
      const unchanged = await owner.skill.findUnique({
        where: { id: skillId },
        select: { name: true },
      });
      expect(unchanged?.name).toBe('Order status');
    });

    it('is closed to a read-only token', async () => {
      const token = await writeToken(fx.a);
      const created = await createSkillViaApi(token);
      const skillId = (created.json() as { id: string }).id;

      const readOnly = await readToken(fx.a);
      expect(
        (await server.patch(`/skills/${skillId}`, { name: 'nope' }, auth(readOnly))).statusCode,
      ).toBe(403);
    });
  });

  // ===========================================================================
  // Delete
  // ===========================================================================
  // The positive delete + audit trail is already covered by
  // `audit-log.test.ts` ("records an AI-agent skill being deleted"); only
  // cross-tenant isolation is missing there.

  describe('DELETE /skills/:id', () => {
    it("never deletes another tenant's skill", async () => {
      const tokenA = await writeToken(fx.a);
      const created = await createSkillViaApi(tokenA);
      const skillId = (created.json() as { id: string }).id;

      const tokenB = await writeToken(fx.b);
      expect((await server.del(`/skills/${skillId}`, auth(tokenB))).statusCode).toBe(404);
      expect(await owner.skill.count({ where: { id: skillId } })).toBe(1);
    });
  });

  // ===========================================================================
  // Authoring — compile / preview
  // ===========================================================================

  describe('POST /skills/compile', () => {
    // Region-gating on this exact route is already covered by
    // `hipaa-constraints.test.ts`; this covers the compiler behaviour itself.
    it('turns an instruction into steps, and reports what it could not parse', async () => {
      const token = await writeToken(fx.a);
      const response = await server.post(
        '/skills/compile',
        { instruction: 'when the customer asks about refunds, reply with our policy' },
        auth(token),
      );
      expect(response.statusCode).toBe(200);
      const body = response.json() as { steps: Array<{ type: string }>; unrecognised: string[] };
      expect(body.steps.length).toBeGreaterThan(0);
      expect(Array.isArray(body.unrecognised)).toBe(true);
    });

    it('rejects an empty instruction', async () => {
      const token = await writeToken(fx.a);
      const response = await server.post('/skills/compile', { instruction: '' }, auth(token));
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /skills/preview', () => {
    it('runs the real engine over a supplied message, without persisting a skill', async () => {
      const token = await writeToken(fx.a);
      const before = await owner.skill.count({ where: { licenseId: fx.a.licenseId } });

      const response = await server.post(
        '/skills/preview',
        {
          steps: [{ type: 'send_message', source: 'text', text: 'Hello from preview.' }],
          message: 'Hi',
          ai_agent_id: aiAgentId,
        },
        auth(token),
      );
      expect(response.statusCode).toBe(200);
      const body = response.json() as { outcome: string; reply: string | null; errors: string[] };
      expect(body.outcome).toBe('answered');
      expect(body.reply).toBe('Hello from preview.');
      expect(body.errors).toEqual([]);

      // Never persisted — a preview is a dry run of the real engine, not a write.
      expect(await owner.skill.count({ where: { licenseId: fx.a.licenseId } })).toBe(before);
    });

    it('reports a bad step list as an error rather than 400ing the request', async () => {
      const token = await writeToken(fx.a);
      const response = await server.post(
        '/skills/preview',
        { steps: [{ type: 'not_a_real_step' }], message: 'Hi' },
        auth(token),
      );
      expect(response.statusCode).toBe(200);
      const body = response.json() as { outcome: string; errors: string[] };
      expect(body.outcome).toBe('skipped');
      expect(body.errors.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Run history
  // ===========================================================================

  describe('GET /skills/:id/runs', () => {
    it('reads back a run recorded in the current envelope log shape', async () => {
      const token = await writeToken(fx.a);
      const created = await createSkillViaApi(token, {
        steps: [{ type: 'send_message', source: 'text', text: 'ok' }],
      });
      const skillId = (created.json() as { id: string }).id;

      await owner.skillRun.create({
        data: {
          skillId,
          licenseId: fx.a.licenseId,
          status: 'succeeded',
          log: { outcome: 'answered', entries: [{ step: 'send_message', detail: 'ok' }] },
        },
      });

      const response = await server.get(`/skills/${skillId}/runs`, auth(token));
      expect(response.statusCode).toBe(200);
      const items = (
        response.json() as {
          items: Array<{ status: string; outcome: string | null; log: unknown[] }>;
        }
      ).items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ status: 'succeeded', outcome: 'answered' });
      expect(items[0]?.log).toEqual([{ step: 'send_message', detail: 'ok' }]);
    });

    it('reads back a run recorded before the log gained an outcome (plain array)', async () => {
      const token = await writeToken(fx.a);
      const created = await createSkillViaApi(token);
      const skillId = (created.json() as { id: string }).id;

      await owner.skillRun.create({
        data: {
          skillId,
          licenseId: fx.a.licenseId,
          status: 'succeeded',
          log: [{ step: 'send_message', detail: 'legacy' }],
        },
      });

      const response = await server.get(`/skills/${skillId}/runs`, auth(token));
      const items = (
        response.json() as { items: Array<{ outcome: string | null; log: unknown[] }> }
      ).items;
      expect(items[0]?.outcome).toBeNull();
      expect(items[0]?.log).toEqual([{ step: 'send_message', detail: 'legacy' }]);
    });

    it('returns 404 for a skill that does not exist', async () => {
      const token = await writeToken(fx.a);
      expect((await server.get(`/skills/${randomUUID()}/runs`, auth(token))).statusCode).toBe(404);
    });

    it("never lists another tenant's skill runs", async () => {
      const tokenA = await writeToken(fx.a);
      const created = await createSkillViaApi(tokenA);
      const skillId = (created.json() as { id: string }).id;
      await owner.skillRun.create({
        data: { skillId, licenseId: fx.a.licenseId, status: 'succeeded', log: [] },
      });

      const tokenB = await writeToken(fx.b);
      expect((await server.get(`/skills/${skillId}/runs`, auth(tokenB))).statusCode).toBe(404);
    });
  });
});
