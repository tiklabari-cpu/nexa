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
  });

  it('mounts the shell and shows Inbox — the tab the navigator opens on', async () => {
    await render(<App />);

    expect(
      screen.getByText("Sohbet listesi, transkript ve composer 13.7-f'te gelir."),
    ).toBeOnTheScreen();
  });

  it('names all four FR-MOD-13.7 surfaces on the tab bar', async () => {
    await render(<App />);

    for (const label of ROOT_TABS) {
      expect(tabButton(label)).toBeOnTheScreen();
    }
  });

  it('switches screens when a tab is pressed, each showing its own placeholder', async () => {
    await render(<App />);

    await fireEvent.press(tabButton('Customers'));
    expect(screen.getByText("Liste ve kişi detayı 13.7-g'de gelir.")).toBeOnTheScreen();

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
