/**
 * The expired "talk like a player" sessions, deleted (tm 314.2 · SiyahTuş
 * analysis AI-19 §8): a sandbox session lives 24 hours past its last turn
 * (`AI_SANDBOX_SESSION_TTL_HOURS`, the API's `expires_at`); the routes already
 * answer 404 for one past it, and this removes the row. The scheduler's
 * `ai_sandbox_sessions` job, hourly.
 *
 * Across workspaces through the one SECURITY DEFINER function that may
 * (`ai_sandbox_sessions_purge`, migration 20261022090000), in batches, so a
 * pass after a long pause never holds one long delete.
 */
import type { PrismaClient } from '@prisma/client';

/** Sessions one statement deletes. */
export const AI_SANDBOX_PURGE_BATCH = 500;

export interface SandboxSweepReport {
  totals: { purged: number; batches: number };
}

export class SandboxSessionSweeper {
  readonly #db: PrismaClient;
  readonly #batch: number;

  constructor(db: PrismaClient, options: { batch?: number } = {}) {
    this.#db = db;
    this.#batch = options.batch ?? AI_SANDBOX_PURGE_BATCH;
  }

  async run(options: { signal?: AbortSignal } = {}): Promise<SandboxSweepReport> {
    let purged = 0;
    let batches = 0;
    for (;;) {
      if (options.signal?.aborted) break;
      const rows = await this.#db.$queryRaw<Array<{ purged: number }>>`
        SELECT ai_sandbox_sessions_purge(${this.#batch}::int) AS purged`;
      const gone = rows[0]?.purged ?? 0;
      batches += 1;
      purged += gone;
      if (gone < this.#batch) break;
    }
    return { totals: { purged, batches } };
  }
}
