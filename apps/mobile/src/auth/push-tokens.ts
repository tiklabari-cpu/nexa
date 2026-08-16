/**
 * This handset's own delivery address, and whether the operating system will
 * let anything through it (FR-MOD-13.7 · 13.7-l).
 *
 * `13.7-b` wrote the lifecycle that decides *when* a push token is minted and
 * revoked, and injected both halves it needed — a provider and a transport —
 * because `13.7-c`'s endpoints did not exist yet. They do. This is the
 * provider: the one module in the app that talks to `expo-notifications`, kept
 * to itself so that everything else — the lifecycle, the transport, the
 * settings screen — depends on a `Promise<string | null>` rather than on a
 * native module.
 *
 * **The native token, not an Expo one.** `getExpoPushTokenAsync` would mint a
 * token through Expo's own push service, which needs an EAS project id in
 * `app.json` and a live request to a third party this project has neither an
 * account with nor permission to reach (CLAUDE.md: no real secrets, external
 * services are mocked). `getDevicePushTokenAsync` asks the operating system for
 * the APNs/FCM address instead — which is what `13.7-c`'s `token` field is
 * documented to carry, and whose `type` is already exactly the `ios | android`
 * the endpoint's `platform` requires. Sending stays mocked either way
 * (`13.7-d`); what changes is that the address is now real.
 *
 * **Nothing here throws.** `DeviceTokenLifecycle.onSignedIn` calls the provider
 * outside its own try/catch, and it is awaited on the sign-in path — so a
 * provider that rejected because a phone was in a lift would fail the sign-in
 * itself. Somebody trying to reach their inbox must not be turned away over a
 * notification. Every failure here is `null`, which the lifecycle already
 * treats as a first-class state: the person who declined notifications.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { isDevicePlatform, type DevicePlatform } from '@nexa/types';

import type { DeviceTokenProvider } from './device-token';

/**
 * What the device says about notifications, as much as a settings screen needs.
 *
 * `undetermined` and `denied` are kept apart because they are different
 * sentences to a person — one is "we have not asked yet", the other is "you
 * said no, and the switch to change it is in iOS Settings, not here".
 * `unavailable` is neither: it is this build being unable to find out, which
 * must not be reported as a refusal.
 */
export type PushPermission = 'granted' | 'undetermined' | 'denied' | 'unavailable';

/** Reads {@link PushPermission} without prompting for anything. */
export type PushPermissionReader = () => Promise<PushPermission>;

/**
 * Which of `13.7-c`'s two platforms this build is running on, or `null` where
 * the answer is neither.
 *
 * `app.json` declares `["ios", "android"]`, so `null` is unreachable on a real
 * handset. It is still returned rather than assumed: the alternative is posting
 * a `platform` the endpoint's enum rejects, and a registration that 400s on
 * every launch is a phone that silently never receives anything.
 */
export function currentDevicePlatform(): DevicePlatform | null {
  return isDevicePlatform(Platform.OS) ? Platform.OS : null;
}

/**
 * Whether a notification would actually be shown.
 *
 * Read off `granted`/`canAskAgain` rather than the `status` enum so this does
 * not import one, and widened by the iOS provisional case: a provisional
 * authorization delivers quietly to the notification centre without ever having
 * prompted, and treating that as "off" would tell somebody who *is* being
 * notified that they are not.
 */
function permissionOf(settings: Notifications.NotificationPermissionsStatus): PushPermission {
  const provisional = settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (settings.granted || provisional) return 'granted';
  return settings.canAskAgain ? 'undetermined' : 'denied';
}

/** {@link PushPermission} as it stands, asking the person for nothing. */
export const readPushPermission: PushPermissionReader = async () => {
  if (currentDevicePlatform() === null) return 'unavailable';
  try {
    return permissionOf(await Notifications.getPermissionsAsync());
  } catch {
    // A build without the native module compiled in. Saying "denied" here would
    // put a warning on the settings screen about a refusal that never happened.
    return 'unavailable';
  }
};

/**
 * The address this handset can be reached at, or `null` when it cannot be.
 *
 * The permission prompt lives here rather than on the settings screen because
 * this is the moment it is actually needed — a person who has just signed in is
 * being asked about the app they are looking at, which is the one context where
 * the request is not an ambush. Asking again on a later launch is pointless and
 * the platform ignores it, which is what `canAskAgain` reports.
 */
async function getToken(): Promise<string | null> {
  if (currentDevicePlatform() === null) return null;

  try {
    let settings = await Notifications.getPermissionsAsync();
    if (permissionOf(settings) === 'undetermined') {
      settings = await Notifications.requestPermissionsAsync();
    }
    if (permissionOf(settings) !== 'granted') return null;

    const { data } = await Notifications.getDevicePushTokenAsync();
    // `data` is `any` for the platforms the type does not name explicitly, and
    // is a `PushSubscription` object rather than a string on web. An address
    // that is not a string is not one this API can carry.
    return typeof data === 'string' && data !== '' ? data : null;
  } catch {
    // No native module, no APNs/FCM registration, or no network to complete
    // one. All of them mean the same thing to the lifecycle: no address today.
    return null;
  }
}

/** The provider `services.tsx` hands to `DeviceTokenLifecycle` in the real app. */
export const expoPushTokens: DeviceTokenProvider = { getToken };
