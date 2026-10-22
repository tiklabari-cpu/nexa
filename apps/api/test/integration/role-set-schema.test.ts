/**
 * The Team Lead role — its vocabulary and its schema (tm 324.1 · SiyahTuş
 * analysis RL-01, RL-04, owner decision K6; migration
 * 20261022180000_role_team_lead).
 *
 * Assigning the role, marking a lead and inviting one are the API's (tm
 * 324.2). What is pinned here is what those lean on:
 *
 *   - **One set of words.** The two role CHECKs, `@siyahtus/types` and the
 *     contract name the same roles, and the contract names them once.
 *   - **The database refuses a role it does not know**, and still holds
 *     exactly one owner per workspace.
 *   - **Leading a team** is a flag on the membership, read back by
 *     `GET /groups`, with an index for "the teams this person leads".
 *   - **An invitation's teams** belong to its workspace: another tenant's rows
 *     are invisible, a row cannot pair one workspace's invitation with
 *     another's team, and the rows go with the invitation and with the team.
 *   - **A Team Lead is not an admin**: a session caps them at the Team Lead
 *     set, and the role gates refuse them even holding admin scopes.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  AGENT_ROLES,
  INVITATION_ROLES,
  MATRIX_ROLES,
  MAX_INVITATION_GROUPS,
  TEAM_LEAD_SCOPES,
  defaultScopesForRole,
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
  agents: Array<{ agent_id: string; priority: string; lead: boolean }>;
}

interface InvitationBody {
  id: string;
  role: string;
  groups: Array<{ group_id: number; lead: boolean }>;
}

/** The quoted values a CHECK constraint lists, sorted. */
async function checkValues(db: PrismaClient, name: string): Promise<string[]> {
  const [row] = await db.$queryRaw<Array<{ def: string }>>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
  return [...row!.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!).sort();
}

/** Every `enum` in the bundled contract, by JSON pointer. */
function contractEnums(): Array<{ at: string; values: string[] }> {
  const found: Array<{ at: string; values: string[] }> = [];
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}/${i}`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' && Array.isArray(value)) found.push({ at, values: value as string[] });
      else walk(value, `${at}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
  };
  walk(loadOpenApiDocument(), '');
  return found;
}

