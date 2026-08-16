/**
 * Notification rules and preferences (FR-MOD-13.8).
 *
 * The *decision* — which channels fire for a given push — is pure and lives
 * here, apart from the effects (sound, the OS notification, the tab title). That
 * split is deliberate: the interesting cases are all conditional (off in
 * settings, permission denied, the agent's own reply, a system event), and a
 * pure function is the only way to test them without a real browser, an audio
 * device and a permission prompt.
 *
 * **The preferences themselves now live on the account, not in this browser**
 * (13.7-c). They moved because push does: the server picks which handset a
 * notification is delivered to, so a preference kept only in `localStorage` would
 * not apply to the one channel that reaches somebody who has closed their laptop.
 * `@nexa/types` holds the shape, the API holds the value.
 *
 * What is left here is a *cache* of that value, in the key the browser
 * preference used to occupy. It exists for one reason: `decideNotification` runs
 * on every realtime push, inside a callback that cannot await a fetch, so the
 * answer has to be readable synchronously. The auth store writes the cache
 * whenever the server tells it something new; a stale or absent cache degrades
 * to the defaults, which is the reachable direction to be wrong in.
 */
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  readNotificationPreferences,
  type NotificationPreferences,
} from '@nexa/types';

/**
 * The contract's preference object, under the name this module has always used.
 * Re-exported rather than redefined so there is one shape, shared with the
 * server and the phone.
 */
export type NotificationPrefs = NotificationPreferences;

export const DEFAULT_PREFS: NotificationPrefs = DEFAULT_NOTIFICATION_PREFERENCES;

/**
 * The channels the *console* can fire. `push` and `email` are the server's to
 * act on, and naming only what this decision reads keeps a caller from having to
 * invent values for two channels it has no say over.
 */
export type ConsoleNotificationPrefs = Pick<
  NotificationPreferences,
  'enabled' | 'sound' | 'desktop'
>;

const STORAGE_KEY = 'nexa.notifications';

/** Browser permission, plus the case where the API does not exist at all. */
export type Permission = NotificationPermission | 'unsupported';

/** The subset of an event the decision needs — kept loose so a raw push fits. */
export interface NotifiableEvent {
  type?: string;
  author_type?: string;
}

export interface NotifyDecision {
  /** Bump the unread badge in the tab title / favicon. */
  badge: boolean;
  /** Play the alert sound. */
  sound: boolean;
  /** Raise a desktop notification. */
  desktop: boolean;
}

/**
 * What, if anything, to do about an incoming realtime push.
 *
 * Returns `null` when nothing should happen — the common case — so the caller
 * has one branch to check. Only a customer's message on a chat the agent is not
 * currently looking at is worth interrupting them for: their own replies, agent
 * notes, and system events (archived, transferred) are not.
 */
export function decideNotification(args: {
  action: string;
  event: NotifiableEvent | undefined;
  prefs: ConsoleNotificationPrefs;
  /** True when the agent is looking at this tab — do not nag them then. */
  focused: boolean;
  permission: Permission;
}): NotifyDecision | null {
  const { action, event, prefs, focused, permission } = args;

  if (action !== 'incoming_event') return null;
  if (!event || event.type !== 'message' || event.author_type !== 'customer') return null;

  // The master switch, and the reason the negative test passes: off here means
  // no channel fires, regardless of the per-channel toggles or permission.
  if (!prefs.enabled) return null;

  // Already watching — the message is on screen; an alert would be noise.
  if (focused) return null;

  return {
    badge: true,
    sound: prefs.sound,
    // Desktop degrades silently when permission is anything but granted: the
    // badge and sound still fire, so the agent is not left unaware (the
    // permission-denied case in the test strategy).
    desktop: prefs.desktop && permission === 'granted',
  };
}

/** The tab title, with an unread count that reads at a glance from the taskbar. */
export function notificationTitle(base: string, unread: number): string {
  return unread > 0 ? `(${unread}) ${base}` : base;
}

/**
 * Read the cached preferences, tolerating an absent, malformed or partial stored
 * value.
 *
 * All three are ordinary rather than exceptional: absent on a first load before
 * the profile has arrived, partial for a browser that still holds the
 * three-field shape this key carried before the preferences moved to the
 * account. Every one of them falls back to the defaults, because a settings
 * cache that threw would take the inbox down with it — and would do so over a
 * value the server already knows.
 */
export function loadPrefs(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): NotificationPrefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return readNotificationPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Write the cache. Called by the auth store when the server states the
 * preferences — never on its own authority, so the cache cannot drift into
 * disagreeing with the account it is standing in for.
 */
export function savePrefs(
  prefs: NotificationPrefs,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // A full or unavailable localStorage is not worth failing a settings toggle.
  }
}

/** `localStorage` can throw on access (private mode, sandboxed frames). */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
