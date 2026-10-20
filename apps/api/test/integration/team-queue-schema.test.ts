/**
 * Team queues — the schema and a team's queue settings (tm 305.1 · SiyahTuş
 * analysis AU-01, owner decisions K14 and K18, ADR-08a; migrations
 * 20261020120000_team_queues and 20261020120100_threads_queue_group_backfill).
 *
 * Routing reads none of this yet (tm 305.2). What is pinned here is what the
 * later subtasks will lean on:
 *
 *   - **One set of words.** The CHECKs, `@siyahtus/types` and the contract
 *     name the same topic roles, after-hours modes and priorities, and the
 *     stored priority is a rank, so "most pressing first" is `priority DESC`.
 *   - **One team per role.** The role is what a hand-over resolves (K14), so a
 *     second holder is refused — by the index, and by the API with a 409 that
 *     names the holder.
 *   - **Required expertise.** A team's requirement is one workspace's: another
 *     tenant's rows are invisible and unwritable, the application role cannot
 *     edit a row in place, and an id from another workspace is a 404.
 *   - **The backfill.** The conversations waiting at deploy time get the team
 *     routing queued them for, else the chat's first access group, and nothing
 *     else is touched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  AFTER_HOURS_MODES,
  MAX_GROUP_REQUIRED_EXPERTISE,
  QUEUE_TOPIC_ROLES,
  THREAD_PRIORITIES,
  THREAD_PRIORITY_RANK,
  generateShortId,
  threadPriorityFromRank,
} from '@siyahtus/types';
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

interface GroupBody {
  id: number;
  name: string;
  topic_role: string | null;
  after_hours_mode: string;
  required_expertise_ids: number[];
}

interface ErrorBody {
  error: { type: string; details?: Record<string, unknown> };
}

interface SchemaNode {
  enum?: string[];
  required?: string[];
  allOf?: Array<{ $ref?: string }>;
  properties?: Record<string, SchemaNode>;
}

function contractSchemas(): Record<string, SchemaNode> {
  const document = loadOpenApiDocument() as unknown as {
    components: { schemas: Record<string, SchemaNode> };
  };
  return document.components.schemas;
}

/** The quoted values a CHECK constraint lists, sorted. */
async function checkValues(db: PrismaClient, name: string): Promise<string[]> {
  const [row] = await db.$queryRaw<Array<{ def: string }>>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
  return [...row!.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!).sort();
}

