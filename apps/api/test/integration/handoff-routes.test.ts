/**
 * Hand-over routes and team ids (tm 307.1 · SiyahTuş analysis AI-12, shared
 * with AU-01; ADR-14b §2.12), through the real server and the real database:
 *
 *   - `GET|POST /handoff-routes`, `PATCH|DELETE /handoff-routes/{routeId}`: a
 *     topic or reason route to a team by id, one per key and brand; what it
 *     names is the workspace's own; the routing rules' scopes and role; row
 *     level security, the brand trigger, the CHECKs = the types' lists = the
 *     contract;
 *   - a one-message skill's `transfer_to_team` step names its team by id: the
 *     API fills the id from the name and the name from the id, refuses
 *     another workspace's team, and the step backfill
 *     (20261020180100_skill_steps_group_id_backfill) gives the steps already
 *     stored their ids;
 *   - KK "Ekip yeniden adlandırılınca devir çalışır": a skill saved against
 *     "Finans" still hands over after the team is renamed, and a step saved
 *     before ids still hands over by name;
 *   - `Thread.priority` / `priority_reason` and `GET /chats?priority=`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  HANDOFF_REASONS,
  HANDOFF_ROUTE_MATCH_TYPES,
  HANDOFF_ROUTES_MAX,
  QUEUE_TOPIC_ROLES,
  THREAD_PRIORITIES,
} from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
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

interface RouteBody {
  id: string;
  brand_id: string | null;
  match_type: string;
  match_key: string;
  group_id: number;
  required_expertise_id: number | null;
  default_priority: string;
  active: boolean;
  created_by: string | null;
  updated_by: string | null;
}

/** The step backfill's one statement, comments stripped. */
function backfillStatement(): string {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20261020180100_skill_steps_group_id_backfill',
      'migration.sql',
    ),
    'utf8',
  )
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const statements = sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  expect(statements).toHaveLength(1);
  return statements[0]!;
}

