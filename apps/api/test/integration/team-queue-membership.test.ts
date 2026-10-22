/**
 * Team queues — who may be on a team, the Responsible Gambling team, and the
 * topic resolution (tm 305.3 · SiyahTuş analysis AU-01, owner decision K14,
 * ADR-08a `docs/adr/routing-team-queues.md` §2.6, §2.7).
 *
 * What is pinned here:
 *
 *   1. **The training check at joining** (acceptance: "Yetenek etiketi olmayan
 *      ajan Sorumlu Oyun ekibine eklenemez (409)"): a team that requires areas
 *      of expertise takes only a member holding all of them — from the console
 *      and from a directory alike; an existing member's tier is not re-checked.
 *   2. **The Responsible Gambling team is fixed** (K14): never deleted, never
 *      without its role, never without a training requirement — renamed only.
 *   3. **Its members are trained at all times**: growing its requirement past
 *      a member, giving the role to a staffed team with an untrained member,
 *      or dropping an agent's training while on it are refused.
 *   4. **Serialised**: an agent losing the training while being added is one
 *      write or the other, on separate connections so the race is real.
 *   5. **`resolveQueue` and `GET /routing/queues`**: by role, so a renamed team
 *      keeps its topic; scoped to the caller's workspace and scopes.
 *
 * The AI's hand-over to a topic ("Rol ile çözülen AI devri ekip adı değişse de
 * doğru ekibe düşer") is driven end to end in `ai-procedure.test.ts`.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUEUE_TOPIC_ROLES, generateShortId } from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { resolveQueue } from '../../src/services/routing/queues.js';
import {
  assertKeepsTeamTraining,
  deleteGroup,
  replaceGroupMembers,
} from '../../src/services/team/group-service.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const CHAIN_SECRET = testEnv().AUDIT_CHAIN_SECRET;

interface GroupBody {
  id: number;
  name: string;
  topic_role: string | null;
  required_expertise_ids: number[];
  agents: Array<{ agent_id: string; priority: string }>;
}

interface ErrorBody {
  error: { type: string; details?: Record<string, unknown> };
}

interface QueuesBody {
  items: Array<{
    topic_role: string;
    group_id: number | null;
    group_name: string | null;
    after_hours_mode: string | null;
  }>;
}

describe('team queues — membership, the Responsible Gambling team, topic resolution (AU-01 · K14 · tm 305.3)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let teamsA: string;
  let teamsB: string;
  let adminA: string;

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
    const token = (t: TenantFixture, scopes: string[]) =>
      grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId: t.ownerAccountId,
        scopes,
      });
    teamsA = await token(fx.a, ['groups--all:rw', 'groups--all:ro']);
    teamsB = await token(fx.b, ['groups--all:rw', 'groups--all:ro']);
    adminA = await token(fx.a, ['agents--all:rw', 'access_rules:rw']);
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ctx = (t: TenantFixture = fx.a): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });
  const audit = () => ({ licenseId: fx.a.licenseId, chainSecret: CHAIN_SECRET });

  async function createGroup(body: Record<string, unknown>, token = teamsA): Promise<GroupBody> {
    const res = await server.post('/groups', body, auth(token));
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as GroupBody;
  }

  const patch = (id: number, body: unknown) => server.patch(`/groups/${id}`, body, auth(teamsA));
  const join = (groupId: number, agentId: string, priority = 'normal') =>
    server.put(`/groups/${groupId}/agents/${agentId}`, { priority }, auth(teamsA));
  const setExpertise = (agentId: string, ids: number[]) =>
    server.put(`/agents/${agentId}/expertise`, { expertise_ids: ids }, auth(adminA));

  async function expertise(slug: string, t: TenantFixture = fx.a): Promise<number> {
    const row = await owner.expertise.create({
      data: {
        licenseId: t.licenseId,
        name: slug,
        slug: `${slug}-${generateShortId()}`.toLowerCase(),
      },
      select: { id: true },
    });
    return Number(row.id);
  }

  /** Straight in the database: what the agent holds. */
  async function hold(agentId: string, ids: number[]): Promise<void> {
    for (const id of ids) {
      await owner.agentExpertise.create({
        data: { licenseId: fx.a.licenseId, agentId, expertiseId: BigInt(id) },
      });
    }
  }

  const held = async (agentId: string) =>
    (
      await owner.agentExpertise.findMany({
        where: { licenseId: fx.a.licenseId, agentId },
        select: { expertiseId: true },
        orderBy: { expertiseId: 'asc' },
      })
    ).map((row) => Number(row.expertiseId));

  const membersOf = async (groupId: number) =>
    (
      await owner.groupAgent.findMany({
        where: { groupId: BigInt(groupId) },
        select: { agentId: true },
      })
    )
      .map((row) => row.agentId)
      .sort();

  const requirementOf = async (groupId: number) =>
    (
      await owner.groupExpertise.findMany({
        where: { groupId: BigInt(groupId) },
        select: { expertiseId: true },
        orderBy: { expertiseId: 'asc' },
      })
    ).map((row) => Number(row.expertiseId));

  function errorOf(res: { json: () => unknown }) {
    return (res.json() as ErrorBody).error;
  }

  /** The Responsible Gambling team with its training, via the API. */
  async function rgTeam(training: number): Promise<GroupBody> {
    return createGroup({
      name: 'Sorumlu Oyun',
      topic_role: 'responsible_gambling',
      required_expertise_ids: [training],
    });
  }

  // =========================================================================
  // 1. The training check at joining
  // =========================================================================

  describe('joining a team', () => {
    it('refuses an agent without the Responsible Gambling training with 409 naming what they lack, and writes nothing (FR-MOD-04.5 · FR-MOD-08.6.3)', async () => {
      const training = await expertise('rg-training');
      const rg = await rgTeam(training);
      const agent = fx.a.agentAccountId;

      const refused = await join(rg.id, agent);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toMatchObject({
        type: 'group_expertise_missing',
        details: { group_id: rg.id, agent_id: agent, expertise_ids: [training] },
      });
      expect(await membersOf(rg.id)).toEqual([]);
      expect(
        await owner.auditLogEntry.count({
          where: { licenseId: fx.a.licenseId, action: 'group.member_set' },
        }),
      ).toBe(0);

      // Trained: in.
      await hold(agent, [training]);
      const admitted = await join(rg.id, agent);
      expect(admitted.statusCode, admitted.body).toBe(200);
      expect((admitted.json() as GroupBody).agents.map((a) => a.agent_id)).toEqual([agent]);
    });

    it('holds any team to its whole requirement at joining, and only at joining (FR-MOD-08.6.3)', async () => {
      const turkish = await expertise('turkish');
      const vip = await expertise('vip');
      const agent = fx.a.agentAccountId;
      await hold(agent, [turkish]);

      const both = await createGroup({ name: 'VIP TR', required_expertise_ids: [turkish, vip] });
      const res = await join(both.id, agent);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).details).toMatchObject({ expertise_ids: [vip] });

      // A team that requires nothing takes anyone.
      const open = await createGroup({ name: 'Genel' });
      expect((await join(open.id, agent)).statusCode).toBe(200);

      // Somebody already on a team before it required more keeps their seat:
      // moving their tier is not a new grant.
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: BigInt(both.id), agentId: agent },
      });
      const moved = await join(both.id, agent, 'primary');
      expect(moved.statusCode, moved.body).toBe(200);
      expect((moved.json() as GroupBody).agents).toEqual([
        { agent_id: agent, priority: 'primary', lead: false },
      ]);
    });

    it('holds a directory to the same rule — the membership a SCIM replacement adds is refused (FR-MOD-04.5)', async () => {
      const training = await expertise('rg-training');
      const rg = await rgTeam(training);

      await expect(
        withTenant(app, ctx(), (tx) =>
          replaceGroupMembers(tx, audit(), fx.a.licenseId, BigInt(rg.id), [fx.a.agentAccountId]),
        ),
      ).rejects.toMatchObject({ type: 'group_expertise_missing', status: 409 });
      expect(await membersOf(rg.id)).toEqual([]);
    });
  });

  // =========================================================================
  // 2. The Responsible Gambling team is fixed
  // =========================================================================

  describe('the Responsible Gambling team', () => {
    it('cannot be deleted, by the console or a directory, but can be renamed (FR-MOD-04.5)', async () => {
      const rg = await rgTeam(await expertise('rg-training'));

      const refused = await server.del(`/groups/${rg.id}`, auth(teamsA));
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toMatchObject({
        type: 'group_protected',
        details: { reason: 'delete', topic_role: 'responsible_gambling', group_id: rg.id },
      });
      await expect(
        withTenant(app, ctx(), (tx) => deleteGroup(tx, audit(), fx.a.licenseId, BigInt(rg.id))),
      ).rejects.toMatchObject({ type: 'group_protected' });

      const renamed = await patch(rg.id, { name: 'Güvenli Oyun' });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(renamed.json()).toMatchObject({
        name: 'Güvenli Oyun',
        topic_role: 'responsible_gambling',
      });
      expect(await owner.group.count({ where: { id: BigInt(rg.id) } })).toBe(1);

      // An ordinary team still deletes.
      const other = await createGroup({ name: 'Teknik', topic_role: 'technical' });
      expect((await server.del(`/groups/${other.id}`, auth(teamsA))).statusCode).toBe(204);
    });

    it('keeps its role: clearing or changing it is a 409, restating it is not', async () => {
      const rg = await rgTeam(await expertise('rg-training'));

      for (const topic_role of [null, 'finance']) {
        const res = await patch(rg.id, { topic_role });
        expect(res.statusCode, String(topic_role)).toBe(409);
        expect(errorOf(res)).toMatchObject({
          type: 'group_protected',
          details: { reason: 'topic_role' },
        });
      }
      const restated = await patch(rg.id, { topic_role: 'responsible_gambling', name: 'RG' });
      expect(restated.statusCode, restated.body).toBe(200);
      expect(
        (
          await owner.group.findUniqueOrThrow({
            where: { licenseId_id: { licenseId: fx.a.licenseId, id: BigInt(rg.id) } },
          })
        ).topicRole,
      ).toBe('responsible_gambling');
    });

    it('never goes without its training requirement — on create, on edit, or by deleting the area (FR-MOD-08.6.3)', async () => {
      for (const body of [
        { name: 'RG', topic_role: 'responsible_gambling' },
        { name: 'RG', topic_role: 'responsible_gambling', required_expertise_ids: [] },
      ]) {
        const res = await server.post('/groups', body, auth(teamsA));
        expect(res.statusCode).toBe(409);
        expect(errorOf(res)).toMatchObject({
          type: 'group_protected',
          details: { reason: 'required_expertise' },
        });
      }
      expect(await owner.group.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);

      // A team with no requirement does not take the role.
      const plain = await createGroup({ name: 'Plain' });
      const taken = await patch(plain.id, { topic_role: 'responsible_gambling' });
      expect(taken.statusCode).toBe(409);
      expect(errorOf(taken).details).toMatchObject({ reason: 'required_expertise' });

      const training = await expertise('rg-training');
      const rg = await rgTeam(training);
      const cleared = await patch(rg.id, { required_expertise_ids: [] });
      expect(cleared.statusCode).toBe(409);
      expect(errorOf(cleared).details).toMatchObject({ reason: 'required_expertise' });

      // The catalogue: its last area is refused, and stays everywhere.
      const deleted = await server.del(`/settings/expertise/${training}`, auth(adminA));
      expect(deleted.statusCode).toBe(409);
      expect(errorOf(deleted)).toMatchObject({
        type: 'group_protected',
        details: { reason: 'required_expertise', group_id: rg.id },
      });
      expect(await requirementOf(rg.id)).toEqual([training]);

      // With a second area beside it, the first goes the way it goes elsewhere.
      const second = await expertise('rg-level-2');
      expect((await patch(rg.id, { required_expertise_ids: [training, second] })).statusCode).toBe(
        200,
      );
      expect((await server.del(`/settings/expertise/${training}`, auth(adminA))).statusCode).toBe(
        204,
      );
      expect(await requirementOf(rg.id)).toEqual([second]);
    });

    it('keeps every member trained: a requirement grown past a member, an agent dropping the training, the role given to a staffed team (FR-MOD-08.6.3)', async () => {
      const training = await expertise('rg-training');
      const turkish = await expertise('turkish');
      const agent = fx.a.agentAccountId;
      await hold(agent, [training]);

      // The role, to a staffed team whose member lacks the requirement.
      const desk = await createGroup({ name: 'Masa', required_expertise_ids: [training] });
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: BigInt(desk.id), agentId: fx.a.ownerAccountId },
      });
      const staffed = await patch(desk.id, { topic_role: 'responsible_gambling' });
      expect(staffed.statusCode).toBe(409);
      expect(errorOf(staffed)).toMatchObject({
        type: 'group_expertise_missing',
        details: { group_id: desk.id, agent_ids: [fx.a.ownerAccountId], expertise_ids: [training] },
      });
      expect(
        (await owner.group.findFirstOrThrow({ where: { id: BigInt(desk.id) } })).topicRole,
      ).toBeNull();
      await server.del(`/groups/${desk.id}/agents/${fx.a.ownerAccountId}`, auth(teamsA));

      const rg = await rgTeam(training);
      expect((await join(rg.id, agent)).statusCode).toBe(200);

      // A requirement grown past the member.
      const grown = await patch(rg.id, { required_expertise_ids: [training, turkish] });
      expect(grown.statusCode).toBe(409);
      expect(errorOf(grown)).toMatchObject({
        type: 'group_expertise_missing',
        details: { group_id: rg.id, agent_ids: [agent], expertise_ids: [turkish] },
      });
      expect(await requirementOf(rg.id)).toEqual([training]);
      await hold(agent, [turkish]);
      expect((await patch(rg.id, { required_expertise_ids: [training, turkish] })).statusCode).toBe(
        200,
      );

      // The agent dropping the training while on the team.
      const dropped = await setExpertise(agent, [turkish]);
      expect(dropped.statusCode).toBe(409);
      expect(errorOf(dropped)).toMatchObject({
        type: 'group_expertise_missing',
        details: { group_id: rg.id, agent_id: agent, expertise_ids: [training] },
      });
      expect(await held(agent)).toEqual([training, turkish].sort((a, b) => a - b));
      // Adding is fine; off the team, so is dropping.
      const extra = await expertise('vip');
      expect((await setExpertise(agent, [training, turkish, extra])).statusCode).toBe(200);
      await server.del(`/groups/${rg.id}/agents/${agent}`, auth(teamsA));
      expect((await setExpertise(agent, [])).statusCode).toBe(200);
    });

    it('lets an ordinary team narrow: its requirement grows, and an agent loses an area, without refusal (FR-MOD-08.6.3)', async () => {
      const kyc = await expertise('kyc');
      const level2 = await expertise('kyc-2');
      const agent = fx.a.agentAccountId;
      await hold(agent, [kyc]);
      const team = await createGroup({
        name: 'KYC',
        topic_role: 'kyc_risk',
        required_expertise_ids: [kyc],
      });
      expect((await join(team.id, agent)).statusCode).toBe(200);

      expect((await patch(team.id, { required_expertise_ids: [kyc, level2] })).statusCode).toBe(
        200,
      );
      expect((await setExpertise(agent, [])).statusCode).toBe(200);
      expect(await membersOf(team.id)).toEqual([agent]);
    });
  });

  // =========================================================================
  // 4. Serialised
  // =========================================================================

  describe('concurrency', () => {
    /** Until some backend waits on an advisory lock (the team-staffing one). */
    async function untilAdvisoryWait(): Promise<void> {
      for (let i = 0; i < 100; i++) {
        const [row] = await owner.$queryRaw<Array<{ n: number }>>`
          SELECT COUNT(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`;
        if ((row?.n ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('nobody waited for the team-staffing lock');
    }

    it('an agent losing the training while being added to the team ends trained or off it, never both (FR-MOD-08.6.3)', async () => {
      const training = await expertise('rg-training');
      const rg = await rgTeam(training);
      const agent = fx.a.agentAccountId;
      await hold(agent, [training]);

      const c1 = new PrismaClient({ datasourceUrl: APP_URL });
      await c1.$queryRaw`SELECT 1`;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let checked!: () => void;
      const checkedOnce = new Promise<void>((resolve) => (checked = resolve));
      try {
        // T1 drops the training (what `PUT /agents/{id}/expertise []` does) and
        // holds its transaction open.
        const t1 = withTenant(c1, ctx(), async (tx) => {
          await assertKeepsTeamTraining(tx, fx.a.licenseId, agent, []);
          await tx.agentExpertise.deleteMany({ where: { agentId: agent } });
          checked();
          await gate;
        });
        await checkedOnce;
        // T2 adds the agent meanwhile: it waits, then reads what T1 committed.
        const t2 = join(rg.id, agent);
        await untilAdvisoryWait();
        release();
        await t1;
        const res = await t2;
        expect(res.statusCode).toBe(409);
        expect(errorOf(res).type).toBe('group_expertise_missing');
      } finally {
        release();
        await c1.$disconnect();
      }
      expect(await membersOf(rg.id)).toEqual([]);
      expect(await held(agent)).toEqual([]);
    });
  });

  // =========================================================================
  // 5. Topic resolution
  // =========================================================================

  describe('resolveQueue', () => {
    it('resolves a topic to the team holding its role, renamed or moved, and nothing when none does (FR-MOD-08.6.1)', async () => {
      const resolve = (role: (typeof QUEUE_TOPIC_ROLES)[number]) =>
        withTenant(app, ctx(), (tx) => resolveQueue(tx, fx.a.licenseId, role));

      const finance = await createGroup({
        name: 'Finans',
        topic_role: 'finance',
        after_hours_mode: 'ticket',
      });
      expect(await resolve('finance')).toEqual({
        topicRole: 'finance',
        groupId: BigInt(finance.id),
        name: 'Finans',
        afterHoursMode: 'ticket',
      });
      expect(await resolve('bonus')).toBeNull();

      await patch(finance.id, { name: 'Ödemeler' });
      expect(await resolve('finance')).toMatchObject({
        groupId: BigInt(finance.id),
        name: 'Ödemeler',
      });

      const payments = await createGroup({ name: 'Payments EU' });
      await patch(finance.id, { topic_role: null });
      await patch(payments.id, { topic_role: 'finance' });
      expect((await resolve('finance'))?.groupId).toBe(BigInt(payments.id));
    });

    it("never resolves to another workspace's team (NFR-S4)", async () => {
      await createGroup({ name: 'Finance B', topic_role: 'finance' }, teamsB);
      expect(
        await withTenant(app, ctx(), (tx) => resolveQueue(tx, fx.a.licenseId, 'finance')),
      ).toBeNull();
    });
  });

  describe('GET /routing/queues', () => {
    it('lists the six roles in order, each with its team or nulls (FR-MOD-08.6.1)', async () => {
      const training = await expertise('rg-training');
      const rg = await rgTeam(training);
      const finance = await createGroup({
        name: 'Finans',
        topic_role: 'finance',
        after_hours_mode: 'ticket',
      });
      await createGroup({ name: 'Genel' });

      const res = await server.get('/routing/queues', auth(teamsA));
      expect(res.statusCode, res.body).toBe(200);
      const none = { group_id: null, group_name: null, after_hours_mode: null };
      expect((res.json() as QueuesBody).items).toEqual([
        {
          topic_role: 'finance',
          group_id: finance.id,
          group_name: 'Finans',
          after_hours_mode: 'ticket',
        },
        { topic_role: 'kyc_risk', ...none },
        { topic_role: 'bonus', ...none },
        {
          topic_role: 'responsible_gambling',
          group_id: rg.id,
          group_name: 'Sorumlu Oyun',
          after_hours_mode: 'queue',
        },
        { topic_role: 'technical', ...none },
        { topic_role: 'complaint', ...none },
      ]);
      expect((res.json() as QueuesBody).items.map((q) => q.topic_role)).toEqual([
        ...QUEUE_TOPIC_ROLES,
      ]);
    });

    it("needs a groups scope, and shows only the caller's workspace (NFR-S5)", async () => {
      await createGroup({ name: 'Finance B', topic_role: 'finance' }, teamsB);

      const mine = (await server.get('/routing/queues', auth(teamsA))).json() as QueuesBody;
      expect(mine.items.every((q) => q.group_id === null)).toBe(true);
      const theirs = (await server.get('/routing/queues', auth(teamsB))).json() as QueuesBody;
      expect(theirs.items[0]).toMatchObject({ topic_role: 'finance', group_name: 'Finance B' });

      const myGroups = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['groups--my:ro'],
      });
      expect((await server.get('/routing/queues', auth(myGroups))).statusCode).toBe(200);

      const chatsOnly = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      expect((await server.get('/routing/queues', auth(chatsOnly))).statusCode).toBe(403);
      expect((await server.get('/routing/queues')).statusCode).toBe(401);
    });
  });
});
