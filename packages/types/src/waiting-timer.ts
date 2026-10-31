/**
 * How long a player has waited for an answer (IN-03 · tm 361).
 *
 * The inbox row shows a counter and changes its look at two thresholds. The
 * counter's start is ONE stored fact, `threads.awaiting_reply_since`, kept by
 * the server's single event-append path — never worked out from "the last
 * event is the player's", which a "chat transferred" line or an internal note
 * would reset. This file is the rule both sides read:
 *
 *   - the API's `#appendEvent` applies {@link waitingEffect} to the thread's
 *     column in the same transaction as the event;
 *   - the web's push handler applies the same function to its cached row, so a
 *     pushed message moves the counter exactly as the stored column will.
 *
 * WG-03's unanswered transfer (#340) and RP-04's queue report (#291/#371) take
 * their "waiting for a reply" from the same column.
 */

/** Seconds before a waiting row turns to a warning, when a workspace sets none. */
export const WAITING_WARN_DEFAULT_SECONDS = 120;
/** Seconds before it turns to an alert, when a workspace sets none. */
export const WAITING_ALERT_DEFAULT_SECONDS = 300;
/** The longest threshold the settings take: one day. */
export const WAITING_MAX_SECONDS = 86_400;

/** The event types that are a message — something to answer or an answer. */
const MESSAGE_TYPES: ReadonlySet<string> = new Set(['message', 'rich_message', 'file']);

export interface WaitingEventShape {
  type: string;
  author_type: string;
  recipients: string;
}

/**
 * What an appended event does to the counter:
 *
 *   - `start`: the player wrote (visible to all). Starts the count if it is
 *     not running — a second message does not restart it, the wait is since
 *     the first one unanswered.
 *   - `clear`: an agent or a bot wrote something the player sees.
 *   - `none`: everything else — an internal note, a system line such as
 *     "chat transferred", a form, a typing preview.
 */
export function waitingEffect(event: WaitingEventShape): 'start' | 'clear' | 'none' {
  if (!MESSAGE_TYPES.has(event.type) || event.recipients !== 'all') return 'none';
  if (event.author_type === 'customer') return 'start';
  if (event.author_type === 'agent' || event.author_type === 'bot') return 'clear';
  return 'none';
}

/**
 * The AI-mode changes that hand a player to a person who has not answered
 * them: from the AI or a rule bot to `human`, for these reasons. The counter
 * starts then if it is not running (the AI's reply had cleared it).
 */
export const WAITING_HANDOVER_REASONS: readonly string[] = [
  'ai_handoff',
  'ai_failure',
  'bot_handoff',
];

export interface WaitingThresholds {
  warn_seconds: number;
  alert_seconds: number;
}

export const WAITING_DEFAULT_THRESHOLDS: WaitingThresholds = Object.freeze({
  warn_seconds: WAITING_WARN_DEFAULT_SECONDS,
  alert_seconds: WAITING_ALERT_DEFAULT_SECONDS,
});

/**
 * The thresholds a workspace runs on: a stored value, else the default. A pair
 * that is out of order (stored by hand, or one column set and the other not)
 * falls back to the defaults whole rather than draw an alert before a warning.
 */
export function waitingThresholds(stored: {
  warn_seconds?: number | null;
  alert_seconds?: number | null;
}): WaitingThresholds {
  const warn = stored.warn_seconds ?? WAITING_WARN_DEFAULT_SECONDS;
  const alert = stored.alert_seconds ?? WAITING_ALERT_DEFAULT_SECONDS;
  return warn < alert ? { warn_seconds: warn, alert_seconds: alert } : WAITING_DEFAULT_THRESHOLDS;
}

/** What a save with the two thresholds out of order is told. */
export type WaitingThresholdProblem = 'warn_not_before_alert';

/** The two values as a save leaves them (null = default); null when they are in order. */
export function waitingThresholdProblem(
  warnSeconds: number | null,
  alertSeconds: number | null,
): WaitingThresholdProblem | null {
  const warn = warnSeconds ?? WAITING_WARN_DEFAULT_SECONDS;
  const alert = alertSeconds ?? WAITING_ALERT_DEFAULT_SECONDS;
  return warn < alert ? null : 'warn_not_before_alert';
}

export type WaitingLevel = 'normal' | 'warn' | 'alert';

/** How a row looks after `elapsedSeconds` of waiting. */
export function waitingLevel(elapsedSeconds: number, thresholds: WaitingThresholds): WaitingLevel {
  if (elapsedSeconds >= thresholds.alert_seconds) return 'alert';
  if (elapsedSeconds >= thresholds.warn_seconds) return 'warn';
  return 'normal';
}

/** The counter as words: under a minute is "just now", then whole minutes, then hours. */
export type WaitingDuration =
  | { kind: 'now' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'hours'; hours: number; minutes: number };

export function waitingDuration(elapsedSeconds: number): WaitingDuration {
  const seconds = Math.max(0, Math.floor(elapsedSeconds));
  if (seconds < 60) return { kind: 'now' };
  const total = Math.floor(seconds / 60);
  if (total < 60) return { kind: 'minutes', minutes: total };
  return { kind: 'hours', hours: Math.floor(total / 60), minutes: total % 60 };
}
