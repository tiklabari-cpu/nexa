/**
 * What a push notification carries, and what it deliberately does not
 * (FR-MOD-13.7 · 13.7-d writes it, 13.7-s reads it).
 *
 * The sender has always known this shape — it was spelled out in
 * `apps/api/src/services/push/push-provider.ts` — but the phone did not, so the
 * one field the whole feature turns on (`chat_id`, "which conversation was this
 * about?") arrived as an untyped bag off a native module. This is the same
 * shape, in the one package both ends already depend on.
 *
 * **No conversation content is in here, and that is a decision, not an
 * omission.** A push travels through Apple's and Google's infrastructure; this
 * product masks card numbers out of message text and personal data out of its
 * own logs, so handing a visitor's sentence to a third party for the sake of a
 * preview would be incoherent (`push.ts` header, 13.7-d — unchanged here). The
 * notification says what *kind* of thing happened and which chat it happened
 * in; the app fetches the conversation over the authenticated API once the
 * person taps it.
 *
 * **Snake case, because this is wire data.** It is written by the server, put
 * through JSON, carried by APNs/FCM and read back on the phone — the same
 * journey every field in this package's API shapes makes, and the same spelling
 * the spool already writes (`DeliveredPush.chat_id`).
 */

/**
 * What happened, in the vocabulary the phone shows.
 *
 * Three kinds rather than one because the notification tray groups by them and
 * because a test that filters the spool needs to tell "you have been given a
 * chat" from "the visitor wrote again" without parsing prose.
 */
export const PUSH_EVENT_KINDS = ['new_chat', 'assignment', 'message'] as const;
export type PushEventKind = (typeof PUSH_EVENT_KINDS)[number];

export function isPushEventKind(value: unknown): value is PushEventKind {
  return typeof value === 'string' && (PUSH_EVENT_KINDS as readonly string[]).includes(value);
}

/** The data half of a notification: what it was about, and about which chat. */
export interface PushPayload {
  kind: PushEventKind;
  /** The conversation to open when the notification is tapped. */
  chat_id: string;
}

/**
 * Read a notification's data as one of ours, or answer `null`.
 *
 * Strict on both fields, unlike `readNotificationPreferences` next door, and
 * for the opposite reason. Preferences are *displayed*, so filling a missing
 * field from the defaults shows something true-ish rather than a blank screen.
 * A payload is *acted on*: the only thing the phone does with it is navigate,
 * and a payload missing its chat id names no destination. Guessing one would
 * open somebody else's conversation, and defaulting the kind would let a
 * notification from a build this one does not understand claim to be a message.
 *
 * `null` is therefore a real answer with a real meaning — "this notification is
 * not one this build can route" — and both callers on the phone have a defined
 * behaviour for it (`notifications/handler.ts`, `notifications/response.ts`).
 */
export function readPushPayload(value: unknown): PushPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const chatId = source.chat_id;
  if (!isPushEventKind(source.kind)) return null;
  if (typeof chatId !== 'string' || chatId === '') return null;
  return { kind: source.kind, chat_id: chatId };
}
