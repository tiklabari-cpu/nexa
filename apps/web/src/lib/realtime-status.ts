/**
 * The realtime connection's state, published for whoever wants to show it.
 *
 * The socket is opened in one place — the shell (`components/AppShell.tsx` ·
 * `RealtimeOwner`) — and its status is read somewhere else entirely: the
 * inbox's connection dot. It used to be a return value, which worked only
 * because the same component did both. Once the shell owns the socket, a
 * return value would have to be threaded down through `<Outlet />` to a screen
 * that may not even be mounted.
 *
 * A store rather than a context for one measured reason: status changes are
 * transport noise (`connecting → live`, and a `reconnecting → live` pair for
 * every network blip), and a context value lives in the provider's render, so
 * each of those would re-render the whole shell — rail, banners and the active
 * module with it. Held outside React, only the components that actually select
 * the status re-render, which today is one badge. Same reasoning as
 * `features/inbox/typing.ts` and `conflict.ts`, the other two stores fed by the
 * socket rather than by a fetch.
 */
import { create } from 'zustand';
import type { RtmStatus } from './realtime.js';

interface RealtimeStatusState {
  status: RtmStatus;
}

/**
 * `offline` until an owner says otherwise — the honest starting point, and what
 * a screen rendered without the shell (a unit test, a future embed) keeps
 * reporting rather than claiming a connection nobody opened.
 */
const useStore = create<RealtimeStatusState>(() => ({ status: 'offline' }));

/** Subscribe to the connection's state. */
export function useRealtimeStatus(): RtmStatus {
  return useStore((state) => state.status);
}

/**
 * Publish the connection's state. Called only by `useRealtime`'s `RtmClient`
 * (`onStatusChange`) — nothing else may claim to know what the socket is doing.
 */
export function setRealtimeStatus(status: RtmStatus): void {
  useStore.setState({ status });
}
