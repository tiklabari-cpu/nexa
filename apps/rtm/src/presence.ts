/**
 * An agent's presence, read from their sockets (WG-03 · tm 340.3).
 *
 * Until this, routing status changed only when the agent changed it. An agent
 * who closed the browser on "Accepting chats" kept that status — and kept
 * being handed new conversations nobody would answer — until they came back
 * and flipped it themselves. RP-03's activity report counted the same hours as
 * "online".
 *
 * The rule: when an agent's last socket, on any gateway, closes and none opens
 * again within the tolerance (`RTM_DISCONNECT_OFFLINE_MS`, two minutes), the
 * agent goes `offline` — the membership row, a row in the presence log
 * (`agent_presence_events`, in the same transaction, as every other writer
 * does) and then a `routing_status_set` push, reason `agent_disconnected`. This
 * class is the one place that does it; the API never infers presence.
 *
 * "Last socket" is a fact about every gateway at once, so it lives in Redis:
 *
 *   - `rtm:presence:sockets:<licence>:<agent>` — the agent's open sockets, a
 *     sorted set scored by a lease expiry. The gateway holding a socket renews
 *     its lease every third of a lease. A gateway that dies stops renewing, and
 *     its sockets stop counting one lease later without anyone having to notice
 *     the death.
 *   - `rtm:presence:due` — one sorted set for the deployment, members
 *     `<licence>:<organization>:<agent>` scored by when to look at them again.
 *     A last socket closing sets "now + tolerance"; every renewal pushes it to
 *     "lease expiry + tolerance", so an agent whose sockets died with their
 *     gateway comes due as well.
 *
 * Every gateway sweeps the due set. Claiming an entry is one script — still
 * due, and no live lease — so one gateway acts on it, and a socket that opened
 * in the meantime wins (its open moved the entry into the future).
 *
 * What it does not do:
 *
 *   - restore anything. An agent who comes back is offline until they choose a
 *     status, the same as after signing in; the console says why (`presence
 *     notice`, web). Choosing for them would hand chats to a tab that is open
 *     but unattended — the case the unanswered-chat sweep exists for.
 *   - move the agent's open conversations. Those stay assigned; the API's
 *     unanswered-chat sweep (tm 340.2) passes on the ones still waiting for a
 *     first reply, and `agent_disconnected` transfers remain unused.
 *   - see bots or the widget. Only a member's socket (`kind: 'agent'`) counts:
 *     a bot has no membership, and a visitor has no routing status.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { licenseChannel, type BusEnvelope, type RoutingStatusSetPush } from '@siyahtus/types';

/** The deployment-wide set of agents to look at again, scored by when. */
export const PRESENCE_DUE_KEY = 'rtm:presence:due';

/** One agent's open sockets in one licence, scored by lease expiry. */
export function presenceSocketsKey(licenseId: string, agentId: string): string {
  return `rtm:presence:sockets:${licenseId}:${agentId}`;
}

/** Whose presence a due entry is about — the tenant context the write runs under. */
export interface PresenceTarget {
  licenseId: string;
  organizationId: string;
  agentId: string;
}

/** `<licence>:<organization>:<agent>` — a numeric id and two UUIDs, so `:` cannot occur inside one. */
export function presenceDueMember(target: PresenceTarget): string {
  return `${target.licenseId}:${target.organizationId}:${target.agentId}`;
}

function parseDueMember(member: string): PresenceTarget | null {
  const [licenseId, organizationId, agentId, ...rest] = member.split(':');
  if (!licenseId || !organizationId || !agentId || rest.length > 0) return null;
  if (!/^\d+$/.test(licenseId)) return null;
  return { licenseId, organizationId, agentId };
}

/** How a gateway paces itself around one tolerance. */
export interface PresenceTiming {
  /** No socket for this long → offline. */
  toleranceMs: number;
  /** How long one renewal keeps a socket counted; what a dead gateway costs. */
  leaseMs: number;
  /** How often this gateway renews its sockets — three chances per lease. */
  renewMs: number;
  /** How often this gateway looks for due agents: the tolerance's overshoot. */
  sweepMs: number;
}

/**
 * Derived from the tolerance alone, so a deployment tunes one number. At the
 * default two minutes: a 60 s lease renewed every 20 s, swept every 5 s — a
 * closed browser goes offline after 120–125 s, one whose gateway died within
 * 200 s. A test's sub-second tolerance scales everything down with it.
 */
export function presenceTiming(toleranceMs: number): PresenceTiming {
  const leaseMs = Math.min(60_000, Math.max(100, Math.round(toleranceMs / 2)));
  return {
    toleranceMs,
    leaseMs,
    renewMs: Math.max(30, Math.round(leaseMs / 3)),
    sweepMs: Math.min(5_000, Math.max(25, Math.round(toleranceMs / 4))),
  };
}

/**
 * KEYS[1] sockets · KEYS[2] due · ARGV: connection, lease expiry, due at, due
 * member, key ttl. Overwrites the due score rather than raising it: an open
 * cancels a pending offline that a close set earlier.
 */
