import type { ChatEvent } from './types.js';

/**
 * Which message carries the "Read · 14:32" line (IN-05 · tm 362).
 *
 * The player's read marker (`seen_up_to`) is a point in time, not a message, so
 * the line is drawn once — under the newest message from the team (an agent or
 * the AI) that the player had on screen by then, never on each one before it.
 * Only what the player could see counts: an internal note, a system line and a
 * message still being sent are skipped. A marker that is missing or not a date
 * draws nothing — showing too little beats a "read" that never happened.
 */
export function readReceiptEventId(
  events: readonly ChatEvent[],
  seenUpTo: string | null | undefined,
): string | null {
  if (!seenUpTo) return null;
  const mark = Date.parse(seenUpTo);
  if (Number.isNaN(mark)) return null;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.recipients !== 'all') continue;
    if (event.author_type !== 'agent' && event.author_type !== 'bot') continue;
    if (event.type === 'system_message') continue;
    if (event.properties?.['pending'] === true) continue;
    if (Date.parse(event.created_at) <= mark) return event.id;
  }
  return null;
}
