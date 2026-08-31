/**
 * Team membership — `PUT`/`DELETE /groups/{groupId}/agents/{agentId}`
 * (FR-MOD-04.5, Must/MVP).
 *
 * `groups.test.ts` covers the team itself. This file covers the two calls that
 * decide *who is in it*, and it asserts their effect rather than their echo:
 *
 *   - **Routing.** ADR-08 step 2 resolves an agent through `group_agents`, so a
 *     membership write is the thing that turns a team from an empty label into
 *     somewhere a conversation can go. Every write here is followed by an actual
 *     `RoutingService.route()` call — a 200 that left the routing decision
 *     unchanged would be the failure worth catching, and only routing can say.
 *   - **Priority tiers.** `GROUP_PRIORITIES` (`@nexa/types`) and the column's
 *     `group_agents_priority_check` are two spellings of one rule, and the
 *     endpoint sits between them. Tested in both directions: every tier the
 *     type names is accepted, and anything else is a 400 rather than a 23514
 *     surfacing as a 500.
 *   - **Access control.** Membership decides which agent is shown which
 *     conversation (`services/chat/access.ts` reads `group_agents` per request,
 *     deliberately, so a removal takes effect at once). A membership endpoint
 *     that accepted an outsider — another workspace's agent, an unknown uuid —
 *     would be granting sight of conversations, not editing a list.
 *
 * The five `group.*` audit actions are checked here too, across one team's whole
 * life: a write to an access-control table that leaves no trail is the one an
 * incident review cannot reconstruct.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GROUP_PRIORITIES } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import { RoutingService } from '../../src/services/routing/routing-service.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface GroupBody {
  id: number;
  name: string;
  language_code: string;
  agents: Array<{ agent_id: string; priority: string }>;
}

interface ErrorBody {
  error: { type: string; message: string; details?: Record<string, unknown> };
}

interface ChatListBody {
  items: Array<{ id: string }>;
}

/** A syntactically valid uuid that belongs to no account anywhere. */
const NOBODY = '00000000-0000-4000-8000-0000000000ff';