const OPEN_LUA = `
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
return 1
`;

/**
 * KEYS[1] sockets · KEYS[2] due · ARGV: connection, now, due at, due member.
 * Returns how many live sockets the agent still has; at zero the agent comes
 * due at `now + tolerance`. One script, so two last sockets closing on two
 * gateways at once cannot each count the other and both leave the agent out.
 */
const CLOSE_LUA = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
local live = redis.call('ZCARD', KEYS[1])
if live == 0 then
  redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
end
return live
`;

/**
 * KEYS[1] due · KEYS[2] sockets · ARGV: due member, now. Returns -1 when the
 * entry is no longer due (another gateway took it, or a socket opened and moved
 * it on), otherwise removes it and returns the live sockets left: 0 means this
 * gateway, and only this one, sets the agent offline.
 */
const CLAIM_LUA = `
local at = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not at or tonumber(at) > tonumber(ARGV[2]) then
  return -1
end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])
return redis.call('ZCARD', KEYS[2])
`;

/** Due entries read per round; a sweep reads rounds until one comes back short. */
const SWEEP_BATCH = 100;
const MAX_SWEEP_ROUNDS = 50;

/** When a write fails (the database is down), the agent is looked at again this much later. */
const RETRY_MS = 30_000;

export class AgentPresence {
  readonly timing: PresenceTiming;
  /** This gateway's tracked sockets → whose they are. Renewal walks this. */
  readonly #sockets = new Map<string, PresenceTarget>();
  readonly #inflight = new Set<Promise<unknown>>();
  #sweeping: Promise<number> | null = null;
  #renewTimer: NodeJS.Timeout | null = null;
  #sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: PrismaClient,
    /** The command connection: scripts and the renewal pipeline. */
    private readonly redis: Redis,
    /** The publish connection — the push must not queue behind the sweep's scripts. */
    private readonly publisher: Redis,
    private readonly log: Logger,
    toleranceMs: number,
  ) {
    this.timing = presenceTiming(toleranceMs);
  }

  /** Start renewing and sweeping. Both timers never keep the process alive. */
  start(): void {
    this.#renewTimer = setInterval(() => {
      this.#track(this.renew());
    }, this.timing.renewMs);
    this.#renewTimer.unref();
    this.#sweepTimer = setInterval(() => {
      void this.sweep().catch((error: unknown) => {
        this.log.warn({ err: error }, 'presence sweep failed');
      });
    }, this.timing.sweepMs);
    this.#sweepTimer.unref();
  }

  /**
   * Stop the timers and wait for whatever is in flight — the closes the drain
   * itself just produced included — so the connections can be let go.
   */
  async stop(): Promise<void> {
    if (this.#renewTimer) clearInterval(this.#renewTimer);
    if (this.#sweepTimer) clearInterval(this.#sweepTimer);
    this.#renewTimer = null;
    this.#sweepTimer = null;
    await Promise.allSettled([...this.#inflight, this.#sweeping ?? Promise.resolve(0)]);
  }

  /**
   * A member's socket logged in. The caller has checked it is still open: a
   * socket that closed while its login was being verified must not be tracked,
   * or it would be renewed for as long as this gateway lives.
   */
  opened(connectionId: string, target: PresenceTarget): void {
    this.#sockets.set(connectionId, target);
    const now = Date.now();
    const leaseUntil = now + this.timing.leaseMs;
    this.#track(
      this.redis
        .eval(
          OPEN_LUA,
          2,
          presenceSocketsKey(target.licenseId, target.agentId),
          PRESENCE_DUE_KEY,
          connectionId,
          String(leaseUntil),
          String(leaseUntil + this.timing.toleranceMs),
          presenceDueMember(target),
          String(this.timing.leaseMs * 2),
        )
        .catch((error: unknown) => {
          // The next renewal writes the lease again; the cost of a miss is one
          // renewal interval in which this socket does not count.
          this.log.warn(
            { err: error, license_id: target.licenseId, actor_id: target.agentId },
            'presence open not recorded',
          );
        }),
    );
  }

  /** A socket closed. A no-op for one this class never tracked. */
  closed(connectionId: string): void {
    const target = this.#sockets.get(connectionId);
    if (!target) return;
    this.#sockets.delete(connectionId);
    const now = Date.now();
    this.#track(
      this.redis
        .eval(
          CLOSE_LUA,
          2,
          presenceSocketsKey(target.licenseId, target.agentId),
          PRESENCE_DUE_KEY,
          connectionId,
          String(now),
          String(now + this.timing.toleranceMs),
          presenceDueMember(target),
        )
        .catch((error: unknown) => {
          // Without the close the socket stays counted until its lease runs
          // out, and the last renewal already set the agent due after that —
          // later than it should be, never not at all.
          this.log.warn(
            { err: error, license_id: target.licenseId, actor_id: target.agentId },
            'presence close not recorded',
          );
        }),
    );
  }

  /** Renew every socket this gateway holds, and keep its agent's due entry beyond the lease. */
  async renew(): Promise<void> {
    if (this.#sockets.size === 0) return;
    const leaseUntil = Date.now() + this.timing.leaseMs;
    const pipeline = this.redis.pipeline();
    for (const [connectionId, target] of this.#sockets) {
      const key = presenceSocketsKey(target.licenseId, target.agentId);
      pipeline.zadd(key, leaseUntil, connectionId);
      pipeline.pexpire(key, this.timing.leaseMs * 2);
      pipeline.zadd(
        PRESENCE_DUE_KEY,
        'GT',
        leaseUntil + this.timing.toleranceMs,
        presenceDueMember(target),
      );
    }
    try {
      await pipeline.exec();
    } catch (error) {
      this.log.warn({ err: error, sockets: this.#sockets.size }, 'presence renewal failed');
    }
  }

  /**
   * Set every agent that is due and has no live socket offline; returns how
   * many changed. One sweep at a time per gateway — the timer skips a beat
   * rather than stacking them.
   */
  sweep(now = Date.now()): Promise<number> {
    this.#sweeping ??= this.#sweep(now).finally(() => {
      this.#sweeping = null;
    });
    return this.#sweeping;
  }

  async #sweep(now: number): Promise<number> {
    let changed = 0;
    for (let round = 0; round < MAX_SWEEP_ROUNDS; round += 1) {
      const due = await this.redis.zrangebyscore(
        PRESENCE_DUE_KEY,
        '-inf',
        now,
        'LIMIT',
        0,
        SWEEP_BATCH,
      );
      for (const member of due) {
        const target = parseDueMember(member);
        if (!target) {
          await this.redis.zrem(PRESENCE_DUE_KEY, member);
          continue;
        }
        const live = Number(
          await this.redis.eval(
            CLAIM_LUA,
            2,
            PRESENCE_DUE_KEY,
            presenceSocketsKey(target.licenseId, target.agentId),
            member,
            String(now),
          ),
        );
        // Not due any more, or still connected somewhere — a renewal re-arms it.
        if (live !== 0) continue;
        try {
          if (await this.#goOffline(target)) changed += 1;
        } catch (error) {
          // The claim already took the entry; put it back, or a database blip
          // would leave this agent "accepting chats" with nobody behind it.
          // `NX`: a socket that opened meanwhile set its own, later entry.
          this.log.error(
            { err: error, license_id: target.licenseId, actor_id: target.agentId },
            'presence offline not written; retrying',
          );
          await this.redis.zadd(PRESENCE_DUE_KEY, 'NX', now + RETRY_MS, member);
        }
      }
      if (due.length < SWEEP_BATCH) break;
    }
    return changed;
  }

  /**
   * The write, under the agent's own tenant context (RLS), with the
   * routing-status route's rule (`apps/api/src/routes/agents.ts`): the UPDATE's
   * own WHERE decides whether this is a change, and only a change is a row in
   * the presence log and a push. Any status but `offline` goes offline — an
   * agent who chose "not accepting" and then left is gone all the same.
   */
  async #goOffline(target: PresenceTarget): Promise<boolean> {
    const licenseId = BigInt(target.licenseId);
    const changed = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_license', ${target.licenseId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_organization', ${target.organizationId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_brand', '', true)`;
      const result = await tx.agentMembership.updateMany({
        where: { licenseId, agentId: target.agentId, routingStatus: { not: 'offline' } },
        data: { routingStatus: 'offline' },
      });
      if (result.count === 0) return false;
      await tx.agentPresenceEvent.create({
        data: { licenseId, agentId: target.agentId, status: 'offline' },
      });
      return true;
    });
    if (!changed) return false;

    this.log.info(
      {
        license_id: target.licenseId,
        organization_id: target.organizationId,
        actor_id: target.agentId,
        tolerance_ms: this.timing.toleranceMs,
      },
      'agent set offline: no open socket within the tolerance',
    );
    await this.#publish(target);
    return true;
  }

  /**
   * The same push the API sends for the agent's own change, to everyone in the
   * licence — the roster and the avatars fold it in. Never fails the sweep: the
   * row is written, and a console that missed the push reads the status on its
   * next profile read.
   */
  async #publish(target: PresenceTarget): Promise<void> {
    const payload: RoutingStatusSetPush = {
      agent_id: target.agentId,
      status: 'offline',
      reason: 'agent_disconnected',
      after_seconds: Math.round(this.timing.toleranceMs / 1000),
    };
    const envelope: BusEnvelope<RoutingStatusSetPush> = {
      v: 1,
      licenseId: target.licenseId,
      organizationId: target.organizationId,
      action: 'routing_status_set',
      audience: { allAgents: true },
      payload,
      at: Date.now(),
    };
    try {
      await this.publisher.publish(licenseChannel(target.licenseId), JSON.stringify(envelope));
    } catch (error) {
      this.log.error(
        { err: error, license_id: target.licenseId, actor_id: target.agentId },
        'presence push failed',
      );
    }
  }

  #track(promise: Promise<unknown>): void {
    this.#inflight.add(promise);
    const settle = (): void => {
      this.#inflight.delete(promise);
    };
    promise.then(settle, settle);
  }
}