describe('the Team Lead role — vocabulary and schema (RL-01 · RL-04 · K6 · tm 324.1)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

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
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const tokenFor = (t: TenantFixture, scopes: string[], ownerId = t.ownerAccountId) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId,
      scopes,
    });

  const seedTeam = (t: TenantFixture, name: string) =>
    owner.group.create({ data: { licenseId: t.licenseId, name }, select: { id: true } });

  const seedInvitation = (t: TenantFixture, email: string, role = 'agent') =>
    owner.invitation.create({
      data: {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        email,
        role,
        tokenHash: randomUUID(),
        invitedById: t.ownerAccountId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      select: { id: true },
    });

  const tenant = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  // =========================================================================
  // One set of words
  // =========================================================================

  describe('one vocabulary', () => {
    it('the role CHECKs and @siyahtus/types name the same roles', async () => {
      expect(await checkValues(owner, 'agent_memberships_role_check')).toEqual(
        [...AGENT_ROLES].sort(),
      );
      expect(await checkValues(owner, 'invitations_role_check')).toEqual(
        [...INVITATION_ROLES].sort(),
      );
      // K6: nobody new is offered the old vice owner, and nobody is invited owner.
      expect(INVITATION_ROLES).not.toContain('owner');
      expect(INVITATION_ROLES).not.toContain('viceowner');
    });

    it('the contract names the roles once, in the order @siyahtus/types ranks them', () => {
      const document = loadOpenApiDocument() as unknown as {
        components: { schemas: Record<string, { enum?: string[] }> };
        paths: Record<string, Record<string, unknown>>;
      };
      expect(document.components.schemas['AgentRole']?.enum).toEqual([...AGENT_ROLES]);
      expect(document.components.schemas['InvitationRole']?.enum).toEqual([...INVITATION_ROLES]);
      // The permission matrix's columns (tm 325.2 · RL-02): a third list on
      // purpose — no `viceowner` column, it reads the admin one.
      expect(document.components.schemas['MatrixRole']?.enum).toEqual([...MATRIX_ROLES]);

      // Every other place a role appears is a `$ref` to one of the two: an
      // inline copy is a list that drifts the next time a role is added.
      const roleLists = contractEnums().filter(
        ({ values }) => values.includes('admin') && values.includes('agent'),
      );
      expect(roleLists.map(({ at }) => at).sort()).toEqual([
        '/components/schemas/AgentRole',
        '/components/schemas/InvitationRole',
        '/components/schemas/MatrixRole',
      ]);

      const invite = document.paths['/invitations']!['post'] as {
        requestBody: {
          content: Record<
            string,
            { schema: { properties: Record<string, { maxItems?: number }> } }
          >;
        };
      };
      expect(
        invite.requestBody.content['application/json']!.schema.properties['groups']?.maxItems,
      ).toBe(MAX_INVITATION_GROUPS);
    });
  });

  // =========================================================================
  // What the database refuses
  // =========================================================================

  describe('the role CHECKs', () => {
    it('take a Team Lead and refuse a role nobody defined (FR-MOD-04.RBAC)', async () => {
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { role: 'team_lead' },
      });
      for (const role of ['superadmin', 'Team_Lead', 'teamlead', 'manager', '']) {
        await expect(
          owner.agentMembership.update({
            where: {
              licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
            },
            data: { role },
          }),
          role,
        ).rejects.toThrow(/agent_memberships_role_check/);
      }
    });

    it('invite a Team Lead, never an owner or a vice owner (FR-MOD-04.4)', async () => {
      await seedInvitation(fx.a, 'lead@example.test', 'team_lead');
      for (const role of ['owner', 'viceowner', 'superadmin']) {
        await expect(seedInvitation(fx.a, `${role}@example.test`, role), role).rejects.toThrow(
          /invitations_role_check/,
        );
      }
    });

    it('still hold exactly one owner per workspace (FR-MOD-04.3.3)', async () => {
      // A unique key on the licence alone is `uq_license_single_owner` (the
      // primary key is licence + agent).
      await expect(
        owner.$executeRaw`
          UPDATE agent_memberships SET role = 'owner'
           WHERE license_id = ${fx.a.licenseId} AND agent_id = ${fx.a.agentAccountId}::uuid`,
      ).rejects.toThrow(/23505[\s\S]*Key \(license_id\)=/);
    });
  });

  // =========================================================================
  // Leading a team
  // =========================================================================

  describe('group_agents.is_lead', () => {
    it('defaults to false, so every membership made before the role reads as a member', async () => {
      const team = await seedTeam(fx.a, 'Support');
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: team.id, agentId: fx.a.agentAccountId },
      });
      const [row] = await owner.$queryRaw<Array<{ is_lead: boolean }>>`
        SELECT is_lead FROM group_agents WHERE group_id = ${team.id}`;
      expect(row?.is_lead).toBe(false);
    });

    it('has a valid partial index for "the teams this person leads"', async () => {
      const rows = await owner.$queryRaw<Array<{ def: string; valid: boolean }>>`
        SELECT pg_get_indexdef(i.indexrelid) AS def, i.indisvalid AS valid
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.relname = 'group_agents_lead_agent_id_idx'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.valid).toBe(true);
      expect(rows[0]!.def).toMatch(/\(agent_id\) WHERE is_lead$/);
    });

    it('is read back by GET /groups as each member’s `lead`', async () => {
      const team = await seedTeam(fx.a, 'Support');
      await owner.groupAgent.createMany({
        data: [
          {
            licenseId: fx.a.licenseId,
            groupId: team.id,
            agentId: fx.a.agentAccountId,
            isLead: true,
          },
          { licenseId: fx.a.licenseId, groupId: team.id, agentId: fx.a.ownerAccountId },
        ],
      });
      const res = await server.get('/groups', auth(await tokenFor(fx.a, ['groups--all:ro'])));
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { items: GroupBody[] };
      const support = body.items.find((group) => group.id === Number(team.id))!;
      expect(support.agents.sort((x, y) => x.agent_id.localeCompare(y.agent_id))).toEqual(
        [
          { agent_id: fx.a.agentAccountId, priority: 'normal', lead: true },
          { agent_id: fx.a.ownerAccountId, priority: 'normal', lead: false },
        ].sort((x, y) => x.agent_id.localeCompare(y.agent_id)),
      );
    });
  });

  // =========================================================================
  // An invitation's teams
  // =========================================================================

  describe('invitation_groups', () => {
    it('is read back by GET /invitations, in team id order; none is an empty list', async () => {
      const first = await seedTeam(fx.a, 'Payments');
      const second = await seedTeam(fx.a, 'VIP');
      const lead = await seedInvitation(fx.a, 'lead@example.test', 'team_lead');
      const member = await seedInvitation(fx.a, 'member@example.test');
      await owner.invitationGroup.createMany({
        data: [
          { invitationId: lead.id, licenseId: fx.a.licenseId, groupId: second.id },
          { invitationId: lead.id, licenseId: fx.a.licenseId, groupId: first.id, isLead: true },
        ],
      });

      const res = await server.get(
        '/invitations',
        auth(await tokenFor(fx.a, ['accounts--all:rw'])),
      );
      expect(res.statusCode, res.body).toBe(200);
      const items = (res.json() as { items: InvitationBody[] }).items;
      expect(items.find((item) => item.id === lead.id)).toMatchObject({
        role: 'team_lead',
        groups: [
          { group_id: Number(first.id), lead: true },
          { group_id: Number(second.id), lead: false },
        ],
      });
      expect(items.find((item) => item.id === member.id)?.groups).toEqual([]);
    });

    it("cannot pair one workspace's invitation with another's team", async () => {
      const mine = await seedInvitation(fx.a, 'x@example.test');
      const theirTeam = await seedTeam(fx.b, 'Theirs');
      const theirs = await seedInvitation(fx.b, 'y@example.test');
      // Their team under my licence: no such team.
      await expect(
        owner.$executeRaw`
          INSERT INTO invitation_groups (invitation_id, license_id, group_id)
          VALUES (${mine.id}::uuid, ${fx.a.licenseId}, ${theirTeam.id})`,
      ).rejects.toThrow(/invitation_groups_license_id_group_id_fkey/);
      // My invitation under their licence: no such invitation.
      await expect(
        owner.$executeRaw`
          INSERT INTO invitation_groups (invitation_id, license_id, group_id)
          VALUES (${mine.id}::uuid, ${fx.b.licenseId}, ${theirTeam.id})`,
      ).rejects.toThrow(/invitation_groups_invitation_id_license_id_fkey/);
      // Theirs with theirs is fine.
      await owner.$executeRaw`
        INSERT INTO invitation_groups (invitation_id, license_id, group_id)
        VALUES (${theirs.id}::uuid, ${fx.b.licenseId}, ${theirTeam.id})`;
    });

    it("hides another workspace's rows and refuses writing under its licence (NFR-S5)", async () => {
      const team = await seedTeam(fx.b, 'Theirs');
      const invitation = await seedInvitation(fx.b, 'y@example.test');
      await owner.invitationGroup.create({
        data: { invitationId: invitation.id, licenseId: fx.b.licenseId, groupId: team.id },
      });

      const seen = await withTenant(app, tenant(fx.a), (tx) => tx.invitationGroup.count());
      expect(seen).toBe(0);
      await expect(
        withTenant(
          app,
          tenant(fx.a),
          (tx) => tx.$executeRaw`
            INSERT INTO invitation_groups (invitation_id, license_id, group_id)
            VALUES (${invitation.id}::uuid, ${fx.b.licenseId}, ${team.id})
            ON CONFLICT DO NOTHING`,
        ),
      ).rejects.toThrow(/row-level security/);
      expect(await withTenant(app, tenant(fx.b), (tx) => tx.invitationGroup.count())).toBe(1);
    });

    it('goes with the invitation and with the team', async () => {
      const keep = await seedTeam(fx.a, 'Keep');
      const drop = await seedTeam(fx.a, 'Drop');
      const revoked = await seedInvitation(fx.a, 'revoked@example.test');
      const kept = await seedInvitation(fx.a, 'kept@example.test');
      await owner.invitationGroup.createMany({
        data: [
          { invitationId: revoked.id, licenseId: fx.a.licenseId, groupId: keep.id },
          { invitationId: kept.id, licenseId: fx.a.licenseId, groupId: keep.id },
          { invitationId: kept.id, licenseId: fx.a.licenseId, groupId: drop.id },
        ],
      });

      await owner.invitation.delete({ where: { id: revoked.id } });
      await owner.group.delete({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: drop.id } },
      });

      const left = await owner.invitationGroup.findMany({
        select: { invitationId: true, groupId: true },
      });
      expect(left).toEqual([{ invitationId: kept.id, groupId: keep.id }]);
    });

    it('lets the application role read, add and remove rows — a re-invite replaces the set', async () => {
      const grants = await owner.$queryRaw<Array<{ privilege_type: string }>>`
        SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'invitation_groups' AND grantee = 'siyahtus_app'`;
      expect(grants.map((row) => row.privilege_type).sort()).toEqual([
        'DELETE',
        'INSERT',
        'SELECT',
      ]);
    });
  });

  // =========================================================================
  // A Team Lead is not an admin
  // =========================================================================

  describe('a Team Lead', () => {
    beforeEach(async () => {
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { role: 'team_lead' },
      });
    });

    it('holds the Team Lead set in a session, whatever it was minted with (FR-00-01.E)', async () => {
      const session = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        kind: 'oauth',
        scopes: defaultScopesForRole('admin'),
      });
      const me = await server.get('/auth/me', auth(session));
      expect(me.statusCode, me.body).toBe(200);
      expect(me.json()).toMatchObject({ role: 'team_lead', scopes: TEAM_LEAD_SCOPES });
    });

    it('cannot open billing, security or AI configuration — 403 (FR-MOD-04.RBAC)', async () => {
      const session = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        kind: 'oauth',
        scopes: defaultScopesForRole('owner'),
      });
      for (const path of ['/billing/invoices', '/settings/security', '/ai-guardrails/platform']) {
        const res = await server.get(path, auth(session));
        expect(res.statusCode, `${path}: ${res.body}`).toBe(403);
      }

      // A personal access token keeps the list it was given — and the role
      // gates, which read the role fresh, refuse a Team Lead holding one.
      const pat = await tokenFor(
        fx.a,
        ['access_rules:rw', 'billing_manage', 'agents--all:rw'],
        fx.a.agentAccountId,
      );
      const security = await server.patch('/settings/security', {}, auth(pat));
      expect(security.statusCode, security.body).toBe(403);
      const billing = await server.patch('/billing/subscription', {}, auth(pat));
      expect(billing.statusCode, billing.body).toBe(403);
      const role = await server.put(
        `/agents/${fx.a.ownerAccountId}/role`,
        { role: 'agent' },
        auth(pat),
      );
      expect(role.statusCode, role.body).toBe(403);
    });
  });
});
