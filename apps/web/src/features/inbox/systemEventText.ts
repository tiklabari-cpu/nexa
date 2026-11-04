/**
 * The words of the server's own system lines, in the console's language (tm 398).
 *
 * The API writes the sentence of a system event in English (`Chat archived`,
 * `Chat closed after inactivity`, …) and tags it with `properties.system_event`
 * (+ `reason`). English stays on the wire — webhooks, the transcript e-mail and
 * older consoles read it — and the console shows its own catalogue's sentence
 * for the events it knows, so a Turkish console does not print "Ziyaretçi /
 * Chat archived". An event it does not know keeps the server's text.
 */
import type { TFunction } from '../../lib/i18n.js';
import type { ChatEvent } from './types.js';

/** The catalogue key of a closing line, by the `reason` the server tagged it with. */
function deactivatedKey(reason: unknown): string {
  switch (reason) {
    case 'day_rollover':
      return 'inbox.systemEvent.chatDeactivated.dayRollover';
    case 'timeout':
      return 'inbox.systemEvent.chatDeactivated.timeout';
    default:
      return 'inbox.systemEvent.chatDeactivated';
  }
}

/**
 * What to show for an event's text: the localised sentence of a known system
 * event, otherwise the stored text (null stays null).
 */
export function eventText(
  event: Pick<ChatEvent, 'text' | 'type' | 'author_type' | 'properties'>,
  t: TFunction,
): string | null {
  const isSystem = event.type === 'system_message' || event.author_type === 'system';
  const props = event.properties as Record<string, unknown> | null | undefined;
  if (isSystem && props && props['system_event'] === 'chat_deactivated') {
    return t(deactivatedKey(props['reason']));
  }
  return event.text;
}
