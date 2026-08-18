/**
 * Whether this phone can reach the server at all — one signal, derived from
 * what the app was already doing.
 *
 * The app had two half-answers and no whole one. `ConnectionBanner` knew what
 * the *socket* was doing, which says nothing about a REST call that just failed
 * on a train; `ChatListScreen` turned a failed load into a line of red text
 * inside the empty list, which an agent reads as "this screen is broken" rather
 * than "you have no bars". Between them an agent could be offline for ten
 * minutes and see nothing that said so.
 *
 * **No NetInfo.** The obvious implementation subscribes to
 * `@react-native-community/netinfo`, and it was deliberately not used: it is a
 * native module, which means an `expo export` risk and an Expo Go risk for a
 * fact this app can already observe. A radio the OS calls "connected" and a
 * server this app cannot reach are not the same claim anyway — a captive portal
 * satisfies the first and fails the second — and it is the second that decides
 * whether the inbox on screen is still true.
 *
 * So the evidence is the traffic itself:
 *
 *   - a REST call that failed to reach anything (`ApiClientError.type ===
 *     'network'`, from `api/client.ts`) is the only thing that declares offline;
 *   - any answer at all — a REST response, or the RTM socket reaching `live`
 *     — clears it, which is what gets the band back down without polling.
 *
 * Kept as a module-level store read through `useSyncExternalStore` rather than
 * React context, for the reason `features/copilot/copilotDraft.ts` gives: the
 * writers are outside React (a fetch rejection, a socket callback) and the
 * readers are two screens, so a provider would only add a tree to thread it
 * through.
 */
import { useSyncExternalStore } from 'react';

export interface ConnectivitySnapshot {
  /** False only after a request actually failed to reach anything. */
  online: boolean;
  /**
   * Epoch milliseconds of the last time the server answered, or null if it
   * never has in this process. Frozen at the moment the app went offline —
   * that is exactly the "…as of when?" the band has to answer.
   */
  lastReachableAt: number | null;
}

type Listener = () => void;

const ONLINE_UNKNOWN: ConnectivitySnapshot = { online: true, lastReachableAt: null };

export class ConnectivityStore {
  /**
   * Starts online. A phone that has not tried anything yet is not offline, and
   * opening the app under a band that says otherwise would be a guess presented
   * as a measurement.
   */
  #snapshot: ConnectivitySnapshot = ONLINE_UNKNOWN;
  #lastReachableAt: number | null = null;
  readonly #listeners = new Set<Listener>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Referentially stable between changes, as `useSyncExternalStore` requires:
   * a new object per call would re-render every reader on every render.
   */
  getSnapshot = (): ConnectivitySnapshot => this.#snapshot;

  /**
   * The server answered. Cheap on purpose — this runs after *every* successful
   * request, and while already online it only moves a number nobody is
   * rendering, so no listener is woken.
   */
  reportReachable(): void {
    this.#lastReachableAt = this.#now();
    if (this.#snapshot.online) return;
    this.#set({ online: true, lastReachableAt: this.#lastReachableAt });
  }

  /** A request could not reach anything: no radio, no DNS, no route. */
  reportUnreachable(): void {
    if (!this.#snapshot.online) return;
    this.#set({ online: false, lastReachableAt: this.#lastReachableAt });
  }

  /** Back to "nothing has been observed" — for tests, and for a sign-out. */
  reset(): void {
    this.#lastReachableAt = null;
    this.#set(ONLINE_UNKNOWN);
  }

  #set(next: ConnectivitySnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}

export const connectivity = new ConnectivityStore();

/** What a screen sees. */
export function useConnectivity(): ConnectivitySnapshot {
  return useSyncExternalStore(connectivity.subscribe, connectivity.getSnapshot);
}
