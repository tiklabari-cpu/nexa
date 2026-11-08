/**
 * How many logged-in visitor sockets one visitor, and one client network, may
 * hold (tm 427).
 *
 * The pre-login cap (`prelogin-limit.ts`, tm 405) releases a socket the moment
 * it logs in, which is right for what it bounds — sockets that have said nothing
 * — and left everything after the login unbounded. A visitor token is minted
 * for anyone who loads a page that carries the widget, and it is stateless: one
 * token could open fifty sockets a second from one address and each of them
 * stayed, short only of the global `RTM_MAX_CONNECTIONS`, which they then filled
 * for everybody.
 *
 * Two counts, both of visitor sockets only — a member's or a bot's socket
 * carries a credential somebody in the workspace issued, and is not counted:
 *
 *   - **per visitor** (`RTM_MAX_SOCKETS_PER_CUSTOMER`): one person's tabs. The
 *     widget opens one socket per tab, so this is how many tabs of one visitor
 *     are live at once; a tab past it stays on the widget's polling path, which
 *     is how every visitor was served before the socket existed;
 *   - **per client network** (`RTM_MAX_CUSTOMER_SOCKETS_PER_IP`): an IPv4
 *     address or an IPv6 /64, as the pre-login cap counts it — so minting a new
 *     visitor for every socket does not get past the first count.
 *
 * Counted per socket, by connection id, so the count cannot leak:
 *
 *   - {@link CustomerSocketLimiter.admit} when a visitor's login is accepted —
 *     check and count in one synchronous step, so two logins cannot both take
 *     the last slot;
 *   - {@link CustomerSocketLimiter.release} when the socket closes. Idempotent,
 *     and a socket that was never admitted is ignored. The caller admits only a
 *     socket still in the registry: one that closed while its token was being
 *     checked has run its close handler already, and counting it afterwards
 *     would hold its slot for as long as the process lives.
 *
 * A key's entry is deleted when its count reaches zero, so the maps hold only
 * keys with a socket open right now.
 */

/** Which count was full: the visitor's own, or its client network's. */
export type CustomerSocketLimitKind = 'customer' | 'network';

interface KeyState {
  /** Logged-in visitor sockets counted against this key. */
  held: number;
  /** Whether this episode at the limit has been logged — see {@link CustomerSocketLimiter.refuse}. */
  refusing: boolean;
}

export class CustomerSocketLimiter {
  readonly #byCustomer = new Map<string, KeyState>();
  readonly #byNetwork = new Map<string, KeyState>();
  /** connection id → the keys it was counted against (null where that count is off). */
  readonly #held = new Map<string, { customer: string | null; network: string | null }>();

  /**
   * Each limit is a positive integer or `null` for off — `0` is "off" in the
   * environment and never reaches here. At least one of them is on: with both
   * off the gateway builds no limiter.
   */
  constructor(
    readonly perCustomer: number | null,
    readonly perNetwork: number | null,
  ) {
    for (const limit of [perCustomer, perNetwork]) {
      if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
        throw new Error(`visitor socket limits must be positive integers, got ${limit}`);
      }
    }
    if (perCustomer === null && perNetwork === null) {
      throw new Error('a visitor socket limiter needs at least one limit');
    }
  }

  /**
   * Count `connectionId` for `customer` and `network` if both have room, and
   * return null; otherwise count nothing and return which one is full. A null
   * `network` (no address could be derived) is counted per visitor only.
   * Admitting the same id twice is a no-op.
   */
  admit(
    connectionId: string,
    customer: string,
    network: string | null,
  ): CustomerSocketLimitKind | null {
    if (this.#held.has(connectionId)) return null;
    const customerKey = this.perCustomer === null ? null : customer;
    const networkKey = this.perNetwork === null ? null : network;
    if (customerKey !== null && this.heldByCustomer(customerKey) >= this.perCustomer!) {
      return 'customer';
    }
    if (networkKey !== null && this.heldByNetwork(networkKey) >= this.perNetwork!) {
      return 'network';
    }
    this.#held.set(connectionId, { customer: customerKey, network: networkKey });
    if (customerKey !== null) increment(this.#byCustomer, customerKey);
    if (networkKey !== null) increment(this.#byNetwork, networkKey);
    return null;
  }

  /**
   * Record a refusal against the full key. True the first time in an episode —
   * the caller logs then, and only then; an episode lasts until the key has no
   * socket counted at all. A source that keeps reconnecting is refused on every
   * attempt, and a line per attempt would be heaviest exactly when the process
   * has the least room; `rtm.connections.closed` counts every one of them.
   */
  refuse(kind: CustomerSocketLimitKind, key: string): boolean {
    const state = (kind === 'customer' ? this.#byCustomer : this.#byNetwork).get(key);
    if (!state || state.refusing) return false;
    state.refusing = true;
    return true;
  }

  /** Stop counting `connectionId`. Unknown or already released ids are ignored. */
  release(connectionId: string): void {
    const keys = this.#held.get(connectionId);
    if (!keys) return;
    this.#held.delete(connectionId);
    if (keys.customer !== null) decrement(this.#byCustomer, keys.customer);
    if (keys.network !== null) decrement(this.#byNetwork, keys.network);
  }

  /** Logged-in sockets counted for one visitor. */
  heldByCustomer(customer: string): number {
    return this.#byCustomer.get(customer)?.held ?? 0;
  }

  /** Logged-in visitor sockets counted for one client network. */
  heldByNetwork(network: string): number {
    return this.#byNetwork.get(network)?.held ?? 0;
  }

  /** Visitor sockets counted, across every key. */
  get size(): number {
    return this.#held.size;
  }

  /** Visitors and networks with at least one socket counted — what the maps actually hold. */
  get keys(): { customers: number; networks: number } {
    return { customers: this.#byCustomer.size, networks: this.#byNetwork.size };
  }
}

function increment(map: Map<string, KeyState>, key: string): void {
  const state = map.get(key);
  if (state) state.held += 1;
  else map.set(key, { held: 1, refusing: false });
}

function decrement(map: Map<string, KeyState>, key: string): void {
  const state = map.get(key);
  if (!state) return;
  state.held -= 1;
  if (state.held <= 0) map.delete(key);
}
