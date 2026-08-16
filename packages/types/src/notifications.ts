/**
 * Where a person wants to be interrupted, and which handsets are allowed to do
 * it (FR-MOD-13.8, FR-MOD-13.7 · 13.7-c).
 *
 * Two things live here because they are halves of one question — "does this
 * event reach this person, and through what?" — and because three different
 * runtimes have to agree on the answer: the API decides it, the web console
 * renders it, and the phone is one of the channels it decides about.
 *
 * **Preferences moved from the browser to the account.** They used to sit in
 * one `localStorage` key per browser, which was defensible while every channel
 * they governed was also per-browser (a speaker, an OS permission). Push is not:
 * the server picks the delivery target, so a preference the server cannot read
 * is a preference that does not apply to the one channel that reaches somebody
 * who has closed their laptop. They are per user *and* per license, matching
 * `notify_email`, so the same person can stay reachable for one workspace and
 * go quiet for another.
 *
 * **`enabled` is a master switch over the interruptive channels, not over
 * e-mail.** Sound, desktop and push all announce something *now*; e-mail is the
 * fallback for somebody who is not there at all, and silencing "alert me now"
 * has never been a request to stop the fallback as well. The settings screen has
 * said exactly that since 13.8 shipped ("Turning this off silences sound,
 * desktop and tab alerts alike"), so the rule is transcribed rather than
 * invented.
 */

/** The mobile platforms a push token can come from (13.7-c). */
export const DEVICE_PLATFORMS = ['ios', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export function isDevicePlatform(value: unknown): value is DevicePlatform {
  return typeof value === 'string' && (DEVICE_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Ceiling on a stored push token, in characters.
 *
 * A generous bound rather than a precise one: an APNs token is 64 hex
 * characters, an FCM registration token around 163, and an Expo token
 * `ExponentPushToken[...]` about 40 — but every one of those is a vendor's
 * current shape rather than a promise, and rejecting a longer future token
 * would silence a device for a reason nobody could see from the phone. What the
 * limit is really for is refusing a body that is not a token at all, so it is
 * set where "somebody is posting a payload" begins and no lower.
 */
export const DEVICE_TOKEN_MAX_LENGTH = 512;

/**
 * The channels an agent can be reached through, and whether each is on.
 *
 * Every field is required — a partial shape would make "absent" and "off" the
 * same value at exactly the point where the difference decides whether somebody
 * is interrupted. Partial *updates* are a separate thing and are expressed as
 * `Partial<NotificationPreferences>` at the write surface.
 */
export interface NotificationPreferences {
  /** Master switch over the interruptive channels: sound, desktop, push. */
  enabled: boolean;
  /** A short chime in the console when a visitor writes in. */
  sound: boolean;
  /** An OS notification from the console — still gated on browser permission. */
  desktop: boolean;
  /** A push notification to this account's registered handsets (13.7-d). */
  push: boolean;
  /** An e-mail when a chat assigned to the agent has new activity. */
  email: boolean;
}

export const NOTIFICATION_CHANNELS = ['enabled', 'sound', 'desktop', 'push', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * On by default, every channel.
 *
 * The product's failure mode is an agent who never learns a visitor is waiting,
 * so a fresh membership is reachable and opts *out*. Mirrors the `notify_email`
 * column default that has been in the schema since 13.8.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  sound: true,
  desktop: true,
  push: true,
  email: true,
};

/**
 * May a push be delivered to this person's devices?
 *
 * The single place the master switch is applied to push, so the sender
 * (`13.7-d`), the mobile settings screen (`13.7-j`) and the web console cannot
 * disagree about what "notifications off" means for a phone.
 */
export function pushAllowed(prefs: NotificationPreferences): boolean {
  return prefs.enabled && prefs.push;
}

/**
 * Read a stored or transmitted shape as preferences, filling in anything
 * missing or malformed from the defaults.
 *
 * Tolerant on purpose: this parses a value written by an older build (the
 * three-field browser shape) and a response from a server one deploy ahead. A
 * settings screen that threw on either would blank itself rather than show a
 * checkbox, and the failure would be indistinguishable from "you have no
 * preferences".
 */
export function readNotificationPreferences(value: unknown): NotificationPreferences {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const channel of NOTIFICATION_CHANNELS) {
    const raw = source[channel];
    if (typeof raw === 'boolean') prefs[channel] = raw;
  }
  return prefs;
}
