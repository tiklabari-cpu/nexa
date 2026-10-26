/**
 * The tenant API's end of the root panel's command channel (tm 389.14 ·
 * FR-ADMIN-20 · design.md §A): `siyahtus:platform:ops`, Redis pub/sub.
 *
 * The platform process shares no call path with the scheduler it wants to
 * poke, so "run this job now" travels as a broadcast —
 * `{ type: 'job.run', name, request_id }` — and every tenant process whose
 * scheduler is on hears it. Exactly one acts: the first to `SET … NX` the
 * request's claim key. That is a decision of this design rather than of the
 * task text, which has only the scheduler *leader* listening: the leader is a
 * lock that is released and retaken every half minute, so "the leader" is
 * momentarily nobody, whereas a claim per request has no such gap and needs
 * no notion of who is in charge. A process that loses the claim does nothing.
 *
 * The winner runs the job through `Scheduler.runNow`, which refuses to start a
 * job that is executing (the running marker, `scheduler/lock.ts`), and leaves
 * the outcome in a Redis hash (`siyahtus:ops:job-runs`) for the panel's job
 * table. Nothing here is on a request path, and nothing here throws: a message
 * this cannot read, or a Redis that fails mid-handling, is logged and dropped.
 */
import { PLATFORM_JOB_RUN, PLATFORM_OPS_CHANNEL, parsePlatformOpsMessage } from '@siyahtus/types';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { ManualRunResult } from '../scheduler/types.js';
import {
  OPS_JOB_CLAIM_PREFIX,
  OPS_JOB_CLAIM_TTL_S,
  OPS_JOB_RUNS_KEY,
  type StoredJobRun,
} from './health-keys.js';

/** A scheduler job name: `lower_snake_case`, as `scheduler/types.ts` promises. */
export const JOB_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** The id the platform mints per request; bounded so a claim key cannot be a vector. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export interface OpsChannelOptions {
  /** A connection of its own — a subscribed client can do nothing else. */
  subscriber: Redis;
  /** The command connection: the claim and the result hash. */
  redis: {
    set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<'OK' | null>;
    hset(key: string, field: string, value: string): Promise<unknown>;
  };
  scheduler: { runNow(name: string): Promise<ManualRunResult> };
  logger: FastifyBaseLogger;
  now?: () => number;
}

export class OpsChannel {
  readonly #options: OpsChannelOptions;
  readonly #pending = new Set<Promise<unknown>>();
  #started = false;

  constructor(options: OpsChannelOptions) {
    this.#options = options;
  }

  /** Subscribe. ioredis resubscribes by itself after a reconnect. */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const { subscriber } = this.#options;
    subscriber.on('message', (channel: string, message: string) => {
      if (channel !== PLATFORM_OPS_CHANNEL) return;
      const handling = this.handle(message).finally(() => this.#pending.delete(handling));
      this.#pending.add(handling);
    });
    await subscriber.subscribe(PLATFORM_OPS_CHANNEL);
  }

  /** Wait for a run in progress, so a clean shutdown does not cut a job off. */
  async stop(): Promise<void> {
    await Promise.allSettled([...this.#pending]);
  }

  /**
   * One message. Public so a test can deliver it without a subscription.
   * Resolves to what was done: `ignored` (not a run request, unreadable, or
   * another process won the claim) or the run's own answer.
   */
  async handle(message: string): Promise<ManualRunResult | 'ignored'> {
    const { redis, scheduler, logger } = this.#options;
    try {
      const parsed = parsePlatformOpsMessage(message);
      if (parsed?.type !== PLATFORM_JOB_RUN) return 'ignored';
      const { name, request_id: requestId } = JSON.parse(message) as Record<string, unknown>;
      if (typeof name !== 'string' || !JOB_NAME_PATTERN.test(name)) return 'ignored';
      if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return 'ignored';

      const claim = await redis.set(
        `${OPS_JOB_CLAIM_PREFIX}${requestId}`,
        '1',
        'EX',
        OPS_JOB_CLAIM_TTL_S,
        'NX',
      );
      if (claim !== 'OK') return 'ignored';

      logger.info(
        { event: 'ops.job_run_requested', job: name },
        'job run requested from the panel',
      );
      const answer = await scheduler.runNow(name);
      await this.#record(name, answer);
      return answer;
    } catch (error) {
      logger.warn({ err: error }, 'a message on the platform ops channel could not be handled');
      return 'ignored';
    }
  }

  async #record(name: string, answer: ManualRunResult): Promise<void> {
    const stored: StoredJobRun = {
      at: new Date((this.#options.now ?? Date.now)()).toISOString(),
      result: answer.result,
      status: answer.result === 'finished' ? answer.status : null,
      duration_ms: answer.result === 'finished' ? answer.duration_ms : null,
      error_class: answer.result === 'finished' ? (answer.error_class ?? null) : null,
    };
    await this.#options.redis.hset(OPS_JOB_RUNS_KEY, name, JSON.stringify(stored));
  }
}
