/**
 * Supervision register/release (FR-MOD-13.2 · NFR-S4/S5).
 *
 * Negative first, and deliberately so: what this endpoint pair can get wrong is
 * not "it returned 500" but the quiet failures — a supervisor planted on another
 * workspace's conversation, an agent learning that a chat id is real because the
 * refusal said 403 instead of 404, an agent watching a team's work they were
 * never given, or one supervisor clearing another's row.
 *
 * The trap 13.2-c documented is the reason the cross-tenant cases assert on the
 * *table* and not only on the status code: the three foreign keys are checked by
 * the table owner, which is exempt from RLS, so referential integrity alone
 * would accept a foreign `chat_id` as long as `license_id` matched the caller's.
 * A test that only read the response body would pass while a row quietly existed.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { withTenant } from '../../src/lib/tenant.js';
import {
  SupervisionService,
  SUPERVISION_LIVE_WINDOW_SECONDS,
} from '../../src/services/traffic/supervision-service.js';

/** Read scopes only — watching is a read, and that is the property under test. */
const WATCHER_SCOPES = ['chats--access:ro'];
const ADMIN_SCOPES = ['chats--all:rw', 'customers:rw'];

interface Supervision {
  chat_id: string;
  agent_id: string;
  started_at: string;
  last_seen_at: string;
}

