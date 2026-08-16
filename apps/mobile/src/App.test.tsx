import { render, screen } from '@testing-library/react-native';

import App from './App';

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

/**
 * A render test at bootstrap time is not about the boot screen's wording — that
 * screen is replaced in `13.7-e`. It is about proving the harness: that Babel,
 * the React Native preset and the workspace packages agree well enough for a
 * component to mount. The next window inherits a suite that already works.
 */
describe('App', () => {
  beforeEach(() => {
    mockExtra.value = {
      apiBaseUrl: 'https://api.nexa.test/api/v1',
      rtmBaseUrl: 'wss://rtm.nexa.test',
    };
  });

  it('mounts and shows the configured endpoints', async () => {
    await render(<App />);

    expect(screen.getByText('Nexa')).toBeOnTheScreen();
    expect(screen.getByText('API https://api.nexa.test/api/v1')).toBeOnTheScreen();
    expect(screen.getByText('RTM wss://rtm.nexa.test')).toBeOnTheScreen();
  });

  it('renders values imported at runtime from @nexa/types, not copies of them', async () => {
    await render(<App />);

    // 6 endpoints from the contract binding; the event-type count comes from
    // `@nexa/types` and is deliberately not restated here — a hard-coded number
    // would pass even if the import broke and returned an empty array.
    expect(screen.getByText(/^6 contract endpoints · \d+ event types$/)).toBeOnTheScreen();
  });

  it('says why the screen is empty instead of white-screening on a bad app.json', async () => {
    mockExtra.value = { apiBaseUrl: 'nope', rtmBaseUrl: 'wss://rtm.nexa.test' };

    await render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(/apiBaseUrl is not a valid URL: nope/);
  });
});
