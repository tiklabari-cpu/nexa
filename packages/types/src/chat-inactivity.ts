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

/**
 * How many times the sweep passes one connection from an agent who did not
 * answer to another (`threads.unresponsive_transfers`, WG-03). After that it
 * stops trying people one by one: the connection goes to the front of its
 * team's queue and the team's lead is told, so it cannot bounce between
 * silent agents for as long as nobody notices.
 */
export const UNRESPONSIVE_TRANSFER_LIMIT = 2;

/**
 * Why the sweep put an unanswered connection in its team's queue rather than
 * with someone else (`ChatUnansweredAlertPush.reason`): nobody in the team
 * could take it, or it already went to {@link UNRESPONSIVE_TRANSFER_LIMIT}
 * people who did not answer either.
 */
export const UNANSWERED_ALERT_REASONS = ['no_agent', 'transfer_limit'] as const;
export type UnansweredAlertReason = (typeof UNANSWERED_ALERT_REASONS)[number];

/**
 * The lead's notice (`RTM_PUSH_ACTIONS` `chat_unanswered_alert`): the agent
 * a connection was given to did not answer the player in time, and the sweep
 * left it at the front of the team's queue. To the team's leads — the
 * workspace's admins and up when the team has none. Ids and numbers only;
 * never a word the player wrote.
 */
export interface ChatUnansweredAlertPush {
  chat_id: string;
  thread_id: string;
  group_id: number;
  /** The agent who did not answer. */
  agent_id: string;
  reason: UnansweredAlertReason;
  /** How many times the sweep has taken it from a silent agent, this one included. */
  transfers: number;
  /** Its place in the team's queue after the move — the front of its priority. */
  queue_position: number | null;
}

/**
 * A connection became inactive, or stopped being (`RTM_PUSH_ACTIONS`
 * `chat_inactivity_changed`) — the sweep's own changes: quiet for the
 * workspace's `inactive_after_seconds`, or the window was turned off or
 * lengthened. To the agents who see the conversation; never to the player. A
 * message ends it without this push: every event clears `inactive_since`, and
 * `incoming_event` already says one arrived.
 */
export interface ChatInactivityChangedPush {
  chat_id: string;
  thread_id: string;
  inactive: boolean;
}

/** The windows a `PUT /settings/chat-timeout` leaves stored; null = off. */
export interface ChatInactivityWindows {
  /**
   * When to ask the player for an e-mail (WG-08 · tm 342, `ask-email.ts`). It
   * runs before the transfer in the same sweep pass, so it is the first of the
   * windows. A caller that does not know it leaves it out: off.
   */
  askEmailSeconds?: number | null;
  unansweredTransferSeconds: number | null;
  inactiveAfterSeconds: number | null;
  chatTimeoutSeconds: number | null;
}

/** Why a set of windows is out of order, as `chatInactivityOrderProblem` names it. */
export const CHAT_INACTIVITY_ORDER_PROBLEMS = [
  'ask_email_not_before_transfer',
  'ask_email_not_before_inactive',
  'ask_email_not_before_timeout',
  'transfer_not_before_inactive',
  'transfer_not_before_timeout',
  'inactive_not_before_timeout',
] as const;
export type ChatInactivityOrderProblem = (typeof CHAT_INACTIVITY_ORDER_PROBLEMS)[number];

/**
 * The first pair of windows that is out of order — ask for an e-mail <
 * transfer < inactive < auto-close, strictly, between whichever of them are on
 * — or null when the order holds. A window that is off (null) is in no pair.
 */
export function chatInactivityOrderProblem(
  windows: ChatInactivityWindows,
): ChatInactivityOrderProblem | null {
  const { unansweredTransferSeconds: transfer, inactiveAfterSeconds: inactive } = windows;
  const timeout = windows.chatTimeoutSeconds;
  const ask = windows.askEmailSeconds ?? null;
  if (ask !== null && transfer !== null && ask >= transfer) {
    return 'ask_email_not_before_transfer';
  }
  if (ask !== null && inactive !== null && ask >= inactive) {
    return 'ask_email_not_before_inactive';
  }
  if (ask !== null && timeout !== null && ask >= timeout) {
    return 'ask_email_not_before_timeout';
  }
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
