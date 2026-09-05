/**
 * When a person was last active (FR-MOD-04.3.4).
 *
 * `accounts.last_seen_at` existed in the schema from the first migration and
 * nothing ever wrote it. That is worse than not having the column: the Team
 * profile panel would read it and tell an admin that every teammate had never
 * been seen, and `services/reports/access-review.ts` says in as many words that
 * it declined to use the field for exactly that reason. A column that is always
 * null is a wrong answer waiting for a reader. So it is written here — the
 * decision recorded in `#### K04.3.4` was to write it rather than drop it,
 * because the PRD acceptance criterion names "last seen" on the panel and a
 * drop would have been three releases of expand → migrate → contract
 * (CONVENTIONS §6.3) to remove a fact the product asks for.
 *
 * **Why coarsening rather than a write per request.** "Last seen" is read to the
 * minute by a human looking at a roster; writing it on every authenticated
 * request would put an `UPDATE` on the hot path of an API that a single agent's
 * open console hits several times a second — write amplification bought for
 * precision nobody can perceive. The window below is the whole trade: inside it
 * the recorder does nothing at all, not even a round-trip.
 *
 * The throttle is per process and deliberately not shared. A second API replica
 * has its own map and will write once inside the same window, which is fine —
 * the point is bounding the rate, and the coarsening predicate on the `UPDATE`
 * itself (`last_seen_at < now() - window`) means the redundant write matches no
 * row rather than moving the timestamp twice.
 *
 * Presence (`AppShell`'s avatar row, FR-MOD-01.1.4) is a different concept and
 * is not fed from here: presence is a live socket that vanishes when a tab
 * closes, this is a durable stamp that survives it. Nor is it the per-licence
 * "last sign-in" of the access-review report — `accounts` is a person, and a
 * person may work for several workspaces.
 */

/** How stale the stored stamp must be before a request rewrites it. */
export const LAST_SEEN_COARSEN_WINDOW_MS = 60_000;

/**
 * How many accounts the in-process throttle remembers before it prunes.
 *
 * The map only ever holds accounts seen inside the window, so on any real
 * workspace it stays small. The bound is here for the pathological case — a
 * token flood across many accounts — so a bookkeeping cache can never be the
 * thing that exhausts the process's memory.
 */
const MAX_TRACKED_ACCOUNTS = 10_000;

/**
 * A per-process throttle in front of the `last_seen_at` write.
 *
 * Deliberately takes the write as a callback rather than a Prisma client: the
 * caller (`plugins/auth.ts`) already holds the request's tenant context, and
 * the write must run under it so RLS applies — `accounts` is a global table
 * whose UPDATE policy is "the caller's licence shares a membership with this
 * account". Passing the client in here would either lose that context or
 * duplicate it.
 */
export class LastSeenRecorder {
  readonly #written = new Map<string, number>();
  readonly #windowMs: number;

  constructor(windowMs: number = LAST_SEEN_COARSEN_WINDOW_MS) {
    this.#windowMs = windowMs;
  }

  /**
   * Run `write` if this account has not been written inside the window.
   *
   * Returns whether the write was attempted, which is what makes the coarsening
   * testable without reaching for a clock spy: two calls in the same second
   * produce exactly one `true`.
   *
   * The account is marked *before* awaiting, so a burst of concurrent requests
   * from one agent produces one write rather than one per request. The mark is
   * rolled back if the write throws, so a transient database failure does not
   * suppress the next attempt for a whole window.
   */
  async record(
    accountId: string,
    write: (at: Date, staleBefore: Date) => Promise<unknown>,
    now: number = Date.now(),
  ): Promise<boolean> {
    const last = this.#written.get(accountId);
    if (last !== undefined && now - last < this.#windowMs) return false;

    this.#written.set(accountId, now);
    this.#prune(now);

    try {
      await write(new Date(now), new Date(now - this.#windowMs));
      return true;
    } catch (error) {
      if (this.#written.get(accountId) === now) this.#written.delete(accountId);
      throw error;
    }
  }

  /** Drop entries whose window has passed; then, if still over, the oldest. */
  #prune(now: number): void {
    if (this.#written.size <= MAX_TRACKED_ACCOUNTS) return;
    for (const [id, at] of this.#written) {
      if (now - at >= this.#windowMs) this.#written.delete(id);
    }
    // Insertion order is write order, so the head of the map is the oldest.
    for (const id of this.#written.keys()) {
      if (this.#written.size <= MAX_TRACKED_ACCOUNTS) break;
      this.#written.delete(id);
    }
  }
}
