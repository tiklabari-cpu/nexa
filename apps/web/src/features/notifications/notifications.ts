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
 * `@siyahtus/types` holds the shape, the API holds the value.
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
  type NotificationEvent,
  type NotificationPreferences,
} from '@siyahtus/types';

/**
 * The contract's preference object, under the name this module has always used.
 * Re-exported rather than redefined so there is one shape, shared with the
 * server and the phone.
 */
export type NotificationPrefs = NotificationPreferences;

export const DEFAULT_PREFS: NotificationPrefs = DEFAULT_NOTIFICATION_PREFERENCES;

/**
 * What the *console* reads to decide. `push` and `email` are the server's to
 * act on, and naming only what this decision reads keeps a caller from having to
 * invent values for channels it has no say over.
 */
export type ConsoleNotificationPrefs = Pick<
  NotificationPreferences,
  'enabled' | 'sound' | 'desktop' | 'events' | 'repeat_sound'
>;

const STORAGE_KEY = 'siyahtus.notifications';

/** Browser permission, plus the case where the API does not exist at all. */
export type Permission = NotificationPermission | 'unsupported';

/**
 * Who is signed in, as far as "was this meant for me?" needs: the account and
 * the teams. A push is fanned out to a team's whole audience, and only the
 * receiving end knows whether *it* is the person or team the thing was handed to.
 */
export interface NotifyMe {
  accountId: string | null;
  groupIds: readonly number[];
}

export interface NotifyDecision {
  /** Which event of the preference list this is (IN-10). */
  event: NotificationEvent;
  /** What the alert is about — a chat or a ticket id — for the tag and the repeater. */
  key: string | null;
  /** Bump the unread badge in the tab title / favicon. */
  badge: boolean;
  /** Play the alert sound. */
  sound: boolean;
  /** Raise a desktop notification. */
  desktop: boolean;
  /**
   * Keep chiming until the message is read (IN-10): only a visitor's message,
   * only with sound and the repeat both on.
   */
  repeat: boolean;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const numbers = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((n): n is number => typeof n === 'number') : [];
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string') : [];

/**
 * Which of the preference events a push is — or `null` for the many pushes
 * that are nobody's alert (an agent's own reply, a note, a system line, a
 * hand-off to somebody else).
 *
 * Pure and exhaustive on purpose: this is where "the right person, for the right
 * thing" is decided, and it is the part a real browser cannot test.
 */
export function classifyPush(
  action: string,
  payload: Record<string, unknown>,
  me: NotifyMe,
): { event: NotificationEvent; key: string | null } | null {
  switch (action) {
    case 'incoming_event': {
      const event = asRecord(payload['event']);
      if (event['type'] !== 'message' || event['author_type'] !== 'customer') return null;
      return { event: 'incoming_chat', key: str(payload['chat_id']) };
    }

    case 'chat_transferred': {
      // The agent who did the hand-off knows; telling them is noise.
      if (me.accountId !== null && payload['requester_id'] === me.accountId) return null;
      const to = asRecord(payload['transferred_to']);
      const toMe =
        me.accountId !== null &&
        (payload['assignee_id'] === me.accountId ||
          strings(to['agent_ids']).includes(me.accountId));
      const key = str(payload['chat_id']);
      if (toMe) return { event: 'transferred_to_me', key };
      if (numbers(to['group_ids']).some((id) => me.groupIds.includes(id))) {
        return { event: 'transferred_to_my_team', key };
      }
      return null;
    }

    case 'incoming_chat': {
      // A visitor who is waiting in a queue of a team this person is in. A chat
      // that arrived through a hand-off is announced by `chat_transferred`.
      if (payload['transferred_from'] !== undefined) return null;
      const chat = asRecord(payload['chat']);
      const thread = asRecord(chat['thread']);
      if (thread['queue_position'] == null || thread['active'] === false) return null;
      const groups = numbers(asRecord(chat['access'])['group_ids']);
      if (!groups.some((id) => me.groupIds.includes(id))) return null;
      return { event: 'queue_waiting', key: str(chat['id']) };
    }

    // The lead's notice that nobody took a chat (WG-03): a queue that needs a person.
    case 'chat_unanswered_alert':
      return { event: 'queue_waiting', key: str(payload['chat_id']) };

    case 'incoming_ticket': {
      if (me.accountId !== null && payload['actor_id'] === me.accountId) return null;
      const toMe = me.accountId !== null && payload['assignee_id'] === me.accountId;
      const group = payload['group_id'];
      const toMyTeam = typeof group === 'number' && me.groupIds.includes(group);
      if (!toMe && !toMyTeam) return null;
      return { event: 'new_ticket', key: str(payload['ticket_id']) };
    }

    case 'ticket_message_created': {
      // The player's answer only — a colleague's reply or note is not an alert.
      if (payload['kind'] !== 'customer_message') return null;
      return { event: 'ticket_reply', key: str(payload['ticket_id']) };
    }

    default:
      return null;
  }
}

/**
 * What, if anything, to do about an incoming realtime push.
 *
 * Returns `null` when nothing should happen — the common case — so the caller
 * has one branch to check. The push has to be one of the listed events
 * (`classifyPush`), the master switch has to be on, the event's own switch has
 * to be on, and the agent must not already be looking at the console.
 */
export function decideNotification(args: {
  action: string;
  payload: Record<string, unknown>;
  prefs: ConsoleNotificationPrefs;
  /** True when the agent is looking at this tab — do not nag them then. */
  focused: boolean;
  permission: Permission;
  me?: NotifyMe;
}): NotifyDecision | null {
  const { action, payload, prefs, focused, permission } = args;

  const classified = classifyPush(action, payload, args.me ?? { accountId: null, groupIds: [] });
  if (!classified) return null;

  // The master switch, and the reason the negative test passes: off here means
  // no channel fires, regardless of the per-channel toggles or permission. Then
  // the event's own switch — `incoming_chat` is always on.
  if (!prefs.enabled || !prefs.events[classified.event]) return null;

  // Already watching — the message is on screen; an alert would be noise.
  if (focused) return null;

  return {
    event: classified.event,
    key: classified.key,
    badge: true,
    sound: prefs.sound,
    // Desktop degrades silently when permission is anything but granted: the
    // badge and sound still fire, so the agent is not left unaware (the
    // permission-denied case in the test strategy).
    desktop: prefs.desktop && permission === 'granted',
    repeat: classified.event === 'incoming_chat' && prefs.sound && prefs.repeat_sound,
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
