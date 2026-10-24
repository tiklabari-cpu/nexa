/**
 * The two inactivity windows that sit before the idle auto-close (WG-03 ·
 * tm 340), saved with it on `inbox_settings` (`PUT /settings/chat-timeout`):
 *
 *   - `unanswered_transfer_seconds` — an assigned connection whose agent has
 *     not written to the player for this long since it was given to them
 *     (`threads.assigned_at`, the first reply only) goes to someone else in
 *     the team, reason `agent_unresponsive`.
 *   - `inactive_after_seconds` — a connection with no event for this long is
 *     *inactive* (`threads.inactive_since`): it stops counting against its
 *     agent's concurrent limit until the next message.
 *
 * Both are null (off) until a workspace sets them. They only make sense in
 * the order a conversation goes quiet — passed on, then set aside, then
 * closed — so a save whose windows are out of that order is refused.
 */

/** The longest window either takes: 30 days, the auto-close window's ceiling. */
export const INACTIVITY_WINDOW_MAX_SECONDS = 2_592_000;

/** The three windows a `PUT /settings/chat-timeout` leaves stored; null = off. */
export interface ChatInactivityWindows {
  unansweredTransferSeconds: number | null;
  inactiveAfterSeconds: number | null;
  chatTimeoutSeconds: number | null;
}

/** Why a set of windows is out of order, as `chatInactivityOrderProblem` names it. */
export const CHAT_INACTIVITY_ORDER_PROBLEMS = [
  'transfer_not_before_inactive',
  'transfer_not_before_timeout',
  'inactive_not_before_timeout',
] as const;
export type ChatInactivityOrderProblem = (typeof CHAT_INACTIVITY_ORDER_PROBLEMS)[number];

/**
 * The first pair of windows that is out of order — transfer < inactive <
 * auto-close, strictly, between whichever of them are on — or null when the
 * order holds. A window that is off (null) is in no pair.
 */
export function chatInactivityOrderProblem(
  windows: ChatInactivityWindows,
): ChatInactivityOrderProblem | null {
  const { unansweredTransferSeconds: transfer, inactiveAfterSeconds: inactive } = windows;
  const timeout = windows.chatTimeoutSeconds;
  if (transfer !== null && inactive !== null && transfer >= inactive) {
    return 'transfer_not_before_inactive';
  }
  if (transfer !== null && timeout !== null && transfer >= timeout) {
    return 'transfer_not_before_timeout';
  }
  if (inactive !== null && timeout !== null && inactive >= timeout) {
    return 'inactive_not_before_timeout';
  }
  return null;
}
