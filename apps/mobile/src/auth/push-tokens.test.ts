/**
 * The provider's contract with the lifecycle is narrow and unforgiving: a
 * string or `null`, and never a rejection — `onSignedIn` calls it outside its
 * own try/catch and on the sign-in path, so a throw here would turn "the phone
 * has no signal" into "you cannot sign in" (13.7-l).
 */

// The factory closes over nothing: `jest.mock` is hoisted above every `const`
// in this file, so a factory referencing one would run against a variable that
// does not exist yet (the same note `secure-store.test.ts` carries).
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  IosAuthorizationStatus: {
    NOT_DETERMINED: 0,
    DENIED: 1,
    AUTHORIZED: 2,
    PROVISIONAL: 3,
    EPHEMERAL: 4,
  },
}));

import { Platform } from 'react-native';

import { currentDevicePlatform, expoPushTokens, readPushPermission } from './push-tokens';

const notifications = jest.requireMock('expo-notifications') as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getDevicePushTokenAsync: jest.Mock;
};

/** A `NotificationPermissionsStatus`, as much of one as this module reads. */
function settings(overrides: Record<string, unknown> = {}) {
  return { status: 'granted', expires: 'never', granted: true, canAskAgain: true, ...overrides };
}

const DENIED = settings({ status: 'denied', granted: false, canAskAgain: false });
const NOT_ASKED = settings({ status: 'undetermined', granted: false, canAskAgain: true });

describe('currentDevicePlatform', () => {
  it('answers with the platform the suite runs as', () => {
    expect(currentDevicePlatform()).toBe(Platform.OS);
    expect(['ios', 'android']).toContain(currentDevicePlatform());
  });
});

describe('readPushPermission', () => {
  it('reports a granted permission, without prompting for anything', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(settings());

    await expect(readPushPermission()).resolves.toBe('granted');
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('separates "not asked yet" from "asked and refused"', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(NOT_ASKED);
    await expect(readPushPermission()).resolves.toBe('undetermined');

    notifications.getPermissionsAsync.mockResolvedValue(DENIED);
    await expect(readPushPermission()).resolves.toBe('denied');
  });

  it('counts an iOS provisional authorization as granted', async () => {
    // Provisional delivers quietly to the notification centre without ever
    // having prompted. `granted` is false for it, and a screen that trusted
    // that alone would tell somebody who *is* being notified that they are not.
    notifications.getPermissionsAsync.mockResolvedValue(
      settings({ granted: false, canAskAgain: false, ios: { status: 3 } }),
    );

    await expect(readPushPermission()).resolves.toBe('granted');
  });

  it('says it could not tell, rather than inventing a refusal', async () => {
    notifications.getPermissionsAsync.mockRejectedValue(new Error('no native module'));

    await expect(readPushPermission()).resolves.toBe('unavailable');
  });
});

describe('expoPushTokens', () => {
  it('returns the handset’s own APNs/FCM address when permission is already held', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(settings());
    notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: 'apns-1' });

    await expect(expoPushTokens.getToken()).resolves.toBe('apns-1');
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks once when nobody has been asked yet, then takes the token', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(NOT_ASKED);
    notifications.requestPermissionsAsync.mockResolvedValue(settings());
    notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: 'apns-1' });

    await expect(expoPushTokens.getToken()).resolves.toBe('apns-1');
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('takes no for an answer, and fetches nothing after it', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(NOT_ASKED);
    notifications.requestPermissionsAsync.mockResolvedValue(DENIED);

    await expect(expoPushTokens.getToken()).resolves.toBeNull();
    expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });

  it('does not prompt somebody who has already refused', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(DENIED);

    await expect(expoPushTokens.getToken()).resolves.toBeNull();
    // The platform ignores a second request anyway; asking would only be a way
    // to look like the app is arguing.
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('never rejects — a phone with no signal must not fail a sign-in', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(settings());
    notifications.getDevicePushTokenAsync.mockRejectedValue(new Error('offline'));

    // `DeviceTokenLifecycle.onSignedIn` awaits this outside its own try/catch,
    // and `#redeem` awaits that, so a rejection here would surface as a failed
    // sign-in for somebody who only wanted to read their inbox.
    await expect(expoPushTokens.getToken()).resolves.toBeNull();
  });

  it('refuses an address that is not one — the web subscription shape', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(settings());
    notifications.getDevicePushTokenAsync.mockResolvedValue({
      type: 'web',
      data: { endpoint: 'https://push.example', keys: { p256dh: 'k', auth: 'a' } },
    });

    await expect(expoPushTokens.getToken()).resolves.toBeNull();
  });

  it('refuses an empty address, which the endpoint would reject anyway', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(settings());
    notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: '' });

    await expect(expoPushTokens.getToken()).resolves.toBeNull();
  });
});
