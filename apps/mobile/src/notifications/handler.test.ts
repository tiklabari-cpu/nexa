/**
 * The foreground decision (13.7-s): a payload in, a behaviour out.
 *
 * Both platforms hand this call the choice between showing a notification and
 * swallowing it, and the default when no handler is installed is to swallow —
 * so the assertions below are about the difference between somebody being told
 * and nobody being told.
 */

// The factory closes over nothing: `jest.mock` is hoisted above every `const`
// in this file (the same note `push-tokens.test.ts` carries).
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
}));

import type * as Notifications from 'expo-notifications';

import { FILE_QUIETLY, INTERRUPT, foregroundBehaviour, installForegroundHandler } from './handler';

const notifications = jest.requireMock('expo-notifications') as {
  setNotificationHandler: jest.Mock;
};

/** A delivery, as much of one as this module reads. */
function arriving(data: unknown): Notifications.Notification {
  return {
    date: 0,
    request: { identifier: 'delivery-1', content: { data }, trigger: null },
  } as unknown as Notifications.Notification;
}

describe('foregroundBehaviour', () => {
  it.each(['message', 'new_chat', 'assignment'])(
    'shows and sounds a %s the app can act on',
    (kind) => {
      expect(foregroundBehaviour(arriving({ kind, chat_id: 'chat-1' }))).toEqual(INTERRUPT);
    },
  );

  it('shows a banner, lists it, and plays a sound — but sets no badge', () => {
    // Spelled out rather than left to `INTERRUPT`'s identity: the banner is the
    // whole feature, and the badge is named out of scope (a count nothing
    // counts, which the phone could never correct).
    expect(INTERRUPT).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it('files a payload it cannot route quietly instead of interrupting', () => {
    // A tap on this one would go nowhere — `readPushPayload` refused it — so
    // buzzing a pocket for it is the wrong trade. It stays in the tray.
    expect(foregroundBehaviour(arriving({ kind: 'message' }))).toEqual(FILE_QUIETLY);
    expect(foregroundBehaviour(arriving({ kind: 'mention', chat_id: 'chat-1' }))).toEqual(
      FILE_QUIETLY,
    );
    expect(foregroundBehaviour(arriving(undefined))).toEqual(FILE_QUIETLY);
  });

  it('never erases a delivery, whichever way it decides', () => {
    // The one property both answers share. "Do not interrupt" must not become
    // "the server told you something and you will never know".
    expect(INTERRUPT.shouldShowList).toBe(true);
    expect(FILE_QUIETLY.shouldShowList).toBe(true);
  });
});

describe('installForegroundHandler', () => {
  it('registers a handler that answers with the behaviour for the notification', async () => {
    expect(installForegroundHandler()).toBe(true);

    const [handler] = notifications.setNotificationHandler.mock.calls[0] as [
      Notifications.NotificationHandler,
    ];
    await expect(
      handler.handleNotification(arriving({ kind: 'message', chat_id: 'c' })),
    ).resolves.toEqual(INTERRUPT);
    await expect(handler.handleNotification(arriving(null))).resolves.toEqual(FILE_QUIETLY);
  });

  it('says so and does not throw when there is no native module to install on', () => {
    // A build without `expo-notifications` compiled in, or a platform with no
    // notification centre. This runs on the launch path — the app still opens.
    notifications.setNotificationHandler.mockImplementation(() => {
      throw new Error('Cannot find native module "ExpoNotificationsHandler"');
    });

    expect(installForegroundHandler()).toBe(false);
  });
});