/** The backfill migration's one statement, comments stripped. */
function backfillStatement(): string {
  const sql = readFileSync(
    join(
      process.cwd(),
      'prisma',
      'migrations',
      '20261020120100_threads_queue_group_backfill',
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

describe('team queues — schema and queue settings (AU-01 · K14 · tm 305.1)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let rwA: string;
  let rwB: string;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const token = (t: TenantFixture) =>
      grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId: t.ownerAccountId,
        scopes: ['groups--all:rw', 'groups--all:ro'],
      });
    rwA = await token(fx.a);
    rwB = await token(fx.b);
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const create = (body: unknown, token = rwA) => server.post('/groups', body, auth(token));
  const patch = (id: number, body: unknown, token = rwA) =>
    server.patch(`/groups/${id}`, body, auth(token));

  async function createGroup(body: Record<string, unknown>, token = rwA): Promise<GroupBody> {
    const res = await create(body, token);
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as GroupBody;
  }

  /** A team straight in the database — the fixtures seed none. */
  const seedTeam = (t: TenantFixture, name: string) =>
    owner.group.create({ data: { licenseId: t.licenseId, name }, select: { id: true } });

  async function expertise(t: TenantFixture, slug: string): Promise<number> {
    const row = await owner.expertise.create({
      data: { licenseId: t.licenseId, name: slug, slug },
      select: { id: true },
    });
    return Number(row.id);
  }

  async function connection(
    t: TenantFixture,
    thread: Record<string, unknown> = {},
  ): Promise<{ chatId: string; threadId: string }> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, ...thread },
    });
    return { chatId, threadId };
  }

  // =========================================================================
  // One set of words
  // =========================================================================

  describe('one vocabulary', () => {
    it('the CHECKs, @siyahtus/types and the contract name the same roles, modes and priorities', async () => {
      expect(await checkValues(owner, 'groups_topic_role_check')).toEqual(
        [...QUEUE_TOPIC_ROLES].sort(),
      );
      expect(await checkValues(owner, 'groups_after_hours_mode_check')).toEqual(
        [...AFTER_HOURS_MODES].sort(),
      );

      const schemas = contractSchemas();
      expect(schemas['QueueTopicRole']?.enum).toEqual([...QUEUE_TOPIC_ROLES]);
      expect(schemas['AfterHoursMode']?.enum).toEqual([...AFTER_HOURS_MODES]);
      expect(schemas['ThreadPriority']?.enum).toEqual([...THREAD_PRIORITIES]);
      expect(schemas['Group']?.required).toEqual(
        expect.arrayContaining(['topic_role', 'after_hours_mode', 'required_expertise_ids']),
      );

      const group = await seedTeam(fx.a, 'General');
      await expect(
        owner.$executeRaw`UPDATE groups SET topic_role = 'vip' WHERE id = ${group.id}`,
      ).rejects.toThrow(/groups_topic_role_check/);
      await expect(
        owner.$executeRaw`UPDATE groups SET after_hours_mode = 'close' WHERE id = ${group.id}`,
      ).rejects.toThrow(/groups_after_hours_mode_check/);
    });

    it('stores a priority as its rank — default normal, out of range refused, most pressing first under DESC', async () => {
      expect(THREAD_PRIORITIES.map((p) => THREAD_PRIORITY_RANK[p]).sort((a, b) => a - b)).toEqual([
        0, 1, 2,
      ]);

      const normal = await connection(fx.a);
      const urgent = await connection(fx.a, { priority: THREAD_PRIORITY_RANK.urgent });
      const high = await connection(fx.a, { priority: THREAD_PRIORITY_RANK.high });

      const rows = await owner.thread.findMany({
        where: { id: { in: [normal.threadId, urgent.threadId, high.threadId] } },
        orderBy: { priority: 'desc' },
        select: { id: true, priority: true },
      });
      expect(rows.map((row) => row.id)).toEqual([urgent.threadId, high.threadId, normal.threadId]);
      expect(rows.map((row) => threadPriorityFromRank(row.priority))).toEqual([
        'urgent',
        'high',
        'normal',
      ]);

      for (const bad of [3, -1]) {
        await expect(
          owner.$executeRaw`UPDATE threads SET priority = ${bad}::smallint WHERE id = ${normal.threadId}`,
        ).rejects.toThrow(/threads_priority_check/);
      }
    });

    it('opens every team with no role, `queue` after hours and no requirement', async () => {
      const team = await createGroup({ name: 'Support' });
      expect(team).toMatchObject({
        topic_role: null,
        after_hours_mode: 'queue',
        required_expertise_ids: [],
      });
      const row = await owner.group.findFirstOrThrow({ where: { id: BigInt(team.id) } });
      expect(row).toMatchObject({ topicRole: null, afterHoursMode: 'queue' });
    });
  });

  // =========================================================================
  // One team per role
  // =========================================================================

  describe('one team per topic role (K14)', () => {
    it('lets the index refuse a second holder in a licence, and only there', async () => {
      const first = await seedTeam(fx.a, 'Finance');
      await owner.group.update({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: first.id } },
        data: { topicRole: 'finance' },
      });

      await expect(
        owner.group.create({
          data: { licenseId: fx.a.licenseId, name: 'Finance 2', topicRole: 'finance' },
        }),
      ).rejects.toThrow(/Unique constraint/);
      // Another licence's Finance, and any number of teams with no role.
      await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Finance', topicRole: 'finance' },
      });
      await owner.group.create({ data: { licenseId: fx.a.licenseId, name: 'Extra 1' } });
      await owner.group.create({ data: { licenseId: fx.a.licenseId, name: 'Extra 2' } });

      const index = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'groups_license_id_topic_role_key'`;
      expect(index[0]?.def).toMatch(
        /UNIQUE INDEX .* \(license_id, topic_role\) WHERE \(topic_role IS NOT NULL\)/,
      );
    });

    it('answers a taken role with 409 naming the holder, and hands it over once cleared (FR-MOD-04.5)', async () => {
      const finance = await createGroup({ name: 'Finans', topic_role: 'finance' });
      expect(finance.topic_role).toBe('finance');

      const second = await create({ name: 'Finance EU', topic_role: 'finance' });
      expect(second.statusCode).toBe(409);
      const error = (second.json() as ErrorBody).error;
      expect(error.type).toBe('group_topic_role_taken');
      expect(error.details).toEqual({ topic_role: 'finance', group_id: finance.id });

      const other = await createGroup({ name: 'Finance EU' });
      expect((await patch(other.id, { topic_role: 'finance' })).statusCode).toBe(409);

      // Renaming the holder keeps its role — the role, not the name, is what a
      // hand-over resolves.
      const renamed = await patch(finance.id, { name: 'Ödemeler' });
      expect((renamed.json() as GroupBody).topic_role).toBe('finance');

      expect((await patch(finance.id, { topic_role: null })).statusCode).toBe(200);
      const moved = await patch(other.id, { topic_role: 'finance' });
      expect(moved.statusCode).toBe(200);
      expect((moved.json() as GroupBody).topic_role).toBe('finance');

      // Another workspace holds its own Finance.
      expect((await createGroup({ name: 'Finance', topic_role: 'finance' }, rwB)).topic_role).toBe(
        'finance',
      );
    });

    it('refuses an unknown role, mode or a malformed requirement with 400', async () => {
      const team = await createGroup({ name: 'Support' });
      for (const body of [
        { topic_role: 'vip' },
        { topic_role: 'responsible_gaming' },
        { after_hours_mode: 'close' },
        { required_expertise_ids: [0] },
        { required_expertise_ids: [-3] },
        { required_expertise_ids: ['abc'] },
        { required_expertise_ids: [1.5] },
        { required_expertise_ids: '1' },
        {
          required_expertise_ids: Array.from(
            { length: MAX_GROUP_REQUIRED_EXPERTISE + 1 },
            (_, i) => i + 1,
          ),
        },
      ]) {
        const res = await patch(team.id, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await create({ name: 'X', topic_role: 'casino' })).statusCode).toBe(400);
    });
  });

  // =========================================================================
  // Required expertise
  // =========================================================================

  describe('required expertise', () => {
    it('stores the complete set once each, reads it back in id order, and clears it with []', async () => {
      const rg = await expertise(fx.a, 'rg-training');
      const tr = await expertise(fx.a, 'turkish');

      // KYC rather than Responsible Gambling: that team's requirement never
      // empties (tm 305.3, `team-queue-membership.test.ts`).
      const team = await createGroup({
        name: 'KYC',
        topic_role: 'kyc_risk',
        after_hours_mode: 'ticket',
        required_expertise_ids: [tr, rg, tr],
      });
      expect(team).toMatchObject({
        topic_role: 'kyc_risk',
        after_hours_mode: 'ticket',
        required_expertise_ids: [rg, tr].sort((a, b) => a - b),
      });

      const listed = (await server.get('/groups', auth(rwA))).json() as { items: GroupBody[] };
      expect(listed.items.find((g) => g.id === team.id)?.required_expertise_ids).toEqual(
        [rg, tr].sort((a, b) => a - b),
      );

      const cleared = await patch(team.id, { required_expertise_ids: [] });
      expect((cleared.json() as GroupBody).required_expertise_ids).toEqual([]);
      expect(await owner.groupExpertise.count({ where: { groupId: BigInt(team.id) } })).toBe(0);
    });

    it("answers another workspace's expertise id with 404 and changes nothing (NFR-S5)", async () => {
      const mine = await expertise(fx.a, 'rg-training');
      const theirs = await expertise(fx.b, 'rg-training');
      const team = await createGroup({ name: 'RG', required_expertise_ids: [mine] });

      expect((await patch(team.id, { required_expertise_ids: [mine, theirs] })).statusCode).toBe(
        404,
      );
      expect((await create({ name: 'Other', required_expertise_ids: [theirs] })).statusCode).toBe(
        404,
      );
      expect(
        (await patch(team.id, { name: 'Renamed', required_expertise_ids: [999_999] })).statusCode,
      ).toBe(404);

      const row = await owner.group.findFirstOrThrow({
        where: { id: BigInt(team.id) },
        include: { requiredExpertise: true },
      });
      expect(row.name).toBe('RG');
      expect(row.requiredExpertise.map((r) => Number(r.expertiseId))).toEqual([mine]);
      expect(await owner.group.count({ where: { name: 'Other' } })).toBe(0);
    });

    it('keeps a requirement one tenant’s, add-or-remove only, and gone with its team or area (NFR-S4)', async () => {
      const security = await owner.$queryRaw<Array<{ enabled: boolean; policy: string | null }>>`
        SELECT c.relrowsecurity AS enabled, p.policyname AS policy
        FROM pg_class c LEFT JOIN pg_policies p ON p.tablename = c.relname
        WHERE c.relname = 'group_expertise'`;
      expect(security).toEqual([{ enabled: true, policy: 'group_expertise_tenant' }]);

      const aArea = await expertise(fx.a, 'a-area');
      const bArea = await expertise(fx.b, 'b-area');
      const aTeam = await createGroup({ name: 'A', required_expertise_ids: [aArea] });
      const bTeam = await createGroup({ name: 'B', required_expertise_ids: [bArea] }, rwB);

      const ctx = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
      const seen = await withTenant(app, ctx, (tx) => tx.groupExpertise.findMany());
      expect(seen.map((row) => Number(row.groupId))).toEqual([aTeam.id]);

      // Writing B's row from A's context: the policy's WITH CHECK refuses it.
      await expect(
        withTenant(app, ctx, (tx) =>
          tx.groupExpertise.create({
            data: {
              licenseId: fx.b.licenseId,
              groupId: BigInt(bTeam.id),
              expertiseId: BigInt(bArea),
            },
          }),
        ),
      ).rejects.toThrow();
      // A set is replaced, never edited in place.
      await expect(
        withTenant(
          app,
          ctx,
          (tx) => tx.$executeRaw`UPDATE group_expertise SET expertise_id = expertise_id`,
        ),
      ).rejects.toThrow(/permission denied/);

      // Gone with the area, then a fresh one gone with the team.
      await owner.expertise.delete({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: BigInt(aArea) } },
      });
      expect(await owner.groupExpertise.count({ where: { groupId: BigInt(aTeam.id) } })).toBe(0);
      expect((await server.del(`/groups/${bTeam.id}`, auth(rwB))).statusCode).toBe(204);
      expect(await owner.groupExpertise.count({ where: { licenseId: fx.b.licenseId } })).toBe(0);
    });
  });

  // =========================================================================
  // Audit
  // =========================================================================

  describe('audit trail', () => {
    const entries = () =>
      owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: { startsWith: 'group.' } },
        orderBy: { chainSeq: 'asc' },
        select: { action: true, metadata: true },
      });

    it('records the queue settings on create and change, and nothing for a restatement', async () => {
      const one = await expertise(fx.a, 'one');
      const two = await expertise(fx.a, 'two');
      const team = await createGroup({ name: 'Bonus', topic_role: 'bonus' });

      await patch(team.id, { after_hours_mode: 'ticket', required_expertise_ids: [two, one] });
      // The same set in another order, the same role and mode: nothing moved.
      const restated = await patch(team.id, {
        topic_role: 'bonus',
        after_hours_mode: 'ticket',
        required_expertise_ids: [one, two, one],
      });
      expect(restated.statusCode).toBe(200);

      const log = await entries();
      expect(log.map((e) => e.action)).toEqual(['group.created', 'group.updated']);
      expect(log[0]?.metadata).toMatchObject({
        topic_role: 'bonus',
        after_hours_mode: 'queue',
        required_expertise_ids: [],
      });
      expect(log[1]?.metadata).toMatchObject({
        topic_role: 'bonus',
        after_hours_mode: 'ticket',
        required_expertise_ids: [one, two].sort((a, b) => a - b),
      });
    });
  });

  // =========================================================================
  // The backfill
  // =========================================================================

  describe('backfill of the conversations waiting at deploy time', () => {
    it('gives each the team it was queued for, else its first access group, and touches nothing else', async () => {
      const general = await seedTeam(fx.a, 'General');
      // A team deleted since; its id is lower than the live ones', so the
      // lowest-id rule would pick it if the backfill did not check it exists.
      const old = await seedTeam(fx.a, 'Old');
      await owner.group.delete({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: old.id } },
      });
      const gone = old.id;
      const sales = await seedTeam(fx.a, 'Sales');
      const bonus = await seedTeam(fx.a, 'Bonus');
      const queued = { queuePosition: 1, queuedAt: new Date() };

      // Routing's own choice wins over the access list.
      const routed = await connection(fx.a, { ...queued, groupId: bonus.id });
      await owner.chatAccess.createMany({
        data: [
          { chatId: routed.chatId, groupId: general.id },
          { chatId: routed.chatId, groupId: bonus.id },
        ],
      });
      // No choice recorded: the lowest-id access group that still exists.
      const byAccess = await connection(fx.a, { ...queued, groupId: gone });
      await owner.chatAccess.createMany({
        data: [
          { chatId: byAccess.chatId, groupId: gone },
          { chatId: byAccess.chatId, groupId: bonus.id },
          { chatId: byAccess.chatId, groupId: sales.id },
        ],
      });
      // Nothing that names a live team: stays NULL.
      const orphan = await connection(fx.a, { ...queued, groupId: gone });
      // Not waiting — assigned, closed, or not in the queue — and already placed.
      const assigned = await connection(fx.a, {
        ...queued,
        groupId: bonus.id,
        assigneeId: fx.a.agentAccountId,
      });
      const closed = await connection(fx.a, {
        ...queued,
        groupId: bonus.id,
        active: false,
        closedAt: new Date(),
      });
      const unqueued = await connection(fx.a, { groupId: bonus.id });
      const placed = await connection(fx.a, {
        ...queued,
        groupId: bonus.id,
        queueGroupId: sales.id,
      });
      // Another tenant's waiting conversation is placed by its own teams.
      const bGeneral = await seedTeam(fx.b, 'General');
      const other = await connection(fx.b, { ...queued });
      await owner.chatAccess.create({ data: { chatId: other.chatId, groupId: bGeneral.id } });

      const statement = backfillStatement();
      await owner.$executeRawUnsafe(statement);

      const queueGroup = async (threadId: string) =>
        (await owner.thread.findUniqueOrThrow({ where: { id: threadId } })).queueGroupId;
      expect(await queueGroup(routed.threadId)).toBe(bonus.id);
      expect(await queueGroup(byAccess.threadId)).toBe(sales.id < bonus.id ? sales.id : bonus.id);
      expect(await queueGroup(orphan.threadId)).toBeNull();
      expect(await queueGroup(assigned.threadId)).toBeNull();
      expect(await queueGroup(closed.threadId)).toBeNull();
      expect(await queueGroup(unqueued.threadId)).toBeNull();
      expect(await queueGroup(placed.threadId)).toBe(sales.id);
      expect(await queueGroup(other.threadId)).toBe(bGeneral.id);

      // Idempotent: a second run changes nothing.
      const snapshot = () =>
        owner.thread.findMany({ orderBy: { id: 'asc' }, select: { id: true, queueGroupId: true } });
      const before = await snapshot();
      await owner.$executeRawUnsafe(statement);
      expect(await snapshot()).toEqual(before);
    });
  });
});
