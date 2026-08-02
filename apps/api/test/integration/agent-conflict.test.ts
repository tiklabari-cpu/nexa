/**
 * Multi-agent conflict warning on the API transfer surface (FR-MOD-08.6.3-d).
 *
 * The RTM typing path (08.6.3-c) warns when two agents compose at once. This is
 * the other surface: a hand-off that lands a chat on a *new* agent while someone
 * else is still composing in it is the same conflict, so `transfer` reads the
 * composer registry `08.6.3-conflict-b` maintains and warns both sides.
 *
 * Attacks and quiet failures first: a warning must never reach an agent outside
 * the chat, never leak across a tenant, and never turn a committed transfer into
 * a 500 because the advisory read on top of it blinked.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { composerStateKey, licenseChannel } from '@nexa/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const ADMIN_SCOPES = ['chats--all:rw', 'tags--all:rw', 'customers:rw'];

describe('agent conflict warning — transfer surface', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;

  let adminToken: string;
  let supportGroupId: bigint;

  /** The composing agent (initial assignee) and the transfer target. */
  let composerAgent: string;
  let incomingAgent: string;

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

    // The owner composes and holds the chat first; the plain agent is who we
    // hand it off to. Both are `accepting_chats` from the fixtures, so either
    // is a valid transfer target.
    composerAgent = fx.a.ownerAccountId;
    incomingAgent = fx.a.agentAccountId;

    // A team with an accepting member so a chat can be started and a team
    // hand-off is permitted (the "no new assignee" branch).
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    supportGroupId = support.id;
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: incomingAgent,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ADMIN_SCOPES,
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** Start a chat and hand it to `composerAgent` so it has a settled assignee. */
  async function chatHeldByComposer(): Promise<string> {
    const started = await server.post('/chats', { customer_id: fx.a.customerId }, auth(adminToken));
    expect([200, 201]).toContain(started.statusCode);
    const chatId = (started.json() as { id: string }).id;

    const held = await server.post(
      `/chats/${chatId}/transfer`,
      { agent_id: composerAgent },
      auth(adminToken),
    );
    expect(held.statusCode).toBe(200);
    return chatId;
  }

  /** Mark `agentId` as composing in `chatId`'s registry, scored to now. */
  async function markComposing(
    licenseId: bigint,
    chatId: string,
    agentId: string,
  ): Promise<void> {
    await server.app.redis.zadd(composerStateKey(licenseId, chatId), Date.now(), agentId);
  }

  /** Capture the realtime envelopes published on tenant A's channel while `run` runs. */
  async function captureBus(run: () => Promise<void>): Promise<Array<Record<string, unknown>>> {
    const sub = server.app.redis.duplicate();
    const seen: Array<Record<string, unknown>> = [];
    await sub.subscribe(licenseChannel(fx.a.licenseId));
    sub.on('message', (_channel, raw) => {
      try {
        seen.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        /* not our shape — ignore */
      }
    });
    try {
      await run();
      // The publish completes before the HTTP response, but the subscriber
      // receives it a tick later.
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await sub.unsubscribe(licenseChannel(fx.a.licenseId));
      sub.disconnect();
    }
    return seen;
  }

  const warnings = (envelopes: Array<Record<string, unknown>>) =>
    envelopes.filter((e) => e['action'] === 'agent_conflict_warning');

  const audienceOf = (envelope: Record<string, unknown>) =>
    (envelope['audience'] as { agentIds?: string[] }).agentIds ?? [];

  // =========================================================================
  // Negatives first
  // =========================================================================

  it('does not warn when nobody else is composing', async () => {
    const chatId = await chatHeldByComposer();
    // No one marked composing before the hand-off.

    const envelopes = await captureBus(async () => {
      const transferred = await server.post(
        `/chats/${chatId}/transfer`,
        { agent_id: incomingAgent },
        auth(adminToken),
      );
      expect(transferred.statusCode).toBe(200);
    });

    expect(warnings(envelopes)).toHaveLength(0);
  });

  it('does not warn on a team hand-off — there is no new assignee to conflict', async () => {
    const chatId = await chatHeldByComposer();
    await markComposing(fx.a.licenseId, chatId, composerAgent);

    const envelopes = await captureBus(async () => {
      // Handing to a team unassigns the chat; the "new assignee" branch cannot
      // fire, so a composer alone in a queued chat is no conflict.
      const transferred = await server.post(
        `/chats/${chatId}/transfer`,
        { group_id: Number(supportGroupId) },
        auth(adminToken),
      );
      expect(transferred.statusCode).toBe(200);
    });

    expect(warnings(envelopes)).toHaveLength(0);
  });

  it('a failed registry read never fails the transfer', async () => {
    const chatId = await chatHeldByComposer();
    await markComposing(fx.a.licenseId, chatId, composerAgent);

    // Make the one Redis call the transfer adds — the composer read — reject.
    const original = server.app.redis.zrangebyscore.bind(server.app.redis);
    (server.app.redis as unknown as { zrangebyscore: unknown }).zrangebyscore = () =>
      Promise.reject(new Error('redis down'));

    try {
      const transferred = await server.post(
        `/chats/${chatId}/transfer`,
        { agent_id: incomingAgent },
        auth(adminToken),
      );
      // Committed and reassigned despite the read blowing up.
      expect(transferred.statusCode).toBe(200);
      const thread = await owner.thread.findFirst({
        where: { chatId, active: true },
        select: { assigneeId: true },
      });
      expect(thread?.assigneeId).toBe(incomingAgent);
    } finally {
      (server.app.redis as unknown as { zrangebyscore: unknown }).zrangebyscore = original;
    }
  });

  it('never warns an agent outside the chat or across a tenant', async () => {
    const chatId = await chatHeldByComposer();
    await markComposing(fx.a.licenseId, chatId, composerAgent);

    // An agent who registered but has no line of sight to this chat, and another
    // tenant's agent squatting the exact same chat id in its own registry.
    const outsider = 'acc_outsider_no_access';
    await markComposing(fx.a.licenseId, chatId, outsider);
    await markComposing(fx.b.licenseId, chatId, fx.b.agentAccountId);

    const envelopes = await captureBus(async () => {
      const transferred = await server.post(
        `/chats/${chatId}/transfer`,
        { agent_id: incomingAgent },
        auth(adminToken),
      );
      expect(transferred.statusCode).toBe(200);
    });

    const warning = warnings(envelopes)[0];
    expect(warning).toBeDefined();
    const audience = audienceOf(warning!);
    // Fenced to the chat's own agents: the outsider and the other tenant's agent
    // are both dropped, never told who is working which conversation.
    expect(audience).not.toContain(outsider);
    expect(audience).not.toContain(fx.b.agentAccountId);
    expect(audience).toEqual(expect.arrayContaining([composerAgent, incomingAgent]));
  });

  // =========================================================================
  // The conflict itself
  // =========================================================================

  it('warns the incoming and composing agents when a hand-off strands a reply', async () => {
    const chatId = await chatHeldByComposer();
    await markComposing(fx.a.licenseId, chatId, composerAgent);

    const before = Date.now();
    const envelopes = await captureBus(async () => {
      const transferred = await server.post(
        `/chats/${chatId}/transfer`,
        { agent_id: incomingAgent },
        auth(adminToken),
      );
      expect(transferred.statusCode).toBe(200);
    });

    const conflict = warnings(envelopes);
    expect(conflict).toHaveLength(1);

    const warning = conflict[0]!;
    // Both the agent handed the chat and the one still composing hear about it.
    expect(audienceOf(warning)).toEqual(
      expect.arrayContaining([composerAgent, incomingAgent]),
    );

    const payload = warning['payload'] as {
      chat_id: string;
      thread_id: string;
      agents: Array<{ agent_id: string; since: string }>;
      detected_at: string;
    };
    expect(payload.chat_id).toBe(chatId);
    expect(payload.thread_id).toBeTruthy();
    expect(payload.agents.map((a) => a.agent_id)).toContain(composerAgent);
    // Timestamps ride the wire as ISO strings, matching the RTM publisher (-c).
    expect(new Date(payload.detected_at).getTime()).toBeGreaterThanOrEqual(before);
    for (const agent of payload.agents) {
      expect(Number.isNaN(new Date(agent.since).getTime())).toBe(false);
    }
  });
});
