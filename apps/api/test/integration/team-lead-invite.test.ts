/**
 * The Team Lead's two doors in (tm 324.2 · RL-01, RL-04-S1).
 *
 *   1. **An invitation names teams.** `POST /invitations` takes `groups`: the
 *      teams every invitee joins on accepting, and which they lead. A Team
 *      Lead must lead one, nobody else may lead any, a team is named once, it
 *      must be this workspace's and it must not require training a newcomer
 *      cannot have. A refusal writes nothing. A re-invite replaces the set.
 *   2. **The join applies them** — at the accept for a verified account, at
 *      the address proof for a new one — and only for a membership the join
 *      created: an invitation that finds the person already a member changes
 *      neither role nor teams.
 *   3. **A lead mark is an admin's to set, and a Team Lead's to hold.** `PUT
 *      /groups/{id}/agents/{agentId}` takes `lead`: an admin or the owner sets
 *      or clears it, nobody else (whatever their token says), and only on a
 *      Team Lead. Leaving it out keeps it.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { MemoryMailer, acceptAndVerify } from '../helpers/invite-join.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const NEWCOMER = 'new-lead@example.test';
const NEWCOMER_PASSWORD = 'a-newcomer-password';

interface ErrorBody {
  error: { type: string; details?: Record<string, unknown> };
}
interface InvitationBody {
  id: string;
  role: string;
  groups: Array<{ group_id: number; lead: boolean }>;
  accept_url: string;
}
interface GroupBody {
  id: number;
  agents: Array<{ agent_id: string; priority: string; lead: boolean }>;
}

describe('Team Lead invitations and lead marks (RL-01 · RL-04-S1)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  /** The owner's token for invitations and for staffing teams. */
  let ownerToken: string;
  const mailer = new MemoryMailer();
  let seq = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const errorOf = (res: { json: () => unknown }) => (res.json() as ErrorBody).error;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { mailer });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    mailer.clear();
    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw', 'groups--all:rw', 'groups--all:ro', 'agents--all:rw'],
    });
  });

  async function team(name: string, licenseId = fx.a.licenseId): Promise<number> {
    const row = await owner.group.create({ data: { licenseId, name }, select: { id: true } });
    return Number(row.id);
  }

  /** A team that requires one area of expertise (AU-01 · K14). */
  async function trainedTeam(name: string): Promise<{ id: number; expertiseId: number }> {
    const id = await team(name);
    const area = await owner.expertise.create({
      data: { licenseId: fx.a.licenseId, name: 'RG training', slug: `rg-${(seq += 1)}` },
      select: { id: true },
    });
    await owner.groupExpertise.create({
      data: { licenseId: fx.a.licenseId, groupId: BigInt(id), expertiseId: area.id },
    });
    return { id, expertiseId: Number(area.id) };
  }

  /** A teammate of `role` in workspace A, with a token over the given scopes. */
  async function teammate(role: 'admin' | 'team_lead' | 'agent', scopes: string[] = []) {
    const account = await owner.account.create({
      data: { email: `${role}-${(seq += 1)}-${Date.now()}@example.test`, name: role },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role },
    });
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      scopes,
    });
    return { accountId: account.id, token };
  }

  const invite = (body: Record<string, unknown>, token = ownerToken) =>
    server.post('/invitations', { emails: [NEWCOMER], ...body }, auth(token));

  const created = (res: { json: () => unknown }) =>
    (res.json() as { items: InvitationBody[] }).items[0]!;

  const tokenOf = (item: InvitationBody) => new URL(item.accept_url).searchParams.get('token')!;

  const invitationRows = () =>
    owner.invitation.findMany({ where: { licenseId: fx.a.licenseId, email: NEWCOMER } });
  const invitationGroups = (invitationId: string) =>
    owner.invitationGroup.findMany({
      where: { invitationId },
      select: { groupId: true, isLead: true },
      orderBy: { groupId: 'asc' },
    });
  const teamsOf = (agentId: string) =>
    owner.groupAgent
      .findMany({
        where: { licenseId: fx.a.licenseId, agentId },
        select: { groupId: true, isLead: true },
        orderBy: { groupId: 'asc' },
      })
      .then((rows) => rows.map((row) => ({ group_id: Number(row.groupId), lead: row.isLead })));
  const invitedEntries = () =>
    owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'member.invited' },
      orderBy: { createdAt: 'asc' },
    });

  // =========================================================================
  // 1. What an invitation may name
  // =========================================================================

  describe('POST /invitations with teams', () => {
    it('refuses a Team Lead invitation that leads no team, and writes nothing (FR-MOD-04.4)', async () => {
      const support = await team('Support');
      for (const groups of [undefined, [], [{ group_id: support }]]) {
        const res = await invite({ role: 'team_lead', ...(groups ? { groups } : {}) });
        expect(res.statusCode, res.payload).toBe(400);
        expect(errorOf(res)).toMatchObject({
          type: 'validation',
          details: { reason: 'lead_team_required' },
        });
      }
      expect(await invitationRows()).toHaveLength(0);
      expect(await invitedEntries()).toHaveLength(0);
    });

    it('refuses a lead mark on any other role, and a team named twice (FR-MOD-04.4)', async () => {
      const support = await team('Support');
      for (const role of ['admin', 'agent']) {
        const res = await invite({ role, groups: [{ group_id: support, lead: true }] });
        expect(res.statusCode).toBe(400);
        expect(errorOf(res).details).toMatchObject({ reason: 'lead_requires_team_lead' });
      }
      const twice = await invite({
        role: 'team_lead',
        groups: [
          { group_id: support, lead: true },
          { group_id: support, lead: false },
        ],
      });
      expect(twice.statusCode).toBe(400);
      expect(errorOf(twice).details).toMatchObject({ reason: 'duplicate_group' });
      expect(await invitationRows()).toHaveLength(0);
    });

    it("answers a team this workspace does not have — another's included — 404 group_not_found", async () => {
      const theirs = await team('Their team', fx.b.licenseId);
      for (const groupId of [theirs, 999_999]) {
        const res = await invite({
          role: 'team_lead',
          groups: [{ group_id: groupId, lead: true }],
        });
        expect(res.statusCode).toBe(404);
        expect(errorOf(res)).toMatchObject({
          type: 'group_not_found',
          details: { group_ids: [groupId] },
        });
      }
      expect(await invitationRows()).toHaveLength(0);
      expect(await owner.invitationGroup.count()).toBe(0);
    });

    it('refuses a team that requires training a newcomer cannot hold yet — 409 (FR-MOD-04.4)', async () => {
      const rg = await trainedTeam('Responsible Gambling');
      const res = await invite({ role: 'agent', groups: [{ group_id: rg.id }] });
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toMatchObject({
        type: 'group_expertise_missing',
        details: { group_id: rg.id, expertise_ids: [rg.expertiseId] },
      });
      expect(await invitationRows()).toHaveLength(0);
    });

    it('records the teams in id order, lists them, and puts the ids in the trail (FR-MOD-04.4)', async () => {
      const sales = await team('Sales');
      const support = await team('Support');
      const res = await invite({
        role: 'team_lead',
        groups: [{ group_id: support }, { group_id: sales, lead: true }],
      });
      expect(res.statusCode, res.payload).toBe(201);
      const item = created(res);
      const expected = [
        { group_id: sales, lead: true },
        { group_id: support, lead: false },
      ];
      expect(item).toMatchObject({ role: 'team_lead', groups: expected });

      const listed = await server.get('/invitations', auth(ownerToken));
      expect(
        (listed.json() as { items: InvitationBody[] }).items.find((i) => i.id === item.id)?.groups,
      ).toEqual(expected);
      expect(await invitationGroups(item.id)).toEqual([
        { groupId: BigInt(sales), isLead: true },
        { groupId: BigInt(support), isLead: false },
      ]);

      const [entry] = await invitedEntries();
      expect(entry!.metadata).toMatchObject({
        role: 'team_lead',
        group_ids: [sales, support],
        lead_group_ids: [sales],
      });
    });

    it('keeps the old shape for an invitation that names no team: agent, no teams, role-only trail', async () => {
      const res = await invite({});
      expect(res.statusCode).toBe(201);
      expect(created(res)).toMatchObject({ role: 'agent', groups: [] });
      const { metadata } = (await invitedEntries())[0]!;
      expect(metadata).toMatchObject({ role: 'agent' });
      expect(metadata).not.toHaveProperty('group_ids');
      expect(metadata).not.toHaveProperty('lead_group_ids');
    });

    it("replaces the set on a re-invite — the latest invitation's teams, not a union", async () => {
      const sales = await team('Sales');
      const support = await team('Support');
      const first = created(
        await invite({ role: 'team_lead', groups: [{ group_id: sales, lead: true }] }),
      );
      const second = created(await invite({ role: 'agent', groups: [{ group_id: support }] }));
      // The same row, re-issued (one live invitation per address).
      expect(second.id).toBe(first.id);
      expect(await invitationGroups(first.id)).toEqual([
        { groupId: BigInt(support), isLead: false },
      ]);
      const [row] = await invitationRows();
      expect(row!.role).toBe('agent');
    });

    it('is still an admin-and-up act: a Team Lead holding the scope is refused (FR-MOD-04.RBAC)', async () => {
      const support = await team('Support');
      const lead = await teammate('team_lead', ['accounts--all:rw']);
      const res = await invite({ role: 'agent', groups: [{ group_id: support }] }, lead.token);
      expect(res.statusCode).toBe(403);
      expect(await invitationRows()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. The join applies them
  // =========================================================================

  describe('joining through an invitation with teams', () => {
    it('puts a verified account on the teams at the accept, leading the ones it says (FR-MOD-04.4)', async () => {
      const sales = await team('Sales');
      const support = await team('Support');
      // B's agent: an account somebody already verified, joining at once.
      const res = await server.post(
        '/invitations',
        {
          emails: [fx.b.agentEmail],
          role: 'team_lead',
          groups: [{ group_id: sales, lead: true }, { group_id: support }],
        },
        auth(ownerToken),
      );
      expect(res.statusCode, res.payload).toBe(201);

      const accepted = await server.post('/auth/invitations/accept', {
        token: tokenOf(created(res)),
      });
      expect(accepted.statusCode, accepted.payload).toBe(200);

      const membership = await owner.agentMembership.findFirst({
        where: { licenseId: fx.a.licenseId, agentId: fx.b.agentAccountId },
      });
      expect(membership?.role).toBe('team_lead');
      expect(await teamsOf(fx.b.agentAccountId)).toEqual([
        { group_id: sales, lead: true },
        { group_id: support, lead: false },
      ]);
      // Applied to the workspace joined, and nowhere else.
      expect(
        await owner.groupAgent.count({
          where: { licenseId: fx.b.licenseId, agentId: fx.b.agentAccountId, isLead: true },
        }),
      ).toBe(0);
    });

    it('waits for a new account to prove its address, then applies them (FR-MOD-04.4)', async () => {
      const sales = await team('Sales');
      const item = created(
        await invite({ role: 'team_lead', groups: [{ group_id: sales, lead: true }] }),
      );

      const { accepted, verified } = await acceptAndVerify(server, mailer, {
        token: tokenOf(item),
        email: NEWCOMER,
        password: NEWCOMER_PASSWORD,
      });
      expect(accepted.statusCode).toBe(202);
      expect(verified.statusCode, verified.payload).toBe(200);

      const account = await owner.account.findUniqueOrThrow({ where: { email: NEWCOMER } });
      expect(await teamsOf(account.id)).toEqual([{ group_id: sales, lead: true }]);
      expect(
        (
          await owner.agentMembership.findFirst({
            where: { licenseId: fx.a.licenseId, agentId: account.id },
          })
        )?.role,
      ).toBe('team_lead');
    });

    it('changes neither role nor teams for somebody who is already a member', async () => {
      const sales = await team('Sales');
      // The fixture's agent, invited as a Team Lead into the workspace they are in.
      const res = await server.post(
        '/invitations',
        {
          emails: [fx.a.agentEmail],
          role: 'team_lead',
          groups: [{ group_id: sales, lead: true }],
        },
        auth(ownerToken),
      );
      expect(res.statusCode, res.payload).toBe(201);
      const accepted = await server.post('/auth/invitations/accept', {
        token: tokenOf(created(res)),
      });
      expect(accepted.statusCode, accepted.payload).toBe(200);

      expect(
        (
          await owner.agentMembership.findFirst({
            where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
          })
        )?.role,
      ).toBe('agent');
      expect(await teamsOf(fx.a.agentAccountId)).toEqual([]);
    });

    it('skips a team deleted, or come to require training, while the invitation waited', async () => {
      const sales = await team('Sales');
      const gone = await team('Gone');
      const support = await team('Support');
      const res = await server.post(
        '/invitations',
        {
          emails: [fx.b.agentEmail],
          role: 'team_lead',
          groups: [{ group_id: sales, lead: true }, { group_id: gone }, { group_id: support }],
        },
        auth(ownerToken),
      );
      expect(res.statusCode, res.payload).toBe(201);

      await owner.group.delete({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: BigInt(gone) } },
      });
      const area = await owner.expertise.create({
        data: { licenseId: fx.a.licenseId, name: 'RG training', slug: 'rg-late' },
        select: { id: true },
      });
      await owner.groupExpertise.create({
        data: { licenseId: fx.a.licenseId, groupId: BigInt(support), expertiseId: area.id },
      });

      const accepted = await server.post('/auth/invitations/accept', {
        token: tokenOf(created(res)),
      });
      expect(accepted.statusCode, accepted.payload).toBe(200);
      expect(await teamsOf(fx.b.agentAccountId)).toEqual([{ group_id: sales, lead: true }]);
    });
  });

  // =========================================================================
  // 3. Marking a team lead
  // =========================================================================

  describe('PUT /groups/{id}/agents/{agentId} lead', () => {
    const setMember = (groupId: number, agentId: string, body: unknown, token = ownerToken) =>
      server.put(`/groups/${groupId}/agents/${agentId}`, body, auth(token));

    const memberOf = (res: { json: () => unknown }, agentId: string) =>
      (res.json() as GroupBody).agents.find((a) => a.agent_id === agentId);

    it('lets an admin mark a Team Lead the lead, keeps the mark when left out, and clears it (FR-MOD-04.5)', async () => {
      const sales = await team('Sales');
      const lead = await teammate('team_lead');
      const admin = await teammate('admin', ['groups--all:rw']);

      const marked = await setMember(sales, lead.accountId, { lead: true }, admin.token);
      expect(marked.statusCode, marked.payload).toBe(200);
      expect(memberOf(marked, lead.accountId)).toEqual({
        agent_id: lead.accountId,
        priority: 'normal',
        lead: true,
      });

      // A tier change that says nothing of `lead` keeps it.
      const moved = await setMember(sales, lead.accountId, { priority: 'primary' }, admin.token);
      expect(memberOf(moved, lead.accountId)).toMatchObject({ priority: 'primary', lead: true });

      const cleared = await setMember(
        sales,
        lead.accountId,
        { priority: 'primary', lead: false },
        admin.token,
      );
      expect(memberOf(cleared, lead.accountId)).toMatchObject({ lead: false });

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'group.member_set' },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((e) => (e.metadata as { lead: boolean }).lead)).toEqual([
        true,
        true,
        false,
      ]);
    });

    it('lets one Team Lead lead several teams (RL-01-S2)', async () => {
      const sales = await team('Sales');
      const support = await team('Support');
      const lead = await teammate('team_lead');
      for (const id of [sales, support]) {
        expect((await setMember(id, lead.accountId, { lead: true })).statusCode).toBe(200);
      }
      expect(await teamsOf(lead.accountId)).toEqual([
        { group_id: sales, lead: true },
        { group_id: support, lead: true },
      ]);
    });

    it('marks only a Team Lead: a Team Member or an admin is 400 lead_requires_team_lead', async () => {
      const sales = await team('Sales');
      const admin = await teammate('admin');
      for (const agentId of [fx.a.agentAccountId, admin.accountId]) {
        const res = await setMember(sales, agentId, { lead: true });
        expect(res.statusCode).toBe(400);
        expect(errorOf(res).details).toMatchObject({ reason: 'lead_requires_team_lead' });
        expect(await teamsOf(agentId)).toEqual([]);
      }
    });

    it('refuses `lead` from anyone under admin, whatever the token holds (FR-MOD-04.RBAC)', async () => {
      const sales = await team('Sales');
      const lead = await teammate('team_lead', ['groups--all:rw']);
      const member = await teammate('agent', ['groups--all:rw']);

      for (const caller of [lead, member]) {
        for (const body of [{ lead: true }, { lead: false }]) {
          const res = await setMember(sales, lead.accountId, body, caller.token);
          expect(res.statusCode).toBe(403);
        }
      }
      expect(await teamsOf(lead.accountId)).toEqual([]);

      // The scope still staffs teams for them; only the mark is the admin's.
      const staffed = await setMember(sales, lead.accountId, { priority: 'normal' }, lead.token);
      expect(staffed.statusCode).toBe(200);
      expect(await teamsOf(lead.accountId)).toEqual([{ group_id: sales, lead: false }]);
    });
  });
});
