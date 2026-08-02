/**
 * ConflictPublisher (FR-MOD-08.6.3).
 *
 * Real Postgres and real Redis on purpose: the properties under test are the
 * RLS-scoped thread read, the exact envelope the gateway will fan out, and that
 * a Redis failure never reaches the caller. A mock would only test the mock.
 * rtm's vitest config runs files serially, so sharing one database and one Redis
 * is safe.
 */
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { licenseChannel, type BusEnvelope } from '@nexa/types';
import type { Logger } from 'pino';
import {
  createConversation,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../test/helpers/fixtures.js';
import { rtmTestEnv } from '../test/helpers/rtm-harness.js';
import type { SocketPrincipal } from './auth.js';
import type { ComposingAgent } from './conflict.js';
import { ConflictPublisher } from './conflict-publisher.js';

function principalFor(tenant: RtmTenant, accountId: string): SocketPrincipal {
  return {
    kind: 'agent',
    actorId: accountId,
    licenseId: tenant.licenseId.toString(),
    organizationId: tenant.organizationId,
    scopes: [],
    groupIds: [Number(tenant.supportGroupId)],
    unrestricted: false,
  };
}

const spyLog = (): Logger =>
  ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as Logger;

describe('ConflictPublisher', () => {
  /** RLS-bypassing: seeds fixtures and reads raw state the app role could not. */
  let owner: PrismaClient;
  /** RLS-enforcing: what the publisher reads the active thread through. */
  let scoped: PrismaClient;
  /** Publishes envelopes. */
  let redis: Redis;
  /** Captures what lands on the licence channels. */
  let sub: Redis;
  let fx: RtmFixtures;

  const inbox: Array<{ channel: string; envelope: BusEnvelope }> = [];

  beforeAll(async () => {
    const env = rtmTestEnv();
    owner = ownerClient();
    scoped = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
    redis = new Redis(env.REDIS_URL);
    sub = new Redis(env.REDIS_URL);
    sub.on('pmessage', (_pattern, channel, message) => {
      try {
        inbox.push({ channel, envelope: JSON.parse(message) as BusEnvelope });
      } catch {
        /* ignore non-JSON — nothing this suite publishes is malformed */
      }
    });
    await sub.psubscribe('nexa:rtm:license:*');
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), scoped.$disconnect(), redis.quit(), sub.quit()]);
  });

  beforeEach(async () => {
    fx = await seedRtmFixtures(owner);
    inbox.length = 0;
  });

  /** Envelopes captured for a tenant's conflict warnings so far. */
  const warningsFor = (tenant: RtmTenant): BusEnvelope[] =>
    inbox
      .filter((m) => m.channel === licenseChannel(tenant.licenseId))
      .map((m) => m.envelope)
      .filter((e) => e.action === 'agent_conflict_warning');

  /** Poll until a warning for the tenant lands, or give up. */
  async function nextWarning(tenant: RtmTenant, timeoutMs = 2_000): Promise<BusEnvelope | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [first] = warningsFor(tenant);
      if (first) return first;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  }

  const settle = (ms = 250): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('publishes a warning addressed to exactly the composing agents', async () => {
    const { chatId, threadId } = await createConversation(owner, { tenant: fx.a });
    const publisher = new ConflictPublisher(scoped, redis, spyLog());
    const t1 = Date.now() - 1_000;
    const t2 = Date.now();
    const agents: ComposingAgent[] = [
      { agentId: fx.a.agentAccountId, since: t1 },
      { agentId: fx.a.ownerAccountId, since: t2 },
    ];

    await publisher.publish(principalFor(fx.a, fx.a.agentAccountId), chatId, agents);

    const envelope = await nextWarning(fx.a);
    expect(envelope).not.toBeNull();
    expect(envelope!.v).toBe(1);
    expect(envelope!.licenseId).toBe(fx.a.licenseId.toString());
    expect(envelope!.organizationId).toBe(fx.a.organizationId);
    // No origin: both composing agents must receive it, and the origin is one.
    expect(envelope!.originConnectionId).toBeUndefined();
    expect([...(envelope!.audience.agentIds ?? [])].sort()).toEqual(
      [fx.a.agentAccountId, fx.a.ownerAccountId].sort(),
    );

    const payload = envelope!.payload as {
      chat_id: string;
      thread_id: string;
      agents: Array<{ agent_id: string; since: string }>;
      detected_at: string;
    };
    expect(payload.chat_id).toBe(chatId);
    // Resolved server-side — the typing frame never carried it.
    expect(payload.thread_id).toBe(threadId);
    expect(payload.agents.map((a) => a.agent_id).sort()).toEqual(
      [fx.a.agentAccountId, fx.a.ownerAccountId].sort(),
    );
    // Numeric composing instants are rendered as ISO strings on the wire.
    expect(new Date(payload.agents[0]!.since).toISOString()).toBe(payload.agents[0]!.since);
    expect(new Date(payload.detected_at).toISOString()).toBe(payload.detected_at);
  });

  it('refuses to publish when the audience is empty', async () => {
    const { chatId } = await createConversation(owner, { tenant: fx.a });
    const log = spyLog();
    const publisher = new ConflictPublisher(scoped, redis, log);

    await publisher.publish(principalFor(fx.a, fx.a.agentAccountId), chatId, []);

    await settle();
    expect(warningsFor(fx.a)).toHaveLength(0);
    expect(log.warn).toHaveBeenCalled();
  });

  it('resolves nothing — and publishes nothing — for a chat in another licence', async () => {
    // A chat that belongs to licence A, addressed by a principal from licence B.
    const { chatId } = await createConversation(owner, { tenant: fx.a });
    const log = spyLog();
    const publisher = new ConflictPublisher(scoped, redis, log);
    const agents: ComposingAgent[] = [{ agentId: fx.b.agentAccountId, since: Date.now() }];

    // The thread read is scoped to licence B, so RLS hides A's thread entirely.
    await publisher.publish(principalFor(fx.b, fx.b.agentAccountId), chatId, agents);

    await settle();
    expect(warningsFor(fx.a)).toHaveLength(0);
    expect(warningsFor(fx.b)).toHaveLength(0);
  });

  it('never lets a Redis failure reach the caller', async () => {
    const { chatId } = await createConversation(owner, { tenant: fx.a });
    const brokenRedis = {
      publish: vi.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as Redis;
    const log = spyLog();
    const publisher = new ConflictPublisher(scoped, brokenRedis, log);
    const agents: ComposingAgent[] = [
      { agentId: fx.a.agentAccountId, since: Date.now() },
      { agentId: fx.a.ownerAccountId, since: Date.now() },
    ];

    // The thread resolves, the publish throws — and it is swallowed, not raised.
    await expect(
      publisher.publish(principalFor(fx.a, fx.a.agentAccountId), chatId, agents),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});
