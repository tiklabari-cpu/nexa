/**
 * What the shell tells an agent about their own availability, and a team lead
 * about a chat nobody answered (WG-03 · tm 340.3).
 *
 * Two things change a person's routing status without them touching it now:
 * the unanswered-chat sweep pauses an agent who did not reply in time
 * (`routing_status_set`, reason `agent_unresponsive`), and the gateway sets an
 * agent offline once none of their sockets has been open for its tolerance
 * (`agent_disconnected`). A status that changes under somebody without a word
 * reads as a bug — or worse, goes unnoticed, and an agent sits "not accepting"
 * for an afternoon. So each change leaves a notice saying what happened and
 * offering the way back.
 *
 * The second kind is the lead's: `chat_unanswered_alert` says a conversation
 * went unanswered and is waiting at the front of the team's queue. Those stack
 * — several can arrive in one sweep — newest first, a few at most.
 *
 * A store rather than component state for the reason `realtime-status.ts` is
 * one: the pushes arrive in `applyPush`, outside React, and the banner that
 * shows them lives in the shell.
 */
import { create } from 'zustand';
import type { RoutingStatus, UnansweredAlertReason } from '@siyahtus/types';

/** Why the caller's own status changed without them. */
export type SelfStatusNotice =
  /** The unanswered-chat sweep paused them; `afterSeconds` is the window that ran out. */
  | { kind: 'unresponsive'; afterSeconds: number | null }
  /** No socket of theirs was open for the gateway's tolerance. */
  | { kind: 'disconnected'; afterSeconds: number | null }
  /**
   * Found on reconnecting: the server holds a different status than this
   * console showed, and the push that said so arrived while it was away.
   */
  | { kind: 'changed_while_away'; status: RoutingStatus };

/** One `chat_unanswered_alert`, as the lead's banner shows it. */
export interface UnansweredAlert {
  /** Thread and attempt — the same alert delivered twice is shown once. */
  id: string;
  chatId: string;
  groupId: number;
  /** The agent who did not answer. */
  agentId: string;
  reason: UnansweredAlertReason;
  transfers: number;
  queuePosition: number | null;
}

/** How many lead alerts stay on screen; older ones are dropped, not queued. */
export const MAX_UNANSWERED_ALERTS = 3;

interface PresenceNoticeState {
  self: SelfStatusNotice | null;
  alerts: UnansweredAlert[];
}

const useStore = create<PresenceNoticeState>(() => ({ self: null, alerts: [] }));

export function usePresenceNotices(): PresenceNoticeState {
  return useStore();
}

/** The latest change wins: two notices about one status would contradict each other. */
export function noteSelfStatusChange(notice: SelfStatusNotice): void {
  useStore.setState({ self: notice });
}

export function noteUnansweredAlert(alert: UnansweredAlert): void {
  useStore.setState((state) => ({
    alerts: [alert, ...state.alerts.filter((a) => a.id !== alert.id)].slice(
      0,
      MAX_UNANSWERED_ALERTS,
    ),
  }));
}

export function dismissSelfStatusNotice(): void {
  useStore.setState({ self: null });
}

export function dismissUnansweredAlert(id: string): void {
  useStore.setState((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) }));
}

/** For tests, and for a sign-out: nothing of one session's notices outlives it. */
export function resetPresenceNotices(): void {
  useStore.setState({ self: null, alerts: [] });
}