describe('team membership — /groups/:groupId/agents/:agentId (FR-MOD-04.5)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let routing: RoutingService;

  /** Tenant A, allowed to write. */
  let rwA: string;
  /** Tenant A, read-only — the scope half of the gate. */
  let roA: string;
  /** Tenant B, allowed to write *its own* teams. */
  let rwB: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
    routing = new RoutingService();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    rwA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['groups--all:rw', 'groups--all:ro'],
    });
    roA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['groups--all:ro'],
    });
    rwB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['groups--all:rw', 'groups--all:ro'],
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A team straight from the endpoint. */
  async function createGroup(name: string, token = rwA): Promise<GroupBody> {
    const res = await server.post('/groups', { name }, auth(token));
    expect(res.statusCode).toBe(201);
    return res.json() as GroupBody;
  }

  /**
   * `PUT` the membership. `body` is passed through untouched — `undefined`
   * sends no payload at all, which is the shape the contract calls optional.
   */
  const setMember = (
    groupId: number | string,
    agentId: string,
    body?: unknown,
    token = rwA,
  ): ReturnType<TestServer['put']> =>
    server.put(`/groups/${groupId}/agents/${agentId}`, body, auth(token));

  const removeMember = (groupId: number | string, agentId: string, token = rwA) =>
    server.del(`/groups/${groupId}/agents/${agentId}`, auth(token));

  /** Add the agent and insist it worked, for the arrange half of a test. */
  async function addMember(
    groupId: number,
    agentId: string,
    priority?: string,
    token = rwA,
  ): Promise<GroupBody> {
    const res = await setMember(
      groupId,
      agentId,
      priority === undefined ? {} : { priority },
      token,
    );
    expect(res.statusCode).toBe(200);
    return res.json() as GroupBody;
  }

  /** What routing would do with a new conversation right now. */
  const route = () =>
    withTenant(owner, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
      routing.route(tx, fx.a.licenseId),
    );

  const memberCount = (groupId: number | bigint) =>
    owner.groupAgent.count({ where: { groupId: BigInt(groupId) } });

  /** The tier on the row, not the one in the response body. */
  const rowPriority = async (groupId: number, agentId: string): Promise<string | undefined> =>
    (
      await owner.groupAgent.findFirst({
        where: { groupId: BigInt(groupId), agentId },
        select: { priority: true },
      })
    )?.priority;

  const priorityIn = (group: GroupBody, agentId: string): string | undefined =>
    group.agents.find((a) => a.agent_id === agentId)?.priority;

  // ==========================================================================
  // The point of the endpoint: routing follows the membership
  // ==========================================================================

  describe('routing follows the membership', () => {
    it('has nowhere to send a chat until PUT puts somebody in the team', async () => {
      const team = await createGroup('Support');

      // The state a fresh workspace is in once a team exists: somewhere to
      // route to, nobody to route to. The conversation queues rather than
      // vanishing, which is why the missing write half read as harmless.
      expect(await route()).toMatchObject({
        assigneeId: null,
        reason: 'queued',
        queuePosition: 1,
      });

      await addMember(team.id, fx.a.agentAccountId);

      expect(await route()).toMatchObject({
        assigneeId: fx.a.agentAccountId,
        reason: 'assigned',
        groupIds: [BigInt(team.id)],
      });
    });

    it('takes the agent back out of the candidate pool on DELETE', async () => {
      const team = await createGroup('Support');
      await addMember(team.id, fx.a.agentAccountId);
      expect((await route()).assigneeId).toBe(fx.a.agentAccountId);

      expect((await removeMember(team.id, fx.a.agentAccountId)).statusCode).toBe(204);

      expect(await route()).toMatchObject({ assigneeId: null, reason: 'queued' });
      expect(await memberCount(team.id)).toBe(0);
    });

    it('answers with the team as it now stands', async () => {
      const team = await createGroup('Support');

      const body = await addMember(team.id, fx.a.agentAccountId, 'primary');
      expect(body).toMatchObject({
        id: team.id,
        name: 'Support',
        agents: [{ agent_id: fx.a.agentAccountId, priority: 'primary' }],
      });
    });

    it('leaves the workspace membership alone when it removes the team one', async () => {
      // `group_agents` and `agent_memberships` answer different questions —
      // "which conversations may this person see" and "does this person work
      // here". Taking someone off a team must not sign them out of the
      // workspace, and the two rows are one cascade away from each other.
      const team = await createGroup('Support');
      await addMember(team.id, fx.a.agentAccountId);

      await removeMember(team.id, fx.a.agentAccountId);

      expect(
        await owner.agentMembership.findUnique({
          where: {
            licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
          },
          select: { role: true, routingStatus: true },
        }),
      ).toEqual({ role: 'agent', routingStatus: 'accepting_chats' });
      expect(await owner.account.count({ where: { id: fx.a.agentAccountId } })).toBe(1);
    });

    it('keeps one agent’s removal from touching the rest of the team', async () => {
      const team = await createGroup('Support');
      await addMember(team.id, fx.a.agentAccountId);
      await addMember(team.id, fx.a.ownerAccountId);

      await removeMember(team.id, fx.a.agentAccountId);

      expect(await memberCount(team.id)).toBe(1);
      expect((await route()).assigneeId).toBe(fx.a.ownerAccountId);
    });
  });

  // ==========================================================================
  // Priority tiers — `GROUP_PRIORITIES` and `group_agents_priority_check`
  // ==========================================================================

  describe('priority tiers', () => {
    it('defaults to `normal`, whether the tier is omitted or the body is', async () => {
      const team = await createGroup('Support');

      const withEmptyBody = await addMember(team.id, fx.a.agentAccountId);
      expect(priorityIn(withEmptyBody, fx.a.agentAccountId)).toBe('normal');

      // No payload at all — the contract marks the request body optional, and a
      // console that only wants to add somebody sends nothing.
      const withNoBody = await setMember(team.id, fx.a.ownerAccountId, undefined);
      expect(withNoBody.statusCode).toBe(200);
      expect(priorityIn(withNoBody.json() as GroupBody, fx.a.ownerAccountId)).toBe('normal');
    });

    it('accepts every tier `GROUP_PRIORITIES` names, and stores it', async () => {
      // The forward half of the enum/CHECK agreement: a tier the type allows and
      // the column rejects would be a 500 on a legitimate call.
      const team = await createGroup('Support');

      for (const priority of GROUP_PRIORITIES) {
        const res = await setMember(team.id, fx.a.agentAccountId, { priority });
        expect(res.statusCode, priority).toBe(200);
        expect(await rowPriority(team.id, fx.a.agentAccountId)).toBe(priority);
      }
    });

    it.each([
      ['primary', 'first'],
      ['first', 'normal'],
      ['normal', 'last'],
      ['primary', 'last'],
    ])('routes to the %s tier ahead of the %s tier', async (higher, lower) => {
      // Both agents are idle and neither has ever been assigned, so the tier
      // written through the endpoint is the only thing that can decide this.
      const team = await createGroup('Support');
      await addMember(team.id, fx.a.ownerAccountId, lower);
      await addMember(team.id, fx.a.agentAccountId, higher);

      expect((await route()).assigneeId).toBe(fx.a.agentAccountId);
    });

    it('moves an existing member between tiers with the same call, and routing follows', async () => {
      const team = await createGroup('Support');
      await addMember(team.id, fx.a.ownerAccountId, 'normal');
      await addMember(team.id, fx.a.agentAccountId, 'primary');
      expect((await route()).assigneeId).toBe(fx.a.agentAccountId);

      // Same path, same agent: an upsert, so the row moves rather than a second
      // one appearing. A duplicate would be invisible in the response and would
      // double the agent's weight in every future candidate query.
      const demoted = await addMember(team.id, fx.a.agentAccountId, 'last');
      expect(await memberCount(team.id)).toBe(2);
      expect(priorityIn(demoted, fx.a.agentAccountId)).toBe('last');
      expect(await rowPriority(team.id, fx.a.agentAccountId)).toBe('last');

      expect((await route()).assigneeId).toBe(fx.a.ownerAccountId);
    });

    it('refuses a tier the CHECK constraint would reject, and writes nothing', async () => {
      // The reverse half of the agreement. Each of these reaches the column as
      // a `group_agents_priority_check` violation if the enum is not enforced
      // first — a 500 for what is a client mistake, and a transaction aborted
      // mid-flight.
      const team = await createGroup('Support');

      for (const priority of ['urgent', 'PRIMARY', 'Normal', '', 'normal ', 0, null]) {
        const res = await setMember(team.id, fx.a.agentAccountId, { priority });
        expect(res.statusCode, String(priority)).toBe(400);
        expect((res.json() as ErrorBody).error.type, String(priority)).toBe('validation');
      }

      expect(await memberCount(team.id)).toBe(0);
    });
  });

  // ==========================================================================
  // Who may be put on a team — membership is an access grant
  // ==========================================================================

  describe('membership is an access grant, not a list', () => {
    it('404s a uuid that belongs to nobody', async () => {
      const team = await createGroup('Support');

      const res = await setMember(team.id, NOBODY, {});

      expect(res.statusCode).toBe(404);
      // Accepted and never matched would be worse than refused: the console
      // would show a member the routing query cannot see.
      expect(await memberCount(team.id)).toBe(0);
    });

    it('404s another workspace’s agent', async () => {
      // The dangerous shape — `fx.b.agentAccountId` is a live account with a
      // live membership, in the wrong workspace. Accepting it would seat an
      // outsider on the team that decides who is shown which conversation.
      const team = await createGroup('Support');

      const res = await setMember(team.id, fx.b.agentAccountId, {});

      expect(res.statusCode).toBe(404);
      expect(await owner.groupAgent.count({ where: { agentId: fx.b.agentAccountId } })).toBe(0);
    });

    it('404s — not 403 — when the team belongs to another workspace', async () => {
      // A 403 would confirm the id names a real team, and group ids are small
      // global `BIGSERIAL` values (NFR-S5, the same reasoning as `groups.test.ts`).
      const theirs = await createGroup('B Support', rwB);

      const res = await setMember(theirs.id, fx.a.agentAccountId, {});

      expect(res.statusCode).toBe(404);
      expect((res.json() as ErrorBody).error.type).toBe('group_not_found');
      expect(await memberCount(theirs.id)).toBe(0);
    });

    it('404s a DELETE for an agent who is not in the team', async () => {
      const team = await createGroup('Support');
      const other = await createGroup('Sales');
      await addMember(other.id, fx.a.agentAccountId);

      // In the workspace, and in a team — just not this one. A 204 here would
      // report a removal that never happened.
      const res = await removeMember(team.id, fx.a.agentAccountId);
      expect(res.statusCode).toBe(404);
      expect(await memberCount(other.id)).toBe(1);
    });

    it('does not let one workspace remove another’s membership', async () => {
      const theirs = await createGroup('B Support', rwB);
      await addMember(theirs.id, fx.b.agentAccountId, undefined, rwB);

      const res = await removeMember(theirs.id, fx.b.agentAccountId);

      expect(res.statusCode).toBe(404);
      expect(await memberCount(theirs.id)).toBe(1);
    });
  });

  // ==========================================================================
  // Scope — reading the teams does not imply staffing them
  // ==========================================================================

  describe('scopes', () => {
    it('refuses membership writes from a read-only token', async () => {
      const team = await createGroup('Support');

      expect((await setMember(team.id, fx.a.agentAccountId, {}, roA)).statusCode).toBe(403);
      expect(await memberCount(team.id)).toBe(0);

      await addMember(team.id, fx.a.agentAccountId);
      expect((await removeMember(team.id, fx.a.agentAccountId, roA)).statusCode).toBe(403);
      expect(await memberCount(team.id)).toBe(1);
    });

    it('refuses an unauthenticated membership write', async () => {
      const team = await createGroup('Support');
      const path = `/groups/${team.id}/agents/${fx.a.agentAccountId}`;

      expect((await server.put(path, {})).statusCode).toBe(401);
      expect((await server.del(path)).statusCode).toBe(401);
      expect(await memberCount(team.id)).toBe(0);
    });
  });

  // ==========================================================================
  // Audit — the five `group.*` actions
  // ==========================================================================

  describe('audit trail', () => {
    /** Every `group.*` entry on tenant A, in the order the chain recorded it. */
    const groupEntries = () =>
      owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: { startsWith: 'group.' } },
        orderBy: { chainSeq: 'asc' },
        select: { action: true, target: true, metadata: true, actorId: true },
      });

    it('records all five actions across one team’s life', async () => {
      const team = await createGroup('Support');
      await addMember(team.id, fx.a.agentAccountId, 'primary');
      expect(
        (await server.patch(`/groups/${team.id}`, { name: 'Support EU' }, auth(rwA))).statusCode,
      ).toBe(200);
      await addMember(team.id, fx.a.agentAccountId, 'last');
      await removeMember(team.id, fx.a.agentAccountId);
      expect((await server.del(`/groups/${team.id}`, auth(rwA))).statusCode).toBe(204);

      const entries = await groupEntries();
      expect(entries.map((e) => e.action)).toEqual([
        'group.created',
        'group.member_set',
        'group.updated',
        'group.member_set',
        'group.member_removed',
        'group.deleted',
      ]);

      // Every entry names the team it is about, and every membership entry names
      // the agent and the tier — a trail saying only "membership changed" cannot
      // answer who was given sight of what.
      expect(new Set(entries.map((e) => e.target))).toEqual(new Set([`group:${team.id}`]));
      expect(entries[1]?.metadata).toMatchObject({
        agent_id: fx.a.agentAccountId,
        priority: 'primary',
      });
      expect(entries[3]?.metadata).toMatchObject({
        agent_id: fx.a.agentAccountId,
        priority: 'last',
      });
      expect(entries[4]?.metadata).toMatchObject({ agent_id: fx.a.agentAccountId });
      expect(new Set(entries.map((e) => e.actorId))).toEqual(new Set([fx.a.ownerAccountId]));
    });

    it('records nothing when the membership write is refused', async () => {
      const team = await createGroup('Support');

      expect((await setMember(team.id, fx.b.agentAccountId, {})).statusCode).toBe(404);
      expect(
        (await setMember(team.id, fx.a.agentAccountId, { priority: 'urgent' })).statusCode,
      ).toBe(400);
      expect((await removeMember(team.id, fx.a.agentAccountId)).statusCode).toBe(404);

      // Only the creation. A refusal that still writes `member_set` would put a
      // grant in the record that the database never made.
      expect((await groupEntries()).map((e) => e.action)).toEqual(['group.created']);
    });
  });

  // ==========================================================================
  // Membership decides what an agent can see
  // ==========================================================================

  describe('visibility follows the membership', () => {
    /**
     * A conversation reachable *only* through `groupId`. Written directly rather
     * than through `POST /chats` so it carries no `chat_users` row: an agent who
     * is personally in a chat keeps access whatever their teams say, which would
     * hide the effect this test is about.
     */
    async function chatVia(id: string, groupId: number): Promise<void> {
      await owner.chat.create({
        data: { id, licenseId: fx.a.licenseId, customerId: fx.a.customerId, active: true },
      });
      await owner.chatAccess.create({ data: { chatId: id, groupId: BigInt(groupId) } });
    }

    const visibleChatIds = async (token: string): Promise<string[]> => {
      const res = await server.get('/chats', auth(token));
      expect(res.statusCode).toBe(200);
      return (res.json() as ChatListBody).items.map((c) => c.id);
    };

    it('shows the team’s conversation to a member and hides it the moment they are removed', async () => {
      const team = await createGroup('Support');
      await addMember(team.id, fx.a.agentAccountId);
      await chatVia('GRPMEM0001', team.id);

      // A team-scoped token, not an admin one: `chats--access` is the scope
      // whose reach *is* the membership.
      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--access:ro'],
      });

      expect(await visibleChatIds(agentToken)).toContain('GRPMEM0001');

      await removeMember(team.id, fx.a.agentAccountId);

      // The same token, unchanged and unexpired. Access is re-read per request
      // on purpose (`services/chat/access.ts`), so a removal takes effect now
      // rather than when the credential next rotates.
      expect(await visibleChatIds(agentToken)).not.toContain('GRPMEM0001');
    });
  });
});
