/**
 * What a tapped notification asks for, and how to be sure it is asked once
 * (FR-MOD-13.7 · 13.7-s).
 *
 * Reading it is pure: a `NotificationResponse` in, a destination or `null` out.
 * That is the whole of the decision, and it is the part worth proving — the two
 * ways in (a live tap while the app runs, and the response that launched the
 * process) deliver exactly the same object, so one function covers both and the
 * cold-start case stops being a separate story.
 *
 * The subscribing half is here too, wrapped the way `auth/push-tokens.ts` wraps
 * its native module: never throwing. Both calls reach `expo-notifications`, and
 * both of them run on the launch path.
 */
import * as Notifications from 'expo-notifications';
import { readPushPayload } from '@nexa/types';

/**
 * One notification a person acted on: which conversation, and which delivery it
 * came from.
 *
 * The `id` is carried because the same response is legitimately offered twice —
 * `getLastNotificationResponseAsync` returns the one that launched the app, and
 * a listener registered early enough is also handed it. Without an identifier
 * the app would push the same chat twice on a cold start; with one, the second
 * offer is recognised and dropped (`routing.ts`).
 */
export interface NotificationTap {
  /** `NotificationRequest.identifier` — unique per delivery. */
  id: string;
  chatId: string;
}

/**
 * What this response asks the app to open, or `null` if it asks for nothing.
 *
 * Only the default action counts as "open this". A dismissal arrives here too
 * (swiped away rather than tapped), and opening a conversation because somebody
 * cleared a notification is the opposite of what they asked for. Any other
 * identifier — a custom action from a category, which `13.7-s` does not add and
 * a later build might — is treated the same conservative way: this build does
 * not know what that button meant, so it does not navigate on it.
 */
export function tapFrom(
  response: Notifications.NotificationResponse | null | undefined,
): NotificationTap | null {
  if (response === null || response === undefined) return null;
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;

  const request = response.notification?.request;
  if (request === undefined) return null;

  const payload = readPushPayload(request.content?.data);
  if (payload === null) return null;
  return { id: request.identifier, chatId: payload.chat_id };
}

/** Undo a subscription, whether or not there was one to make. */
export type Unsubscribe = () => void;

/**
 * Call `onTap` whenever somebody acts on one of our notifications while this
 * process is alive.
 *
 * Returns an unsubscribe that is safe to call regardless — including when the
 * subscription was never made, which is what a build with no native module
 * gets.
 */
export function subscribeToTaps(onTap: (tap: NotificationTap) => void): Unsubscribe {
  try {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const tap = tapFrom(response);
      if (tap !== null) onTap(tap);
    });
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/**
 * The response that launched this process, if it was launched by one.
 *
 * The cold-start half: the OS delivered the tap before any listener could
 * exist, so the answer has to be asked for rather than waited on. Read exactly
 * once, at mount — asking again later would re-open a conversation somebody
 * navigated away from, since the platform keeps answering with the same
 * response for the life of the process.
 */
export async function launchTap(): Promise<NotificationTap | null> {
  try {
    return tapFrom(await Notifications.getLastNotificationResponseAsync());
  } catch {
    return null;
  }
}
