/**
 * Teams — the write half of `/groups` (FR-MOD-04.5, Must/MVP).
 *
 * `GET /groups` shipped alone. That read as delivered and was not: routing
 * resolves an agent through `group_agents` (ADR-08 step 2), so a workspace
 * that could list teams but create none had nowhere to send a conversation.
 *
 * Two properties carry the weight here, and they are why this suite exists
 * rather than a handful of CRUD assertions:
 *
 *   - **Isolation (NFR-S5).** Team membership *is* access control — it decides
 *     which agent is offered which conversation. Another workspace's team is a
 *     404, never a 403: a 403 would confirm the id is real, and group ids are
 *     small global integers (`BIGSERIAL`), so confirming one is an enumeration
 *     oracle over every workspace on the deployment.
 *   - **The two delete refusals.** Neither `routing_rules.target_group_id` nor
 *     `chat_access.group_id` carries a foreign key, so the database will not
 *     stop a delete that strands them. A rule left pointing at a deleted team
 *     routes nothing and says nothing; a live chat reachable only through it
 *     becomes invisible to every agent at once. The endpoint's two refusals are
 *     the only thing standing there — untested, they are a comment.
 *
 * Membership writes, their priority tiers and the `group.*` audit trail are
 * M-TEAM-b's subject; this file stops where the team itself stops.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describe('teams — /groups write paths (FR-MOD-04.5)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** Tenant A, allowed to write. */
  let rwA: string;
  /** Tenant A, read-only — the scope half of the gate. */
  let roA: string;
  /** Tenant B, allowed to write *its own* teams. */
  let rwB: string;

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

  const create = (body: unknown, token = rwA) => server.post('/groups', body, auth(token));
  const patch = (id: number | bigint | string, body: unknown, token = rwA) =>
    server.patch(`/groups/${id}`, body, auth(token));
  const remove = (id: number | bigint | string, token = rwA) =>
    server.del(`/groups/${id}`, auth(token));
  const list = (token = rwA) => server.get('/groups', auth(token));

  /** A team straight from the endpoint — the shape the rest of the suite acts on. */
  async function createGroup(name: string, token = rwA): Promise<GroupBody> {
    const res = await create({ name }, token);
    expect(res.statusCode).toBe(201);
    return res.json() as GroupBody;
  }

  const groupRow = (id: number | bigint) =>
    owner.group.findFirst({ where: { id: BigInt(id) }, select: { licenseId: true, name: true } });

  // ==========================================================================
  // Create / read / update / delete
  // ==========================================================================

  describe('CRUD', () => {
    it('creates a team, in the caller’s licence, with no members yet', async () => {
      const res = await create({ name: 'Sales' });

      expect(res.statusCode).toBe(201);
      const body = res.json() as GroupBody;
      expect(body).toMatchObject({ name: 'Sales', language_code: 'en', agents: [] });
      expect(body.id).toBeGreaterThan(0);

      // The licence on the row, not just the one in the response: a create that
      // wrote someone else's team would still echo back a plausible body.
      expect(await groupRow(body.id)).toEqual({ licenseId: fx.a.licenseId, name: 'Sales' });
    });

    it('accepts a language code and trims the name', async () => {
      const res = await create({ name: '  Türkçe Destek  ', language_code: 'tr' });

      expect(res.statusCode).toBe(201);
      expect(res.json() as GroupBody).toMatchObject({
        name: 'Türkçe Destek',
        language_code: 'tr',
      });
    });

    it('accepts a region-qualified language code', async () => {
      const res = await create({ name: 'UK', language_code: 'en-GB' });
      expect(res.statusCode).toBe(201);
      expect((res.json() as GroupBody).language_code).toBe('en-GB');
    });

    it('lists what it created', async () => {
      await createGroup('Sales');
      await createGroup('Support');

      const res = await list();
      expect(res.statusCode).toBe(200);
      const { items } = res.json() as { items: GroupBody[] };
      expect(items.map((g) => g.name)).toEqual(['Sales', 'Support']);
    });

    it('renames a team', async () => {
      const group = await createGroup('Sales');

      const res = await patch(group.id, { name: 'Revenue' });
      expect(res.statusCode).toBe(200);
      expect((res.json() as GroupBody).name).toBe('Revenue');
      expect((await groupRow(group.id))?.name).toBe('Revenue');
    });

    it('changes the language on its own, leaving the name alone', async () => {
      const group = await createGroup('Sales');

      const res = await patch(group.id, { language_code: 'de' });
      expect(res.statusCode).toBe(200);
      expect(res.json() as GroupBody).toMatchObject({ name: 'Sales', language_code: 'de' });
    });

    it('deletes a team and the memberships that hung off it', async () => {
      const group = await createGroup('Sales');
      await owner.groupAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          groupId: BigInt(group.id),
          agentId: fx.a.agentAccountId,
          priority: 'normal',
        },
      });

      const res = await remove(group.id);
      expect(res.statusCode).toBe(204);

      expect(await groupRow(group.id)).toBeNull();
      // `GroupAgent.group` is `onDelete: Cascade`, so the membership goes with
      // the team — a leftover row would be an access grant to nothing.
      expect(await owner.groupAgent.count({ where: { groupId: BigInt(group.id) } })).toBe(0);
    });
  });

  // ==========================================================================
  // Input the column would reject — a 400, never a 500 from a CHECK
  // ==========================================================================

  describe('validation', () => {
    it('refuses an empty name', async () => {
      expect((await create({ name: '   ' })).statusCode).toBe(400);
    });

    it('refuses a name past the bound', async () => {
      expect((await create({ name: 'x'.repeat(121) })).statusCode).toBe(400);
    });

    it('refuses a language code `groups_language_code_check` would reject', async () => {
      // The CHECK is `^[a-z]{2}(-[A-Z]{2})?$`. Each of these is inside a bare
      // length bound and outside the constraint, so a validator that only
      // measured length would hand Postgres a 23514 — a 500 for what is a
      // client mistake.
      for (const language_code of ['english', 'EN', 'en_GB', 'e', 'en-gb']) {
        const res = await create({ name: `Team ${language_code}`, language_code });
        expect(res.statusCode, language_code).toBe(400);
        expect((res.json() as ErrorBody).error.type).toBe('validation');
      }
      expect(await owner.group.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('refuses a PATCH that changes nothing', async () => {
      const group = await createGroup('Sales');
      const res = await patch(group.id, {});

      expect(res.statusCode).toBe(400);
      expect((res.json() as ErrorBody).error.type).toBe('validation');
    });

    it('treats an id that is not a plain decimal as a team that is not there', async () => {
      // `99999999999999999999` is the one that matters here: it parses as a
      // bigint but is past `BIGSERIAL`, so an unbounded cast hands Postgres an
      // out-of-range value and the caller gets a 500 for a nonexistent team.
      for (const id of ['banana', '1.5', '-1', '0', '99999999999999999999']) {
        const res = await patch(id, { name: 'x' });
        expect(res.statusCode, id).toBe(404);
        expect((res.json() as ErrorBody).error.type, id).toBe('group_not_found');
      }
    });

    it('does not let a hex id name a real team', async () => {
      // `BigInt('0x10')` is 16, so a bare cast would have made `/groups/0x10`
      // an alias for team 16 — a second spelling for a row, past whatever the
      // console and the audit trail think they are addressing. Ids come from a
      // single sequence the fixture restarts, so the sixteenth team here *is*
      // id 16.
      let target: GroupBody | undefined;
      for (let i = 1; i <= 16; i += 1) target = await createGroup(`Team ${i}`);
      expect(target?.id).toBe(16);

      const res = await patch('0x10', { name: 'Renamed by the back door' });
      expect(res.statusCode).toBe(404);
      expect((await groupRow(16))?.name).toBe('Team 16');
    });

    it('refuses a membership path whose agent id is not a uuid', async () => {
      // Only the parse — what a membership *does* is M-TEAM-b's subject. Here
      // because the segment reaches a `uuid` column: unparsed, it comes back as
      // a `22P02` from Postgres, i.e. a 500 for a malformed URL.
      const group = await createGroup('Sales');

      const put = await server.put(`/groups/${group.id}/agents/banana`, {}, auth(rwA));
      expect(put.statusCode).toBe(400);
      expect((put.json() as ErrorBody).error.type).toBe('validation');

      const del = await server.del(`/groups/${group.id}/agents/banana`, auth(rwA));
      expect(del.statusCode).toBe(400);
    });

    it('404s an id no team in this workspace carries', async () => {
      const group = await createGroup('Sales');
      const res = await patch(Number(group.id) + 5_000, { name: 'x' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ==========================================================================
  // Scope — the write half is not implied by the read half
  // ==========================================================================

  describe('scopes', () => {
    it('refuses every write to a read-only token', async () => {
      const group = await createGroup('Sales');

      expect((await create({ name: 'Nope' }, roA)).statusCode).toBe(403);
      expect((await patch(group.id, { name: 'Nope' }, roA)).statusCode).toBe(403);
      expect((await remove(group.id, roA)).statusCode).toBe(403);

      // Refused, not half-applied.
      expect((await groupRow(group.id))?.name).toBe('Sales');
      expect(await owner.group.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    });

    it('refuses an unauthenticated write', async () => {
      expect((await server.post('/groups', { name: 'Nope' })).statusCode).toBe(401);
    });
  });

  // ==========================================================================
  // Tenant isolation (NFR-S5) — another workspace's team is absent, not forbidden
  // ==========================================================================

  describe('tenant isolation', () => {
    /** A real team belonging to tenant B, addressed by its real id. */
    async function foreignGroup(): Promise<GroupBody> {
      return createGroup('B Support', rwB);
    }

    it('404s — not 403 — when A names B’s team', async () => {
      const theirs = await foreignGroup();

      const patched = await patch(theirs.id, { name: 'Hijacked' });
      expect(patched.statusCode).toBe(404);
      expect((patched.json() as ErrorBody).error.type).toBe('group_not_found');

      const deleted = await remove(theirs.id);
      expect(deleted.statusCode).toBe(404);

      // Untouched, under its own name and licence.
      expect(await groupRow(theirs.id)).toEqual({
        licenseId: fx.b.licenseId,
        name: 'B Support',
      });
    });

    it('keeps each workspace’s list to its own teams', async () => {
      await createGroup('A Sales');
      await foreignGroup();

      const mine = list().then((r) => r.json()) as Promise<{ items: GroupBody[] }>;
      const theirs = list(rwB).then((r) => r.json()) as Promise<{ items: GroupBody[] }>;

      expect((await mine).items.map((g) => g.name)).toEqual(['A Sales']);
      expect((await theirs).items.map((g) => g.name)).toEqual(['B Support']);
    });

    it('does not let another tenant’s routing rule block a delete', async () => {
      // Group ids are a single global `BIGSERIAL`, and `target_group_id` has no
      // foreign key — so a rule in B *can* name A's group id. If the delete
      // guard queried the table unscoped, B could pin A's teams in place from
      // outside. The guard runs inside A's tenant, so B's rule is not there.
      const mine = await createGroup('Sales');
      await owner.routingRule.create({
        data: {
          licenseId: fx.b.licenseId,
          kind: 'chat',
          isFallback: true,
          targetGroupId: BigInt(mine.id),
        },
      });

      expect((await remove(mine.id)).statusCode).toBe(204);
    });
  });

  // ==========================================================================
  // Delete refusal A — a routing rule still points here
  // ==========================================================================

  describe('delete refusal: a routing rule targets the team', () => {
    async function ruleFor(groupId: number, isFallback = true): Promise<string> {
      const rule = await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          isFallback,
          targetGroupId: BigInt(groupId),
        },
        select: { id: true },
      });
      return rule.id;
    }

    it('409s with the rule that is in the way', async () => {
      const group = await createGroup('Sales');
      const ruleId = await ruleFor(group.id);

      const res = await remove(group.id);

      expect(res.statusCode).toBe(409);
      const { error } = res.json() as ErrorBody;
      expect(error.type).toBe('group_in_use');
      // The id is the point: the operator has to go and repoint *that* rule,
      // and a refusal that will not say which one is a dead end on the screen.
      expect(error.details).toMatchObject({ rule_id: ruleId, kind: 'chat', is_fallback: true });

      expect(await groupRow(group.id)).not.toBeNull();
    });

    it('names a non-fallback rule too', async () => {
      const group = await createGroup('Sales');
      const ruleId = await ruleFor(group.id, false);

      const res = await remove(group.id);
      expect(res.statusCode).toBe(409);
      expect((res.json() as ErrorBody).error.details).toMatchObject({
        rule_id: ruleId,
        is_fallback: false,
      });
    });

    it('lets the delete through once the rule points elsewhere', async () => {
      const group = await createGroup('Sales');
      const other = await createGroup('Support');
      const ruleId = await ruleFor(group.id);

      expect((await remove(group.id)).statusCode).toBe(409);

      await owner.routingRule.update({
        where: { id: ruleId },
        data: { targetGroupId: BigInt(other.id) },
      });

      expect((await remove(group.id)).statusCode).toBe(204);
      expect(await groupRow(group.id)).toBeNull();
    });

    it('lets the delete through once the rule is deleted from Settings', async () => {
      // The other half of the same interaction: repointing the rule is one way
      // out of the refusal, deleting it is the other — and the delete has to be
      // reachable through the endpoint an admin actually has, not only through
      // the database. Without this, a team whose only rule is obsolete is
      // undeletable from the product.
      const rulesToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['access_rules:rw'],
      });
      const group = await createGroup('Sales');

      const created = await server.post(
        '/settings/routing-rules',
        {
          name: 'Pricing page',
          conditions: { url_contains: ['/pricing'] },
          target_group_id: group.id,
        },
        auth(rulesToken),
      );
      expect(created.statusCode).toBe(201);
      const ruleId = (created.json() as { id: string }).id;

      expect((await remove(group.id)).statusCode).toBe(409);

      const deleted = await server.del(`/settings/routing-rules/${ruleId}`, auth(rulesToken));
      expect(deleted.statusCode).toBe(204);

      expect((await remove(group.id)).statusCode).toBe(204);
      expect(await groupRow(group.id)).toBeNull();
    });

    it('ignores a rule that targets no team at all', async () => {
      const group = await createGroup('Sales');
      await owner.routingRule.create({
        data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: null },
      });

      expect((await remove(group.id)).statusCode).toBe(204);
    });
  });

  // ==========================================================================
  // Delete refusal B — a live conversation is reachable through the team
  // ==========================================================================

  describe('delete refusal: an open chat is reachable through the team', () => {
    /** A chat in tenant A, visible through `groupId` — the shape routing writes. */
    async function chatVia(
      id: string,
      groupId: number,
      { active = true, licenseId = fx.a.licenseId, customerId = fx.a.customerId } = {},
    ): Promise<void> {
      await owner.chat.create({ data: { id, licenseId, customerId, active } });
      await owner.chatAccess.create({ data: { chatId: id, groupId: BigInt(groupId) } });
    }

    it('409s and counts the conversations that would go dark', async () => {
      const group = await createGroup('Sales');
      await chatVia('GRPDEL0001', group.id);

      const res = await remove(group.id);

      expect(res.statusCode).toBe(409);
      const { error } = res.json() as ErrorBody;
      expect(error.type).toBe('group_in_use');
      expect(error.details).toMatchObject({ active_chats: 1 });

      expect(await groupRow(group.id)).not.toBeNull();
    });

    it('counts every open chat, not just the first', async () => {
      const group = await createGroup('Sales');
      // One active chat per customer per licence (`uq_one_active_chat`), so the
      // second open conversation belongs to a second visitor.
      const second = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Customer A2' },
        select: { id: true },
      });
      await chatVia('GRPDEL0002', group.id);
      await chatVia('GRPDEL0003', group.id, { customerId: second.id });

      const res = await remove(group.id);
      expect(res.statusCode).toBe(409);
      expect((res.json() as ErrorBody).error.details).toMatchObject({ active_chats: 2 });
    });

    it('lets an archived conversation go — history is not a live grant', async () => {
      const group = await createGroup('Sales');
      await chatVia('GRPDEL0004', group.id, { active: false });

      expect((await remove(group.id)).statusCode).toBe(204);
      expect(await groupRow(group.id)).toBeNull();

      // The `chat_access` row survives on purpose: it records who could see the
      // conversation while it was open, and ids are never reused (a single
      // sequence), so it grants nobody anything.
      expect(await owner.chatAccess.count({ where: { chatId: 'GRPDEL0004' } })).toBe(1);
    });

    it('ignores a chat that reaches the team through no access row', async () => {
      const group = await createGroup('Sales');
      await owner.chat.create({
        data: { id: 'GRPDEL0005', licenseId: fx.a.licenseId, customerId: fx.a.customerId },
      });

      expect((await remove(group.id)).statusCode).toBe(204);
    });

    it('does not count another team’s open chat', async () => {
      const group = await createGroup('Sales');
      const other = await createGroup('Support');
      await chatVia('GRPDEL0006', other.id);

      expect((await remove(group.id)).statusCode).toBe(204);
    });
  });

  // ==========================================================================
  // Delete refusal C — a saved reply is scoped to the team
  // ==========================================================================

  describe('delete refusal: a saved reply is scoped to the team (FR-MOD-08.7.2)', () => {
    async function replyFor(groupId: number, shortcut = 'discount'): Promise<string> {
      const row = await owner.cannedResponse.create({
        data: {
          licenseId: fx.a.licenseId,
          shortcut,
          text: 'Team only.',
          visibility: 'group',
          groupId: BigInt(groupId),
          updatedAt: new Date(),
        },
        select: { id: true },
      });
      return row.id;
    }

    it('409s and counts the replies that would otherwise go public', async () => {
      const group = await createGroup('Sales');
      await replyFor(group.id);

      const res = await remove(group.id);

      expect(res.statusCode).toBe(409);
      const { error } = res.json() as ErrorBody;
      expect(error.type).toBe('group_in_use');
      expect(error.details).toMatchObject({ canned_responses: 1 });

      // The point of the refusal: the only legal shape for a reply with no team
      // is `visibility: 'all'`, so letting the delete through would publish this
      // team's private text to the whole workspace.
      expect(await groupRow(group.id)).not.toBeNull();
    });

    it('counts every scoped reply, not just the first', async () => {
      const group = await createGroup('Sales');
      await replyFor(group.id, 'one');
      await replyFor(group.id, 'two');

      const res = await remove(group.id);
      expect(res.statusCode).toBe(409);
      expect((res.json() as ErrorBody).error.details).toMatchObject({ canned_responses: 2 });
    });

    it('lets the delete through once the reply is workspace-wide again', async () => {
      const group = await createGroup('Sales');
      const replyId = await replyFor(group.id);

      expect((await remove(group.id)).statusCode).toBe(409);

      await owner.cannedResponse.update({
        where: { id: replyId },
        data: { visibility: 'all', groupId: null },
      });

      expect((await remove(group.id)).statusCode).toBe(204);
      expect(await groupRow(group.id)).toBeNull();
    });

    it('ignores a workspace-wide reply and another team’s', async () => {
      const group = await createGroup('Sales');
      const other = await createGroup('Support');
      await replyFor(other.id, 'theirs');
      await owner.cannedResponse.create({
        data: {
          licenseId: fx.a.licenseId,
          shortcut: 'everyone',
          text: 'Hi.',
          updatedAt: new Date(),
        },
      });

      expect((await remove(group.id)).statusCode).toBe(204);
    });
  });
});
