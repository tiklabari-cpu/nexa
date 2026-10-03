/**
 * The expired unverified sign-up sweep (tm 257.19 · ADR
 * docs/adr/pilot-public-readiness.md K-e(1) · PLAN §D203).
 *
 * With `SIGNUP_EMAIL_VERIFICATION` on, sign-up builds the workspace before the
 * address is proven, and an address that never answers — a bot's, a typo's —
 * leaves an empty workspace behind for good. This pass removes the ones older
 * than `UNVERIFIED_SIGNUP_TTL_HOURS`.
 *
 * All of the deciding happens in one database function,
 * `purge_unverified_signups` (migration `20261003190000_unverified_signup_purge`):
 * what counts as purgeable, the locks that keep a verification, a membership
 * or a first chat arriving at the same moment from being deleted under it, and
 * the delete itself, which crosses tenants and so runs as SECURITY DEFINER
 * rather than inside any one tenant's RLS. This module only drives it, in
 * batches, so each call is a short transaction and a backlog after a wave of
 * bot sign-ups is worked off over a few passes rather than under one long lock.
 *
 * Nothing goes to the audit trail: a purged workspace's trail is part of what
 * is deleted. The scheduler job logs the count instead — the count only.
 */
import type { PrismaClient } from '@prisma/client';

/**
 * Accounts per call to the database function: one transaction's worth.
 *
 * Kept under 64 on purpose. The function purges each account in its own
 * subtransaction, and every one that deletes keeps its transaction id until
 * the call commits; Postgres caches 64 of those per transaction, and past that
 * every other session's snapshot turns "suboverflowed" — slower visibility
 * checks across the whole database for as long as the batch runs.
 */
export const PURGE_BATCH_SIZE = 50;

/**
 * Calls per pass. A thousand an hour is far more than an honest deployment
 * signs up, and it keeps a single pass bounded however large the backlog.
 */
export const PURGE_MAX_BATCHES = 20;

export interface UnverifiedSignupSweepOptions {
  /** `UNVERIFIED_SIGNUP_TTL_HOURS`. */
  ttlHours: number;
  /** Defaults to {@link PURGE_BATCH_SIZE}; smaller only in tests. */
  batchSize?: number;
  /** Defaults to {@link PURGE_MAX_BATCHES}; smaller only in tests. */
  maxBatches?: number;
}

export interface UnverifiedSignupSweepReport {
  totals: {
    /** Accounts deleted, each with the workspace it signed up with. */
    purged: number;
    /** Calls made to `purge_unverified_signups`. */
    batches: number;
  };
}

export class UnverifiedSignupSweeper {
  readonly #db: PrismaClient;
  readonly #ttlHours: number;
  readonly #batchSize: number;
  readonly #maxBatches: number;

  constructor(db: PrismaClient, options: UnverifiedSignupSweepOptions) {
    this.#db = db;
    this.#ttlHours = options.ttlHours;
    this.#batchSize = options.batchSize ?? PURGE_BATCH_SIZE;
    this.#maxBatches = options.maxBatches ?? PURGE_MAX_BATCHES;
  }

  async run(options: { signal?: AbortSignal } = {}): Promise<UnverifiedSignupSweepReport> {
    let purged = 0;
    let batches = 0;

    while (batches < this.#maxBatches && !options.signal?.aborted) {
      const [row] = await this.#db.$queryRaw<Array<{ purged: number }>>`
        SELECT purge_unverified_signups(
                 make_interval(hours => ${this.#ttlHours}::int),
                 ${this.#batchSize}::int
               ) AS purged`;
      batches += 1;
      const count = row?.purged ?? 0;
      purged += count;
      // A short batch means the scan ran out of candidates, or that the rest
      // are in use right now — which the next pass looks at again either way.
      if (count < this.#batchSize) break;
    }

    return { totals: { purged, batches } };
  }
}
