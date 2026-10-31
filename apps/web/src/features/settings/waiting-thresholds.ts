/**
 * The two waiting-counter thresholds as the settings form edits them
 * (IN-03 · tm 361): whole seconds in a text box, empty meaning "the default".
 */
import { WAITING_MAX_SECONDS, waitingThresholdProblem } from '@siyahtus/types';

/** What a box holds, as the value to save, or why it cannot be saved. */
export type WaitingFieldResult =
  { ok: true; seconds: number | null } | { ok: false; error: 'range' };

export function parseWaitingSeconds(raw: string): WaitingFieldResult {
  const text = raw.trim();
  if (text === '') return { ok: true, seconds: null };
  if (!/^\d+$/.test(text)) return { ok: false, error: 'range' };
  const seconds = Number(text);
  if (seconds < 1 || seconds > WAITING_MAX_SECONDS) return { ok: false, error: 'range' };
  return { ok: true, seconds };
}

/**
 * The message key for what is wrong with the pair, or null when both can be
 * saved: each box in range, and the warning before the alert.
 */
export function waitingFormError(warn: string, alert: string): string | null {
  const w = parseWaitingSeconds(warn);
  const a = parseWaitingSeconds(alert);
  if (!w.ok || !a.ok) return 'settings.waiting.rangeError';
  return waitingThresholdProblem(w.seconds, a.seconds) ? 'settings.waiting.orderError' : null;
}
