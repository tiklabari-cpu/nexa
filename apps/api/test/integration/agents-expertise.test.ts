/**
 * Agent ↔ expertise assignment (FR-MOD-08.6.3 — skill-based routing).
 *
 * The API sets an agent's expertise *wholesale*: the body is the complete set,
 * so the properties that matter are that two identical calls leave the same rows
 * (idempotent), an empty list clears everything, and no id — agent or area —
 * ever reaches across tenants. The negatives are written first, deliberately, so
 * a handler that forgot a gate fails loudly rather than passing on the happy path.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('agent expertise assignment (FR-MOD-08.6.3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;
  // Two areas on tenant A to assign from.
  let billingId: number;
  let technicalId: number;

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

    // Owner rank — enough for the admin gate. Carries `access_rules:rw` too so
    // this suite can also exercise the catalogue DELETE that cascades.
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--all:rw', 'agents--all:ro', 'access_rules:rw'],
    });

    const billing = await owner.expertise.create({
      data: { licenseId: fx.a.licenseId, name: 'Billing', slug: 'billing' },
      select: { id: true },
    });
    const technical = await owner.expertise.create({
      data: { licenseId: fx.a.licenseId, name: 'Technical', slug: 'technical' },
      select: { id: true },
    });
    billingId = Number(billing.id);
    technicalId = Number(technical.id);
  });

  // A getter, not a captured string: `adminToken` is reassigned every beforeEach.
  const auth = {
    get authorization() {
      return `Bearer ${adminToken}`;
    },
  };

  const setExpertise = (agentId: string, expertiseIds: number[], headers = auth) =>
    server.put(`/agents/${agentId}/expertise`, { expertise_ids: expertiseIds }, headers);

  /** The expertise slugs currently on an agent, read back through GET /agents. */
  const expertiseOf = async (agentId: string): Promise<string[]> => {
    const res = await server.get('/agents?status=all', auth);
    const agent = (
      res.json() as { items: Array<{ id: string; expertise: Array<{ slug: string }> }> }
    ).items.find((a) => a.id === agentId);
    return (agent?.expertise ?? []).map((e) => e.slug).sort();
  };

  // ==========================================================================
  // Authorization and isolation — first, on purpose
  // ==========================================================================

  describe('authorization and isolation', () => {
    it('refuses a token without the write scope', async () => {
      const roToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents--all:ro'],
      });
      const res = await setExpertise(fx.a.agentAccountId, [billingId], {
        authorization: `Bearer ${roToken}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('refuses an agent-role token even with the write scope', async () => {
      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['agents--all:rw'],
      });
      const res = await setExpertise(fx.a.agentAccountId, [billingId], {
        authorization: `Bearer ${agentToken}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('refuses a bot principal even with the write scope', async () => {
      const bot = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Bot', kind: 'ai_agent', active: true },
        select: { id: true },
      });
      const botToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: bot.id,
        scopes: ['agents--all:rw'],
        kind: 'bot',
      });
      const res = await setExpertise(fx.a.agentAccountId, [billingId], {
        authorization: `Bearer ${botToken}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('404s an unknown agent, keeping ids un-enumerable', async () => {
      const res = await setExpertise('00000000-0000-0000-0000-000000000000', [billingId]);
      expect(res.statusCode).toBe(404);
    });

    it('rejects a malformed agent id as a 400', async () => {
      const res = await setExpertise('not-a-uuid', [billingId]);
      expect(res.statusCode).toBe(400);
    });

    it('cannot assign to an agent in another workspace (404)', async () => {
      const res = await setExpertise(fx.b.agentAccountId, [billingId]);
      expect(res.statusCode).toBe(404);
    });

    it('rejects a foreign expertise id with a 404, changing nothing', async () => {
      const theirs = await owner.expertise.create({
        data: { licenseId: fx.b.licenseId, name: 'Theirs', slug: 'theirs' },
        select: { id: true },
      });
      const res = await setExpertise(fx.a.agentAccountId, [billingId, Number(theirs.id)]);
      expect(res.statusCode).toBe(404);

      // Not even the valid id in the same body was written — the whole set is
      // validated before any row changes.
      const count = await owner.agentExpertise.count({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      });
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // Setting the set — wholesale, idempotent, reflected on GET /agents
  // ==========================================================================

  describe('setting the expertise set', () => {
    it('assigns a set and returns it on the agent, ordered by name', async () => {
      const res = await setExpertise(fx.a.agentAccountId, [technicalId, billingId]);
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        id: string;
        expertise: Array<{ id: number; name: string; slug: string }>;
      };
      expect(body.id).toBe(fx.a.agentAccountId);
      expect(body.expertise.map((e) => e.name)).toEqual(['Billing', 'Technical']);
      expect(body.expertise.map((e) => e.id)).toEqual([billingId, technicalId]);

      // GET /agents shows the same set.
      expect(await expertiseOf(fx.a.agentAccountId)).toEqual(['billing', 'technical']);
    });

    it('replaces wholesale — the body is the complete set', async () => {
      await setExpertise(fx.a.agentAccountId, [billingId, technicalId]);
      const res = await setExpertise(fx.a.agentAccountId, [technicalId]);
      expect(res.statusCode).toBe(200);
      expect(
        (res.json() as { expertise: Array<{ slug: string }> }).expertise.map((e) => e.slug),
      ).toEqual(['technical']);
      expect(await expertiseOf(fx.a.agentAccountId)).toEqual(['technical']);
    });

    it('is idempotent — the same body twice leaves the same rows', async () => {
      await setExpertise(fx.a.agentAccountId, [billingId, technicalId]);
      const again = await setExpertise(fx.a.agentAccountId, [billingId, technicalId]);
      expect(again.statusCode).toBe(200);

      const rows = await owner.agentExpertise.findMany({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      });
      expect(rows.length).toBe(2);
      expect(await expertiseOf(fx.a.agentAccountId)).toEqual(['billing', 'technical']);
    });

    it('de-duplicates a repeated id in the body', async () => {
      const res = await setExpertise(fx.a.agentAccountId, [billingId, billingId]);
      expect(res.statusCode).toBe(200);
      const rows = await owner.agentExpertise.count({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      });
      expect(rows).toBe(1);
    });

    it('clears every area with an empty list', async () => {
      await setExpertise(fx.a.agentAccountId, [billingId, technicalId]);
      const res = await setExpertise(fx.a.agentAccountId, []);
      expect(res.statusCode).toBe(200);
      expect((res.json() as { expertise: unknown[] }).expertise).toEqual([]);
      expect(await expertiseOf(fx.a.agentAccountId)).toEqual([]);
    });

    it('drops the area from its agents when the catalogue entry is deleted', async () => {
      await setExpertise(fx.a.agentAccountId, [billingId, technicalId]);

      // The catalogue DELETE cascades the assignment rows (composite FK), so the
      // agent's set narrows without a second call.
      const del = await server.del(`/settings/expertise/${billingId}`, auth);
      expect(del.statusCode).toBe(204);
      expect(await expertiseOf(fx.a.agentAccountId)).toEqual(['technical']);
    });
  });
});
