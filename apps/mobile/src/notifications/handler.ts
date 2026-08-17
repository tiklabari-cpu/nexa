/**
 * What a notification does when it lands on a phone that is already looking at
 * this app (FR-MOD-13.7 · 13.7-s).
 *
 * Both platforms suppress their own banner while the app is in the foreground
 * and hand the decision to the application instead. `expo-notifications`
 * expresses that as one handler, and the default when none is set is *not to
 * show it* — which is what this app did until now: a message that arrived while
 * somebody had the inbox open was silently dropped by the platform, and the
 * only reason anything appeared on screen at all was that `13.7-f`'s socket had
 * separately delivered the event (§D111).
 *
 * **The overlap with realtime is deliberate, not an oversight.** When the chat
 * in question is the one on screen, the transcript already grew a bubble and
 * the banner is arguably redundant. It is still shown, because the alternative
 * is a rule that reads the current route from inside a module-level callback
 * and decides *not* to tell somebody about a conversation — and the way that
 * rule fails (a stale or mis-read route) is silence, which is the one failure
 * mode a notification system cannot afford. FR-MOD-08.2's own switch, which the
 * server already honours before sending (`pushAllowed`), is where a person who
 * does not want to be interrupted turns this off.
 */
import * as Notifications from 'expo-notifications';
import { readPushPayload } from '@nexa/types';

/**
 * Shown, listed and audible — the answer for a notification this build can act
 * on.
 *
 * `shouldSetBadge` is `false` throughout: an app-icon badge is a *count*, and
 * nothing here counts anything. Setting it from a single delivery would write
 * "1" over a number the phone has no way to correct when the person reads the
 * conversation somewhere else. Badges are named out of scope for `13.7-s`.
 *
 * `shouldShowAlert` is the deprecated predecessor of the banner/list pair and is
 * deliberately left unset rather than duplicated — passing both invites the two
 * to disagree on a future SDK.
 */
export const INTERRUPT: Notifications.NotificationBehavior = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: false,
};

/**
 * Recorded in the notification list, but no banner and no sound — the answer
 * for a notification whose payload this build cannot route.
 *
 * Not "discard": the title and body were written by the server and mean
 * something to the person reading them, so a delivery that arrives is not
 * erased. Not "interrupt" either: a tap on this one goes nowhere, because
 * `readPushPayload` refused it (`@nexa/types/push.ts` — no chat id names no
 * destination, and an unrecognised `kind` is a build that is behind the server).
 * Buzzing a pocket for something that leads nowhere when opened is the worse of
 * the two, so it is filed quietly and stays readable in the tray.
 */
export const FILE_QUIETLY: Notifications.NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

/** Which of the two above this notification gets. */
export function foregroundBehaviour(
  notification: Notifications.Notification,
): Notifications.NotificationBehavior {
  return readPushPayload(notification.request.content.data) === null ? FILE_QUIETLY : INTERRUPT;
}

/**
 * Register {@link foregroundBehaviour} with the native module.
 *
 * Nothing throws, for the reason `auth/push-tokens.ts` gives at length: this
 * runs on the launch path, and a build without the native module compiled in —
 * or a platform that has no notification centre — must still open the app.
 * The return value says which happened, so a caller can tell "installed" from
 * "there was nothing to install on" without catching anything itself.
 */
export function installForegroundHandler(): boolean {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => foregroundBehaviour(notification),
    });
    return true;
  } catch {
    return false;
  }
}
