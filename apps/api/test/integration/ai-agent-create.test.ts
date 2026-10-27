/**
 * The workspace's AI agent — `POST /ai-agents` and `GET /ai-agents/{id}`
 * (tm 390.1 · PLAN §D218 kararı 5).
 *
 * A new workspace has no AI agent until its owner adds one from the Playbook's
 * empty state. v1 keeps one customer-facing agent per workspace, held by the
 * partial unique index `ai_agents_one_per_license` — the 409 tests below are
 * the ones that go red without it (the route has no read-then-write to fall
 * back on). The persona round trip of `PATCH` stays in `ai-agent-profile.test.ts`.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_SCOPES } from '../../src/services/auth/principal.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface AgentDetail {
  id: string;
  name: string;
  kind: string;
  tone: string | null;
  avatar_url: string | null;
  languages: string[];
  active: boolean;
  skills_count: number;
  readiness: {
    ready: boolean;
    has_knowledge: boolean;
    has_skill: boolean;
    guardrail_problem: string | null;
  };
}

describe('the workspace AI agent — create and read', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** The owner's PAT with the AI configuration scope. */
  const adminToken = (tenant: TenantFixture) =>
    grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });

  const create = async (tenant: TenantFixture, body: Record<string, unknown>) =>
    server.post('/ai-agents', body, auth(await adminToken(tenant)));

  const agentsOf = (tenant: TenantFixture) =>
    owner.aiAgent.count({ where: { licenseId: tenant.licenseId, kind: 'ai_agent' } });

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
  });

  it('creates the agent of a new workspace switched off, and reads it back with what it still needs', async () => {
    expect(await agentsOf(fx.a)).toBe(0);
    const created = await create(fx.a, {
      name: '  Ada  ',
      tone: 'friendly',
      languages: ['tr', 'en'],
      avatar_url: 'https://cdn.example.test/ada.png',
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as AgentDetail;
    expect(body).toMatchObject({
      name: 'Ada',
      kind: 'ai_agent',
      tone: 'friendly',
      languages: ['tr', 'en'],
      avatar_url: 'https://cdn.example.test/ada.png',
      active: false,
      skills_count: 0,
      readiness: {
        ready: false,
        has_knowledge: false,
        has_skill: false,
        guardrail_problem: 'crisis_text_missing',
      },
    });

    const token = await adminToken(fx.a);
    const read = await server.get(`/ai-agents/${body.id}`, auth(token));
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(body);
    const list = (await server.get('/ai-agents', auth(token))).json() as { items: AgentDetail[] };
    expect(list.items.map((agent) => agent.id)).toEqual([body.id]);

    // A reader may read it too.
    const reader = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:ro'],
    });
    expect((await server.get(`/ai-agents/${body.id}`, auth(reader))).statusCode).toBe(200);
    expect((await server.post('/ai-agents', { name: 'Bea' }, auth(reader))).statusCode).toBe(403);
  });

  it('refuses a second customer-facing agent with 409 ai_agent_exists, and keeps the first', async () => {
    expect((await create(fx.a, { name: 'Ada' })).statusCode).toBe(201);
    const second = await create(fx.a, { name: 'Bea' });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { type: 'ai_agent_exists' } });
    const names = await owner.aiAgent.findMany({
      where: { licenseId: fx.a.licenseId },
      select: { name: true },
    });
    expect(names).toEqual([{ name: 'Ada' }]);
  });

  it('gives two tabs creating at once one agent and one 409 — the index decides, not a read', async () => {
    const [one, two] = await Promise.all([
      create(fx.a, { name: 'Ada' }),
      create(fx.a, { name: 'Bea' }),
    ]);
    expect([one.statusCode, two.statusCode].sort()).toEqual([201, 409]);
    expect(await agentsOf(fx.a)).toBe(1);
  });

  it("is one per workspace: Copilot's record does not count, and another workspace adds its own", async () => {
    await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, kind: 'copilot', name: 'Copilot', active: true },
    });
    expect((await create(fx.a, { name: 'Ada' })).statusCode).toBe(201);
    expect((await create(fx.b, { name: 'Bora' })).statusCode).toBe(201);
    expect(await agentsOf(fx.a)).toBe(1);
    expect(await agentsOf(fx.b)).toBe(1);
  });

  it('is an owner/admin power: an agent session, and an agent holding a broad PAT, are 403', async () => {
    const agentSession = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: [...DEFAULT_AGENT_SCOPES],
      kind: 'oauth',
      clientId: fx.a.clientId,
    });
    const agentPat = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    for (const token of [agentSession, agentPat]) {
      expect((await server.post('/ai-agents', { name: 'Ada' }, auth(token))).statusCode).toBe(403);
    }
    expect(await agentsOf(fx.a)).toBe(0);

    const id = ((await create(fx.a, { name: 'Ada' })).json() as AgentDetail).id;
    expect((await server.get(`/ai-agents/${id}`, auth(agentSession))).statusCode).toBe(403);
    expect(
      (await server.patch(`/ai-agents/${id}`, { name: 'Ece' }, auth(agentPat))).statusCode,
    ).toBe(403);
    expect((await owner.aiAgent.findUniqueOrThrow({ where: { id } })).name).toBe('Ada');
  });

  it('refuses a body it would not carry out — no name, an unknown key, an instruction', async () => {
    for (const body of [
      {},
      { name: '   ' },
      { name: 'x'.repeat(121) },
      { name: 'Ada', active: true },
      { name: 'Ada', instruction: 'Kısa yaz.' },
      { name: 'Ada', languages: Array.from({ length: 21 }, (_, i) => `l${i}`) },
    ]) {
      const response = await create(fx.a, body);
      expect(response.statusCode, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(await agentsOf(fx.a)).toBe(0);

    // `instruction` became the "Genel talimat" behaviour rules (tm 299.1,
    // §D280); the PATCH does not write the old column either.
    const id = ((await create(fx.a, { name: 'Ada' })).json() as AgentDetail).id;
    const token = await adminToken(fx.a);
    for (const instruction of ['Kısa yaz.', 'x'.repeat(2001)]) {
      const response = await server.patch(`/ai-agents/${id}`, { instruction }, auth(token));
      expect(response.statusCode).toBe(400);
    }
    expect((await owner.aiAgent.findUniqueOrThrow({ where: { id } })).instruction).toBeNull();
  });

  it("answers another workspace's agent with 404, on read and on edit", async () => {
    const id = ((await create(fx.a, { name: 'Ada' })).json() as AgentDetail).id;
    const theirs = await adminToken(fx.b);
    expect((await server.get(`/ai-agents/${id}`, auth(theirs))).statusCode).toBe(404);
    expect((await server.patch(`/ai-agents/${id}`, { name: 'X' }, auth(theirs))).statusCode).toBe(
      404,
    );
    expect(
      (await server.get('/ai-agents/00000000-0000-4000-8000-000000000000', auth(theirs)))
        .statusCode,
    ).toBe(404);
    expect((await server.get('/ai-agents/not-a-uuid', auth(theirs))).statusCode).toBe(400);
  });

  it('reports readiness as the panel states it: indexed knowledge AND an active skill with steps; the crisis text apart', async () => {
    const id = ((await create(fx.a, { name: 'Ada' })).json() as AgentDetail).id;
    const token = await adminToken(fx.a);
    const readiness = async () =>
      ((await server.get(`/ai-agents/${id}`, auth(token))).json() as AgentDetail).readiness;

    // A source with no chunk answers nothing; one for agents only is not the AI's.
    const empty = await owner.knowledgeSource.create({
      data: { aiAgentId: id, licenseId: fx.a.licenseId, type: 'faq', name: 'Boş', status: 'ready' },
      select: { id: true },
    });
    const internal = await owner.knowledgeSource.create({
      data: {
        aiAgentId: id,
        licenseId: fx.a.licenseId,
        type: 'faq',
        name: 'İç not',
        status: 'ready',
        audiences: ['copilot'],
      },
      select: { id: true },
    });
    await owner.knowledgeChunk.create({
      data: { sourceId: internal.id, licenseId: fx.a.licenseId, chunkText: 'Yalnız ekip.' },
    });
    // An inactive skill, and an active one with no steps, run nothing.
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: id,
        kind: 'ai_agent',
        name: 'Kapalı',
        steps: [{ type: 'send_message', source: 'text', text: 'Merhaba.' }],
      },
    });
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: id,
        kind: 'ai_agent',
        name: 'Boş',
        active: true,
      },
    });
    expect(await readiness()).toEqual({
      ready: false,
      has_knowledge: false,
      has_skill: false,
      guardrail_problem: 'crisis_text_missing',
    });

    await owner.knowledgeChunk.create({
      data: { sourceId: empty.id, licenseId: fx.a.licenseId, chunkText: 'Para çekme 24 saat.' },
    });
    expect(await readiness()).toMatchObject({
      ready: false,
      has_knowledge: true,
      has_skill: false,
    });

    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: id,
        kind: 'ai_agent',
        name: 'Selam',
        active: true,
        steps: [{ type: 'send_message', source: 'text', text: 'Merhaba.' }],
      },
    });
    await owner.aiGuardrailSettings.create({
      data: { aiAgentId: id, licenseId: fx.a.licenseId, crisisText: 'Yardım hattı: 182.' },
    });
    expect(await readiness()).toEqual({
      ready: true,
      has_knowledge: true,
      has_skill: true,
      guardrail_problem: 'crisis_text_not_approved',
    });

    await owner.aiGuardrailSettings.update({
      where: { aiAgentId: id },
      data: { approvedAt: new Date(), approvedBy: fx.a.ownerAccountId },
    });
    expect((await readiness()).guardrail_problem).toBeNull();
  });

  it('holds the rule in a valid partial unique index on (license_id) WHERE kind = ai_agent', async () => {
    const rows = await owner.$queryRaw<
      Array<{ unique: boolean; valid: boolean; definition: string }>
    >`
      SELECT i.indisunique AS unique, i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = 'ai_agents_one_per_license'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unique: true, valid: true });
    expect(rows[0]!.definition).toMatch(/\(license_id\) WHERE \(kind = 'ai_agent'::text\)/);
  });
});
