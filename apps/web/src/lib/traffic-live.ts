/**
 * The traffic board's live signal, published for whoever wants it
 * (FR-MOD-03.1.1).
 *
 * Exactly `realtime-status.ts`'s shape and for the same reason: the socket is
 * opened in one place — the shell (`components/AppShell.tsx` · `RealtimeOwner`)
 * — and the screen that cares about `traffic_visitor_updated` is a route under
 * it that may not even be mounted. A return value would have to be threaded
 * down through `<Outlet />`; a context would put the value in the shell's own
 * render, so every visitor event on a busy workspace would re-render the rail,
 * the banners and the active module along with it.
 *
 * A counter rather than the payload, because the board's reaction is not to
 * trust the push but to re-read (`TrafficVisitorUpdatedPush` argues that at
 * length): the customer id is carried alongside for logging and for anything
 * later that wants to be narrower, and `revision` is the only thing the board
 * subscribes to. Monotonic so a subscriber can tell "another one arrived" from
 * "the same one twice" — two pushes for the same visitor are two events, and
 * the second one is the one that must not be swallowed.
 */
import { create } from 'zustand';

interface TrafficLiveState {
  /** Incremented once per `traffic_visitor_updated` push. */
  revision: number;
  /** Who the most recent one was about; null before any has arrived. */
  customerId: string | null;
}

const useStore = create<TrafficLiveState>(() => ({ revision: 0, customerId: null }));

/**
 * Subscribe to the board's live signal. The number itself means nothing — only
 * that it changed.
 */
export function useTrafficRevision(): number {
  return useStore((state) => state.revision);
}

/**
 * Publish one visitor-moved signal. Called only by the push handler
 * (`applyPush`) — nothing else may claim the server said something.
 */
export function noteTrafficVisitorUpdated(customerId: string): void {
  useStore.setState((state) => ({ revision: state.revision + 1, customerId }));
}

/** Test seam: `TrafficPage.test.tsx` resets between renders. */
export const useTrafficLiveStore = useStore;