describe('hand-over routes and team ids (AI-12 · tm 307.1)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let financeId: number;
  let rgId: number;
  let otherTeamId: number;
  let expertiseId: number;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const tenant = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });
  const send = (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object,
    token = adminToken,
  ) =>
    server.app.inject({
      method,
      url: server.url(path),
      headers: auth(token),
      ...(payload ? { payload } : {}),
    });
  const add = async (payload: object): Promise<RouteBody> => {
    const response = await send('POST', '/handoff-routes', payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as RouteBody;
  };
  const list = async (token = adminToken): Promise<RouteBody[]> => {
    const response = await server.get('/handoff-routes', auth(token));
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: RouteBody[] }).items;
  };
  const refusal = (response: { statusCode: number; json: () => unknown }) => {
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { type: string; details: { reason: string } } };
    expect(body.error.type).toBe('validation');
    return body.error.details;
  };
  const team = async (licenseId: bigint, name: string) =>
    Number((await owner.group.create({ data: { licenseId, name }, select: { id: true } })).id);

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
    financeId = await team(fx.a.licenseId, 'Finans');
    rgId = await team(fx.a.licenseId, 'Sorumlu Oyun');
    otherTeamId = await team(fx.b.licenseId, 'Finans');
    expertiseId = Number(
      (
        await owner.expertise.create({
          data: { licenseId: fx.a.licenseId, name: 'Sorumlu oyun eğitimi', slug: 'rg-training' },
          select: { id: true },
        })
      ).id,
    );
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
  });

  // =========================================================================
  // 1. The routes
  // =========================================================================

  describe('/handoff-routes', () => {
    it('adds a topic and a reason route by team id, edits, turns off and deletes one (AI-12)', async () => {
      const topic = await add({ match_type: 'topic', match_key: 'finance', group_id: financeId });
      expect(topic).toMatchObject({
        brand_id: null,
        match_type: 'topic',
        match_key: 'finance',
        group_id: financeId,
        required_expertise_id: null,
        default_priority: 'normal',
        active: true,
        created_by: fx.a.ownerAccountId,
      });
      const reason = await add({
        match_type: 'reason',
        match_key: 'guardrail_self_harm',
        group_id: rgId,
        required_expertise_id: expertiseId,
        default_priority: 'urgent',
      });
      expect(reason).toMatchObject({
        required_expertise_id: expertiseId,
        default_priority: 'urgent',
      });

      // Renaming the team keeps the route: it holds the id.
      await owner.group.update({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: BigInt(financeId) } },
        data: { name: 'Finance & Payments' },
      });
      expect((await list()).map((route) => [route.match_key, route.group_id])).toEqual([
        ['guardrail_self_harm', rgId],
        ['finance', financeId],
      ]);

      const edited = await send('PATCH', `/handoff-routes/${reason.id}`, {
        group_id: financeId,
        required_expertise_id: null,
        default_priority: 'high',
        active: false,
      });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json()).toMatchObject({
        group_id: financeId,
        required_expertise_id: null,
        default_priority: 'high',
        active: false,
      });
      const stored = await owner.handoffRoute.findUniqueOrThrow({ where: { id: reason.id } });
      expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(stored.createdAt.getTime());

      expect((await send('DELETE', `/handoff-routes/${reason.id}`)).statusCode).toBe(204);
      expect((await send('DELETE', `/handoff-routes/${reason.id}`)).statusCode).toBe(404);
      expect(
        (await send('PATCH', `/handoff-routes/${reason.id}`, { active: true })).statusCode,
      ).toBe(404);
      expect((await list()).map((route) => route.id)).toEqual([topic.id]);
    });

    it('one route per key and brand: the every-brand route and a brand route sit side by side', async () => {
      const brandId = await seedDefaultBrand(owner, fx.a.licenseId);
      const every = await add({ match_type: 'topic', match_key: 'bonus', group_id: financeId });
      const taken = refusal(
        await send('POST', '/handoff-routes', {
          match_type: 'topic',
          match_key: 'bonus',
          group_id: rgId,
        }),
      );
      expect(taken).toMatchObject({ reason: 'handoff_route_taken', route_id: every.id });

      const branded = await add({
        brand_id: brandId,
        match_type: 'topic',
        match_key: 'bonus',
        group_id: rgId,
      });
      expect(branded.brand_id).toBe(brandId);
      expect(
        refusal(
          await send('POST', '/handoff-routes', {
            brand_id: brandId,
            match_type: 'topic',
            match_key: 'bonus',
            group_id: financeId,
          }),
        ).reason,
      ).toBe('handoff_route_taken');
      // Every-brand first.
      expect((await list()).map((route) => route.brand_id)).toEqual([null, brandId]);

      // The indexes hold it under the route too.
      await expect(
        owner.handoffRoute.create({
          data: {
            licenseId: fx.a.licenseId,
            matchType: 'topic',
            matchKey: 'bonus',
            groupId: BigInt(financeId),
          },
        }),
      ).rejects.toThrow();
      await expect(
        owner.handoffRoute.create({
          data: {
            licenseId: fx.a.licenseId,
            brandId,
            matchType: 'topic',
            matchKey: 'bonus',
            groupId: BigInt(financeId),
          },
        }),
      ).rejects.toThrow();
    });

    it("refuses a key the type does not take, what is not the workspace's, and a 201st route — nothing written", async () => {
      const otherBrand = await seedDefaultBrand(owner, fx.b.licenseId);
      const otherExpertise = await owner.expertise.create({
        data: { licenseId: fx.b.licenseId, name: 'x', slug: 'x' },
        select: { id: true },
      });
      const archived = await owner.expertise.create({
        data: { licenseId: fx.a.licenseId, name: 'eski', slug: 'eski', archived: true },
        select: { id: true },
      });
      const cases: Array<[object, string]> = [
        [
          { match_type: 'topic', match_key: 'trading', group_id: financeId },
          'handoff_route_bad_key',
        ],
        [
          { match_type: 'topic', match_key: 'guardrail_rg', group_id: financeId },
          'handoff_route_bad_key',
        ],
        [
          { match_type: 'reason', match_key: 'finance', group_id: financeId },
          'handoff_route_bad_key',
        ],
        [
          { match_type: 'topic', match_key: 'finance', group_id: otherTeamId },
          'handoff_route_unknown_team',
        ],
        [
          {
            match_type: 'topic',
            match_key: 'finance',
            group_id: financeId,
            required_expertise_id: Number(otherExpertise.id),
          },
          'handoff_route_unknown_expertise',
        ],
        [
          {
            match_type: 'topic',
            match_key: 'finance',
            group_id: financeId,
            required_expertise_id: Number(archived.id),
          },
          'handoff_route_unknown_expertise',
        ],
        [
          { brand_id: otherBrand, match_type: 'topic', match_key: 'finance', group_id: financeId },
          'handoff_route_unknown_brand',
        ],
      ];
      for (const [payload, reason] of cases) {
        expect(refusal(await send('POST', '/handoff-routes', payload)).reason).toBe(reason);
      }
      for (const payload of [
        { match_type: 'queue', match_key: 'finance', group_id: financeId },
        { match_type: 'topic', match_key: 'finance', group_id: 0 },
        { match_type: 'topic', match_key: 'finance', group_id: financeId, default_priority: 'low' },
        { match_type: 'topic', match_key: 'finance', group_id: financeId, extra: true },
      ]) {
        expect((await send('POST', '/handoff-routes', payload)).statusCode).toBe(400);
      }
      const route = await add({ match_type: 'topic', match_key: 'finance', group_id: financeId });
      expect(
        refusal(await send('PATCH', `/handoff-routes/${route.id}`, { group_id: otherTeamId }))
          .reason,
      ).toBe('handoff_route_unknown_team');
      expect(
        (await send('PATCH', `/handoff-routes/${route.id}`, { match_key: 'bonus' })).statusCode,
      ).toBe(400);
      expect((await send('PATCH', `/handoff-routes/${route.id}`, {})).statusCode).toBe(400);
      expect(await owner.handoffRoute.count()).toBe(1);

      // The ceiling: rows straight in, as many brands' worth as it takes.
      const brands = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          owner.brand.create({
            data: { licenseId: fx.a.licenseId, name: `b${index}`, slug: `b${index}` },
            select: { id: true },
          }),
        ),
      );
      const keys = [
        ...QUEUE_TOPIC_ROLES.map((key) => ['topic', key] as const),
        ...HANDOFF_REASONS.map((key) => ['reason', key] as const),
      ];
      const rows = brands
        .flatMap((brand) =>
          keys.map(([matchType, matchKey]) => ({
            licenseId: fx.a.licenseId,
            brandId: brand.id,
            matchType,
            matchKey,
            groupId: BigInt(financeId),
          })),
        )
        .slice(0, HANDOFF_ROUTES_MAX - 1);
      await owner.handoffRoute.createMany({ data: rows });
      expect(
        refusal(
          await send('POST', '/handoff-routes', {
            match_type: 'topic',
            match_key: 'bonus',
            group_id: financeId,
          }),
        ),
      ).toMatchObject({ reason: 'handoff_routes_limit', limit: HANDOFF_ROUTES_MAX });
    });

    it("the routing rules' scopes and role: a reader reads, an agent and an AI editor do not write", async () => {
      await add({ match_type: 'topic', match_key: 'finance', group_id: financeId });
      const reader = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['access_rules:ro'],
      });
      expect(await list(reader)).toHaveLength(1);
      const write = { match_type: 'topic', match_key: 'bonus', group_id: financeId };
      expect((await send('POST', '/handoff-routes', write, reader)).statusCode).toBe(403);

      const agent = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['access_rules:rw'],
      });
      expect((await send('POST', '/handoff-routes', write, agent)).statusCode).toBe(403);

      const aiEditor = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      });
      expect((await server.get('/handoff-routes', auth(aiEditor))).statusCode).toBe(403);
      expect(await owner.handoffRoute.count()).toBe(1);
    });

    it("row level security and the brand trigger: one workspace neither sees nor writes another's (NFR-S4)", async () => {
      const route = await add({ match_type: 'topic', match_key: 'finance', group_id: financeId });
      const seen = await withTenant(appRole, tenant(fx.b), (tx) =>
        tx.handoffRoute.findMany({ select: { id: true } }),
      );
      expect(seen).toEqual([]);
      // Under a brand: its own routes and the every-brand ones, not a sibling brand's.
      const own = await seedDefaultBrand(owner, fx.a.licenseId);
      const sibling = (
        await owner.brand.create({
          data: { licenseId: fx.a.licenseId, name: 'İkinci', slug: 'ikinci' },
          select: { id: true },
        })
      ).id;
      const ownRoute = await add({
        brand_id: own,
        match_type: 'topic',
        match_key: 'finance',
        group_id: financeId,
      });
      await add({ brand_id: sibling, match_type: 'topic', match_key: 'finance', group_id: rgId });
      const underBrand = await withTenant(appRole, { ...tenant(fx.a), brandId: own }, (tx) =>
        tx.handoffRoute.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } }),
      );
      expect(underBrand.map((row) => row.id)).toEqual([route.id, ownRoute.id]);
      await owner.handoffRoute.deleteMany({ where: { brandId: { not: null } } });
      await expect(
        withTenant(appRole, tenant(fx.b), (tx) =>
          tx.handoffRoute.create({
            data: {
              licenseId: fx.a.licenseId,
              matchType: 'topic',
              matchKey: 'bonus',
              groupId: BigInt(financeId),
            },
          }),
        ),
      ).rejects.toThrow();
      // Under its own licence, with another workspace's brand: the brand exists,
      // so what refuses it is the trigger (raised as a foreign-key violation).
      const otherBrand = await seedDefaultBrand(owner, fx.b.licenseId);
      await expect(
        withTenant(appRole, tenant(fx.a), (tx) =>
          tx.handoffRoute.create({
            data: {
              licenseId: fx.a.licenseId,
              brandId: otherBrand,
              matchType: 'topic',
              matchKey: 'bonus',
              groupId: BigInt(financeId),
            },
          }),
        ),
      ).rejects.toThrow(/Foreign key constraint/);
      // Another workspace's id reads as missing, not forbidden.
      const response = await server.app.inject({
        method: 'DELETE',
        url: server.url(`/handoff-routes/${route.id}`),
        headers: auth(
          await grantToken(owner, {
            licenseId: fx.b.licenseId,
            organizationId: fx.b.organizationId,
            ownerId: fx.b.ownerAccountId,
            scopes: ['access_rules:rw'],
          }),
        ),
      });
      expect(response.statusCode).toBe(404);
      expect(await owner.handoffRoute.count()).toBe(1);
      await expect(
        withTenant(appRole, tenant(fx.a), (tx) => tx.$executeRaw`TRUNCATE handoff_routes`),
      ).rejects.toThrow(/permission denied/);
    });

    it("the CHECKs hold the types' lists: every topic role and reason in, anything else out", async () => {
      const row = (matchType: string, matchKey: string, brandId: string | null = null) => ({
        licenseId: fx.a.licenseId,
        brandId,
        matchType,
        matchKey,
        groupId: BigInt(financeId),
      });
      for (const role of QUEUE_TOPIC_ROLES)
        await owner.handoffRoute.create({ data: row('topic', role) });
      for (const reason of HANDOFF_REASONS) {
        await owner.handoffRoute.create({ data: row('reason', reason) });
      }
      for (const [type, key] of [
        ['topic', 'trading'],
        ['topic', 'responsible_gaming'],
        ['reason', 'finance'],
        ['brand', 'finance'],
      ] as const) {
        await expect(owner.handoffRoute.create({ data: row(type, key) })).rejects.toThrow();
      }
      const brandId = await seedDefaultBrand(owner, fx.a.licenseId);
      for (const data of [
        { ...row('topic', 'finance', brandId), groupId: 0n },
        { ...row('topic', 'finance', brandId), requiredExpertiseId: 0n },
        { ...row('topic', 'finance', brandId), defaultPriority: 'low' },
      ]) {
        await expect(owner.handoffRoute.create({ data })).rejects.toThrow();
      }
      for (const priority of THREAD_PRIORITIES) {
        await owner.handoffRoute.deleteMany({ where: { brandId } });
        await owner.handoffRoute.create({
          data: { ...row('topic', 'finance', brandId), defaultPriority: priority },
        });
      }
    });

    it("the contract names the types' lists", () => {
      const doc = loadOpenApiDocument() as unknown as {
        components: { schemas: Record<string, { enum?: unknown[] }> };
      };
      const schemas = doc.components.schemas;
      expect(schemas['HandoffRouteMatchType']!.enum).toEqual([...HANDOFF_ROUTE_MATCH_TYPES]);
      expect(schemas['QueueTopicRole']!.enum).toEqual([...QUEUE_TOPIC_ROLES]);
      expect(schemas['ThreadPriority']!.enum).toEqual([...THREAD_PRIORITIES]);
    });
  });

  // =========================================================================
  // 2. A skill's transfer_to_team names its team by id
  // =========================================================================

  describe('transfer_to_team by id', () => {
    let aiAgentId: string;
    let playbookToken: string;

    beforeEach(async () => {
      aiAgentId = (
        await owner.aiAgent.create({
          data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
          select: { id: true },
        })
      ).id;
      playbookToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents-bot--all:rw', 'chats--all:rw'],
      });
    });

    const saveSkill = (steps: unknown[]) =>
      send('POST', '/skills', { name: 'Para', ai_agent_id: aiAgentId, steps }, playbookToken);

    it('the API fills the id from the name and the name from the id, and refuses a team the workspace lacks (AI-12)', async () => {
      // Two teams of one name: the lowest id, the backfill's rule.
      const later = await team(fx.a.licenseId, 'Finans');
      expect(later).toBeGreaterThan(financeId);

      const byName = await saveSkill([
        { type: 'tag', tag: 'para' },
        { type: 'transfer_to_team', group: 'Finans' },
      ]);
      expect(byName.statusCode, byName.body).toBe(201);
      const created = byName.json() as { id: string; steps: unknown[] };
      expect(created.steps).toEqual([
        { type: 'tag', tag: 'para' },
        { type: 'transfer_to_team', group: 'Finans', group_id: financeId },
      ]);

      await owner.group.update({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: BigInt(rgId) } },
        data: { name: 'Responsible Gambling' },
      });
      const byId = await send(
        'PATCH',
        `/skills/${created.id}`,
        { steps: [{ type: 'transfer_to_team', group_id: rgId, group: 'Sorumlu Oyun' }] },
        playbookToken,
      );
      expect(byId.statusCode, byId.body).toBe(200);
      expect((byId.json() as { steps: unknown[] }).steps).toEqual([
        { type: 'transfer_to_team', group_id: rgId, group: 'Responsible Gambling' },
      ]);

      // A name no team has is kept as it is: the hand-over leaves the conversation where it is.
      const nobody = await saveSkill([{ type: 'transfer_to_team', group: 'Yok' }]);
      expect((nobody.json() as { steps: unknown[] }).steps).toEqual([
        { type: 'transfer_to_team', group: 'Yok' },
      ]);

      const before = await owner.skill.count();
      for (const response of [
        await saveSkill([
          { type: 'summarize' },
          { type: 'transfer_to_team', group_id: otherTeamId },
        ]),
        await send(
          'PATCH',
          `/skills/${created.id}`,
          { steps: [{ type: 'transfer_to_team', group_id: 999_999 }] },
          playbookToken,
        ),
      ]) {
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          error: { type: 'validation', details: { reason: 'transfer_to_team_unknown_team' } },
        });
      }
      expect(await owner.skill.count()).toBe(before);
      const kept = await owner.skill.findUniqueOrThrow({ where: { id: created.id } });
      expect(kept.steps).toEqual([
        { type: 'transfer_to_team', group_id: rgId, group: 'Responsible Gambling' },
      ]);
    });

    it('the step backfill gives a name-only step its id — the lowest of that name, in its own workspace — and is idempotent (AI-12 "Ad tabanlı eski adım id\'ye taşınır")', async () => {
      const later = await team(fx.a.licenseId, 'Finans');
      const stored = async (licenseId: bigint, steps: unknown[]) =>
        (
          await owner.skill.create({
            data: {
              licenseId,
              name: 'eski',
              kind: 'ai_agent',
              steps: steps as object,
              updatedAt: new Date('2026-01-01T00:00:00Z'),
            },
            select: { id: true },
          })
        ).id;
      const mixed = await stored(fx.a.licenseId, [
        { type: 'detect_intent', intent: 'para', phrases: ['para'] },
        { type: 'transfer_to_team', group: 'Finans' },
        { type: 'transfer_to_team', group: 'Yok' },
        { type: 'transfer_to_team', group: 'Finans', group_id: later },
      ]);
      const other = await stored(fx.b.licenseId, [{ type: 'transfer_to_team', group: 'Finans' }]);
      const untouched = await stored(fx.a.licenseId, [{ type: 'summarize' }]);

      const statement = backfillStatement();
      await owner.$executeRawUnsafe(statement);
      const read = async (id: string) => owner.skill.findUniqueOrThrow({ where: { id } });
      const expected = [
        { type: 'detect_intent', intent: 'para', phrases: ['para'] },
        { type: 'transfer_to_team', group: 'Finans', group_id: financeId },
        { type: 'transfer_to_team', group: 'Yok' },
        { type: 'transfer_to_team', group: 'Finans', group_id: later },
      ];
      expect((await read(mixed)).steps).toEqual(expected);
      expect((await read(other)).steps).toEqual([
        { type: 'transfer_to_team', group: 'Finans', group_id: otherTeamId },
      ]);
      expect((await read(untouched)).steps).toEqual([{ type: 'summarize' }]);
      // The skill behaves as it did: not an edit.
      expect((await read(mixed)).updatedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');

      expect(await owner.$executeRawUnsafe(statement)).toBe(0);
      expect((await read(mixed)).steps).toEqual(expected);
    });

    describe('on a live conversation', () => {
      async function visitorSays(text: string): Promise<string> {
        const token = await server.post(
          '/customer/token',
          { organization_id: fx.a.organizationId },
          { origin: `https://${fx.a.trustedDomain}` },
        );
        const response = await server.post(
          '/customer/chat/events',
          { text },
          { authorization: `Bearer ${(token.json() as { token: string }).token}` },
        );
        expect(response.statusCode).toBe(201);
        return (response.json() as { chat_id: string }).chat_id;
      }
      const handedTo = async (chatId: string) =>
        (
          await owner.thread.findFirstOrThrow({
            where: { chatId },
            orderBy: { createdAt: 'desc' },
            select: { groupId: true },
          })
        ).groupId;

      beforeEach(async () => {
        // A team with nobody in it takes no transfer (tm 306); one member, off shift, will do.
        await owner.groupAgent.create({
          data: {
            licenseId: fx.a.licenseId,
            groupId: BigInt(financeId),
            agentId: fx.a.agentAccountId,
          },
        });
        // The usual routing goes elsewhere, so a hand-over to Finans is the step's doing.
        const elsewhere = await team(fx.a.licenseId, 'Genel');
        await owner.routingRule.create({
          data: {
            licenseId: fx.a.licenseId,
            kind: 'chat',
            isFallback: true,
            targetGroupId: BigInt(elsewhere),
            priority: 100,
          },
        });
      });

      it('a renamed team still receives the hand-over (AI-12 KK: "Ekip yeniden adlandırılınca devir çalışır")', async () => {
        const saved = await saveSkill([{ type: 'transfer_to_team', group: 'Finans' }]);
        expect(saved.statusCode, saved.body).toBe(201);
        await owner.skill.updateMany({ where: { aiAgentId }, data: { active: true } });
        await owner.group.update({
          where: { licenseId_id: { licenseId: fx.a.licenseId, id: BigInt(financeId) } },
          data: { name: 'Finance & Payments' },
        });

        const chatId = await visitorSays('Param yatmadı');
        expect(await handedTo(chatId)).toBe(BigInt(financeId));
        const access = await owner.chatAccess.findMany({ where: { chatId } });
        expect(access.map((row) => row.groupId)).toContain(BigInt(financeId));
      });

      it('a step saved before ids still hands over by name', async () => {
        await owner.skill.create({
          data: {
            licenseId: fx.a.licenseId,
            aiAgentId,
            name: 'eski',
            kind: 'ai_agent',
            steps: [{ type: 'transfer_to_team', group: 'Finans' }],
            active: true,
            updatedAt: new Date(),
          },
        });
        const chatId = await visitorSays('Param yatmadı');
        expect(await handedTo(chatId)).toBe(BigInt(financeId));
      });
    });
  });

  // =========================================================================
  // 3. A connection's priority on the contract
  // =========================================================================

  describe('Thread.priority', () => {
    it('reads the priority and its reason on the chat, and lists by priority (AI-12)', async () => {
      const reader = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      const start = await server.app.inject({
        method: 'POST',
        url: server.url('/chats'),
        headers: auth(
          await grantToken(owner, {
            licenseId: fx.a.licenseId,
            organizationId: fx.a.organizationId,
            ownerId: fx.a.ownerAccountId,
            scopes: ['chats--all:rw'],
          }),
        ),
        payload: { customer_id: fx.a.customerId },
      });
      expect(start.statusCode, start.body).toBeLessThan(300);
      const chatId = (start.json() as { id: string }).id;

      const chat = async () =>
        (await server.get(`/chats/${chatId}`, auth(reader))).json() as {
          thread: { priority: string; priority_reason: string | null };
        };
      expect((await chat()).thread).toMatchObject({ priority: 'normal', priority_reason: null });

      await owner.thread.updateMany({
        where: { chatId },
        data: { priority: 2, priorityReason: 'guardrail_self_harm' },
      });
      expect((await chat()).thread).toMatchObject({
        priority: 'urgent',
        priority_reason: 'guardrail_self_harm',
      });

      const listed = async (priority: string) =>
        (await server.get(`/chats?priority=${priority}`, auth(reader))).json() as {
          items: Array<{ id: string; priority: string }>;
          total: number;
        };
      expect(await listed('urgent')).toMatchObject({
        items: [{ id: chatId, priority: 'urgent' }],
        total: 1,
      });
      expect(await listed('normal')).toMatchObject({ items: [], total: 0 });
      expect((await server.get('/chats?priority=low', auth(reader))).statusCode).toBe(400);

      await expect(
        owner.thread.updateMany({ where: { chatId }, data: { priorityReason: 'Kendine zarar' } }),
      ).rejects.toThrow();
    });
  });
});
