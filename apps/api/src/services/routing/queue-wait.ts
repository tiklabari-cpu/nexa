/**
 * The queued visitor's estimated wait (tm 344 · SiyahTuş analysis WG-05).
 *
 * "You are number 3 in the queue" tells a player where they are, not how long
 * that is — and a player who cannot tell closes the tab and writes again,
 * which swells the queue. So the widget's queue line may say roughly how long:
 *
 *   from the same team's queue (AU-01 · `threads.queue_group_id`), the waits
 *   that ended in an assignment over the last {@link QUEUE_WAIT_WINDOW_DAYS}
 *   days (`queue_entries`, tm 291 · RP-04) — their median and 80th percentile,
 *   times the visitor's position, over the agents of the team accepting chats
 *   now; rounded to whole minutes and given as a range.
 *
 * A range and "about", never a promise (the rule the AI's replies follow too):
 * with fewer than {@link QUEUE_WAIT_MIN_SAMPLES} finished waits, or nobody of
 * the team accepting chats, there is no estimate and the widget shows the
 * position alone.
 *
 * The widget polls every few seconds. The aggregate is read at most once per
 * team per {@link QUEUE_WAIT_CACHE_SECONDS} from Redis; each poll only does
 * the multiplication for its own position.
 */
import type { Redis } from 'ioredis';
import type { TenantClient } from '../../lib/tenant.js';

/** The history the estimate looks at. */
export const QUEUE_WAIT_WINDOW_DAYS = 7;
/** Fewer finished waits than this is not enough to say anything. */
export const QUEUE_WAIT_MIN_SAMPLES = 20;
/** How long one team's aggregate is reused across polls. */
export const QUEUE_WAIT_CACHE_SECONDS = 60;

/** One team's queue, as the estimate needs it. */
export interface QueueWaitStats {
  /** Waits that ended in an assignment within the window. */
  samples: number;
  medianSeconds: number;
  p80Seconds: number;
  /** Agents of the team accepting chats now. */
  capacity: number;
}

export interface EstimatedWait {
  min_minutes: number;
  max_minutes: number;
}

/**
 * The range for a visitor at `position`, or null when there is nothing honest
 * to say. The lower end is at least a minute ("about 0 min" is a promise of
 * immediacy), the upper end never below the lower.
 */
export function estimateQueueWait(stats: QueueWaitStats, position: number): EstimatedWait | null {
  if (!Number.isInteger(position) || position < 1) return null;
  if (stats.samples < QUEUE_WAIT_MIN_SAMPLES || stats.capacity < 1) return null;
  const minutes = (seconds: number) => (seconds * position) / stats.capacity / 60;
  const min = Math.max(1, Math.round(minutes(stats.medianSeconds)));
  const max = Math.max(min, Math.round(minutes(stats.p80Seconds)));
  return { min_minutes: min, max_minutes: max };
}

/** One team's aggregate, read from the database inside the caller's transaction. */
export async function readQueueWaitStats(
  tx: TenantClient,
  licenseId: bigint,
  groupId: bigint,
): Promise<QueueWaitStats> {
  const [waits] = await tx.$queryRaw<
    Array<{ samples: number; median: number | null; p80: number | null }>
  >`
    SELECT count(*)::int AS samples,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM left_at - entered_at)::float8) AS median,
           percentile_cont(0.8) WITHIN GROUP (ORDER BY extract(epoch FROM left_at - entered_at)::float8) AS p80
      FROM queue_entries
     WHERE license_id = ${licenseId}
       AND group_id = ${groupId}
       AND outcome = 'assigned'
       AND entered_at >= now() - make_interval(days => ${QUEUE_WAIT_WINDOW_DAYS}::int)`;
  const [accepting] = await tx.$queryRaw<Array<{ capacity: number }>>`
    SELECT count(*)::int AS capacity
      FROM group_agents ga
      JOIN agent_memberships m
        ON m.license_id = ga.license_id AND m.agent_id = ga.agent_id
     WHERE ga.license_id = ${licenseId}
       AND ga.group_id = ${groupId}
       AND m.routing_status = 'accepting_chats'
       AND NOT m.suspended
       AND NOT m.awaiting_approval`;
  return {
    samples: waits?.samples ?? 0,
    medianSeconds: waits?.median ?? 0,
    p80Seconds: waits?.p80 ?? 0,
    capacity: accepting?.capacity ?? 0,
  };
}

export function queueWaitCacheKey(licenseId: bigint, groupId: bigint): string {
  return `siyahtus:queue-wait:${licenseId}:${groupId}`;
}

/**
 * The team's aggregate from the cache, else from `read` (then cached). A cache
 * that cannot be read or written is skipped, not fatal: the estimate is a
 * courtesy on a poll that must answer anyway.
 */
export async function cachedQueueWaitStats(
  redis: Pick<Redis, 'get' | 'set'>,
  licenseId: bigint,
  groupId: bigint,
  read: () => Promise<QueueWaitStats>,
): Promise<QueueWaitStats> {
  const key = queueWaitCacheKey(licenseId, groupId);
  const cached = await redis.get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as QueueWaitStats;
    } catch {
      // A value that does not parse is recomputed below and overwritten.
    }
  }
  const stats = await read();
  await redis
    .set(key, JSON.stringify(stats), 'EX', QUEUE_WAIT_CACHE_SECONDS)
    .catch(() => undefined);
  return stats;
}
