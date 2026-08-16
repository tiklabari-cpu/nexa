import { fireEvent, render, screen } from '@testing-library/react-native';

import App from './App';
import { ROOT_TABS } from './app/navigation';

/**
 * The tab bar renders every label as plain text, and — for whichever tab is
 * focused — that same word also appears as the header title and the
 * placeholder screen's own heading. `getByText('Inbox')` on the focused tab
 * is therefore ambiguous; the accessibility label React Navigation puts on
 * the tab button itself (`"Inbox, tab, 1 of 4"`) is not.
 */
const tabButton = (label: string) => screen.getByLabelText(new RegExp(`^${label}, tab,`));

/**
 * The shell now builds a session and an API client from the config (13.7-f), so
 * this suite has to stand in for both ends of that: the protected store, which
 * answers "no session" here, and the network, which answers with an empty inbox
 * rather than reaching for a real one.
 */
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  isAvailableAsync: jest.fn(async () => true),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 4,
}));

/** Stands in for the manifest Expo injects; jest-expo leaves `extra` unset. */
const mockExtra: { value: unknown } = { value: undefined };
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra.value };
    },
  },
}));

describe('App', () => {
  beforeEach(() => {
    mockExtra.value = {
      apiBaseUrl: 'https://api.nexa.test/api/v1',
      rtmBaseUrl: 'wss://rtm.nexa.test',
    };
    globalThis.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
  });

  it('mounts the shell and shows Inbox — the tab the navigator opens on', async () => {
    await render(<App />);

    // The real conversation list, not a placeholder: 13.7-f replaced it.
    expect(await screen.findByTestId('chat-list')).toBeOnTheScreen();
  });

  it('names all four FR-MOD-13.7 surfaces on the tab bar', async () => {
    await render(<App />);

    for (const label of ROOT_TABS) {
      expect(tabButton(label)).toBeOnTheScreen();
    }
  });

  it('switches screens when a tab is pressed, each showing its own placeholder', async () => {
    await render(<App />);

    await screen.findByTestId('chat-list');

    // The real Customers list, not a placeholder: 13.7-g replaced it. The
    // shared mock answers every endpoint with `{ items: [] }`, so an empty
    // directory is what a real fetch would show too.
    await fireEvent.press(tabButton('Customers'));
    expect(await screen.findByText('No customers yet.')).toBeOnTheScreen();

    await fireEvent.press(tabButton('Reports'));
    expect(screen.getByText("Salt-okunur KPI kartları 13.7-h'de gelir.")).toBeOnTheScreen();

    await fireEvent.press(tabButton('Settings'));
    expect(
      screen.getByText("Bildirim tercihleri + cihaz kaydı 13.7-j'de gelir."),
    ).toBeOnTheScreen();
  });

  it('says why the screen is empty instead of white-screening on a bad app.json', async () => {
    mockExtra.value = { apiBaseUrl: 'nope', rtmBaseUrl: 'wss://rtm.nexa.test' };

    await render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(/apiBaseUrl is not a valid URL: nope/);
    // The broken config must not fall through to a navigator that needs it.
    expect(screen.queryByLabelText(/^Inbox, tab,/)).not.toBeOnTheScreen();
  });
});
