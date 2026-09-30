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
 *
 * How *often* is a fourth question, and not a pure one: whether this chat's
 * assignee was already mailed within the window is shared across requests and
 * API replicas, so it is kept in Redis — {@link claimAssigneeEmailWindow} below,
 * asked only once the three above have said yes (tm 256.4).
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

/** Where the per-chat, per-assignee e-mail window lives in Redis (tm 256.4). */
export const ASSIGNEE_EMAIL_KEY_PREFIX = 'siyahtus:assignee-email:';

export function assigneeEmailKey(
  licenseId: bigint | string,
  chatId: string,
  assigneeId: string,
): string {
  return `${ASSIGNEE_EMAIL_KEY_PREFIX}${licenseId}:${chatId}:${assigneeId}`;
}

/**
 * The slice of ioredis the window needs. Structural, like the scheduler's
 * `LockRedis`, so a unit test can drive the rule without a Redis.
 */
export interface AssigneeEmailWindowRedis {
  set(
    key: string,
    value: string,
    millisecondsToken: 'PX',
    milliseconds: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
}

/**
 * Whether this message may e-mail the assignee, or one already went to them
 * about this chat within the last `cooldownMs` (tm 256.4).
 *
 * Before this, every visitor message was its own e-mail: twenty lines typed in
 * a row were twenty messages in the agent's mailbox, and twenty sends against
 * the mailbox's own sending limit — the limit invitations and password resets
 * go out under too. The first message of a window mails; the rest of the
 * window is covered by it, because the e-mail says "go and look", not what was
 * said. Keyed by chat *and* assignee: a transfer hands the conversation to
 * somebody who has not been told yet, so their window starts fresh.
 *
 * `SET NX PX` makes the claim and its expiry one command, so five messages
 * arriving at once still mail once and a window can never outlive its length.
 * A send that then fails does not reopen the window: the carrier has already
 * retried it, and reopening would turn a broken carrier back into one attempt
 * per message.
 *
 * `cooldownMs` 0 turns the window off — every message mails, as before. When
 * Redis cannot answer the claim is granted, and `onUnavailable` is told why:
 * the realtime path runs over the same Redis, so during that outage the e-mail
 * may be the only thing that still reaches the agent, and the cost of failing
 * open is the pre-window behaviour for as long as it lasts.
 */
export async function claimAssigneeEmailWindow(
  redis: AssigneeEmailWindowRedis,
  window: { licenseId: bigint | string; chatId: string; assigneeId: string; cooldownMs: number },
  onUnavailable: (error: unknown) => void,
): Promise<boolean> {
  if (window.cooldownMs <= 0) return true;
  try {
    const claimed = await redis.set(
      assigneeEmailKey(window.licenseId, window.chatId, window.assigneeId),
      '1',
      'PX',
      window.cooldownMs,
      'NX',
    );
    return claimed === 'OK';
  } catch (error) {
    onUnavailable(error);
    return true;
  }
}
