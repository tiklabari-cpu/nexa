/**
 * What a tapped notification asks for (13.7-s).
 *
 * The reading half is pure, so the cases worth proving are the ones a device
 * cannot be made to produce on demand: a dismissal, a payload from a server one
 * deploy ahead, and the response that launched the process.
 */

// The factory closes over nothing (see `push-tokens.test.ts`). The action
// identifier is the real constant's value rather than a stand-in: it is what
// the platform actually sends, and a mock that invented one would let the
// source compare against something no device ever produces.
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
}));

import type * as Notifications from 'expo-notifications';

import { launchTap, subscribeToTaps, tapFrom } from './response';

const notifications = jest.requireMock('expo-notifications') as {
  DEFAULT_ACTION_IDENTIFIER: string;
  addNotificationResponseReceivedListener: jest.Mock;
  getLastNotificationResponseAsync: jest.Mock;
};

const DISMISSED = 'expo.modules.notifications.actions.DISMISS';

/** A response, as much of one as this module reads. */
function responseTo(
  data: unknown,
  overrides: { id?: string; actionIdentifier?: string } = {},
): Notifications.NotificationResponse {
  return {
    actionIdentifier: overrides.actionIdentifier ?? notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: {
      date: 0,
      request: { identifier: overrides.id ?? 'delivery-1', content: { data }, trigger: null },
    },
  } as unknown as Notifications.NotificationResponse;
}

describe('tapFrom', () => {
  it('names the conversation the notification was about', () => {
    expect(tapFrom(responseTo({ kind: 'message', chat_id: 'chat-7' }))).toEqual({
      id: 'delivery-1',
      chatId: 'chat-7',
    });
  });

  it('carries the delivery id, which is how the same tap is only acted on once', () => {
    const tap = tapFrom(responseTo({ kind: 'new_chat', chat_id: 'chat-7' }, { id: 'delivery-9' }));
    expect(tap?.id).toBe('delivery-9');
  });

  it('opens nothing when the notification was dismissed rather than tapped', () => {
    // Swiped away. Opening the conversation would be the opposite of what the
    // person just asked for.
    expect(
      tapFrom(responseTo({ kind: 'message', chat_id: 'chat-7' }, { actionIdentifier: DISMISSED })),
    ).toBeNull();
  });

  it('opens nothing for an action button this build does not know', () => {
    // Categories and their buttons are out of scope for 13.7-s; a later build
    // that adds one has to say here what it means.
    expect(
      tapFrom(responseTo({ kind: 'message', chat_id: 'chat-7' }, { actionIdentifier: 'reply' })),
    ).toBeNull();
  });

  it('opens nothing for a payload with no destination', () => {
    expect(tapFrom(responseTo({ kind: 'message' }))).toBeNull();
    expect(tapFrom(responseTo({ kind: 'mention', chat_id: 'chat-7' }))).toBeNull();
    expect(tapFrom(responseTo(undefined))).toBeNull();
  });

  it('answers null for no response at all', () => {
    expect(tapFrom(null)).toBeNull();
    expect(tapFrom(undefined)).toBeNull();
  });
});

describe('subscribeToTaps', () => {
  it('reports the taps that name a conversation and swallows the ones that do not', () => {
    const remove = jest.fn();
    let deliver = (_response: Notifications.NotificationResponse) => {};
    notifications.addNotificationResponseReceivedListener.mockImplementation(
      (listener: (response: Notifications.NotificationResponse) => void) => {
        deliver = listener;
        return { remove };
      },
    );

    const onTap = jest.fn();
    const unsubscribe = subscribeToTaps(onTap);

    deliver(responseTo({ kind: 'message', chat_id: 'chat-7' }));
    deliver(responseTo({ kind: 'message', chat_id: 'chat-8' }, { actionIdentifier: DISMISSED }));

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith({ id: 'delivery-1', chatId: 'chat-7' });

    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('returns an unsubscribe that works even when there was nothing to subscribe to', () => {
    notifications.addNotificationResponseReceivedListener.mockImplementation(() => {
      throw new Error('Cannot find native module "ExpoNotificationsEmitter"');
    });

    const unsubscribe = subscribeToTaps(jest.fn());
    expect(unsubscribe).not.toThrow();
  });
});

describe('launchTap', () => {
  it('reads the response the process was launched by', async () => {
    // The cold-start half: nothing was listening when the person tapped, so the
    // answer has to be asked for.
    notifications.getLastNotificationResponseAsync.mockResolvedValue(
      responseTo({ kind: 'assignment', chat_id: 'chat-3' }, { id: 'delivery-cold' }),
    );

    await expect(launchTap()).resolves.toEqual({ id: 'delivery-cold', chatId: 'chat-3' });
  });

  it('answers null when the app was opened the ordinary way', async () => {
    notifications.getLastNotificationResponseAsync.mockResolvedValue(null);

    await expect(launchTap()).resolves.toBeNull();
  });

  it('answers null rather than failing the launch when the module is absent', async () => {
    notifications.getLastNotificationResponseAsync.mockRejectedValue(new Error('no such module'));

    await expect(launchTap()).resolves.toBeNull();
  });
});
