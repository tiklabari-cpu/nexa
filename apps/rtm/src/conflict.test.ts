/**
 * ConflictDetectionService (FR-MOD-08.6.3).
 *
 * Real Postgres and real Redis on purpose: the properties under test are RLS
 * isolation, Redis atomicity and TTL self-expiry, and a mock would only test the
 * mock. The service is built on the RLS-enforcing app role — the same one the
 * server uses — while the owner client seeds cross-tenant fixtures the app role
 * could never write. rtm's vitest config runs files serially, so sharing one
 * database is safe.
 */
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { composerStateKey } from '@nexa/types';
import {
  createConversation,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../test/helpers/fixtures.js';
import { rtmTestEnv } from '../test/helpers/rtm-harness.js';
import type { SocketPrincipal } from './auth.js';
import { ConflictDetectionService } from './conflict.js';

/** Short enough that the TTL test does not have to sleep for real seconds. */
const WINDOW_MS = 300;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function principalFor(
  tenant: RtmTenant,
  accountId: string,
  opts: { groupIds?: number[]; unrestricted?: boolean } = {},
): SocketPrincipal {
  return {
    kind: 'agent',
    actorId: accountId,
    licenseId: tenant.licenseId.toString(),
    organizationId: tenant.organizationId,
    scopes: [],
    groupIds: opts.groupIds ?? [Number(tenant.supportGroupId)],
    unrestricted: opts.unrestricted ?? false,
  };
}

describe('ConflictDetectionService', () => {
  /** RLS-bypassing: seeds the two-tenant fixture and asserts raw Redis state. */
  let owner: PrismaClient;
  /** RLS-enforcing: what the service reads through in production. */
  let scoped: PrismaClient;
  let redis: Redis;
  let service: ConflictDetectionService;
  let fx: RtmFixtures;

  beforeAll(() => {
    const env = rtmTestEnv();
    owner = ownerClient();
    scoped = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
    redis = new Redis(env.REDIS_URL);
    service = new ConflictDetectionService(scoped, redis, WINDOW_MS);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), scoped.$disconnect(), redis.quit()]);
  });

  beforeEach(async () => {
    fx = await seedRtmFixtures(owner);
    // Licence ids repeat across suites (RESTART IDENTITY), so drop any composer
    // keys a prior file left behind before a stale registration can bleed in.
    const stale = await redis.keys('nexa:composer:*');
    if (stale.length > 0) await redis.del(...stale);
  });

  const keyFor = (tenant: RtmTenant, chatId: string): string =>
    composerStateKey(tenant.licenseId.toString(), chatId);

  // --- negatives first -------------------------------------------------------

  it('does not register an agent who cannot see the chat, and reveals nothing', async () => {
    // Chat is routed to Support; the outsider belongs to Sales only.
    const { chatId } = await createConversation(owner, {
      tenant: fx.a,
      groupId: fx.a.supportGroupId,
    });
    const outsider = principalFor(fx.a, fx.a.outsiderAccountId, {
      groupIds: [Number(fx.a.salesGroupId)],
    });

    const decision = await service.record(outsider, chatId, true);

    expect(decision).toEqual({ agents: [], conflict: false });
    // Nothing written: an inaccessible chat is indistinguishable from a missing one.
    expect(await redis.zcard(keyFor(fx.a, chatId))).toBe(0);
  });

  it('keeps the same chat id in two licences completely separate', async () => {
    const { chatId } = await createConversation(owner, { tenant: fx.a });

    // The agent who can see the chat registers.
    const agentA = principalFor(fx.a, fx.a.agentAccountId);
    const a = await service.record(agentA, chatId, true);
    expect(a.agents.map((x) => x.agentId)).toEqual([fx.a.agentAccountId]);

    // A different licence supplying the exact same chat id sees nothing: RLS
    // hides a chat that is not theirs, so no registration and an empty set.
    const agentB = principalFor(fx.b, fx.b.agentAccountId);
    const b = await service.record(agentB, chatId, true);
    expect(b).toEqual({ agents: [], conflict: false });

    // The write landed only in licence A's namespace.
    expect(await redis.zcard(keyFor(fx.a, chatId))).toBe(1);
    expect(await redis.zcard(keyFor(fx.b, chatId))).toBe(0);
  });

  // --- the core property: detection survives concurrency ---------------------

  it('never loses a conflict when two agents register at the same instant', async () => {
    const { chatId } = await createConversation(owner, { tenant: fx.a });
    const agent = principalFor(fx.a, fx.a.agentAccountId); // sees via Support group
    const other = principalFor(fx.a, fx.a.ownerAccountId, { unrestricted: true });

    const [r1, r2] = await Promise.all([
      service.record(agent, chatId, true),
      service.record(other, chatId, true),
    ]);

    // With prune+add+read as one atomic script the second writer always observes
    // the first, so the conflict surfaces in at least one result. A read-then-
    // write would let both read "just me" and lose it entirely — which is the
    // whole reason this is a Lua script and not three separate calls. (Under
    // true serialisation the first writer legitimately sees only itself, so
    // asserting "both see two" would fail a correct implementation.)
    expect([r1, r2].some((r) => r.conflict && r.agents.length === 2)).toBe(true);

    // Neither registration clobbered the other: both agents are present across
    // the two observations — no lost update.
    const seen = new Set([...r1.agents, ...r2.agents].map((agentRow) => agentRow.agentId));
    expect(seen).toEqual(new Set([fx.a.agentAccountId, fx.a.ownerAccountId]));

    // And a follow-up read still holds both.
    const after = await service.record(agent, chatId, true);
    expect(after.agents.map((agentRow) => agentRow.agentId).sort()).toEqual(
      [fx.a.agentAccountId, fx.a.ownerAccountId].sort(),
    );
    expect(after.conflict).toBe(true);
  });

  it('does not report a conflict for one agent registering repeatedly', async () => {
    const { chatId } = await createConversation(owner, { tenant: fx.a });
    const agent = principalFor(fx.a, fx.a.agentAccountId);

    const first = await service.record(agent, chatId, true);
    const second = await service.record(agent, chatId, true);

    expect(first.conflict).toBe(false);
    expect(second.conflict).toBe(false);
    expect(second.agents.map((a) => a.agentId)).toEqual([fx.a.agentAccountId]);
    expect(second.agents[0]?.since).toBeGreaterThan(0);
    expect(await redis.zcard(keyFor(fx.a, chatId))).toBe(1);
  });

  // --- self-expiry and explicit withdrawal -----------------------------------

  it('drops a registration on its own once the window passes', async () => {
    const { chatId } = await createConversation(owner, { tenant: fx.a });
    const agent = principalFor(fx.a, fx.a.agentAccountId);
    const key = keyFor(fx.a, chatId);

    await service.record(agent, chatId, true);
    expect(await redis.zcard(key)).toBe(1);

    // No refresh: a socket that dropped mid-compose must not leave a phantom.
    await wait(WINDOW_MS * 2);
    expect(await redis.zcard(key)).toBe(0);

    // A second agent arriving later sees only itself — the lapsed one is gone.
    const later = principalFor(fx.a, fx.a.ownerAccountId, { unrestricted: true });
    const decision = await service.record(later, chatId, true);
    expect(decision.conflict).toBe(false);
    expect(decision.agents.map((a) => a.agentId)).toEqual([fx.a.ownerAccountId]);
  });

  it('clears just that agent when it stops composing', async () => {
    const { chatId } = await createConversation(owner, { tenant: fx.a });
    const agent = principalFor(fx.a, fx.a.agentAccountId);
    const other = principalFor(fx.a, fx.a.ownerAccountId, { unrestricted: true });
    const key = keyFor(fx.a, chatId);

    await service.record(agent, chatId, true);
    const both = await service.record(other, chatId, true);
    expect(both.conflict).toBe(true);
    expect(await redis.zcard(key)).toBe(2);

    // is_typing=false withdraws only the caller, atomically.
    const afterStop = await service.record(agent, chatId, false);
    expect(afterStop.agents.map((a) => a.agentId)).toEqual([fx.a.ownerAccountId]);
    expect(afterStop.conflict).toBe(false);
    expect(await redis.zcard(key)).toBe(1);
  });
});