describe('chat supervision', () => {
  let server: TestServer;
  let owner: PrismaClient;
  /**
   * The runtime role, `nexa_app`. Isolation has to be attacked from the layer
   * the API actually uses: `owner` owns these tables and Postgres exempts owners
   * from RLS, so a cross-tenant read through it proves nothing.
   */
  let app: PrismaClient;
  let fx: Fixtures;

  /** Tenant A: an admin (`chats--all`), a Support agent (`chats--access`). */
  let adminToken: string;
  let agentToken: string;
  /** Tenant B, for the cross-tenant probes. */
  let otherToken: string;
  let supportGroupId: bigint;
  let salesGroupId: bigint;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const appUrl = process.env['DATABASE_APP_URL'];
    if (!appUrl) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: appUrl });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    // Two teams, so "a scoped agent cannot watch another team's chat" is
    // actually expressible rather than vacuously true.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    const sales = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Sales' },
      select: { id: true },
    });
    supportGroupId = support.id;
    salesGroupId = sales.id;

    // The regular agent is in Support only.
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ADMIN_SCOPES,
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: WATCHER_SCOPES,
    });
    otherToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ADMIN_SCOPES,
    });
  });

  /**
   * A chat belonging to `tenant`, reachable through `groupId` when given.
   *
   * Written directly rather than through `POST /chats` so the conversation
   * carries no chat_users row for anybody: an agent must reach it through their
   * team or not at all, which is the access rule this file is about.
   */
  let seq = 0;
  async function seedChat(tenant: TenantFixture, groupId?: bigint): Promise<string> {
    seq += 1;
    // Ten Crockford base32 symbols, because the route validates the shape
    // before it looks anything up — a placeholder id would be a 400 and would
    // never reach the access rules these tests are about.
    const suffix = String(seq).padStart(6, '0');
    const chatId = `CHAT${suffix}`;
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: tenant.licenseId,
        customerId: tenant.customerId,
        active: true,
      },
    });
    await owner.thread.create({
      data: { id: `THRD${suffix}`, chatId, licenseId: tenant.licenseId },
    });
    if (groupId !== undefined) await owner.chatAccess.create({ data: { chatId, groupId } });
    return chatId;
  }

  const rowsFor = (chatId: string) =>
    owner.chatSupervision.findMany({ where: { chatId }, orderBy: { agentId: 'asc' } });

  const supervise = (chatId: string, token: string) =>
    server.post(`/chats/${chatId}/supervise`, undefined, auth(token));
  const release = (chatId: string, token: string) =>
    server.del(`/chats/${chatId}/supervise`, auth(token));

  // =========================================================================
  // Scope — a read scope is required, and is enough
  // =========================================================================

  describe('scope', () => {
    it('refuses a token carrying no chat scope at all', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      const scopeless = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['customers:ro'],
      });

      const response = await supervise(chatId, scopeless);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.type).toBe('authorization');
      expect(await rowsFor(chatId)).toHaveLength(0);
    });

    it('refuses a scopeless token on release too', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      expect((await supervise(chatId, agentToken)).statusCode).toBe(200);

      const scopeless = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['customers:ro'],
      });

      expect((await release(chatId, scopeless)).statusCode).toBe(403);
      // The refusal is not a quiet success: the watch is still standing.
      expect(await rowsFor(chatId)).toHaveLength(1);
    });

    it('accepts a read-only scope — watching writes nothing the agent owns', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      // `chats--access:ro` and nothing else. If this ever starts failing, the
      // endpoint has grown a write-scope requirement and the Supervise button
      // (rowActions.ts, which offers itself on a read scope) now lies.
      expect((await supervise(chatId, agentToken)).statusCode).toBe(200);
    });

    it('lets a chats--all token watch a chat no team of theirs reaches', async () => {
      // The admin is in no group; `chats--all` is what carries them.
      const chatId = await seedChat(fx.a, salesGroupId);
      expect((await supervise(chatId, adminToken)).statusCode).toBe(200);
    });
  });

  // =========================================================================
  // Tenant boundary — 404, never 403 (NFR-S5)
  // =========================================================================

  describe('tenant isolation', () => {
    it("answers 404, not 403, for another workspace's chat id", async () => {
      const chatId = await seedChat(fx.a, supportGroupId);

      const response = await supervise(chatId, otherToken);
      expect(response.statusCode).toBe(404);
      // The distinction is the whole point: 403 would confirm the id is real
      // and turn short ids into an enumeration oracle.
      expect(response.json().error.type).toBe('not_found');
    });

    it("writes no row for another workspace's chat id", async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      await supervise(chatId, otherToken);

      // Asserted against the owner connection, which is exempt from RLS — a
      // policy-invisible row would still show up here. This is the case the
      // owner-enforced foreign keys would otherwise have allowed.
      expect(await rowsFor(chatId)).toHaveLength(0);
    });

    it("cannot release another workspace's supervision", async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      expect((await supervise(chatId, agentToken)).statusCode).toBe(200);

      const response = await release(chatId, otherToken);
      expect(response.statusCode).toBe(404);
      expect(await rowsFor(chatId)).toHaveLength(1);
    });
  });

  // =========================================================================
  // Team access — an agent may watch exactly what they may open
  // =========================================================================

  describe('team access', () => {
    it('refuses a chat routed to a team the agent is not in', async () => {
      const chatId = await seedChat(fx.a, salesGroupId);

      const response = await supervise(chatId, agentToken);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.type).toBe('not_found');
      expect(await rowsFor(chatId)).toHaveLength(0);
    });

    it('refuses a chat routed to no team at all', async () => {
      const chatId = await seedChat(fx.a);

      expect((await supervise(chatId, agentToken)).statusCode).toBe(404);
      expect(await rowsFor(chatId)).toHaveLength(0);
    });

    it('reflects a team removal immediately', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      expect((await supervise(chatId, agentToken)).statusCode).toBe(200);

      await owner.groupAgent.deleteMany({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      });

      // Memberships are read per request, not baked into the token, so losing
      // the team stops the heartbeat now rather than at the next rotation.
      expect((await supervise(chatId, agentToken)).statusCode).toBe(404);
    });

    it('refuses an unknown chat id with the same 404', async () => {
      // Well-formed and nonexistent: the answer must not differ from the
      // well-formed-but-someone-else's case above.
      const response = await supervise('ZZZZZZZZZZ', agentToken);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.type).toBe('not_found');
    });

    it('rejects a malformed chat id as a validation error', async () => {
      const response = await supervise('not-a-chat-id!', agentToken);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.type).toBe('validation');
    });
  });

  // =========================================================================
  // Principal kind — a watcher is a person
  // =========================================================================

  describe('principal kind', () => {
    it('turns a bot token away', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      const bot = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Bot', kind: 'ai_agent', active: true },
        select: { id: true },
      });
      const botToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: bot.id,
        scopes: ['chats--all:rw'],
        kind: 'bot',
      });

      // 404 (the principal-kind gate), not a foreign-key explosion: `agent_id`
      // references `accounts`, where a bot has no row.
      const response = await supervise(chatId, botToken);
      expect(response.statusCode).toBe(404);
      expect(await rowsFor(chatId)).toHaveLength(0);
    });

    it('turns a customer token away', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      const minted = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, customer_id: fx.a.customerId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      expect(minted.statusCode).toBe(200);

      const response = await supervise(chatId, (minted.json() as { token: string }).token);
      expect(response.statusCode).toBe(404);
      expect(await rowsFor(chatId)).toHaveLength(0);
    });
  });

  // =========================================================================
  // Register / release
  // =========================================================================

  describe('register', () => {
    it('returns the watch it recorded', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);

      const response = await supervise(chatId, agentToken);
      expect(response.statusCode).toBe(200);
      const body = response.json() as Supervision;
      expect(body).toMatchObject({ chat_id: chatId, agent_id: fx.a.agentAccountId });
      expect(Date.parse(body.started_at)).not.toBeNaN();
      expect(Date.parse(body.last_seen_at)).not.toBeNaN();

      const rows = await rowsFor(chatId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.licenseId).toBe(fx.a.licenseId);
    });

    it('is idempotent — a second call refreshes one row rather than adding another', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      const first = (await supervise(chatId, agentToken)).json() as Supervision;

      // Back-date the heartbeat so the refresh is unambiguously observable
      // without making the test wait a real second.
      await owner.chatSupervision.update({
        where: { chatId_agentId: { chatId, agentId: fx.a.agentAccountId } },
        data: { lastSeenAt: new Date(Date.now() - 60_000) },
      });

      const second = (await supervise(chatId, agentToken)).json() as Supervision;
      expect(await rowsFor(chatId)).toHaveLength(1);
      expect(Date.parse(second.last_seen_at)).toBeGreaterThan(Date.parse(first.last_seen_at) - 1);
      expect(Date.parse(second.last_seen_at)).toBeGreaterThan(Date.now() - 60_000);
      // `started_at` is "since when", so it survives every heartbeat.
      expect(second.started_at).toBe(first.started_at);
    });

    it('records two rows when two agents watch one chat', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);

      expect((await supervise(chatId, agentToken)).statusCode).toBe(200);
      expect((await supervise(chatId, adminToken)).statusCode).toBe(200);

      const watchers = (await rowsFor(chatId)).map((row) => row.agentId).sort();
      expect(watchers).toEqual([fx.a.agentAccountId, fx.a.ownerAccountId].sort());
    });

    it('changes nothing about the conversation — supervising is not assignment', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      const before = await owner.thread.findFirst({ where: { chatId } });

      expect((await supervise(chatId, agentToken)).statusCode).toBe(200);

      const after = await owner.thread.findFirst({ where: { chatId } });
      expect(after?.assigneeId).toBe(before?.assigneeId ?? null);
      expect(after?.assigneeId ?? null).toBeNull();
      expect(after?.queuePosition ?? null).toBe(before?.queuePosition ?? null);
      // Nor does it enrol the supervisor as a participant.
      expect(await owner.chatUser.count({ where: { chatId } })).toBe(0);
    });
  });

  describe('release', () => {
    it('removes only the caller’s own row', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      await supervise(chatId, agentToken);
      await supervise(chatId, adminToken);

      expect((await release(chatId, agentToken)).statusCode).toBe(204);

      // The other supervisor is untouched. There is no request shape that
      // names someone else's row — the agent id comes from the principal.
      const remaining = await rowsFor(chatId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.agentId).toBe(fx.a.ownerAccountId);
    });

    it('succeeds when the caller was not watching', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      await supervise(chatId, adminToken);

      // Stopping something already stopped is not an error — otherwise an
      // idempotent client retry reads as a failure.
      expect((await release(chatId, agentToken)).statusCode).toBe(204);
      expect(await rowsFor(chatId)).toHaveLength(1);
    });

    it('refuses to release a chat the caller may not see', async () => {
      const chatId = await seedChat(fx.a, salesGroupId);
      await supervise(chatId, adminToken);

      expect((await release(chatId, agentToken)).statusCode).toBe(404);
      expect(await rowsFor(chatId)).toHaveLength(1);
    });
  });

  // =========================================================================
  // Liveness — a stale heartbeat is a closed tab, not a watcher
  // =========================================================================

  describe('liveness', () => {
    const supervisions = new SupervisionService();

    /**
     * The read side (13.2-e's input), run as the runtime role under the tenant
     * session — so the isolation case below rests on the policy rather than on
     * the service's own WHERE clause.
     */
    const liveByChat = (tenant: TenantFixture, chatIds: string[]) =>
      withTenant(app, { licenseId: tenant.licenseId, organizationId: tenant.organizationId }, (tx) =>
        supervisions.liveByChat(tx, tenant.licenseId, chatIds),
      );

    it('counts a fresh heartbeat as live', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      await supervise(chatId, agentToken);

      expect((await liveByChat(fx.a, [chatId])).get(chatId)).toEqual([fx.a.agentAccountId]);
    });

    it('drops a row whose heartbeat fell outside the window', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      await supervise(chatId, agentToken);

      await owner.chatSupervision.update({
        where: { chatId_agentId: { chatId, agentId: fx.a.agentAccountId } },
        data: { lastSeenAt: new Date(Date.now() - (SUPERVISION_LIVE_WINDOW_SECONDS + 30) * 1000) },
      });

      // The row still exists — it is the *time*, not the deletion, that ends a
      // watch nobody released.
      expect(await rowsFor(chatId)).toHaveLength(1);
      expect((await liveByChat(fx.a, [chatId])).has(chatId)).toBe(false);
    });

    it('keeps a row still inside the window', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      await supervise(chatId, agentToken);

      await owner.chatSupervision.update({
        where: { chatId_agentId: { chatId, agentId: fx.a.agentAccountId } },
        data: { lastSeenAt: new Date(Date.now() - (SUPERVISION_LIVE_WINDOW_SECONDS - 30) * 1000) },
      });

      expect((await liveByChat(fx.a, [chatId])).get(chatId)).toEqual([fx.a.agentAccountId]);
    });

    it('reports both watchers of one chat', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      await supervise(chatId, agentToken);
      await supervise(chatId, adminToken);

      const watchers = (await liveByChat(fx.a, [chatId])).get(chatId) ?? [];
      expect([...watchers].sort()).toEqual([fx.a.agentAccountId, fx.a.ownerAccountId].sort());
    });

    it("never reports another workspace's watchers", async () => {
      const mine = await seedChat(fx.a, supportGroupId);
      await supervise(mine, agentToken);

      const theirs = await seedChat(fx.b);
      await owner.chatSupervision.create({
        data: { chatId: theirs, agentId: fx.b.agentAccountId, licenseId: fx.b.licenseId },
      });

      // Asked for both ids from tenant A's session; only A's may come back.
      const live = await liveByChat(fx.a, [mine, theirs]);
      expect(live.get(mine)).toEqual([fx.a.agentAccountId]);
      expect(live.has(theirs)).toBe(false);

      // Two independent reasons that row stayed out — the service's licence
      // filter above, and the policy underneath it. Asked here without any
      // WHERE clause at all, as the runtime role in tenant A's session, so it
      // is RLS answering and not something a caller could forget to write.
      const everythingASees = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => tx.chatSupervision.findMany(),
      );
      expect(everythingASees.map((row) => row.chatId)).toEqual([mine]);
    });

    it('is empty for a chat nobody watches', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      expect((await liveByChat(fx.a, [chatId])).size).toBe(0);
      expect((await liveByChat(fx.a, [])).size).toBe(0);
    });

    it('forgets a released watch', async () => {
      const chatId = await seedChat(fx.a, supportGroupId);
      await supervise(chatId, agentToken);
      expect((await release(chatId, agentToken)).statusCode).toBe(204);

      expect((await liveByChat(fx.a, [chatId])).has(chatId)).toBe(false);
    });
  });
});
