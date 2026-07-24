/**
 * Notification rules and preferences (FR-MOD-13.8).
 *
 * The *decision* — which channels fire for a given push — is pure and lives
 * here, apart from the effects (sound, the OS notification, the tab title). That
 * split is deliberate: the interesting cases are all conditional (off in
 * settings, permission denied, the agent's own reply, a system event), and a
 * pure function is the only way to test them without a real browser, an audio
 * device and a permission prompt.
 */

export interface NotificationPrefs {
  /** Master switch. Off means nothing happens, whatever the others say. */
  enabled: boolean;
  /** Play a short sound on a new message. */
  sound: boolean;
  /** Show a desktop (OS) notification — still gated on browser permission. */
  desktop: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = { enabled: true, sound: true, desktop: true };

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
  prefs: NotificationPrefs;
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
 * Load preferences, tolerating an absent, malformed or partial stored value —
 * a shape written by an older build must not throw and blank the inbox.
 */
export function loadPrefs(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): NotificationPrefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_PREFS.enabled,
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULT_PREFS.sound,
      desktop: typeof parsed.desktop === 'boolean' ? parsed.desktop : DEFAULT_PREFS.desktop,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

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
