import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { NotificationsScreen } from './NotificationsScreen';
import { DevicePushPermissionContext, NotificationsContext } from './context';
import type { NotificationsApi } from './api';
import type { NotificationPreferences, NotificationPreferencesPatch } from './types';
import type { PushPermission } from '../../auth/push-tokens';
import { ThemeProvider } from '../../theme/theme';

function prefs(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return { enabled: true, sound: true, desktop: true, push: true, email: true, ...overrides };
}

function api(overrides: Partial<NotificationsApi> = {}): NotificationsApi {
  return {
    getPreferences: async () => prefs(),
    updatePreferences: async (patch: NotificationPreferencesPatch) => ({ ...prefs(), ...patch }),
    ...overrides,
  };
}

/**
 * RNTL v14 renders through a concurrent root, so `render` returns a promise —
 * an un-awaited one leaves `screen` empty rather than failing loudly (same
 * note `CustomerListScreen.test.tsx` carries).
 */
async function mount(
  notificationsApi: NotificationsApi,
  devicePermission?: PushPermission,
): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <NotificationsContext.Provider value={notificationsApi}>
        <DevicePushPermissionContext.Provider
          value={devicePermission === undefined ? null : async () => devicePermission}
        >
          <NotificationsScreen />
        </DevicePushPermissionContext.Provider>
      </NotificationsContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

function toggle(name: string) {
  return screen.getByTestId(`notification-toggle-${name}`);
}

describe('NotificationsScreen', () => {
  it('shows a loading state before preferences arrive', async () => {
    let resolve: (value: NotificationPreferences) => void = () => {};
    const pending = new Promise<NotificationPreferences>((r) => {
      resolve = r;
    });

    const tree: ReactElement = (
      <ThemeProvider>
        <NotificationsContext.Provider value={api({ getPreferences: async () => pending })}>
          <NotificationsScreen />
        </NotificationsContext.Provider>
      </ThemeProvider>
    );
    await render(tree);

    expect(screen.getByTestId('notifications-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve(prefs());
    });
  });

  it('renders every channel from the account', async () => {
    await mount(api());

    expect(toggle('enabled')).toHaveProp('value', true);
    expect(toggle('sound')).toHaveProp('value', true);
    expect(toggle('push')).toHaveProp('value', true);
    expect(toggle('desktop')).toHaveProp('value', true);
    expect(toggle('email')).toHaveProp('value', true);
  });

  it('reflects a channel the account has switched off', async () => {
    await mount(api({ getPreferences: async () => prefs({ push: false, email: false }) }));

    expect(toggle('push')).toHaveProp('value', false);
    expect(toggle('email')).toHaveProp('value', false);
    expect(toggle('sound')).toHaveProp('value', true);
  });

  it('sends only the channel that moved, and follows the server’s answer', async () => {
    const patches: NotificationPreferencesPatch[] = [];
    await mount(
      api({
        updatePreferences: async (patch) => {
          patches.push(patch);
          // The server's answer, not the local guess — a change made
          // elsewhere (another patch already in flight) can differ from
          // what this screen sent.
          return { ...prefs(), sound: false, push: false };
        },
      }),
    );

    await act(async () => {
      fireEvent(toggle('sound'), 'valueChange', false);
    });

    await waitFor(() => expect(patches).toEqual([{ sound: false }]));
    await waitFor(() => expect(toggle('push')).toHaveProp('value', false));
  });

  it('lets the master switch disable the interruptive channels — but not e-mail', async () => {
    await mount(api());

    await act(async () => {
      fireEvent(toggle('enabled'), 'valueChange', false);
    });

    // `Switch` only mirrors `disabled` into `accessibilityState` on Android
    // (`react-native/.../Switch.js`); on iOS — this suite's platform — it is
    // a plain prop, so `toBeDisabled()` (which reads `accessibilityState`)
    // cannot see it. Read the prop directly, the same way `.props.value` is
    // asserted elsewhere in this app's tests.
    await waitFor(() => expect(toggle('sound')).toHaveProp('disabled', true));
    expect(toggle('push')).toHaveProp('disabled', true);
    expect(toggle('desktop')).toHaveProp('disabled', true);
    expect(toggle('email')).toHaveProp('disabled', false);
    expect(toggle('email')).toHaveProp('value', true);
  });

  it('shows a meaningful push status when push will actually be delivered', async () => {
    await mount(api());

    expect(
      await screen.findByText(
        'Delivered to this phone and any other device signed in on this workspace.',
      ),
    ).toBeOnTheScreen();
  });

  it('shows a meaningful push status when the master switch denies it', async () => {
    await mount(api({ getPreferences: async () => prefs({ enabled: false }) }));

    expect(await screen.findByText('Off — notifications are disabled above.')).toBeOnTheScreen();
  });

  it('shows a meaningful push status when just the push channel denies it', async () => {
    await mount(api({ getPreferences: async () => prefs({ push: false }) }));

    expect(await screen.findByText('Off for this workspace.')).toBeOnTheScreen();
  });

  it('says so when the phone is refusing what the account permits', async () => {
    // The fourth state, and the only one the account cannot see: push is on
    // here and the handset shows nothing. Before 13.7-l this screen said
    // "delivered" to somebody who would never be interrupted.
    await mount(api(), 'denied');

    expect(
      await screen.findByText(
        'On for this workspace, but this phone is not allowing Nexa to notify you — turn notifications on in your device settings.',
      ),
    ).toBeOnTheScreen();
  });

  it('treats a permission nobody has been asked for the same way — nothing arrives either', async () => {
    await mount(api(), 'undetermined');

    expect(
      await screen.findByText(
        'On for this workspace, but this phone is not allowing Nexa to notify you — turn notifications on in your device settings.',
      ),
    ).toBeOnTheScreen();
  });

  it('says push is delivered once the phone allows it', async () => {
    await mount(api(), 'granted');

    expect(
      await screen.findByText(
        'Delivered to this phone and any other device signed in on this workspace.',
      ),
    ).toBeOnTheScreen();
  });

  it('does not accuse a phone this build could not ask', async () => {
    // `unavailable` is "we could not find out", not "you said no". Reporting it
    // as a refusal would put a warning on a device that is perfectly happy to
    // show notifications.
    await mount(api(), 'unavailable');

    expect(
      await screen.findByText(
        'Delivered to this phone and any other device signed in on this workspace.',
      ),
    ).toBeOnTheScreen();
  });

  it('names the account’s own switch first, even on a phone that is refusing', async () => {
    // Ordered from the switch furthest from the person to the nearest: telling
    // somebody to open iOS Settings when the thing that silenced push is a
    // toggle two rows up would send them to fix the wrong thing.
    await mount(api({ getPreferences: async () => prefs({ push: false }) }), 'denied');

    expect(await screen.findByText('Off for this workspace.')).toBeOnTheScreen();
  });

  it('says so when the save fails, rather than showing a switch that lies', async () => {
    await mount(
      api({
        updatePreferences: async () => {
          throw new Error('save failed');
        },
      }),
    );

    await act(async () => {
      fireEvent(toggle('sound'), 'valueChange', false);
    });

    expect(await screen.findByText('Could not save — please try again.')).toBeOnTheScreen();
    // Nothing was applied: the switch still holds the account's last known value.
    expect(toggle('sound')).toHaveProp('value', true);
  });

  it('says what went wrong when preferences could not be loaded', async () => {
    await mount(
      api({
        getPreferences: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });
});
