/**
 * How many sockets one client address may hold before they log in (tm 405).
 *
 * The gateway's only other limit on arrivals is `RTM_MAX_CONNECTIONS`, and that
 * one is global. A socket is let in before it says who it is — it has the
 * login window (`RTM_LIMITS.loginTimeoutMs`, 30 s) to do so — so a single
 * source that opens sockets and never logs in held every one of them for that
 * long, and enough of them filled the ceiling for everybody. This bounds what
 * one address can hold that way. It does not bound what one address holds once
 * logged in: those sockets carry a credential, and what they may do is decided
 * by it.
 *
 * Counted per socket, by connection id, so the count cannot leak:
 *
 *   - {@link PreLoginLimiter.hold} when the handshake completes;
 *   - {@link PreLoginLimiter.release} when the socket logs in, and again when it
 *     closes. Release is idempotent, so a socket that logs in and later closes
 *     — or closes while its login is still being checked — is released once.
 *
 * An address's entry is deleted the moment its count reaches zero, so the map
 * holds only addresses that have a socket waiting right now, and its size is
 * bounded by the number of such sockets.
 *
 * The address is whatever `client-address.ts` derived; this class neither reads
 * nor interprets it.
 */

interface AddressState {
  /** Sockets from this address that have not logged in yet. */
  held: number;
  /** Whether this episode at the limit has been logged already — see {@link PreLoginLimiter.refuse}. */
  refusing: boolean;
}

export class PreLoginLimiter {
  readonly #byAddress = new Map<string, AddressState>();
  /** connection id → the address it was counted against. */
  readonly #held = new Map<string, string>();

  /** At least 1 — a limit of 0 is "off" in the environment and never reaches here. */
  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`pre-login limit must be a positive integer, got ${limit}`);
    }
  }

  /** Whether one more socket from `address` may be let in before it logs in. */
  admits(address: string): boolean {
    return (this.#byAddress.get(address)?.held ?? 0) < this.limit;
  }

  /**
   * Record a refusal for `address`. True the first time in an episode — the
   * caller logs then, and only then.
   *
   * An episode lasts until the address has no waiting socket at all. Under a
   * source that keeps reconnecting, every slot it frees is taken again at once,
   * so a line per refusal — or per slot freed — would be heaviest exactly when
   * the process has the least room; one line per episode says what an operator
   * needs: which address, and that it started.
   */
  refuse(address: string): boolean {
    const state = this.#byAddress.get(address);
    if (!state || state.refusing) return false;
    state.refusing = true;
    return true;
  }

  /** Count `connectionId` against `address`. Holding the same id twice is a no-op. */
  hold(connectionId: string, address: string): void {
    if (this.#held.has(connectionId)) return;
    this.#held.set(connectionId, address);
    const state = this.#byAddress.get(address);
    if (state) state.held += 1;
    else this.#byAddress.set(address, { held: 1, refusing: false });
  }

  /** Stop counting `connectionId`. Unknown or already released ids are ignored. */
  release(connectionId: string): void {
    const address = this.#held.get(connectionId);
    if (address === undefined) return;
    this.#held.delete(connectionId);
    const state = this.#byAddress.get(address);
    if (!state) return;
    state.held -= 1;
    if (state.held <= 0) this.#byAddress.delete(address);
  }

  /** Sockets from `address` waiting to log in. */
  heldBy(address: string): number {
    return this.#byAddress.get(address)?.held ?? 0;
  }

  /** Sockets waiting to log in, across every address. */
  get size(): number {
    return this.#held.size;
  }

  /** Addresses with at least one socket waiting — what the map actually holds. */
  get addresses(): number {
    return this.#byAddress.size;
  }
}
