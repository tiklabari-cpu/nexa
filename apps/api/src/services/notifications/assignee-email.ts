/**
 * The e-mail notification channel — the *decision*, apart from the effect.
 *
 * A chat's assigned agent is e-mailed when their visitor writes in
 * (FR-MOD-13.8), so they hear about it even when they are away from the inbox.
 * Whether that e-mail actually goes out is three conditional questions — is
 * there a human assignee at all, has that agent kept the channel on, and do we
 * have an address to send to — and this pure function answers them.
 *
 * It lives on its own, away from the `FileMailer` call in the route, for the
 * same reason `decideNotification` does on the web: the interesting cases are
 * the *negatives* (queued/AI-only chat, an agent who opted out, an account with
 * no e-mail), and a pure function is the only way to test them without a mailer
 * and a database. FR-MOD-08.2 makes the opt-out per user and per license.
 */

export interface AssigneeChannel {
  /**
   * The assignee's deliverable e-mail, or null when the chat has no human
   * assignee (it is queued, or answered only by the AI) — nobody to write to.
   */
  email: string | null;
  /** The assignee's per-user, per-license opt-in for the e-mail channel. */
  emailEnabled: boolean;
}

/**
 * Whether to send the assignee an e-mail for new activity on their chat.
 *
 * A type guard rather than a plain predicate: on `true` the caller knows
 * `email` is a real string, so it can pass it to the mailer without a non-null
 * assertion the next refactor could quietly invalidate.
 */
export function shouldEmailAssignee(
  channel: AssigneeChannel | null,
): channel is AssigneeChannel & { email: string } {
  // No human assignee — a queued or AI-only chat has nobody to notify, and
  // e-mailing on every message to an unassigned chat would be noise.
  if (!channel) return false;
  // The agent turned the e-mail channel off (FR-MOD-08.2).
  if (!channel.emailEnabled) return false;
  // An account without an address cannot be reached; skip rather than send to
  // an empty recipient.
  return typeof channel.email === 'string' && channel.email.length > 0;
}
